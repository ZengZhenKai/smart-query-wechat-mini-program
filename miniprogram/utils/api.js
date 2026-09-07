function getErrorMessage(err) {
  const raw = err && (err.message || err.errMsg)
  return String(raw || '网络异常，请稍后重试').replace(/^Error:\s*/, '')
}

async function call(action, data = {}, loading = true, options = {}) {
  if (loading) wx.showLoading({ title: '处理中', mask: true })
  try {
    const res = await wx.cloud.callFunction({ name: 'api', data: { action, data } })
    const payload = res.result || {}
    if (!payload.ok) throw new Error(payload.message || '操作失败')
    return payload.data
  } catch (err) {
    if (!options.silent) wx.showToast({ title: getErrorMessage(err).slice(0, 20), icon: 'none' })
    throw err
  } finally { if (loading) wx.hideLoading() }
}
module.exports = { call, getErrorMessage }
