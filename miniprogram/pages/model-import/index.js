const { call } = require('../../utils/api')

const PAGE_SIZE = 20
const DETAIL_CONFIG = {
  create: { source: 'createDetails', visible: 'visibleCreates', limit: 'createLimit', expanded: 'showCreate' },
  update: { source: 'updateDetails', visible: 'visibleUpdates', limit: 'updateLimit', expanded: 'showUpdate' },
  unchanged: { source: 'unchangedDetails', visible: 'visibleUnchanged', limit: 'unchangedLimit', expanded: 'showUnchanged' },
  error: { source: 'errorDetails', visible: 'visibleErrors', limit: 'errorLimit', expanded: 'showError' }
}

function displayValue(value) { return value === '' || value == null ? '（空）' : String(value) }

Page({
  data: {
    fileName: '', filePath: '', fileSize: 0, fileID: '', preview: null, importToken: '',
    canImport: false, busy: false, result: null, completed: false,
    showCreate: false, showUpdate: true, showUnchanged: false, showError: false,
    createLimit: PAGE_SIZE, updateLimit: PAGE_SIZE, unchangedLimit: PAGE_SIZE, errorLimit: PAGE_SIZE,
    visibleCreates: [], visibleUpdates: [], visibleUnchanged: [], visibleErrors: []
  },
  async onLoad() { try { await call('checkModelImportPermission', {}, false) } catch (_) { setTimeout(() => wx.navigateBack(), 500) } },
  chooseFile() {
    wx.chooseMessageFile({ count: 1, type: 'file', extension: ['xlsx'], success: res => {
      const f = res.tempFiles && res.tempFiles[0]
      if (!f) return
      if (!/\.xlsx$/i.test(f.name)) return wx.showToast({ title: '只支持.xlsx文件', icon: 'none' })
      if (f.size > 15 * 1024 * 1024) return wx.showToast({ title: '文件不能超过15MB', icon: 'none' })
      this.setData({ fileName: f.name, filePath: f.path, fileSize: f.size, preview: null, importToken: '', canImport: false, result: null })
    } })
  },
  preparePreview(preview) {
    preview.duplicateAssemblyText = (preview.duplicateAssemblyCodes || []).join('、')
    preview.createDetails = (preview.createDetails || []).map(item => ({ ...item, productNameDisplay: displayValue(item.productName), testCodeDisplay: displayValue(item.testCode) }))
    preview.updateDetails = (preview.updateDetails || []).map(item => ({
      ...item,
      changes: (item.changes || []).map(change => ({ ...change, oldDisplay: displayValue(change.oldValue), newDisplay: displayValue(change.newValue) })),
      preservedBlankText: (item.preservedBlankFields || []).join('、')
    }))
    preview.unchangedDetails = (preview.unchangedDetails || []).map(item => ({ ...item, productNameDisplay: displayValue(item.productName), preservedBlankText: (item.preservedBlankFields || []).join('、') }))
    preview.errorDetails = (preview.errorDetails || []).map((item, index) => ({ ...item, detailKey: `${item.row}-${item.assemblyCode || 'blank'}-${index}`, assemblyCodeDisplay: displayValue(item.assemblyCode) }))
    return preview
  },
  resetDetailViews(preview) {
    this.setData({
      preview,
      showCreate: false, showUpdate: true, showUnchanged: false, showError: preview.errorCount > 0,
      createLimit: PAGE_SIZE, updateLimit: PAGE_SIZE, unchangedLimit: PAGE_SIZE, errorLimit: PAGE_SIZE,
      visibleCreates: preview.createDetails.slice(0, PAGE_SIZE),
      visibleUpdates: preview.updateDetails.slice(0, PAGE_SIZE),
      visibleUnchanged: preview.unchangedDetails.slice(0, PAGE_SIZE),
      visibleErrors: preview.errorDetails.slice(0, PAGE_SIZE)
    })
  },
  toggleDetails(e) {
    const config = DETAIL_CONFIG[e.currentTarget.dataset.kind]
    if (!config) return
    this.setData({ [config.expanded]: !this.data[config.expanded] })
  },
  showMore(e) {
    const config = DETAIL_CONFIG[e.currentTarget.dataset.kind]
    if (!config || !this.data.preview) return
    const nextLimit = this.data[config.limit] + PAGE_SIZE
    this.setData({ [config.limit]: nextLimit, [config.visible]: this.data.preview[config.source].slice(0, nextLimit) })
  },
  async parseFile() {
    if (!this.data.filePath || this.data.busy) return
    this.setData({ busy: true })
    let fileID = ''
    try {
      const upload = await wx.cloud.uploadFile({ cloudPath: `temp-model-imports/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.xlsx`, filePath: this.data.filePath })
      fileID = upload.fileID
      this.setData({ fileID })
      const data = await call('previewModelsExcel', { fileID, fileName: this.data.fileName }, false)
      this.resetDetailViews(this.preparePreview(data.preview))
      this.setData({ importToken: data.importToken || '', canImport: data.canImport === true, fileID: data.canImport ? fileID : '' })
      if (!data.canImport) wx.showModal({ title: 'Excel校验未通过', content: '存在重复总成编号或异常行，请查看异常明细，修改 Excel 后重新上传。', showCancel: false })
    } catch (err) {
      if (fileID) await call('discardUploadedModelsExcel', { fileID }, false).catch(() => {})
      console.error('[model-import] preview failed', err)
    } finally { this.setData({ busy: false }) }
  },
  confirmImport() {
    wx.showModal({ title: '确认更新数据库', content: '实际写入将严格采用本页预览；Excel 空白不会清空数据库已有非空值，Excel 未包含的原有型号不会删除。确定继续吗？', confirmColor: '#0b57d0', success: async res => {
      if (!res.confirm) return
      this.setData({ busy: true })
      try {
        const result = await call('confirmModelsExcel', { importToken: this.data.importToken })
        result.failedAssemblyText = (result.failedAssemblyCodes || []).join('、')
        this.setData({ result, preview: null, importToken: '', fileID: '', completed: true })
        wx.showToast({ title: result.failedCount ? '部分完成' : '导入完成', icon: result.failedCount ? 'none' : 'success' })
      } finally { this.setData({ busy: false }) }
    } })
  },
  async cancelImport() {
    if (this.data.importToken) await call('cancelModelsExcel', { importToken: this.data.importToken }, false).catch(() => {})
    else if (this.data.fileID) await call('discardUploadedModelsExcel', { fileID: this.data.fileID }, false).catch(() => {})
    this.setData({ preview: null, importToken: '', fileID: '', canImport: false, fileName: '', filePath: '' })
    wx.navigateBack()
  },
  finish() { wx.navigateBack() },
  onUnload() {
    if (!this.data.completed && this.data.importToken) call('cancelModelsExcel', { importToken: this.data.importToken }, false).catch(() => {})
    else if (!this.data.completed && this.data.fileID) call('discardUploadedModelsExcel', { fileID: this.data.fileID }, false).catch(() => {})
  }
})
