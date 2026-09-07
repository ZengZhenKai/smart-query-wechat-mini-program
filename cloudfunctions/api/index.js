const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const XLSX = require('xlsx')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const { db, getCurrentUser, cleanText, escapeRegex, log } = require('./lib/security')
const { assertSuperAdminBootstrapAllowed } = require('./lib/super-admin')
const { normalizeWorkbookRows, diffModels, chunks } = require('./lib/model-import')
const { MAX_MODEL_IMAGE_SLOTS, normalizeAssemblyCode, normalizeImageSlot, buildModelImageCloudPath, isAllowedModelImageFileID, groupModelImages } = require('./lib/model-images')
const { getReviewModeStatus, reviewInviteVersion, verifyReviewInvite, isReviewAccessActive } = require('./lib/review-mode')
const { ADMIN_ROLES, normalizeEmployeeCode, normalizeUserPermissions, canUploadImages, canEditAssemblyCode } = require('./lib/permissions')
const _ = db.command
const ACTIONS = {}

function ok(data) { return { ok: true, data } }
function singleSuperAdminBootstrapEnabled() { return String(process.env.ENABLE_SINGLE_SUPER_ADMIN_BOOTSTRAP || '').toLowerCase() === 'true' }
function base64url(buffer) { return Buffer.from(buffer).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') }
function importTokenSecret() {
  const secret = String(process.env.IMPORT_TOKEN_SECRET || '')
  if (secret.length < 32) throw new Error('云函数未配置 IMPORT_TOKEN_SECRET（至少32位）')
  return secret
}
function createImportToken(payload) {
  const encoded = base64url(JSON.stringify({ ...payload, exp:Date.now() + 30 * 60 * 1000 }))
  return `${encoded}.${base64url(crypto.createHmac('sha256', importTokenSecret()).update(encoded).digest())}`
}
function verifyImportToken(token, openid) {
  const [encoded, signature, extra] = String(token || '').split('.')
  if (!encoded || !signature || extra) throw new Error('导入预览凭据无效，请重新选择文件')
  const expected = base64url(crypto.createHmac('sha256', importTokenSecret()).update(encoded).digest())
  const a=Buffer.from(signature), b=Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) throw new Error('导入预览凭据校验失败')
  let payload
  try { payload=JSON.parse(Buffer.from(encoded.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8')) } catch(_){ throw new Error('导入预览凭据格式错误') }
  if (payload.openid !== openid || !payload.exp || payload.exp < Date.now()) throw new Error('导入预览已过期，请重新解析')
  return payload
}
function parseModelsWorkbook(buffer) {
  const workbook=XLSX.read(buffer,{type:'buffer',cellDates:false})
  for(const sheetName of workbook.SheetNames){
    // 使用单元格底层值，避免 #,##0 等显示格式把测试编码制造成假变化。
    const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:true,blankrows:true})
    try { return { sheetName, ...normalizeWorkbookRows(rows) } } catch(err) { if(!String(err.message).includes('未找到完整表头')) throw err }
  }
  throw new Error('所有工作表均未找到所需四列表头')
}
async function loadAllModels() {
  const result=[]; const pageSize=100
  for(let skip=0;;skip+=pageSize){ const page=await db.collection('models').skip(skip).limit(pageSize).get(); result.push(...page.data); if(page.data.length<pageSize) break }
  return result
}
function isMissingModelImagesCollection(err) {
  const message = String(err && (err.errMsg || err.message || err) || '')
  return /-502005|collection.*not exist|collection.*not found|集合.*不存在/i.test(message)
}
function isDuplicateModelImageError(err) {
  const message = String(err && (err.errCode || err.errMsg || err.message || err) || '')
  return /-502001|-501001|duplicate|duplicated|already exists|重复|已存在/i.test(message)
}
function modelImagesCollectionError(err) {
  if (isMissingModelImagesCollection(err)) throw new Error('请先在云开发控制台创建 model_images 集合')
  throw err
}
async function loadModelImagesByAssemblyCodes(assemblyCodes) {
  const codes = [...new Set((assemblyCodes || []).map(normalizeAssemblyCode).filter(Boolean))]
  const records = []
  if (!codes.length) return groupModelImages(records, codes)
  try {
    for (const batch of chunks(codes, 20)) {
      const result = await db.collection('model_images').where({ assemblyCode: _.in(batch) }).limit(100).get()
      records.push(...result.data)
    }
  } catch (err) {
    if (!isMissingModelImagesCollection(err)) throw err
    console.warn('[model-images] model_images collection is not ready')
  }
  const grouped = groupModelImages(records, codes)
  const allImages = Object.values(grouped).flat()
  const resolved = await withModelImageTempURLs(allImages)
  const urlByFileID = new Map(resolved.map(image => [image.fileID, image.url]))
  for (const code of codes) grouped[code] = grouped[code].map(image => ({ ...image, url:urlByFileID.get(image.fileID) || '' }))
  return grouped
}
async function assertModelAssemblyExists(assemblyCode) {
  const result = await db.collection('models').where({ assemblyCode }).limit(1).get()
  if (!result.data.length) throw new Error('总成编号不存在')
}
async function ensureModelImagesCollection() {
  try { await db.collection('model_images').limit(1).get() } catch (err) { modelImagesCollectionError(err) }
}
async function getModelImageSlot(assemblyCode, slot) {
  try {
    const result = await db.collection('model_images').where({ assemblyCode, slot }).limit(2).get()
    if (result.data.length > 1) throw new Error('图片槽位数据冲突，请联系管理员处理')
    return result.data[0] || null
  } catch (err) { modelImagesCollectionError(err) }
}
function modelImageDocumentId(assemblyCode, slot) {
  return `mi_${crypto.createHash('sha256').update(`${assemblyCode}\u0000${slot}`).digest('hex').slice(0, 40)}`
}
async function verifyModelImageFile(fileID) {
  let result
  try { result = await cloud.getTempFileURL({ fileList:[fileID] }) } catch (_) { throw new Error('图片文件校验失败，请重新上传') }
  const item = result && result.fileList && result.fileList[0]
  if (!item || Number(item.status) !== 0 || !item.tempFileURL) throw new Error('图片文件无效或上传未完成')
}
async function withModelImageTempURLs(images) {
  const urls = new Map()
  const fileIDs = [...new Set((images || []).map(image => image.fileID).filter(Boolean))]
  try {
    for (const batch of chunks(fileIDs, 50)) {
      const result = await cloud.getTempFileURL({ fileList:batch })
      for (const item of result.fileList || []) urls.set(item.fileID, Number(item.status) === 0 ? item.tempFileURL || '' : '')
    }
  } catch (err) { console.error('[model-images] temp URL failed', { message:err.message }) }
  return (images || []).map(image => ({ ...image, url:urls.get(image.fileID) || '' }))
}
async function removeCloudImage(fileID) {
  if (!fileID) return ''
  try {
    const result = await cloud.deleteFile({ fileList:[fileID] })
    const item = result && result.fileList && result.fileList[0]
    if (!item || Number(item.status) !== 0) throw new Error(item && item.errMsg || '云文件删除失败')
    return ''
  } catch (err) {
    console.error('[model-images] cloud file cleanup failed', { message:err.message })
    return '数据库已更新，但旧云文件清理失败，请稍后在云存储中清理'
  }
}
async function recordModelImageLog(actor, action, targetId, assemblyCode, slot) {
  try { await log(actor, action, { targetId, detail:{ assemblyCode, slot } }); return '' } catch (err) {
    console.error('[model-images] operation log failed', { action, message:err.message })
    return '图片数据已更新，但操作日志写入失败，请联系管理员检查'
  }
}
function joinWarnings(...warnings) { return warnings.filter(Boolean).join('；') }
async function deleteTempFile(fileID) {
  if(!fileID) return
  try { await cloud.deleteFile({fileList:[fileID]}) } catch(err) { console.error('[model-import] temp delete failed',{message:err.message}) }
}
function importPreview(parsed,diff,fileName) {
  const labels={productName:'商品名称',moduleCode:'模组编码',testCode:'测试编码'}
  const updateDetails=diff.update.map(item=>({
    assemblyCode:item.row.assemblyCode,
    changes:item.changes.map(change=>({...change,label:labels[change.field]||change.field})),
    preservedBlankFields:item.preservedBlankFields.map(field=>labels[field]||field)
  }))
  const unchangedDetails=diff.unchanged.map(item=>({assemblyCode:item.row.assemblyCode,productName:item.row.productName,preservedBlankFields:item.preservedBlankFields.map(field=>labels[field]||field)}))
  return {
    fileName, sheetName:parsed.sheetName, totalRows:parsed.sourceRowCount,
    validModels:parsed.records.length, createCount:diff.create.length,
    updateCount:diff.update.length, unchangedCount:diff.unchanged.length,
    errorCount:parsed.errors.length, blankProductNameCount:parsed.records.filter(x=>String(x.productName||'').trim()==='').length,
    blankTestCodeCount:parsed.records.filter(x=>String(x.testCode||'').trim()==='').length,
    duplicateAssemblyCount:parsed.duplicateAssemblyCodes.length,
    duplicateAssemblyCodes:parsed.duplicateAssemblyCodes.slice(0,100),
    errorDetails:parsed.errors,
    createDetails:diff.create.map(x=>({assemblyCode:x.assemblyCode,productName:x.productName,testCode:x.testCode})),
    updateDetails, unchangedDetails,
    preservedBlankValueCount:updateDetails.reduce((n,x)=>n+x.preservedBlankFields.length,0)+unchangedDetails.reduce((n,x)=>n+x.preservedBlankFields.length,0),
    missingExistingModelsWillBeKept:true
  }
}
function changeSetHash(diff) {
  const fields=row=>({assemblyCode:row.assemblyCode,productName:row.productName,moduleCode:row.moduleCode,testCode:row.testCode})
  const canonical={
    create:diff.create.map(fields).sort((a,b)=>a.assemblyCode.localeCompare(b.assemblyCode)),
    update:diff.update.map(x=>({row:fields(x.row),old:fields({...x.old,assemblyCode:String(x.old.assemblyCode||'').trim().toUpperCase()})})).sort((a,b)=>a.row.assemblyCode.localeCompare(b.row.assemblyCode)),
    unchanged:diff.unchanged.map(x=>fields(x.row)).sort((a,b)=>a.assemblyCode.localeCompare(b.assemblyCode))
  }
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}
function publicUser(user) {
  if (!user) return null
  const { openid, reviewAccess, reviewInviteVersion, ...safe } = user
  return {
    ...safe,
    isReviewAccount:user.reviewAccess === true,
    name: cleanText(user.name || user.nickname, 30),
    employeeCode: cleanText(user.employeeCode, 3),
    ...normalizeUserPermissions(user)
  }
}

function assertPermission(condition) {
  if (!condition) throw new Error('权限不足')
}

function isDuplicateKeyError(err) {
  return /-502001|-501001|duplicate|duplicated|already exists|重复|已存在/i.test(String(err && (err.errCode || err.errMsg || err.message || err) || ''))
}

ACTIONS.session = async ({ openid }) => {
  const r = await db.collection('users').where({ openid }).limit(1).get()
  const user = r.data[0] || null
  if (user) await log(user, 'login')
  const reviewMode = getReviewModeStatus()
  const reviewAccessExpired = !!user && !isReviewAccessActive(user)
  const safeUser = publicUser(user)
  if (safeUser && reviewAccessExpired) safeUser.status = 'review_expired'
  return { registered:!!user, user:safeUser, reviewModeEnabled:reviewMode.enabled, reviewAccessExpired }
}

// 冷启动：生产模式要求恰好两个 OPENID；独立服务端开发开关允许一至两个。
// 只有 SUPER_ADMIN_OPENIDS 名单内用户可将自己的已注册账号初始化为超级管理员。
ACTIONS.bootstrapSuperAdmin = async ({ openid }) => {
  const testMode = singleSuperAdminBootstrapEnabled()
  assertSuperAdminBootstrapAllowed(openid, process.env.SUPER_ADMIN_OPENIDS, testMode)
  const r = await db.collection('users').where({ openid }).limit(1).get()
  const user = r.data[0]
  if (!user) throw new Error('请先完成注册，再执行初始化')
  if (user.reviewAccess) throw new Error('微信审核账号不能初始化为超级管理员')
  await db.collection('users').doc(user._id).update({ data: { role:'super_admin', status:'approved', approvedAt:db.serverDate(), approvedBy:'system_bootstrap', updatedAt:db.serverDate() } })
  await log({ ...user, role:'super_admin' }, 'bootstrap_super_admin', { targetId:user._id })
  return true
}

ACTIONS.register = async ({ openid, data }) => {
  const old = await db.collection('users').where({ openid }).limit(1).get()
  if (old.data.length) return { status: old.data[0].status, alreadyRegistered: true }
  const reviewMode = getReviewModeStatus()
  const reviewInviteCode = cleanText(data.reviewInviteCode, 128)
  if (reviewInviteCode && reviewMode.requested && !reviewMode.enabled) throw new Error('审核模式配置无效，请联系管理员')
  if (reviewInviteCode && !reviewMode.enabled) throw new Error('微信审核通道未开启')
  if (reviewInviteCode && !verifyReviewInvite(reviewInviteCode)) throw new Error('微信审核邀请码不正确')
  const reviewAccess = !!reviewInviteCode
  const name = cleanText(data.name, 30)
  const employeeCode = reviewAccess ? '' : normalizeEmployeeCode(data.employeeCode)
  if (!reviewAccess && !employeeCode) throw new Error('员工编号必须为001–999的3位数字')
  if (!reviewAccess) {
    const duplicate = await db.collection('users').where({ employeeCode }).limit(1).get()
    if (duplicate.data.length) throw new Error('该员工编号已被使用')
  }
  const now = db.serverDate()
  let added
  try {
    added = await db.collection('users').add({ data: {
      openid, name, nickname:name, employeeCode:employeeCode || null, avatarUrl:'', phone:null, phoneSource:'',
      canUploadImages:false, canEditAssemblyCode:false,
      role:'user', status:reviewAccess ? 'approved' : 'pending',
      reviewAccess, reviewInviteVersion:reviewAccess ? reviewInviteVersion() : '',
      confidentialityAcceptedAt:null, createdAt:now, updatedAt:now,
      approvedAt:reviewAccess ? now : null, approvedBy:reviewAccess ? 'review_invite' : ''
    } })
  } catch (err) {
    if (!reviewAccess && isDuplicateKeyError(err)) throw new Error('该员工编号已被使用')
    throw err
  }
  const user = { _id:added._id, openid, name, employeeCode, role:'user' }
  try { await log(user, 'register', { targetId:added._id, detail:{ employeeCode, reviewAccess } }) }
  catch (err) { console.error('register_log_error', { userId:added._id, message:err.message }) }
  return { status:reviewAccess ? 'approved' : 'pending', reviewAccess }
}

ACTIONS.updateProfile = async ({ openid, data }) => {
  const user = await getCurrentUser(openid, { approved: false })
  const name = cleanText(data.name == null ? data.nickname : data.name, 30)
  const avatarUrl = cleanText(data.avatarUrl, 500)
  await db.collection('users').doc(user._id).update({ data: { name, nickname:name, avatarUrl, updatedAt: db.serverDate() } })
  await log(user, 'update_profile', { targetId: user._id })
  return true
}

ACTIONS.acceptConfidentiality = async ({ openid }) => {
  const user = await getCurrentUser(openid)
  await db.collection('users').doc(user._id).update({ data: { confidentialityAcceptedAt: db.serverDate(), updatedAt: db.serverDate() } })
  await log(user, 'accept_confidentiality')
  return true
}

ACTIONS.searchModels = async ({ openid, data }) => {
  const user = await getCurrentUser(openid)
  const keyword = cleanText(data.keyword, 100)
  if (!keyword) throw new Error('请输入查询内容')
  const exactAssembly = db.RegExp({ regexp: `^${escapeRegex(keyword)}$`, options: 'i' })
  const productContains = db.RegExp({ regexp: escapeRegex(keyword), options: 'i' })
  const r = await db.collection('models').where(_.or([{ assemblyCode: exactAssembly }, { productName: productContains }])).limit(100).get()
  const imageGroups = await loadModelImagesByAssemblyCodes(r.data.map(record => record.assemblyCode))
  const records = r.data.map(({ moduleCode, ...record }) => ({
    ...record,
    matchType: String(record.assemblyCode || '').toLowerCase() === keyword.toLowerCase() ? 'assembly_exact' : 'product_contains',
    images: imageGroups[normalizeAssemblyCode(record.assemblyCode)] || []
  })).sort((a, b) => (a.matchType === 'assembly_exact' ? 0 : 1) - (b.matchType === 'assembly_exact' ? 0 : 1))
  await log(user, 'search_models', { keyword, detail: { resultIds: records.map(x => x._id), count: records.length, truncated: records.length === 100 } })
  return { records, truncated: records.length === 100 }
}

ACTIONS.logCopy = async ({ openid, data }) => {
  const user = await getCurrentUser(openid)
  const field = data.field === 'testCode' ? 'testCode' : data.field === 'productName' ? 'productName' : ''
  if (!field) throw new Error('无效字段')
  const targetId = cleanText(data.targetId, 80)
  const record = await db.collection('models').doc(targetId).get()
  if (!record.data) throw new Error('记录不存在')
  await log(user, field === 'testCode' ? 'copy_test_code' : 'copy_product_name', { targetId, detail: { field, assemblyCode: record.data.assemblyCode } })
  return true
}

ACTIONS.listEmployees = async ({ openid, data }) => {
  await getCurrentUser(openid, { roles: ADMIN_ROLES })
  const status = ['pending', 'approved', 'rejected'].includes(data.status) ? data.status : 'pending'
  const r = await db.collection('users').where({ status }).orderBy('createdAt', 'desc').limit(100).get()
  return r.data.map(publicUser)
}

ACTIONS.setUserPermissions = async ({ openid, data }) => {
  const actor = await getCurrentUser(openid, { roles:ADMIN_ROLES })
  const target = (await db.collection('users').doc(cleanText(data.userId, 80)).get()).data
  if (!target || target.status !== 'approved') throw new Error('目标用户不存在或未通过审核')
  if (target.role !== 'user' || target.reviewAccess) throw new Error('只能修改普通员工的功能权限')
  const before = normalizeUserPermissions(target)
  const after = {
    canUploadImages:data.canUploadImages === true,
    canEditAssemblyCode:data.canEditAssemblyCode === true
  }
  await db.collection('users').doc(target._id).update({ data:{ ...after, updatedAt:db.serverDate() } })
  const changes = [
    ['canUploadImages', 'grant_upload_images_permission', 'revoke_upload_images_permission'],
    ['canEditAssemblyCode', 'grant_edit_assembly_code_permission', 'revoke_edit_assembly_code_permission']
  ].filter(([field]) => before[field] !== after[field])
  for (const [field, grantAction, revokeAction] of changes) {
    await log(actor, after[field] ? grantAction : revokeAction, { targetId:target._id, detail:{
      targetEmployeeCode:cleanText(target.employeeCode, 3), permission:field, before:before[field], after:after[field]
    } })
  }
  return after
}

ACTIONS.reviewEmployee = async ({ openid, data }) => {
  const actor = await getCurrentUser(openid, { roles: ADMIN_ROLES })
  const status = data.status === 'approved' ? 'approved' : data.status === 'rejected' ? 'rejected' : ''
  if (!status) throw new Error('无效审核状态')
  const target = (await db.collection('users').doc(cleanText(data.userId, 80)).get()).data
  if (!target) throw new Error('用户不存在')
  if (target.role === 'super_admin') throw new Error('不能审核超级管理员')
  if (actor.role !== 'super_admin' && target.role !== 'user') throw new Error('普通管理员不能审核或变更管理员状态')
  const permissionReset = status === 'rejected' ? { canUploadImages:false, canEditAssemblyCode:false } : {}
  await db.collection('users').doc(target._id).update({ data: { status, role: target.role === 'admin' ? 'admin' : 'user', ...permissionReset, approvedAt: status === 'approved' ? db.serverDate() : null, approvedBy: actor._id, updatedAt: db.serverDate() } })
  await log(actor, status === 'approved' ? 'approve_employee' : 'reject_employee', { targetId: target._id, detail: { targetName: target.nickname } })
  return true
}

ACTIONS.deleteEmployee = async ({ openid, data }) => {
  const actor = await getCurrentUser(openid, { roles: ADMIN_ROLES })
  const target = (await db.collection('users').doc(cleanText(data.userId, 80)).get()).data
  if (!target) throw new Error('用户不存在')
  if (target.openid === openid) throw new Error('不能删除自己的账号')
  if (target.role === 'super_admin') throw new Error('不能删除超级管理员')
  if (actor.role !== 'super_admin' && target.role !== 'user') throw new Error('普通管理员只能删除普通员工')
  await log(actor, 'delete_employee', { targetId: target._id, detail: { targetName: target.nickname, targetRole: target.role } })
  await db.collection('users').doc(target._id).remove()
  return true
}

ACTIONS.listModels = async ({ openid, data }) => {
  const user = await getCurrentUser(openid)
  assertPermission(ADMIN_ROLES.includes(user.role) || canUploadImages(user) || canEditAssemblyCode(user))
  const keyword = cleanText(data.keyword, 100)
  const where = keyword ? _.or([{ assemblyCode: db.RegExp({ regexp: escapeRegex(keyword), options: 'i' }) }, { productName: db.RegExp({ regexp: escapeRegex(keyword), options: 'i' }) }]) : {}
  const r = await db.collection('models').where(where).orderBy('assemblyCode', 'asc').limit(100).get()
  return r.data
}

ACTIONS.getModelImages = async ({ openid, data }) => {
  const user = await getCurrentUser(openid)
  assertPermission(canUploadImages(user))
  const assemblyCode = normalizeAssemblyCode(data.assemblyCode)
  if (!assemblyCode) throw new Error('总成编号不能为空')
  await assertModelAssemblyExists(assemblyCode)
  try {
    const result = await db.collection('model_images').where({ assemblyCode }).orderBy('slot', 'asc').limit(MAX_MODEL_IMAGE_SLOTS).get()
    return withModelImageTempURLs(groupModelImages(result.data, [assemblyCode])[assemblyCode])
  } catch (err) { modelImagesCollectionError(err) }
}

ACTIONS.prepareModelImageUpload = async ({ openid, data }) => {
  const user = await getCurrentUser(openid)
  assertPermission(canUploadImages(user))
  const assemblyCode = normalizeAssemblyCode(data.assemblyCode)
  const slot = normalizeImageSlot(data.slot)
  if (!assemblyCode) throw new Error('总成编号不能为空')
  await assertModelAssemblyExists(assemblyCode)
  await ensureModelImagesCollection()
  const cloudPath = buildModelImageCloudPath(assemblyCode, slot, data.extension, Date.now(), crypto.randomBytes(8).toString('hex'))
  return { cloudPath, maxSlots:MAX_MODEL_IMAGE_SLOTS }
}

ACTIONS.saveModelImage = async ({ openid, data }) => {
  const actor = await getCurrentUser(openid)
  assertPermission(canUploadImages(actor))
  const assemblyCode = normalizeAssemblyCode(data.assemblyCode)
  const slot = normalizeImageSlot(data.slot)
  const fileID = cleanText(data.fileID, 1000)
  const expectedFileID = cleanText(data.expectedFileID, 1000)
  if (!assemblyCode || !fileID) throw new Error('图片参数不完整')
  await assertModelAssemblyExists(assemblyCode)
  if (!isAllowedModelImageFileID(fileID, assemblyCode, slot)) throw new Error('图片文件路径与总成编号或槽位不匹配')
  await verifyModelImageFile(fileID)
  const current = await getModelImageSlot(assemblyCode, slot)
  const employeeImageAction = actor.role === 'user'
  let targetId = '', action = employeeImageAction ? 'employee_upload_model_image' : 'upload_model_image'
  if (current) {
    if (!expectedFileID || current.fileID !== expectedFileID) throw new Error('图片已被其他管理员修改，请刷新后重试')
    const updated = await db.collection('model_images').where({ _id:current._id, fileID:expectedFileID }).update({ data:{ fileID, updatedAt:db.serverDate(), updatedBy:actor._id } })
    if (!updated.stats || updated.stats.updated !== 1) throw new Error('图片已被其他管理员修改，请刷新后重试')
    targetId = current._id
    action = employeeImageAction ? 'employee_replace_model_image' : 'replace_model_image'
  } else {
    if (expectedFileID) throw new Error('图片状态已变化，请刷新后重试')
    targetId = modelImageDocumentId(assemblyCode, slot)
    try {
      await db.collection('model_images').add({ data:{ _id:targetId, assemblyCode, slot, fileID, createdAt:db.serverDate(), createdBy:actor._id, updatedAt:db.serverDate(), updatedBy:actor._id } })
    } catch (err) {
      if (isDuplicateModelImageError(err)) throw new Error('该图片位置已被占用，请刷新后重试')
      modelImagesCollectionError(err)
    }
  }
  const logWarning = await recordModelImageLog(actor, action, targetId, assemblyCode, slot)
  const fileWarning = current && current.fileID !== fileID ? await removeCloudImage(current.fileID) : ''
  const cleanupWarning = joinWarnings(logWarning, fileWarning)
  return { slot, fileID, replaced:!!current, cleanupWarning }
}

ACTIONS.deleteModelImage = async ({ openid, data }) => {
  const actor = await getCurrentUser(openid)
  assertPermission(canUploadImages(actor))
  const assemblyCode = normalizeAssemblyCode(data.assemblyCode)
  const slot = normalizeImageSlot(data.slot)
  const expectedFileID = cleanText(data.expectedFileID, 1000)
  if (!assemblyCode) throw new Error('总成编号不能为空')
  await assertModelAssemblyExists(assemblyCode)
  const current = await getModelImageSlot(assemblyCode, slot)
  if (!current) throw new Error('图片不存在或已被删除')
  if (!expectedFileID || current.fileID !== expectedFileID) throw new Error('图片已被其他管理员修改，请刷新后重试')
  const removed = await db.collection('model_images').where({ _id:current._id, fileID:expectedFileID }).remove()
  if (!removed.stats || removed.stats.removed !== 1) throw new Error('图片已被其他管理员修改，请刷新后重试')
  const action = actor.role === 'user' ? 'employee_delete_model_image' : 'delete_model_image'
  const logWarning = await recordModelImageLog(actor, action, current._id, assemblyCode, slot)
  const fileWarning = await removeCloudImage(current.fileID)
  const cleanupWarning = joinWarnings(logWarning, fileWarning)
  return { slot, cleanupWarning }
}

ACTIONS.discardModelImageUpload = async ({ openid, data }) => {
  const user = await getCurrentUser(openid)
  assertPermission(canUploadImages(user))
  const fileID = cleanText(data.fileID, 1000)
  if (!fileID || !fileID.startsWith('cloud://') || !fileID.includes('/model-images/')) throw new Error('无效图片文件')
  try {
    const bound = await db.collection('model_images').where({ fileID }).limit(1).get()
    if (bound.data.length) return false
  } catch (err) { modelImagesCollectionError(err) }
  const warning = await removeCloudImage(fileID)
  if (warning) throw new Error('未使用图片清理失败，请稍后在云存储中清理')
  return true
}

ACTIONS.previewModelsExcel = async ({ openid, data }) => {
  await getCurrentUser(openid,{roles:ADMIN_ROLES})
  const fileID=cleanText(data.fileID,1000), fileName=cleanText(data.fileName,200)
  if(!fileID || !/\.xlsx$/i.test(fileName)) throw new Error('只支持 .xlsx 文件')
  try {
    const downloaded=await cloud.downloadFile({fileID})
    const buffer=downloaded.fileContent
    if(!buffer || buffer.length===0) throw new Error('Excel文件为空')
    if(buffer.length>15*1024*1024) throw new Error('Excel文件不能超过15MB')
    const parsed=parseModelsWorkbook(buffer)
    const existing=await loadAllModels(); const diff=diffModels(parsed.records,existing)
    const preview=importPreview(parsed,diff,fileName)
    if(parsed.duplicateAssemblyCodes.length || parsed.errors.length){ await deleteTempFile(fileID); return {preview,canImport:false,importToken:''} }
    const hash=crypto.createHash('sha256').update(buffer).digest('hex')
    return {preview,canImport:true,importToken:createImportToken({openid,fileID,fileName,hash,changeSetHash:changeSetHash(diff)})}
  } catch(err) { await deleteTempFile(fileID); throw err }
}

ACTIONS.checkModelImportPermission = async ({ openid }) => {
  await getCurrentUser(openid,{roles:ADMIN_ROLES})
  return true
}

ACTIONS.cancelModelsExcel = async ({ openid, data }) => {
  await getCurrentUser(openid,{roles:ADMIN_ROLES})
  const payload=verifyImportToken(cleanText(data.importToken,5000),openid)
  await deleteTempFile(payload.fileID)
  return true
}

ACTIONS.discardUploadedModelsExcel = async ({ openid, data }) => {
  await getCurrentUser(openid,{roles:ADMIN_ROLES})
  const fileID=cleanText(data.fileID,1000)
  if(!fileID || !fileID.includes('/temp-model-imports/')) throw new Error('无效临时文件')
  await deleteTempFile(fileID)
  return true
}

ACTIONS.confirmModelsExcel = async ({ openid, data }) => {
  const actor=await getCurrentUser(openid,{roles:ADMIN_ROLES})
  const payload=verifyImportToken(cleanText(data.importToken,5000),openid)
  let preview, createSuccess=0, updateSuccess=0; const failedAssemblyCodes=[]
  try {
    const downloaded=await cloud.downloadFile({fileID:payload.fileID}); const buffer=downloaded.fileContent
    const hash=crypto.createHash('sha256').update(buffer).digest('hex')
    if(hash!==payload.hash) throw new Error('Excel文件已变化，请重新解析')
    const parsed=parseModelsWorkbook(buffer)
    if(parsed.duplicateAssemblyCodes.length || parsed.errors.length) throw new Error('Excel校验未通过，请修正后重试')
    const existing=await loadAllModels(); const diff=diffModels(parsed.records,existing)
    if(changeSetHash(diff)!==payload.changeSetHash) throw new Error('数据库内容已变化，请重新解析并确认最新预览')
    preview=importPreview(parsed,diff,payload.fileName)
    for(const batch of chunks(diff.create,20)){
      const results=await Promise.allSettled(batch.map(row=>db.collection('models').add({data:{...row,createdAt:db.serverDate(),updatedAt:db.serverDate()}})))
      results.forEach((result,i)=>{if(result.status==='fulfilled')createSuccess++;else failedAssemblyCodes.push(batch[i].assemblyCode)})
    }
    for(const batch of chunks(diff.update,20)){
      const results=await Promise.allSettled(batch.map(item=>db.collection('models').doc(item.old._id).update({data:{...item.row,updatedAt:db.serverDate()}})))
      results.forEach((result,i)=>{if(result.status==='fulfilled')updateSuccess++;else failedAssemblyCodes.push(batch[i].row.assemblyCode)})
    }
    const result={fileName:payload.fileName,createSuccess,updateSuccess,unchangedCount:diff.unchanged.length,failedCount:failedAssemblyCodes.length,failedAssemblyCodes}
    await log(actor,'import_models_excel',{detail:{fileName:payload.fileName,createSuccess,updateSuccess,unchangedCount:diff.unchanged.length,failedCount:failedAssemblyCodes.length}})
    return result
  } finally { await deleteTempFile(payload.fileID) }
}

async function validateModel(data, excludeId = '') {
  const model = { assemblyCode: cleanText(data.assemblyCode, 80), productName: cleanText(data.productName, 500), moduleCode: cleanText(data.moduleCode, 500), testCode: cleanText(data.testCode, 2000) }
  if (!model.assemblyCode || !model.productName) throw new Error('总成编号和商品名称不能为空')
  const duplicate = await db.collection('models').where({ assemblyCode: model.assemblyCode }).limit(2).get()
  if (duplicate.data.some(x => x._id !== excludeId)) throw new Error('总成编号已存在')
  return model
}

ACTIONS.updateAssemblyCode = async ({ openid, data }) => {
  const actor = await getCurrentUser(openid)
  assertPermission(canEditAssemblyCode(actor))
  const id = cleanText(data.modelId, 80)
  const assemblyCode = cleanText(data.assemblyCode, 80)
  if (!id || !assemblyCode) throw new Error('总成编号不能为空')
  const old = (await db.collection('models').doc(id).get()).data
  if (!old) throw new Error('型号不存在')
  if (old.assemblyCode === assemblyCode) return { _id:id, assemblyCode }
  const duplicate = await db.collection('models').where({ assemblyCode }).limit(2).get()
  if (duplicate.data.some(item => item._id !== id)) throw new Error('总成编号已存在')
  const updated = await db.collection('models').where({ _id:id, assemblyCode:old.assemblyCode }).update({ data:{ assemblyCode, updatedAt:db.serverDate() } })
  if (!updated.stats || updated.stats.updated !== 1) throw new Error('型号已被其他人修改，请刷新后重试')
  try {
    await db.collection('model_images').where({ assemblyCode:old.assemblyCode }).update({ data:{ assemblyCode, updatedAt:db.serverDate(), updatedBy:actor._id } })
  } catch (err) {
    if (!isMissingModelImagesCollection(err)) throw err
  }
  await log(actor, actor.role === 'user' ? 'employee_update_assembly_code' : 'update_assembly_code', { targetId:id, detail:{
    operatorEmployeeCode:cleanText(actor.employeeCode, 3), oldAssemblyCode:old.assemblyCode, newAssemblyCode:assemblyCode
  } })
  return { _id:id, assemblyCode }
}

ACTIONS.saveModel = async ({ openid, data }) => {
  const actor = await getCurrentUser(openid, { roles: ADMIN_ROLES })
  const id = cleanText(data._id, 80)
  const model = await validateModel(data, id)
  if (id) {
    const old = (await db.collection('models').doc(id).get()).data
    if (!old) throw new Error('型号不存在')
    await db.collection('models').doc(id).update({ data: { ...model, updatedAt: db.serverDate() } })
    const changedFields = ['assemblyCode', 'productName', 'moduleCode', 'testCode'].filter(key => old[key] !== model[key])
    await log(actor, 'update_model', { targetId: id, detail: { assemblyCode: model.assemblyCode, changedFields } })
    return { _id: id }
  }
  const added = await db.collection('models').add({ data: { ...model, createdAt: db.serverDate(), updatedAt: db.serverDate() } })
  await log(actor, 'create_model', { targetId: added._id, detail: { assemblyCode: model.assemblyCode } })
  return { _id: added._id }
}

ACTIONS.deleteModel = async ({ openid, data }) => {
  const actor = await getCurrentUser(openid, { roles: ADMIN_ROLES })
  const id = cleanText(data.modelId, 80)
  const target = (await db.collection('models').doc(id).get()).data
  if (!target) throw new Error('型号不存在')
  await log(actor, 'delete_model', { targetId: id, detail: { assemblyCode: target.assemblyCode } })
  await db.collection('models').doc(id).remove()
  return true
}

ACTIONS.listAdmins = async ({ openid }) => {
  await getCurrentUser(openid, { roles: ['super_admin'] })
  const approved = await db.collection('users').where({ status:'approved' }).limit(100).get()
  return {
    admins:approved.data.filter(user => ADMIN_ROLES.includes(user.role)).map(publicUser),
    users:approved.data.filter(user => user.role === 'user' && !user.reviewAccess).map(publicUser)
  }
}

ACTIONS.setAdminRole = async ({ openid, data }) => {
  const actor = await getCurrentUser(openid, { roles: ['super_admin'] })
  const target = (await db.collection('users').doc(cleanText(data.userId, 80)).get()).data
  if (!target || target.status !== 'approved') throw new Error('目标用户不存在或未通过审核')
  if (target.role === 'super_admin') throw new Error('不能修改超级管理员')
  if (target.reviewAccess) throw new Error('微信审核账号不能设为管理员')
  const role = data.role === 'admin' ? 'admin' : data.role === 'user' ? 'user' : ''
  if (!role) throw new Error('无效角色')
  await db.collection('users').doc(target._id).update({ data: { role, updatedAt: db.serverDate() } })
  await log(actor, role === 'admin' ? 'grant_admin' : 'revoke_admin', { targetId: target._id, detail: { targetName: target.nickname } })
  return true
}

ACTIONS.listLogs = async ({ openid, data }) => {
  await getCurrentUser(openid, { roles: ADMIN_ROLES })
  const action = cleanText(data.action, 60)
  const r = await db.collection('operation_logs').where(action ? { action } : {}).orderBy('createdAt', 'desc').limit(100).get()
  return r.data.map(({ operatorOpenid, ...item }) => item)
}

exports.main = async (event) => {
  const action = cleanText(event.action, 60)
  const handler = ACTIONS[action]
  if (!handler) return { ok: false, message: '未知操作' }
  try {
    const { OPENID } = cloud.getWXContext()
    return ok(await handler({ openid: OPENID, data: event.data || {} }))
  } catch (err) {
    console.error('api_error', { action, message: err.message })
    return { ok: false, message: err.message || '服务异常' }
  }
}
