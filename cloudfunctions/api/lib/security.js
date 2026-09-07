const cloud = require('wx-server-sdk')
const db = cloud.database()
const { isReviewAccessActive } = require('./review-mode')

async function getCurrentUser(openid, options = {}) {
  const result = await db.collection('users').where({ openid }).limit(1).get()
  const user = result.data[0] || null
  if (!user) throw new Error('请先注册')
  if (!isReviewAccessActive(user)) throw new Error('微信审核访问已关闭')
  if (options.approved !== false && user.status !== 'approved') throw new Error('账号尚未审核通过')
  if (options.roles && !options.roles.includes(user.role)) throw new Error('权限不足')
  return user
}

function cleanText(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max)
}

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

async function log(user, action, extra = {}) {
  const safe = {
    operatorId: user && user._id || '', operatorOpenid: user && user.openid || '',
    operatorName: user && (user.name || user.nickname) || '', operatorRole: user && user.role || '',
    action, targetId: cleanText(extra.targetId, 80), keyword: cleanText(extra.keyword, 200),
    detail: extra.detail || {}, createdAt: db.serverDate()
  }
  await db.collection('operation_logs').add({ data: safe })
}

module.exports = { db, getCurrentUser, cleanText, escapeRegex, log }
