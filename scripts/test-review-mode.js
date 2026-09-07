'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const {
  getReviewModeStatus,
  reviewInviteVersion,
  verifyReviewInvite,
  isReviewAccessActive
} = require('../cloudfunctions/api/lib/review-mode')

const invite = 'A'.repeat(16)
const enabledEnv = { REVIEW_MODE_ENABLED:'true', REVIEW_INVITE_CODE:invite }

assert.deepStrictEqual(getReviewModeStatus({}), { requested:false, enabled:false }, '未配置时必须关闭')
assert.deepStrictEqual(getReviewModeStatus({ REVIEW_MODE_ENABLED:'false', REVIEW_INVITE_CODE:invite }), { requested:false, enabled:false }, 'false必须关闭')
assert.deepStrictEqual(getReviewModeStatus({ REVIEW_MODE_ENABLED:'true' }), { requested:true, enabled:false }, '缺少邀请码必须失败关闭')
assert.deepStrictEqual(getReviewModeStatus({ REVIEW_MODE_ENABLED:'true', REVIEW_INVITE_CODE:'short' }), { requested:true, enabled:false }, '短邀请码必须失败关闭')
assert.deepStrictEqual(getReviewModeStatus({ REVIEW_MODE_ENABLED:'true', REVIEW_INVITE_CODE:'含中文的邀请码1234' }), { requested:true, enabled:false }, '非法字符必须失败关闭')
assert.deepStrictEqual(getReviewModeStatus(enabledEnv), { requested:true, enabled:true }, '有效配置必须开启')
assert.strictEqual(verifyReviewInvite(invite, enabledEnv), true, '正确邀请码必须通过')
assert.strictEqual(verifyReviewInvite(invite.toLowerCase(), enabledEnv), false, '邀请码必须区分大小写')
assert.strictEqual(verifyReviewInvite(`${invite}X`, enabledEnv), false, '错误邀请码必须拒绝')
assert.strictEqual(verifyReviewInvite(invite, { REVIEW_MODE_ENABLED:'false', REVIEW_INVITE_CODE:invite }), false, '关闭后正确邀请码也必须拒绝')

const version = reviewInviteVersion(enabledEnv)
assert.match(version, /^[a-f0-9]{64}$/, '邀请码版本必须是SHA-256摘要')
assert.ok(!version.includes(invite), '摘要不得泄露原始邀请码')
assert.strictEqual(isReviewAccessActive({ role:'user', status:'approved' }, {}), true, '普通既有用户不受审核模式影响')
assert.strictEqual(isReviewAccessActive({ reviewAccess:true, reviewInviteVersion:version }, enabledEnv), true, '当前邀请码创建的审核账号可以访问')
assert.strictEqual(isReviewAccessActive({ reviewAccess:true, reviewInviteVersion:version }, { REVIEW_MODE_ENABLED:'false', REVIEW_INVITE_CODE:invite }), false, '关闭审核模式后审核账号必须失效')
assert.strictEqual(isReviewAccessActive({ reviewAccess:true, reviewInviteVersion:version }, { REVIEW_MODE_ENABLED:'true', REVIEW_INVITE_CODE:'B'.repeat(16) }), false, '轮换邀请码后旧审核账号必须失效')

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
const cloud = read('cloudfunctions/api/index.js')
const security = read('cloudfunctions/api/lib/security.js')
const registerJs = read('miniprogram/pages/register/index.js')
const registerWxml = read('miniprogram/pages/register/index.wxml')
const pendingJs = read('miniprogram/pages/pending/index.js')
const auth = read('miniprogram/utils/auth.js')
const app = read('miniprogram/app.js')

assert.match(cloud, /const old = await[\s\S]*if \(old\.data\.length\) return[\s\S]*const reviewMode = getReviewModeStatus\(\)/, '既有OPENID必须在审核分支前幂等返回，不能被修改')
assert.match(cloud, /role:'user', status:reviewAccess \? 'approved' : 'pending'/, '审核注册只能创建普通用户，正常注册仍待审核')
assert.match(cloud, /approvedAt:reviewAccess \? now : null, approvedBy:reviewAccess \? 'review_invite' : ''/, '审核注册必须保存服务端审批时间和受控来源')
assert.match(cloud, /const \{ openid, reviewAccess, reviewInviteVersion, \.\.\.safe \} = user/, '客户端用户对象不得泄露OPENID或审核内部字段')
assert.match(cloud, /reviewModeEnabled:reviewMode\.enabled/, 'session只应公开是否显示审核入口')
assert.ok(!/reviewInviteCode[^\n]*(?:log|detail)|detail[^\n]*reviewInviteCode/.test(cloud), '日志不得记录审核邀请码')
assert.match(security, /if \(!isReviewAccessActive\(user\)\) throw new Error\('微信审核访问已关闭'\)/, '所有鉴权业务必须校验审核账号是否仍有效')
assert.match(registerWxml, /wx:if="\{\{reviewModeEnabled\}\}"[\s\S]*password[\s\S]*bindinput="onReviewInvite"/, '审核邀请码输入框只能由服务端模式开关显示并需掩码')
assert.match(registerJs, /if \(reviewerMode\) registerData\.reviewInviteCode = this\.data\.reviewInviteCode/, '前端只能在审核模式时附带邀请码')
assert.match(registerJs, /if \(!reviewerMode && !\/\^\(\?!000\)\\d\{3\}\$\/.test\(employeeCode\)\)/, '正式员工注册必须校验员工编号')
assert.match(auth, /globalData\.reviewModeEnabled = !!session\.reviewModeEnabled/, '前端显示开关必须来自session')
assert.match(app, /reviewModeEnabled:false/, '客户端本地默认必须关闭审核入口')
assert.match(pendingJs, /review_expired[\s\S]*微信审核访问已关闭/, '关闭后审核账号必须显示明确失效状态')

const clientRuntime = [registerJs, registerWxml, auth, app].join('\n')
assert.ok(!clientRuntime.includes(invite), '实际邀请码不得硬编码进小程序包')
assert.ok(!clientRuntime.includes('REVIEW_INVITE_CODE'), '小程序源码不得读取服务端邀请码环境变量')

console.log('微信审核邀请码模式测试通过：默认关闭、服务端校验、普通用户权限、关闭/轮换失效、秘密不下发。')
