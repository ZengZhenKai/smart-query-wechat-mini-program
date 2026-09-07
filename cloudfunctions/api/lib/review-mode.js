'use strict'

const crypto = require('crypto')
const MIN_REVIEW_INVITE_CODE_LENGTH = 8
const MAX_REVIEW_INVITE_CODE_LENGTH = 64

function readSettings(env = process.env) {
  const requested = String(env.REVIEW_MODE_ENABLED || '').trim().toLowerCase() === 'true'
  const code = String(env.REVIEW_INVITE_CODE || '').trim()
  const validCode = code.length >= MIN_REVIEW_INVITE_CODE_LENGTH && code.length <= MAX_REVIEW_INVITE_CODE_LENGTH && /^[A-Za-z0-9_-]+$/.test(code)
  return { requested, enabled:requested && validCode, code }
}

function getReviewModeStatus(env = process.env) {
  const settings = readSettings(env)
  return { requested:settings.requested, enabled:settings.enabled }
}

function reviewInviteVersion(env = process.env) {
  const settings = readSettings(env)
  if (!settings.enabled) return ''
  return crypto.createHash('sha256').update(settings.code, 'utf8').digest('hex')
}

function verifyReviewInvite(value, env = process.env) {
  const settings = readSettings(env)
  if (!settings.enabled) return false
  const provided = Buffer.from(String(value == null ? '' : value).trim(), 'utf8')
  const expected = Buffer.from(settings.code, 'utf8')
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected)
}

function isReviewAccessActive(user, env = process.env) {
  if (!user || !user.reviewAccess) return true
  const version = reviewInviteVersion(env)
  return !!version && user.reviewInviteVersion === version
}

module.exports = {
  MIN_REVIEW_INVITE_CODE_LENGTH,
  MAX_REVIEW_INVITE_CODE_LENGTH,
  getReviewModeStatus,
  reviewInviteVersion,
  verifyReviewInvite,
  isReviewAccessActive
}
