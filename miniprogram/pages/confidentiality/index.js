const { call } = require('../../utils/api')
Page({
  data: { needAccept: true },
  onLoad(q) { this.setData({ needAccept: q.view !== '1' }) },
  async accept() { await call('acceptConfidentiality'); wx.reLaunch({ url: '/pages/search/index' }) }
})
