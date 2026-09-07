import fs from 'node:fs/promises'
import path from 'node:path'
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool'

const source = process.argv[2]
if (!source) throw new Error('用法: npm run excel:prepare -- "Excel文件路径.xlsx"')
const sourcePath = path.resolve(source)
await fs.access(sourcePath)

const input = await FileBlob.load(sourcePath)
const workbook = await SpreadsheetFile.importXlsx(input)
const sheets = workbook.worksheets.items
if (!sheets.length) throw new Error('Excel 没有工作表')

const required = ['总成编号', '商品名称', '模组编码', '测试编码']
let selected = null
const sheetSummaries = []
for (const sheet of sheets) {
  const used = sheet.getUsedRange(true)
  const values = used ? used.values : []
  sheetSummaries.push({ name:sheet.name, usedRows:values.length, usedColumns:Math.max(0, ...values.map(row => row.length)) })
  const headerIndex = values.findIndex(row => required.every(h => row.map(cell => String(cell ?? '').trim()).includes(h)))
  if (!selected && headerIndex >= 0) selected = { sheet, values, headerIndex }
}
if (!selected) throw new Error(`所有工作表均未找到完整表头: ${required.join('、')}`)

const { sheet, values:rows, headerIndex } = selected
const headers = rows[headerIndex].map(x => String(x ?? '').trim())
const columns = Object.fromEntries(required.map(h => [h, headers.indexOf(h)]))
const text = value => String(value == null ? '' : value).trim()
const sourceRows = rows.slice(headerIndex + 1)
const mappedRows = sourceRows.map(row => ({
  assemblyCode:text(row[columns['总成编号']]),
  productName:text(row[columns['商品名称']]),
  moduleCode:text(row[columns['模组编码']]),
  testCode:text(row[columns['测试编码']])
}))
const nonBlankRows = mappedRows.filter(row => Object.values(row).some(Boolean))
const records = nonBlankRows.filter(row => row.assemblyCode)
const countBy = (items, selector) => items.reduce((map, item) => { const key=selector(item); if(key) map.set(key,(map.get(key)||0)+1); return map }, new Map())
const duplicateAssemblyCodes = [...countBy(records,x=>x.assemblyCode.toUpperCase())].filter(([,count])=>count>1).map(([assemblyCode,count])=>({assemblyCode,count}))
const duplicateTestCodes = [...countBy(records,x=>x.testCode)].filter(([,count])=>count>1).map(([testCode,count])=>({testCode,count}))
const modelTokens = name => [...new Set((name.match(/(?:IPHONE\s*)?[A-Z]{1,4}[- ]?\d{2,}[A-Z0-9+\-]*/gi)||[]).map(x=>x.replace(/\s+/g,'').toUpperCase()))]
const multiModelProducts = records.map(x=>({assemblyCode:x.assemblyCode,models:modelTokens(x.productName)})).filter(x=>x.models.length>1)
const modelAssemblies = new Map()
for (const row of records) for (const token of modelTokens(row.productName)) {
  if (!modelAssemblies.has(token)) modelAssemblies.set(token,new Set())
  modelAssemblies.get(token).add(row.assemblyCode)
}
const modelsAcrossAssemblies = [...modelAssemblies].filter(([,codes])=>codes.size>1).map(([model,codes])=>({model,assemblyCodes:[...codes]}))
const demoValidationRows = records.filter(x=>x.assemblyCode.toUpperCase()==='E001')
const rawTestTypes = sourceRows.map(row=>row[columns['测试编码']]).filter(v=>v!==''&&v!=null).reduce((m,v)=>(m[typeof v]=(m[typeof v]||0)+1,m),{})

const report = {
  sourceFile:path.basename(sourcePath), workbookSheets:sheetSummaries, selectedSheet:sheet.name,
  headerRow:headerIndex+1, actualDataRowCount:sourceRows.length,
  completelyBlankRowCount:mappedRows.length-nonBlankRows.length,
  nonBlankDataRowCount:nonBlankRows.length, validModelCount:records.length,
  skippedInvalidRowCount:nonBlankRows.length-records.length, exportedRecordCount:records.length,
  blankAssemblyCodeCount:nonBlankRows.filter(x=>!x.assemblyCode).length,
  blankProductNameCount:records.filter(x=>!x.productName).length,
  blankTestCodeCount:records.filter(x=>!x.testCode).length,
  rawNonBlankTestCodeTypes:rawTestTypes,
  duplicateAssemblyCodeCount:duplicateAssemblyCodes.length, duplicateAssemblyCodes,
  duplicateTestCodeValueCount:duplicateTestCodes.length,
  duplicateTestCodeRecordCount:duplicateTestCodes.reduce((sum,x)=>sum+x.count,0), duplicateTestCodes,
  demoValidation:demoValidationRows.map(x=>({assemblyCode:x.assemblyCode,productName:x.productName,testCodeBlank:!x.testCode})),
  hasProductContainingMultipleModelTokens:multiModelProducts.length>0,
  multiModelProductCount:multiModelProducts.length, multiModelProductExamples:multiModelProducts.slice(0,20),
  hasSameModelAcrossMultipleAssemblies:modelsAcrossAssemblies.length>0,
  modelAcrossAssembliesCount:modelsAcrossAssemblies.length, modelAcrossAssembliesExamples:modelsAcrossAssemblies.slice(0,20),
  modelTokenDetectionNote:'手机型号统计使用保守的字母数字型号标记规则，仅用于发现候选；需结合业务人工复核。'
}

const outputDir = path.resolve(process.cwd(),'local-import-output')
await fs.mkdir(outputDir,{recursive:true})
await fs.writeFile(path.join(outputDir,'models-import.json'),JSON.stringify(records,null,2),'utf8')
await fs.writeFile(path.join(outputDir,'models-import.ndjson'),records.map(x=>JSON.stringify(x)).join('\n'),'utf8')
await fs.writeFile(path.join(outputDir,'import-report.json'),JSON.stringify(report,null,2),'utf8')
console.log(JSON.stringify(report,null,2))
if (duplicateAssemblyCodes.length || report.blankAssemblyCodeCount || report.exportedRecordCount!==report.validModelCount) process.exitCode=2
