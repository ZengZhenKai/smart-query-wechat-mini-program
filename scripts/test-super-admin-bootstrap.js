'use strict'
const assert = require('assert')
const { parseSuperAdminAllowlist, assertSuperAdminBootstrapAllowed } = require('../cloudfunctions/api/lib/super-admin')

assert.deepStrictEqual(parseSuperAdminAllowlist('openid_a', true), ['openid_a'], '测试模式单OPENID应允许')
assert.deepStrictEqual(parseSuperAdminAllowlist('openid_a,openid_b', true), ['openid_a','openid_b'], '测试模式两个不同OPENID应允许')
assert.throws(() => parseSuperAdminAllowlist('', true), /必须包含1或2人/, '测试模式零人必须拒绝')
assert.throws(() => parseSuperAdminAllowlist('openid_a', false), /必须恰好包含两人/, '生产模式单OPENID必须拒绝')
assert.deepStrictEqual(parseSuperAdminAllowlist('openid_a,openid_b', false), ['openid_a','openid_b'], '生产模式两个不同OPENID应允许')
assert.throws(() => parseSuperAdminAllowlist('openid_a,openid_a', true), /不能包含重复/, '重复OPENID必须拒绝')
assert.throws(() => assertSuperAdminBootstrapAllowed('outsider', 'openid_a,openid_b', true), /不在超级管理员初始化名单中/, '名单外调用者必须拒绝')
assert.deepStrictEqual(assertSuperAdminBootstrapAllowed('openid_a', 'openid_a', true), ['openid_a'], '名单内调用者应允许')

console.log('超级管理员初始化测试通过：测试模式1-2人、生产模式严格2人、重复和名单外均拒绝。')
