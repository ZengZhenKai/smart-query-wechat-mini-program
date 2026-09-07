const { call } = require('../../utils/api')
Page({
  data:{admins:[],users:[],canManageRoles:false,loaded:false},
  onShow(){this.initialize()},
  async initialize(){const session=await call('session',{},false);const user=session.user||{};getApp().globalData.user=user;const canManageRoles=user.role==='super_admin';this.setData({canManageRoles});if(canManageRoles)await this.load()},
  async load(){const data=await call('listAdmins');const decorate=list=>(list||[]).map(item=>({...item,displayName:item.name||item.nickname||(item.employeeCode?`员工 ${item.employeeCode}`:'未命名员工'),displayCode:item.employeeCode||'无员工编号'}));this.setData({admins:decorate(data.admins),users:decorate(data.users),loaded:true})},
  change(e){if(!this.data.canManageRoles)return;const {id,role}=e.currentTarget.dataset;wx.showModal({title:'权限变更确认',content:role==='admin'?'确定授予该员工管理员权限吗？':'确定取消该管理员权限并恢复为普通员工吗？',success:async r=>{if(r.confirm){await call('setAdminRole',{userId:id,role});this.load()}}})}
})
