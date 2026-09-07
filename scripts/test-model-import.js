'use strict'
const fs=require('fs'), assert=require('assert')
const {normalizeForComparison,normalizeWorkbookRows,diffModels,chunks}=require('../cloudfunctions/api/lib/model-import')

const special='001 / 002\n（中文说明 原样）'
const rows=[['公司型号表'],[],['总成编号','商品名称','模组编码','测试编码'],[' e900 ','新型号','M1',''],['E901','多行型号','M2',special]]
const parsed=normalizeWorkbookRows(rows)
assert.strictEqual(parsed.records[0].assemblyCode,'E900','assemblyCode应去空格并大写')
assert.strictEqual(parsed.records[0].testCode,'','空testCode应保留空字符串')
assert.strictEqual(parsed.records[1].testCode,special,'多行括号中文testCode必须原样保留')

const existing=[{_id:'old1',assemblyCode:'E899',productName:'旧型号',moduleCode:'',testCode:'OLD'},{_id:'same',assemblyCode:'E900',productName:'新型号',moduleCode:'M1',testCode:''},{_id:'update',assemblyCode:'E901',productName:'旧名称',moduleCode:'M2',testCode:special}]
const diff=diffModels(parsed.records,existing)
assert.strictEqual(diff.create.length,0)
assert.strictEqual(diff.update.length,1,'字段变化应更新')
assert.strictEqual(diff.unchanged.length,1,'完全相同不应重复写入')
assert.ok(existing.some(x=>x.assemblyCode==='E899'),'Excel未包含的旧型号必须保留且不进入删除逻辑')
const addDiff=diffModels([{assemblyCode:'E902',productName:'新增',moduleCode:'',testCode:''}],existing)
assert.strictEqual(addDiff.create.length,1,'新assemblyCode应新增')
const duplicateParsed=normalizeWorkbookRows([rows[2],['E001','','',''],[' e001 ','','','']])
assert.deepStrictEqual(duplicateParsed.duplicateAssemblyCodes,['E001'],'重复assemblyCode必须被识别')
assert.strictEqual(duplicateParsed.errors.length,2,'重复的每一行都必须出现在异常明细')
assert.deepStrictEqual(duplicateParsed.errors.map(x=>x.row),[2,3],'异常明细必须保留真实Excel行号')
assert.deepStrictEqual(chunks([1,2,3,4,5],2),[[1,2],[3,4],[5]],'写入必须分批')

const blankExisting=[{_id:'blank-safe',assemblyCode:'E260',productName:'数据库商品名',moduleCode:'数据库模组',testCode:'旧编码 / A\n中文说明'}]
const blankDiff=diffModels([{assemblyCode:'E260',productName:'',moduleCode:'',testCode:''}],blankExisting)
assert.strictEqual(blankDiff.update.length,0,'Excel全空白不应触发清空更新')
assert.strictEqual(blankDiff.unchanged.length,1,'Excel全空白应归为无变化')
assert.strictEqual(blankDiff.unchanged[0].row.productName,'数据库商品名','空商品名称必须保留数据库原值')
assert.strictEqual(blankDiff.unchanged[0].row.testCode,'旧编码 / A\n中文说明','空测试编码必须保留数据库原值')
assert.deepStrictEqual(blankDiff.unchanged[0].preservedBlankFields,['productName','moduleCode','testCode'],'预览必须标记所有被保护的空白字段')
const partialBlankDiff=diffModels([{assemblyCode:'E260',productName:'Excel新商品名',moduleCode:'',testCode:''}],blankExisting)
assert.strictEqual(partialBlankDiff.update.length,1,'非空字段真实变化应更新')
assert.deepStrictEqual(partialBlankDiff.update[0].changes,[{field:'productName',oldValue:'数据库商品名',newValue:'Excel新商品名'}],'更新明细只应显示真正变化字段')
assert.strictEqual(partialBlankDiff.update[0].row.testCode,'旧编码 / A\n中文说明','同一更新记录中的空测试编码仍须保留')
const whitespaceBlankDiff=diffModels([{assemblyCode:'E260',productName:'  ',moduleCode:'\t',testCode:' \n '}],blankExisting)
assert.strictEqual(whitespaceBlankDiff.update.length,0,'仅含空格或换行的Excel单元格也不得清空数据库原值')
assert.strictEqual(whitespaceBlankDiff.unchanged[0].row.testCode,'旧编码 / A\n中文说明','空白字符单元格必须保留测试编码原值')
assert.strictEqual(normalizeForComparison(' A\r\nB\rC '),'A\nB\nC','CRLF、CR、LF必须统一为LF')
assert.strictEqual(normalizeForComparison('\u3000A\u00a0\t B\u200bC  '),'A BC','全角空格、NBSP、Tab和连续空格必须统一，零宽空格必须移除')
const invisibleFormatExisting=[
  {_id:'e293',assemblyCode:'E293',productName:'\u00a0原版总成S23/S665C  ',moduleCode:'Z293',testCode:'098070/098071'},
  {_id:'e296',assemblyCode:'E296',productName:'原版总成\tA70/A05S/\u3000itel P55 5G\r\n',moduleCode:'Z296',testCode:'117770'},
  {_id:'e072',assemblyCode:'E072',productName:'总成 KC6/ COMSparkGo/KC1 COM/Spark5air',moduleCode:'Z072',testCode:'05201/750  S15\t2411'}
]
const invisibleFormatIncoming=[
  {assemblyCode:'E293',productName:'原版总成S23/S665C',moduleCode:'Z293',testCode:'098070/098071'},
  {assemblyCode:'E296',productName:'原版总成 A70/A05S/ itel  P55 5G\n',moduleCode:'Z296',testCode:'117770'},
  {assemblyCode:'E072',productName:'总成 KC6/ COMSparkGo/KC1 COM/Spark5air',moduleCode:'Z072',testCode:'05201/750 S15 2411'}
]
const invisibleFormatDiff=diffModels(invisibleFormatIncoming,invisibleFormatExisting)
assert.strictEqual(invisibleFormatDiff.update.length,0,'E293/E296/E072类肉眼相同的不可见格式差异不得进入更新')
assert.strictEqual(invisibleFormatDiff.unchanged.length,3,'格式等价记录必须全部归类为无变化')
assert.strictEqual(invisibleFormatDiff.unchanged[0].row.productName,invisibleFormatExisting[0].productName,'格式等价时必须沿用数据库原值而非清洗重写')
const realCodeChange=diffModels([{assemblyCode:'E293',productName:'原版总成S23/S665C',moduleCode:'Z293',testCode:'098070/098072 (新)'}],invisibleFormatExisting)
assert.strictEqual(realCodeChange.update.length,1,'测试编码数字或括号内容真正变化必须更新')
assert.deepStrictEqual(realCodeChange.update[0].changes.map(x=>x.field),['testCode'],'真正变化时只显示变化字段')
assert.strictEqual(normalizeForComparison('750 X5516/（710）077930'),'750 X5516/（710）077930','不得删除测试编码中的分隔空格、斜杠和括号')
assert.notStrictEqual(normalizeForComparison('750 X5516'),normalizeForComparison('750X5516'),'有业务意义的单个分隔空格不得被删除')
const numericParsed=normalizeWorkbookRows([rows[2],['E407','数字格式测试','Z407',117703098080]])
const numericDiff=diffModels(numericParsed.records,[{_id:'e407',assemblyCode:'E407',productName:'数字格式测试',moduleCode:'Z407',testCode:'117703098080'}])
assert.strictEqual(numericDiff.update.length,0,'E407数字底层值转字符串后必须与数据库编码一致')
const manyExisting=Array.from({length:482},(_,i)=>({_id:`id-${i}`,assemblyCode:`E${String(i).padStart(3,'0')}`,productName:`商品${i}`,moduleCode:'M',testCode:'T'}))
const manyIncoming=manyExisting.map((item,i)=>({assemblyCode:item.assemblyCode,productName:i<39?`${item.productName}新版`:item.productName,moduleCode:item.moduleCode,testCode:item.testCode}))
const manyDiff=diffModels(manyIncoming,manyExisting)
assert.strictEqual(manyDiff.update.length,39,'39条真实变化必须全部进入更新明细')
assert.strictEqual(manyDiff.unchanged.length,443,'其余443条必须全部进入无变化明细')

const cloud=fs.readFileSync('cloudfunctions/api/index.js','utf8')
assert.match(cloud,/previewModelsExcel[\s\S]*getCurrentUser\(openid,\{roles:ADMIN_ROLES\}\)/,'预览必须服务端验证管理员')
assert.match(cloud,/confirmModelsExcel[\s\S]*getCurrentUser\(openid,\{roles:ADMIN_ROLES\}\)/,'确认必须服务端验证管理员')
assert.match(cloud,/checkModelImportPermission[\s\S]*getCurrentUser\(openid,\{roles:ADMIN_ROLES\}\)/,'导入页面准入必须服务端验证管理员')
assert.match(cloud,/import_models_excel/,'必须写导入日志')
assert.match(cloud,/finally \{ await deleteTempFile\(payload\.fileID\) \}/,'确认后必须清理临时Excel')
assert.ok(!/\.remove\(\)/.test(cloud.match(/ACTIONS\.confirmModelsExcel[\s\S]*?\n\}/)[0]),'导入确认不得删除Excel未出现的旧型号')
const previewAction=cloud.slice(cloud.indexOf('ACTIONS.previewModelsExcel'),cloud.indexOf('ACTIONS.checkModelImportPermission'))
assert.ok(!/collection\(['"]models['"]\)[\s\S]*?\.(add|update|remove)\(/.test(previewAction),'预览阶段不得写入models数据库')
assert.match(cloud,/const updateDetails[\s\S]*changes:item\.changes/,'预览必须返回逐字段更新明细')
const importHelper=fs.readFileSync('cloudfunctions/api/lib/model-import.js','utf8')
assert.match(importHelper,/changes\.push\(\{field,oldValue,newValue:excelValue\}\)/,'更新明细必须包含字段原值和Excel新值')
assert.match(cloud,/errorDetails:parsed\.errors/,'预览必须返回完整异常行明细')
assert.match(cloud,/changeSetHash\(diff\)!==payload\.changeSetHash/,'确认必须校验数据库变更集与预览完全一致')
assert.match(cloud,/sheet_to_json\([\s\S]*?raw:true/,'云端必须读取Excel底层值，避免数字显示格式制造假更新')
const page=fs.readFileSync('miniprogram/pages/model-import/index.wxml','utf8')
assert.match(page,/更新 \{\{preview\.updateCount\}\} 条[\s\S]*updateItem\.changes/,'更新分类必须可逐条显示真正变更字段')
assert.match(page,/unchangedLimit < preview\.unchangedCount/,'大量无变化数据必须分页查看更多')
assert.match(page,/updateLimit < preview\.updateCount/,'39条更新必须支持查看更多直至全部展示')
const pageScript=fs.readFileSync('miniprogram/pages/model-import/index.js','utf8')
assert.match(pageScript,/const PAGE_SIZE = 20/,'明细首屏必须限制渲染数量')
assert.match(pageScript,/\[config\.visible\]: this\.data\.preview\[config\.source\]\.slice\(0, nextLimit\)/,'查看更多必须从完整明细继续加载')
assert.match(page,/已保留数据库原值（不会清空）/,'页面必须显式提示空白字段保护')
console.log('型号Excel导入测试通过：分类明细/分页/空白保护/预览只读/变更集一致/新增更新不变/保留旧型号/异常行号/字符串保真/权限/日志/清理。')
