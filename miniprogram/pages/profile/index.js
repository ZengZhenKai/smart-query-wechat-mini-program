const { call } = require('../../utils/api')
const { uploadAvatar } = require('../../utils/upload')
Page({
  data: { user:{}, form:{name:'',avatarUrl:''}, roleText:'', isAdmin:false, canMaintainModels:false },
  async onShow() { const s=await call('session',{},false); const u=s.user||{},isAdmin=['admin','super_admin'].includes(u.role);getApp().globalData.user=u;this.setData({user:u,form:{name:u.name||u.nickname||'',avatarUrl:u.avatarUrl||''},roleText:{user:'普通员工',admin:'管理员',super_admin:'超级管理员'}[u.role]||'',isAdmin,canMaintainModels:isAdmin||u.canUploadImages===true||u.canEditAssemblyCode===true}) },
  name(e){this.setData({'form.name':e.detail.value})}, chooseAvatar(e){this.setData({'form.avatarUrl':e.detail.avatarUrl})},
  async save(){const avatarUrl=await uploadAvatar(this.data.form.avatarUrl);await call('updateProfile',{name:this.data.form.name,avatarUrl});wx.showToast({title:'资料已保存'});this.onShow()},
  confidentiality(){wx.navigateTo({url:'/pages/confidentiality/index?view=1'})},admin(){wx.navigateTo({url:'/pages/admin/index'})},models(){wx.navigateTo({url:'/pages/models/index'})}
})
