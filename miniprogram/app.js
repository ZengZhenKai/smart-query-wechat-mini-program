const { CLOUD_ENV_ID } = require('./env')

App({
  globalData: { user:null, reviewModeEnabled:false },
  onLaunch() {
    if (!wx.cloud) throw new Error('基础库版本过低，无法使用云开发')
    wx.cloud.init({ env: CLOUD_ENV_ID || undefined, traceUser: true })
  }
})
