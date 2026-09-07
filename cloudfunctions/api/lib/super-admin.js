function parseSuperAdminAllowlist(raw, testMode) {
  const allowlist = String(raw || '').split(',').map(x => x.trim()).filter(Boolean)
  const unique = new Set(allowlist)
  if (unique.size !== allowlist.length) throw new Error('超级管理员名单不能包含重复 OPENID')
  if (testMode) {
    if (allowlist.length < 1 || allowlist.length > 2) throw new Error('测试模式超级管理员名单必须包含1或2人')
  } else if (allowlist.length !== 2) {
    throw new Error('生产模式超级管理员名单必须恰好包含两人')
  }
  return allowlist
}

function assertSuperAdminBootstrapAllowed(openid, raw, testMode) {
  const allowlist = parseSuperAdminAllowlist(raw, testMode)
  if (!allowlist.includes(openid)) throw new Error('不在超级管理员初始化名单中')
  return allowlist
}

module.exports = { parseSuperAdminAllowlist, assertSuperAdminBootstrapAllowed }
