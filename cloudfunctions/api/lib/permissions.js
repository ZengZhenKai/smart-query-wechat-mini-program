'use strict'

const ADMIN_ROLES = ['admin', 'super_admin']
const USER_PERMISSION_FIELDS = ['canUploadImages', 'canEditAssemblyCode']

function normalizeEmployeeCode(value) {
  const code = String(value == null ? '' : value).trim()
  return /^(?!000)\d{3}$/.test(code) ? code : ''
}

function normalizeUserPermissions(user) {
  return {
    canUploadImages: !!(user && user.canUploadImages === true),
    canEditAssemblyCode: !!(user && user.canEditAssemblyCode === true)
  }
}

function isApprovedUserWithPermission(user, field) {
  return !!user && user.status === 'approved' && user.role === 'user' && !user.reviewAccess && USER_PERMISSION_FIELDS.includes(field) && user[field] === true
}

function canUploadImages(user) {
  return !!user && (ADMIN_ROLES.includes(user.role) || isApprovedUserWithPermission(user, 'canUploadImages'))
}

function canEditAssemblyCode(user) {
  return !!user && (ADMIN_ROLES.includes(user.role) || isApprovedUserWithPermission(user, 'canEditAssemblyCode'))
}

module.exports = {
  ADMIN_ROLES,
  USER_PERMISSION_FIELDS,
  normalizeEmployeeCode,
  normalizeUserPermissions,
  isApprovedUserWithPermission,
  canUploadImages,
  canEditAssemblyCode
}
