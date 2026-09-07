const { call, getErrorMessage } = require('../../utils/api')
Page({
  data: { tabs:[{label:'待审核',value:'pending'},{label:'已通过',value:'approved'},{label:'已拒绝',value:'rejected'}], status:'pending', statusText:'待审核', users:[], savingId:'', canManagePermissions:false },
  onShow(){this.initialize()},
  async initialize(){const session=await call('session',{},false);const user=session.user||{};getApp().globalData.user=user;this.setData({canManagePermissions:['admin','super_admin'].includes(user.role)});await this.load()},
  switchTab(e){const s=e.currentTarget.dataset.status;this.setData({status:s,statusText:{pending:'待审核',approved:'已通过',rejected:'已拒绝'}[s]});this.load()},
  async load(){const users=(await call('listEmployees',{status:this.data.status})).map(user=>{const displayName=user.name||user.nickname||(user.employeeCode?`员工 ${user.employeeCode}`:'未命名员工');const identityText=user.employeeCode?`${user.employeeCode} · ${user.role}`:user.phone?`${user.phone} · ${user.role}`:user.role;const showPermissionControls=this.data.canManagePermissions&&user.status==='approved'&&user.role==='user'&&user.isReviewAccount!==true;return{...user,canUploadImages:user.canUploadImages===true,canEditAssemblyCode:user.canEditAssemblyCode===true,displayName,identityText,showPermissionControls}});this.setData({users})},
  async review(e){await call('reviewEmployee',{userId:e.currentTarget.dataset.id,status:e.currentTarget.dataset.status});wx.showToast({title:'操作成功'});this.load()},
  async togglePermission(e){
    const index=Number(e.currentTarget.dataset.index),field=e.currentTarget.dataset.field,user=this.data.users[index]
    if(!this.data.canManagePermissions||!user||user.role!=='user'||this.data.savingId)return
    const before=user[field]===true,after=!!e.detail.value
    this.setData({savingId:user._id,[`users[${index}].${field}`]:after})
    try{
      const saved=await call('setUserPermissions',{userId:user._id,canUploadImages:field==='canUploadImages'?after:user.canUploadImages===true,canEditAssemblyCode:field==='canEditAssemblyCode'?after:user.canEditAssemblyCode===true},false,{silent:true})
      this.setData({[`users[${index}].canUploadImages`]:saved.canUploadImages===true,[`users[${index}].canEditAssemblyCode`]:saved.canEditAssemblyCode===true})
      wx.showToast({title:'权限已更新'})
    }catch(err){
      this.setData({[`users[${index}].${field}`]:before})
      wx.showModal({title:'权限更新失败',content:getErrorMessage(err),showCancel:false})
    }finally{this.setData({savingId:''})}
  },
  remove(e){const {id,name}=e.currentTarget.dataset;wx.showModal({title:'删除员工',content:'确定删除该员工账号吗？删除后该员工需要重新注册并审核。',confirmColor:'#c62828',success:async r=>{if(r.confirm){await call('deleteEmployee',{userId:id});wx.showToast({title:'已删除 '+name,icon:'none'});this.load()}}})}
})
