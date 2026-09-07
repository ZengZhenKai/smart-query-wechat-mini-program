# 部署、配置与验收

## 云数据库

建立四个集合：`users`、`models`、`model_images`、`operation_logs`。项目不要求客户端数据库读权限，因此四个集合均设置为所有客户端不可读、不可写。参考 [database-security-rules.json](./database-security-rules.json)；控制台实际规则编辑器若要求单集合配置，则分别设置 `read: false, write: false`。

建议索引：

- `users.openid` 唯一索引
- `users.phone` 唯一索引
- `users.status` 普通索引
- `models.assemblyCode` 唯一索引（导入报告无重复后再建立）
- `model_images.assemblyCode` 普通索引
- `model_images.(assemblyCode, slot)` 联合唯一索引
- `operation_logs.createdAt` 降序普通索引

不要给 `models.testCode` 建唯一索引。商品名称包含搜索使用正则匹配；约 482 条规模可工作。数据显著增长后应引入受控关键词索引或搜索服务，避免全量正则性能下降。

## 总成编号图片

部署、字段、索引、云存储路径和真机验收要求见 [model-images.md](./model-images.md)，云存储规则参考 [storage-security-rules.example.json](./storage-security-rules.example.json)。必须先创建 `model_images` 及索引，再在现有 `api` 云函数执行“上传并部署：云端安装依赖”。未创建集合时原查询仍会返回空图片槽位，不会影响型号文字查询；图片管理接口会明确提示创建集合。

## 手机号注册

正式注册改为用户手动输入中国内地手机号，不再调用微信 `getPhoneNumber`。前端只保留数字并限制 11 位，前端和云函数均按 `^1[3-9]\d{9}$` 校验；云函数从微信上下文取得 OPENID，同时检查 OPENID 和手机号是否已经注册。新用户保存 `phoneSource: manual_cn`。

必须在云数据库保留 `users.openid` 与 `users.phone` 两个唯一索引。服务端查询用于友好报错，唯一索引用于阻止并发注册造成重复。`PHONE_TOKEN_SECRET`、手机号快速验证组件资格及 `phonenumber.getPhoneNumber` OpenAPI 权限均不再需要。

## 两名超级管理员

先取得两人的 OPENID（可从云开发调用日志中的微信上下文确认），在 `api` 云函数环境变量设置：

`SUPER_ADMIN_OPENIDS=openid_1,openid_2`

必须恰好两个。两人各自正常注册后，在待审核页会静默请求 `bootstrapSuperAdmin`。云函数只允许名单内 OPENID 提升自己的账号，并写入审计日志；名单外请求不会改变数据。完成后不要删除该环境变量，以免重新部署后失去名单约束。普通管理员和客户端参数均不能设置超级管理员。

若本地开发阶段确实只有一个微信账号，可仅在开发云环境设置 `ENABLE_SINGLE_SUPER_ADMIN_BOOTSTRAP=true`；它只影响超级管理员冷启动，不会开启任何测试手机号入口。正式环境必须删除该变量或设为 `false`，并保持 `SUPER_ADMIN_OPENIDS` 恰好两人。

## 微信审核邀请码模式

提审期间如需让微信审核人员无需内部管理员人工审核即可进入查询页，按 [review-mode.md](./review-mode.md) 在 `api` 云函数环境变量配置 `REVIEW_MODE_ENABLED` 与 `REVIEW_INVITE_CODE`。该通道只能创建 `role: user` 的临时审核访问账号，不会修改既有用户或超级管理员；审核完成后必须关闭开关并重新部署云函数。

## 建议验收顺序

1. 名单内超级管理员注册后自动通过；名单外用户保持待审核。
2. 待审核/拒绝用户直接调用 `searchModels`，确认云函数返回无权限且不泄露型号。
3. 管理员通过、拒绝和删除普通员工；删除后原微信用户重新进入应回到注册页。
4. 查询 Demo 编号 E001，确认空测试编码不出现复制按钮；用 Demo 商品名称确认返回多条匹配。
5. 复制两个字段，管理员日志页确认操作人、动作、记录 ID 和时间。
6. 普通管理员直接调用 `setAdminRole`、尝试删除超级管理员，确认被拒绝。
7. 超级管理员授予/取消管理员；确认取消后恢复为 `user`。
8. 新增重复总成编号应失败；重复测试编码应允许；删除型号需二次确认。

## 已知边界

- 微信小程序无法绝对阻止系统截图、另一台设备拍照或复制后外传；当前方案是显著告知、最小权限和操作审计。
- 操作日志第一版每次显示最近 100 条；大量日志需要后续增加游标分页和归档策略。
- 查询第一版单次最多返回 100 条，超过会提示收窄关键词。
- 头像会上传至当前云环境的 `avatars/` 目录。正式发布前应在云存储控制台限制文件读取范围，并定期清理注册失败留下的孤立文件；客户端已限制常见图片扩展名，但需要更严格时可增加云端内容安全检测。
