'use strict'

const MAX_MODEL_IMAGE_SLOTS = 5
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif']

function normalizeAssemblyCode(value) {
  return String(value == null ? '' : value).trim().slice(0, 80)
}

function normalizeImageSlot(value) {
  const slot = Number(value)
  if (Number.isInteger(slot) && slot > MAX_MODEL_IMAGE_SLOTS) throw new Error('每个总成编号最多上传5张图片')
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_MODEL_IMAGE_SLOTS) {
    throw new Error('图片位置必须是1到5')
  }
  return slot
}

function normalizeImageExtension(value) {
  const ext = String(value || '').toLowerCase().replace(/^\./, '')
  if (!IMAGE_EXTENSIONS.includes(ext)) throw new Error('仅支持 JPG、PNG、WEBP 或 GIF 图片')
  return ext
}

function assemblyStorageKey(assemblyCode) {
  const code = normalizeAssemblyCode(assemblyCode)
  if (!code) throw new Error('总成编号不能为空')
  return Buffer.from(code, 'utf8').toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function buildModelImageCloudPath(assemblyCode, slot, extension, stamp, nonce) {
  const safeSlot = normalizeImageSlot(slot)
  const ext = normalizeImageExtension(extension)
  const suffix = String(nonce || '').replace(/[^a-z0-9]/gi, '').slice(0, 16)
  if (!suffix) throw new Error('图片上传标识无效')
  return `model-images/${assemblyStorageKey(assemblyCode)}/slot-${safeSlot}/${Number(stamp) || Date.now()}-${suffix}.${ext}`
}

function isAllowedModelImageFileID(fileID, assemblyCode, slot) {
  const value = String(fileID || '')
  const marker = `/model-images/${assemblyStorageKey(assemblyCode)}/slot-${normalizeImageSlot(slot)}/`
  return value.startsWith('cloud://') && value.includes(marker)
}

function groupModelImages(records, assemblyCodes) {
  const codes = [...new Set((assemblyCodes || []).map(normalizeAssemblyCode).filter(Boolean))]
  const grouped = Object.fromEntries(codes.map(code => [code, []]))
  for (const record of records || []) {
    const code = normalizeAssemblyCode(record.assemblyCode)
    const slot = Number(record.slot)
    const fileID = String(record.fileID || '')
    if (!Object.prototype.hasOwnProperty.call(grouped, code) || !Number.isInteger(slot) || slot < 1 || slot > MAX_MODEL_IMAGE_SLOTS || !fileID) continue
    if (grouped[code].some(item => item.slot === slot)) continue
    grouped[code].push({ slot, fileID })
  }
  for (const code of codes) grouped[code].sort((a, b) => a.slot - b.slot)
  return grouped
}

module.exports = {
  MAX_MODEL_IMAGE_SLOTS,
  normalizeAssemblyCode,
  normalizeImageSlot,
  normalizeImageExtension,
  assemblyStorageKey,
  buildModelImageCloudPath,
  isAllowedModelImageFileID,
  groupModelImages
}
