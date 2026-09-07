async function uploadAvatar(localPath) {
  if (!localPath || localPath.startsWith('cloud://') || localPath.startsWith('https://')) return localPath || ''
  const ext = (localPath.match(/\.(jpg|jpeg|png|webp)$/i) || [,'jpg'])[1].toLowerCase()
  const cloudPath = `avatars/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
  const result = await wx.cloud.uploadFile({ cloudPath, filePath: localPath })
  return result.fileID
}
module.exports = { uploadAvatar }
