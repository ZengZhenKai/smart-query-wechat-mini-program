Page({
  data: { superAdmin: false },
  onLoad() { const u = getApp().globalData.user || {}; this.setData({ superAdmin: u.role === 'super_admin' }) },
  employees() { wx.navigateTo({ url: '/pages/employees/index' }) },
  models() { wx.navigateTo({ url: '/pages/models/index' }) },
  logs() { wx.navigateTo({ url: '/pages/logs/index' }) },
  admins() { wx.navigateTo({ url: '/pages/admins/index' }) }
})
