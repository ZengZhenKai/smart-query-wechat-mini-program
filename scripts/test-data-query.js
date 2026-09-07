'use strict'
const assert = require('assert')

function query(records, keyword) {
  const key = String(keyword).trim().toLowerCase()
  return records.filter(x => String(x.assemblyCode).toLowerCase() === key || String(x.productName).toLowerCase().includes(key))
    .map(x => ({ ...x, matchType:String(x.assemblyCode).toLowerCase() === key ? 'assembly_exact' : 'product_contains' }))
    .sort((a,b) => (a.matchType === 'assembly_exact' ? 0 : 1) - (b.matchType === 'assembly_exact' ? 0 : 1))
}

const specialCode = 'TEST-002 / TEST-002B\n（Demo 说明）'
const fixtures = [
  { assemblyCode:'E001', productName:'Demo 型号 A', moduleCode:'DEMO-M1', testCode:'' },
  { assemblyCode:'E002', productName:'Demo 型号 B', moduleCode:'DEMO-M2', testCode:specialCode },
  { assemblyCode:'E003', productName:'Demo 型号 C', moduleCode:'DEMO-M3', testCode:'TEST-003' }
]
assert.strictEqual(query(fixtures, 'e001')[0].assemblyCode, 'E001', 'E编号应忽略大小写精确匹配')
assert.strictEqual(query(fixtures, 'E001')[0].matchType, 'assembly_exact', '精确总成编号必须优先')
assert.strictEqual(query(fixtures, 'Demo 型号').length, 3, '商品名称包含搜索必须返回多结果')
assert.strictEqual(query(fixtures, 'E001')[0].testCode, '', '空testCode必须保留空字符串')
assert.strictEqual(JSON.parse(JSON.stringify(fixtures))[1].testCode, specialCode, '特殊字符testCode序列化后必须原样保留')
console.log('虚构 Demo 数据查询测试通过：精确匹配、多结果与特殊字符均符合预期。')
