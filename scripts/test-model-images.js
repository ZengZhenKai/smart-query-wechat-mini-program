'use strict'

const fs = require('fs')
const assert = require('assert')
const server = require('../cloudfunctions/api/lib/model-images')
const client = require('../miniprogram/utils/model-images')

const empty = client.fillImageSlots([])
assert.strictEqual(empty.length, 5, '无图时必须生成5个槽位')
assert.ok(empty.every(item => !item.fileID), '无图时5个槽位都必须为空')

const one = client.fillImageSlots([{ slot:1, fileID:'cloud://env/model-images/e/slot-1/a.jpg', url:'https://temp/1' }])
assert.strictEqual(one.filter(item => item.fileID).length, 1, '上传1张后必须只有1个已用槽位')
assert.strictEqual(one.filter(item => !item.fileID).length, 4, '上传1张后必须保留4个空槽位')

const five = client.fillImageSlots(Array.from({ length:5 }, (_, index) => ({ slot:index + 1, fileID:`cloud://env/${index + 1}.jpg`, url:`https://temp/${index + 1}` })))
assert.strictEqual(five.filter(item => item.fileID).length, 5, '必须支持5个固定图片槽位')
assert.throws(() => server.normalizeImageSlot(6), /最多上传5张图片/, '第6张必须被阻止')

const grouped = server.groupModelImages([
  { assemblyCode:'E250', slot:1, fileID:'cloud://env/e250-1.jpg' },
  { assemblyCode:'E161', slot:1, fileID:'cloud://env/e161-1.jpg' },
  { assemblyCode:'E250', slot:3, fileID:'cloud://env/e250-3.jpg' }
], ['E250', 'E161'])
assert.deepStrictEqual(grouped.E250.map(item => item.slot), [1, 3], '删除slot2/slot3时不得移动其他槽位')
assert.deepStrictEqual(grouped.E161.map(item => item.fileID), ['cloud://env/e161-1.jpg'], '不同总成编号不得串图')
assert.ok(grouped.E250.every(item => !item.fileID.includes('e161')), 'E250不得包含E161图片')

const multi = client.withImageSlots([
  { assemblyCode:'E250', images:[{ slot:2, fileID:'cloud://env/e250.jpg', url:'https://temp/e250' }] },
  { assemblyCode:'E161', images:[{ slot:4, fileID:'cloud://env/e161.jpg', url:'https://temp/e161' }] }
])
assert.strictEqual(multi[0].imageSlots[1].fileID, 'cloud://env/e250.jpg', '多结果第一张卡必须使用自身图片')
assert.strictEqual(multi[1].imageSlots[3].fileID, 'cloud://env/e161.jpg', '多结果第二张卡必须使用自身图片')
assert.deepStrictEqual(client.previewableFileIDs(multi[0]), ['https://temp/e250'], '大图预览必须只浏览当前总成编号图片')

const path = server.buildModelImageCloudPath('E250', 2, 'jpg', 123, 'abcdef12')
assert.match(path, /^model-images\/.+\/slot-2\/123-abcdef12\.jpg$/, '云存储路径必须包含总成编号键和固定slot')
assert.ok(server.isAllowedModelImageFileID(`cloud://env.xxx/${path}`, 'E250', 2), '正确总成编号和slot路径必须通过')
assert.ok(!server.isAllowedModelImageFileID(`cloud://env.xxx/${path}`, 'E161', 2), '其他总成编号路径必须拒绝')

const api = fs.readFileSync('cloudfunctions/api/index.js', 'utf8')
const searchJs = fs.readFileSync('miniprogram/pages/search/index.js', 'utf8')
const searchWxml = fs.readFileSync('miniprogram/pages/search/index.wxml', 'utf8')
const editJs = fs.readFileSync('miniprogram/pages/model-edit/index.js', 'utf8')
const editWxml = fs.readFileSync('miniprogram/pages/model-edit/index.wxml', 'utf8')
const databaseRules = JSON.parse(fs.readFileSync('docs/database-security-rules.json', 'utf8'))
const storageRules = JSON.parse(fs.readFileSync('docs/storage-security-rules.example.json', 'utf8'))
const importSection = api.slice(api.indexOf('ACTIONS.previewModelsExcel'), api.indexOf('async function validateModel'))

assert.match(api, /loadModelImagesByAssemblyCodes\(r\.data\.map\(record => record\.assemblyCode\)\)/, '查询必须仅按命中assemblyCode加载图片')
assert.match(api, /where\(\{ assemblyCode: _\.in\(batch\) \}\)\.limit\(100\)/, '图片查询必须按assemblyCode分批，不得扫描整集合')
assert.match(api, /images: imageGroups\[normalizeAssemblyCode\(record\.assemblyCode\)\] \|\| \[\]/, '每条型号结果必须携带自己的images')
assert.match(api, /ACTIONS\.prepareModelImageUpload[\s\S]*?roles:ADMIN_ROLES/, '上传准备接口必须服务端校验admin+')
assert.match(api, /ACTIONS\.saveModelImage[\s\S]*?roles:ADMIN_ROLES/, '保存/替换接口必须服务端校验admin+')
assert.match(api, /ACTIONS\.deleteModelImage[\s\S]*?roles:ADMIN_ROLES/, '删除接口必须服务端校验admin+')
assert.match(api, /where\(\{ _id:current\._id, fileID:expectedFileID \}\)\.update/, '更换图片必须使用旧fileID做并发比较更新')
assert.match(api, /where\(\{ _id:current\._id, fileID:expectedFileID \}\)\.remove/, '删除图片必须使用旧fileID做并发比较删除')
assert.match(api, /upload_model_image|replace_model_image|delete_model_image/, '必须记录三种图片管理日志')
assert.ok(api.indexOf("update({ data:{ fileID") < api.indexOf('await removeCloudImage(current.fileID)'), '更换必须先更新数据库再删除旧文件')
assert.ok(!/model_images/.test(importSection), 'Excel预览/确认不得读写model_images')
assert.deepStrictEqual(databaseRules.model_images, { read:false, write:false }, 'model_images客户端必须不可读写')
assert.match(storageRules.write, /model-images/, '云存储规则示例必须允许受限的model-images目录上传')
assert.match(storageRules.write, /resource\.size <= 10485760/, '云存储规则示例必须限制图片为10MB')

assert.match(editJs, /wx\.chooseMedia/, '管理员必须使用微信图片选择能力')
assert.match(editJs, /wx\.cloud\.uploadFile/, '图片必须上传到微信云存储')
assert.match(editJs, /prepareModelImageUpload[\s\S]*saveModelImage/, '上传前后必须经过服务端鉴权和绑定')
assert.match(editWxml, /wx:for="\{\{imageSlots\}\}"/, '型号编辑页必须显示固定图片槽位')
assert.match(editWxml, /bindtap="removeImage"/, '型号编辑页必须支持固定槽位删除')
assert.match(searchWxml, /产品图片/, '查询卡片必须显示产品图片区域')
assert.match(searchWxml, /暂无图片/, '空槽位必须显示暂无图片')
assert.match(searchJs, /wx\.previewImage\(\{ current, urls/, '点击图片必须使用微信原生大图预览并支持连续浏览')
assert.ok(!/wx\.cloud\.database\(|collection\(['"]model_images/.test([searchJs, editJs].join('\n')), '客户端不得直连model_images数据库')

console.log('总成编号图片测试通过：5槽位、上限、隔离、预览、admin+鉴权、并发保护、日志及Excel隔离。')
