const REQUIRED_HEADERS = ['总成编号', '商品名称', '模组编码', '测试编码']

function cellText(value) { return String(value == null ? '' : value) }
// 仅用于判断业务内容是否相同；实际写入仍保留 Excel 原始字符串。
// 保留换行和单个分隔空格的语义，不改动 /、括号、数字、字母或其他业务字符。
function normalizeForComparison(value) {
  return cellText(value)
    .normalize('NFC')
    .replace(/\r\n?|\u2028|\u2029/g, '\n')
    .replace(/[\u180E\u200B\u2060\uFEFF]/g, '')
    .replace(/[\t\v\f\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .split('\n')
    .map(line => line.replace(/ +/g, ' ').trim())
    .join('\n')
    .trim()
}
function normalizeWorkbookRows(rows) {
  const headerIndex = rows.findIndex(row => REQUIRED_HEADERS.every(h => row.map(v => cellText(v).trim()).includes(h)))
  if (headerIndex < 0) throw new Error(`未找到完整表头：${REQUIRED_HEADERS.join('、')}`)
  const headers = rows[headerIndex].map(v => cellText(v).trim())
  const columns = Object.fromEntries(REQUIRED_HEADERS.map(h => [h, headers.indexOf(h)]))
  const sourceRows = rows.slice(headerIndex + 1)
  const nonBlankRows = sourceRows.map((row,index)=>({row,excelRow:headerIndex+2+index})).filter(item => item.row.some(v => cellText(v).trim() !== ''))
  const entries = []
  const errors = []
  for (let i = 0; i < nonBlankRows.length; i++) {
    const {row,excelRow}=nonBlankRows[i]
    const assemblyCode = cellText(row[columns['总成编号']]).trim().toUpperCase()
    if (!assemblyCode) { errors.push({ row:excelRow, assemblyCode:'', reason:'总成编号为空' }); continue }
    entries.push({ excelRow, record:{
      assemblyCode,
      productName: cellText(row[columns['商品名称']]),
      moduleCode: cellText(row[columns['模组编码']]),
      testCode: cellText(row[columns['测试编码']])
    }})
  }
  const counts = new Map()
  for (const item of entries) counts.set(item.record.assemblyCode, (counts.get(item.record.assemblyCode) || 0) + 1)
  const duplicateAssemblyCodes = [...counts].filter(([, count]) => count > 1).map(([code]) => code).sort()
  const duplicateSet=new Set(duplicateAssemblyCodes)
  for(const item of entries) if(duplicateSet.has(item.record.assemblyCode)) errors.push({row:item.excelRow,assemblyCode:item.record.assemblyCode,reason:'总成编号重复'})
  const records=entries.map(x=>x.record)
  return { headerIndex, sourceRowCount: sourceRows.length, nonBlankRowCount: nonBlankRows.length, records, errors, duplicateAssemblyCodes }
}

function sameBusinessFields(a, b) {
  return ['assemblyCode', 'productName', 'moduleCode', 'testCode'].every(key => cellText(a[key]) === cellText(b[key]))
}

function diffModels(incoming, existing) {
  const existingMap = new Map(existing.map(row => [cellText(row.assemblyCode).trim().toUpperCase(), row]))
  const create = [], update = [], unchanged = []
  for (const row of incoming) {
    const old = existingMap.get(row.assemblyCode)
    if (!old) create.push(row)
    else {
      const effective={...row}; const changes=[]; const preservedBlankFields=[]
      for(const field of ['productName','moduleCode','testCode']){
        const oldValue=cellText(old[field]), excelValue=cellText(row[field])
        const oldComparable=normalizeForComparison(oldValue), excelComparable=normalizeForComparison(excelValue)
        if(excelComparable===''){
          effective[field]=oldValue
          if(oldComparable!=='')preservedBlankFields.push(field)
          continue
        }
        if(excelComparable===oldComparable){
          effective[field]=oldValue
          continue
        }
        changes.push({field,oldValue,newValue:excelValue})
      }
      if(changes.length)update.push({row:effective,old,changes,preservedBlankFields})
      else unchanged.push({row:effective,old,preservedBlankFields})
    }
  }
  return { create, update, unchanged }
}

function chunks(items, size = 20) {
  const result = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

module.exports = { REQUIRED_HEADERS, normalizeForComparison, normalizeWorkbookRows, diffModels, chunks }
