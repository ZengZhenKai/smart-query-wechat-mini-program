'use strict'
const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')

const source = process.argv[2]
if (!source) throw new Error('用法: npm run excel:prepare -- "Excel文件路径.xlsx"')
const sourcePath = path.resolve(source)
if (!fs.existsSync(sourcePath)) throw new Error(`文件不存在: ${sourcePath}`)

const workbook = XLSX.readFile(sourcePath, { cellDates:false })
const sheetName = workbook.SheetNames[0]
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header:1, defval:'', raw:true })
const required = ['总成编号', '商品名称', '模组编码', '测试编码']
const headerIndex = rows.findIndex(row => required.every(h => row.map(cell => String(cell).trim()).includes(h)))
if (headerIndex < 0) throw new Error(`未找到完整表头: ${required.join('、')}`)
const headers = rows[headerIndex].map(x => String(x).trim())
const columns = Object.fromEntries(required.map(h => [h, headers.indexOf(h)]))
const text = value => String(value == null ? '' : value).trim()
const sourceRows = rows.slice(headerIndex + 1)
const mappedRows = sourceRows.map(row => ({
  assemblyCode: text(row[columns['总成编号']]),
  productName: text(row[columns['商品名称']]),
  moduleCode: text(row[columns['模组编码']]),
  testCode: text(row[columns['测试编码']])
}))
const nonBlankRows = mappedRows.filter(row => Object.values(row).some(Boolean))
// 有效型号以存在总成编号为准；无编号行会报告但不会进入正式导入文件。
const records = nonBlankRows.filter(row => row.assemblyCode)

const assemblyCounts = records.reduce((m, x) => (x.assemblyCode && m.set(x.assemblyCode, (m.get(x.assemblyCode) || 0) + 1), m), new Map())
const duplicateAssemblyCodes = [...assemblyCounts].filter(([, n]) => n > 1).map(([assemblyCode, count]) => ({ assemblyCode, count }))
const testCodeCounts = records.reduce((m, x) => (x.testCode && m.set(x.testCode, (m.get(x.testCode) || 0) + 1), m), new Map())
const duplicateTestCodes = [...testCodeCounts].filter(([, n]) => n > 1).map(([testCode, count]) => ({ testCode, count }))
const modelTokens = name => [...new Set((name.match(/(?:IPHONE\s*)?[A-Z]{1,4}[- ]?\d{2,}[A-Z0-9+\-]*/gi) || []).map(x => x.replace(/\s+/g, '').toUpperCase()))]
const multiModelProducts = records.map(x => ({ assemblyCode:x.assemblyCode, models:modelTokens(x.productName) })).filter(x => x.models.length > 1)
const modelAssemblies = new Map()
for (const row of records) for (const token of modelTokens(row.productName)) {
  if (!modelAssemblies.has(token)) modelAssemblies.set(token, new Set())
  modelAssemblies.get(token).add(row.assemblyCode)
}
const modelsAcrossAssemblies = [...modelAssemblies].filter(([, codes]) => codes.size > 1).map(([model, codes]) => ({ model, assemblyCodes:[...codes] }))
const demoValidationRows = records.filter(x => x.assemblyCode.toUpperCase() === 'E001')
const report = {
  sourceFile: path.basename(sourcePath), sheetName, headerRow: headerIndex + 1,
  actualDataRowCount: sourceRows.length,
  completelyBlankRowCount: mappedRows.length - nonBlankRows.length,
  nonBlankDataRowCount: nonBlankRows.length,
  validModelCount: records.length,
  skippedInvalidRowCount: nonBlankRows.length - records.length,
  exportedRecordCount: records.length,
  blankAssemblyCodeCount: nonBlankRows.filter(x => !x.assemblyCode).length,
  blankProductNameCount: records.filter(x => !x.productName).length,
  blankTestCodeCount: records.filter(x => !x.testCode).length,
  duplicateAssemblyCodeCount: duplicateAssemblyCodes.length,
  duplicateAssemblyCodes,
  duplicateTestCodeValueCount: duplicateTestCodes.length,
  duplicateTestCodeRecordCount: duplicateTestCodes.reduce((sum, x) => sum + x.count, 0),
  duplicateTestCodes,
  demoValidation: demoValidationRows.map(x => ({ assemblyCode:x.assemblyCode, productName:x.productName, testCodeBlank:!x.testCode })),
  hasProductContainingMultipleModelTokens: multiModelProducts.length > 0,
  multiModelProductCount: multiModelProducts.length,
  multiModelProductExamples: multiModelProducts.slice(0, 20),
  hasSameModelAcrossMultipleAssemblies: modelsAcrossAssemblies.length > 0,
  modelAcrossAssembliesCount: modelsAcrossAssemblies.length,
  modelAcrossAssembliesExamples: modelsAcrossAssemblies.slice(0, 20),
  modelTokenDetectionNote: '手机型号统计使用保守的字母数字型号标记规则，仅用于发现候选；需结合业务人工复核。'
}
const outputDir = path.resolve(process.cwd(), 'local-import-output')
fs.mkdirSync(outputDir, { recursive:true })
fs.writeFileSync(path.join(outputDir, 'models-import.json'), JSON.stringify(records, null, 2), 'utf8')
fs.writeFileSync(path.join(outputDir, 'models-import.ndjson'), records.map(x => JSON.stringify(x)).join('\n'), 'utf8')
fs.writeFileSync(path.join(outputDir, 'import-report.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify(report, null, 2))
if (duplicateAssemblyCodes.length || report.blankAssemblyCodeCount || report.exportedRecordCount !== report.validModelCount) process.exitCode = 2
