const { call } = require('../../utils/api')
Page({
  data: { title: '待管理员审核', message: '注册信息已提交。审核通过前无法访问型号和测试编码。' },
  async onShow() {
    // 名单外用户调用会被后端拒绝且不改变任何数据；此处静默尝试，便于两名预配置人员首次冷启动。
    try { await wx.cloud.callFunction({ name:'api', data:{ action:'bootstrapSuperAdmin', data:{} } }) } catch (_) {}
    this.refresh()
  },
  async refresh() {
    try {
      const s = await call('session', {}, false)
      if (!s.registered) return wx.reLaunch({ url: '/pages/register/index' })
      if (s.user.status === 'approved') return wx.reLaunch({ url: s.user.confidentialityAcceptedAt ? '/pages/search/index' : '/pages/confidentiality/index' })
      if (s.user.status === 'rejected') this.setData({ title: '注册审核未通过', message: '当前账号不能查询内部数据。如有疑问，请联系管理员。' })
      if (s.user.status === 'review_expired') this.setData({ title:'微信审核访问已关闭', message:'本次审核通道已经关闭，当前审核账号不能继续访问内部资料。' })
    } catch (_) {}
  }
})
