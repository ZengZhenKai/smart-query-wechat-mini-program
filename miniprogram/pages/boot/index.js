const { routeBySession } = require('../../utils/auth')
const { getErrorMessage } = require('../../utils/api')
Page({
  data: { loading: true, errorMessage: '' },
  onLoad() {
    this.routeTimer = setTimeout(() => this.start(), 1000)
  },
  onUnload() { if (this.routeTimer) clearTimeout(this.routeTimer) },
  async start() {
    if (this.routing) return
    this.routing = true
    this.setData({ loading: true, errorMessage: '' })
    try {
      await routeBySession({ silent: true })
    } catch (err) {
      const errorMessage = getErrorMessage(err)
      this.setData({ loading: false, errorMessage })
      wx.showModal({ title: '启动失败', content: errorMessage, showCancel: false })
    } finally {
      this.routing = false
    }
  },
  retry() { this.start() }
})
