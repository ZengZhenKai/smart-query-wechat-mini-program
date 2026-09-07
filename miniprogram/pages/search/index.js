const { call } = require('../../utils/api')
const { withImageSlots, previewableFileIDs } = require('../../utils/model-images')
Page({
  data: { keyword: '', records: [], searched: false, truncated: false },
  input(e) { this.setData({ keyword: e.detail.value }) },
  async search() {
    const keyword = this.data.keyword.trim(); if (!keyword) return wx.showToast({ title: '请输入查询内容', icon: 'none' })
    const result = await call('searchModels', { keyword })
    this.setData({ records: withImageSlots(result.records), truncated: result.truncated, searched: true })
  },
  copy(e) {
    const { id, value, field } = e.currentTarget.dataset
    wx.setClipboardData({ data: value, success: async () => {
      await call('logCopy', { targetId: id, field }, false).catch(() => {})
      wx.showToast({ title: field === 'testCode' ? '测试编码已复制' : '通用型号已复制', icon: 'success' })
    } })
  },
  previewImage(e) {
    const record = this.data.records[Number(e.currentTarget.dataset.recordIndex)]
    const current = e.currentTarget.dataset.url
    const urls = previewableFileIDs(record)
    if (!current || !urls.length) return
    wx.previewImage({ current, urls, fail:() => wx.showToast({ title:'图片预览失败', icon:'none' }) })
  },
  imageError(e) {
    const recordIndex = Number(e.currentTarget.dataset.recordIndex)
    const slot = Number(e.currentTarget.dataset.slot)
    if (recordIndex >= 0 && slot >= 1 && slot <= 5) this.setData({ [`records[${recordIndex}].imageSlots[${slot - 1}].loadFailed`]:true })
  },
  profile() { wx.navigateTo({ url: '/pages/profile/index' }) },
  onShareAppMessage() {
    return {
      title: '智慧型号',
      path: '/pages/search/index'
    }
  }
})
