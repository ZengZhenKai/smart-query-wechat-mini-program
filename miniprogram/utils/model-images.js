'use strict'

const MAX_MODEL_IMAGE_SLOTS = 5

function fillImageSlots(images) {
  const bySlot = new Map((images || []).map(image => [Number(image.slot), image]))
  return Array.from({ length: MAX_MODEL_IMAGE_SLOTS }, (_, index) => {
    const slot = index + 1
    const image = bySlot.get(slot) || {}
    const fileID = image.fileID || ''
    const url = image.url || ''
    return { slot, fileID, url, loadFailed:!!fileID && !url }
  })
}

function withImageSlots(records) {
  return (records || []).map(record => ({ ...record, imageSlots: fillImageSlots(record.images) }))
}

function previewableFileIDs(record) {
  return (record && record.imageSlots || []).filter(image => image.url && !image.loadFailed).map(image => image.url)
}

module.exports = { MAX_MODEL_IMAGE_SLOTS, fillImageSlots, withImageSlots, previewableFileIDs }
