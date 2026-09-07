const { call } = require('./api')
async function routeBySession(options = {}) {
  const session = await call('session', {}, false, options)
  const app = getApp()
  app.globalData.user = session.user || null
  app.globalData.reviewModeEnabled = !!session.reviewModeEnabled
  if (!session.registered) return wx.reLaunch({ url: '/pages/register/index' })
  if (session.user.status !== 'approved') return wx.reLaunch({ url: '/pages/pending/index' })
  if (!session.user.confidentialityAcceptedAt) return wx.reLaunch({ url: '/pages/confidentiality/index' })
  return wx.reLaunch({ url: '/pages/search/index' })
}
module.exports = { routeBySession }
