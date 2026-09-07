const { call } = require('../../utils/api')
Page({
  data: { keyword:'', models:[], isAdmin:false, canImport:false, canMaintain:false },
  onShow() { const user=getApp().globalData.user||{},isAdmin=['admin','super_admin'].includes(user.role);this.setData({isAdmin,canImport:isAdmin,canMaintain:isAdmin||user.canUploadImages===true||user.canEditAssemblyCode===true});this.load() },
  input(e) { this.setData({ keyword: e.detail.value }) },
  async load() { this.setData({ models: await call('listModels', { keyword: this.data.keyword }) }) },
  create() { wx.navigateTo({ url: '/pages/model-edit/index' }) },
  importExcel() { wx.navigateTo({ url: '/pages/model-import/index' }) },
  edit(e) { wx.navigateTo({ url: '/pages/model-edit/index?model=' + encodeURIComponent(JSON.stringify(e.currentTarget.dataset.model)) }) },
  remove(e) {
    const { id, code } = e.currentTarget.dataset
    wx.showModal({ title: '确认删除', content: `确定删除型号 ${code} 吗？此操作将记录日志。`, confirmColor: '#c62828', success: async r => { if (r.confirm) { await call('deleteModel', { modelId: id }); this.load() } } })
  }
})
