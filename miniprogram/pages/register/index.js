const { call, getErrorMessage } = require('../../utils/api')
const { routeBySession } = require('../../utils/auth')

Page({
  data: { name:'', employeeCode:'', reviewInviteCode:'', reviewModeEnabled:false, reviewerMode:false, submitting:false },
  onLoad() { this.setData({ reviewModeEnabled:!!getApp().globalData.reviewModeEnabled }) },
  onName(e) { this.setData({ name:e.detail.value }) },
  onEmployeeCode(e) { this.setData({ employeeCode:String(e.detail.value || '').trim() }) },
  onReviewInvite(e) { this.setData({ reviewInviteCode:String(e.detail.value || '').trim().slice(0, 64) }) },
  toggleReviewerMode(e) { this.setData({ reviewerMode:!!e.detail.value }) },
  async submit() {
    const name = this.data.name.trim()
    const employeeCode = this.data.employeeCode
    const reviewerMode = this.data.reviewModeEnabled && this.data.reviewerMode
    if (!reviewerMode && !employeeCode) return wx.showToast({ title:'请输入员工编号', icon:'none' })
    if (!reviewerMode && !/^(?!000)\d{3}$/.test(employeeCode)) return wx.showToast({ title:'员工编号必须为 001–999 的三位数字', icon:'none' })
    if (reviewerMode && !this.data.reviewInviteCode) return wx.showToast({ title:'请输入审核邀请码', icon:'none' })
    this.setData({ submitting: true })
    try {
      const registerData = { name }
      if (!reviewerMode) registerData.employeeCode = employeeCode
      if (reviewerMode) registerData.reviewInviteCode = this.data.reviewInviteCode
      await call('register', registerData)
      await routeBySession({ silent:true })
    } catch (err) {
      console.error('[register] 提交失败:', err)
      try {
        const session = await call('session', {}, false, { silent:true })
        if (session.registered) return await routeBySession({ silent:true })
      } catch (sessionErr) {
        console.error('[register] 注册状态复查失败:', sessionErr)
      }
      const message = getErrorMessage(err)
      wx.showModal({ title:'注册未完成', content:message, showCancel:false })
    } finally { this.setData({ submitting: false }) }
  }
})
