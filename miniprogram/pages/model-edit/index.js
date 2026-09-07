const { call } = require('../../utils/api')
const { fillImageSlots, previewableFileIDs } = require('../../utils/model-images')
const MAX_MODEL_IMAGE_SIZE = 10 * 1024 * 1024
Page({
  data: { form:{_id:'',assemblyCode:'',productName:'',testCode:'',moduleCode:''}, savedAssemblyCode:'', imageSlots:fillImageSlots([]), isAdmin:false, canEditAssemblyCode:false, canUploadImages:false },
  onLoad(q) {
    const user=getApp().globalData.user||{},isAdmin=['admin','super_admin'].includes(user.role)
    this.setData({isAdmin,canEditAssemblyCode:isAdmin||user.canEditAssemblyCode===true,canUploadImages:isAdmin||user.canUploadImages===true})
    if (!q.model) return
    try {
      const form = JSON.parse(decodeURIComponent(q.model))
      this.setData({ form, savedAssemblyCode:form.assemblyCode || '' })
      if(this.data.canUploadImages)this.loadImages().catch(() => {})
    } catch (_) {}
  },
  input(e) { const key=e.currentTarget.dataset.key;if(!this.data.isAdmin&&key!=='assemblyCode')return;this.setData({[`form.${key}`]:e.detail.value}) },
  async save() {
    if(this.data.isAdmin)await call('saveModel',this.data.form)
    else{
      if(!this.data.canEditAssemblyCode||!this.data.form._id)return wx.showToast({title:'权限不足',icon:'none'})
      const result=await call('updateAssemblyCode',{modelId:this.data.form._id,assemblyCode:this.data.form.assemblyCode})
      this.setData({'form.assemblyCode':result.assemblyCode,savedAssemblyCode:result.assemblyCode})
    }
    wx.showToast({title:'已保存'});setTimeout(()=>wx.navigateBack(),500)
  },
  async loadImages(loading = true) {
    if (!this.data.savedAssemblyCode) return
    const images = await call('getModelImages', { assemblyCode:this.data.savedAssemblyCode }, loading)
    this.setData({ imageSlots:fillImageSlots(images) })
  },
  chooseImage(e) {
    const slot = Number(e.currentTarget.dataset.slot)
    const current = this.data.imageSlots[slot - 1] || {}
    wx.chooseMedia({
      count:1, mediaType:['image'], sourceType:['album', 'camera'], sizeType:['compressed'],
      success:result => this.uploadImage(slot, current.fileID || '', result.tempFiles && result.tempFiles[0]),
      fail:err => { if (!String(err && err.errMsg || '').includes('cancel')) wx.showToast({ title:'选择图片失败', icon:'none' }) }
    })
  },
  async uploadImage(slot, expectedFileID, selected) {
    if (!selected || !selected.tempFilePath) return wx.showToast({ title:'未取得图片文件', icon:'none' })
    if (selected.size && selected.size > MAX_MODEL_IMAGE_SIZE) return wx.showToast({ title:'图片不能超过10MB', icon:'none' })
    const extension = ((selected.tempFilePath.match(/\.([a-z0-9]+)(?:\?|$)/i) || [,'jpg'])[1] || 'jpg').toLowerCase()
    let uploadedFileID = ''
    try {
      const prepared = await call('prepareModelImageUpload', { assemblyCode:this.data.savedAssemblyCode, slot, extension })
      wx.showLoading({ title:expectedFileID ? '更换中' : '上传中', mask:true })
      const uploaded = await wx.cloud.uploadFile({ cloudPath:prepared.cloudPath, filePath:selected.tempFilePath })
      uploadedFileID = uploaded.fileID
      const saved = await call('saveModelImage', { assemblyCode:this.data.savedAssemblyCode, slot, fileID:uploadedFileID, expectedFileID }, false)
      await this.loadImages(false)
      if (saved.cleanupWarning) wx.showModal({ title:'图片已保存', content:saved.cleanupWarning, showCancel:false })
      else wx.showToast({ title:expectedFileID ? '图片已更换' : '图片已上传', icon:'success' })
    } catch (err) {
      if (uploadedFileID) await call('discardModelImageUpload', { fileID:uploadedFileID }, false).catch(() => {})
      wx.showToast({ title:String(err && err.message || '图片上传失败').replace(/^Error:\s*/, '').slice(0, 20), icon:'none' })
      await this.loadImages(false).catch(() => {})
    } finally { wx.hideLoading() }
  },
  removeImage(e) {
    const slot = Number(e.currentTarget.dataset.slot)
    const current = this.data.imageSlots[slot - 1]
    if (!current || !current.fileID) return
    wx.showModal({ title:'确认删除图片', content:`确定删除照片${slot}吗？其他照片位置不会移动。`, confirmColor:'#c62828', success:async result => {
      if (!result.confirm) return
      try {
        const removed = await call('deleteModelImage', { assemblyCode:this.data.savedAssemblyCode, slot, expectedFileID:current.fileID })
        await this.loadImages(false)
        if (removed.cleanupWarning) wx.showModal({ title:'图片记录已删除', content:removed.cleanupWarning, showCancel:false })
        else wx.showToast({ title:'图片已删除', icon:'success' })
      } catch (_) {}
    } })
  },
  previewImage(e) {
    const current = e.currentTarget.dataset.url
    const urls = previewableFileIDs({ imageSlots:this.data.imageSlots })
    if (!current || !urls.length) return
    wx.previewImage({ current, urls, fail:() => wx.showToast({ title:'图片预览失败', icon:'none' }) })
  },
  imageError(e) {
    const slot = Number(e.currentTarget.dataset.slot)
    if (slot >= 1 && slot <= 5) this.setData({ [`imageSlots[${slot - 1}].loadFailed`]:true })
  }
})
