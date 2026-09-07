# 总成编号图片部署与验收

## 数据集合

在现有云环境手工创建 `model_images`，客户端权限设为不可读、不可写。图片关联、查询、替换和删除只允许 `api` 云函数访问。

字段结构：

```json
{
  "_id": "mi_<assemblyCode+slot的SHA-256摘要>",
  "assemblyCode": "E250",
  "slot": 1,
  "fileID": "cloud://环境/model-images/.../slot-1/...jpg",
  "createdAt": "服务端时间",
  "createdBy": "users文档_id",
  "updatedAt": "服务端时间",
  "updatedBy": "users文档_id"
}
```

`slot` 只能为 1 至 5。程序使用稳定 `_id` 并执行旧 `fileID` 比较更新；控制台仍必须建立 `(assemblyCode, slot)` 联合唯一索引，阻止并发产生重复槽位。另建立 `assemblyCode` 普通索引，用于查询结果批量加载图片。

## 云存储

文件路径规则：`model-images/<assemblyCode的Base64URL>/slot-<1到5>/<时间戳>-<随机值>.<扩展名>`。数据库不保存 base64 或临时 URL，只保存 `fileID`；`api` 在已审核用户查询后生成临时访问 URL。

管理员选择图片后，小程序先调用 `prepareModelImageUpload` 做服务端 admin+ 鉴权并取得服务端生成的路径，再调用 `wx.cloud.uploadFile`，最后调用 `saveModelImage` 再次鉴权并绑定。未绑定文件会请求 `discardModelImageUpload` 清理。

云存储客户端规则必须兼容项目原有 `avatars/`、`temp-model-imports/` 与新增 `model-images/` 上传。参考 [storage-security-rules.example.json](./storage-security-rules.example.json)：只允许已登录创建者写入指定目录，产品图片限制为常见图片扩展名及 10MB，Excel 临时文件限制为 `.xlsx` 及 15MB；不要配置匿名写入。当前头像仍使用云文件地址，因此示例保留“已登录用户可读”；产品图片页面本身使用云函数生成的临时 URL。若现有环境已有更严格规则，请合并目录条件，不要直接覆盖导致头像或 Excel 导入失效。安全规则保存后通常需要等待短暂生效时间，再做真机上传。

注意：微信标准 `wx.cloud.uploadFile` 的原始文件上传发生在客户端，存储规则负责限制文件写入；真正影响业务展示的 `model_images` 绑定、替换和删除全部由云函数按 `approved + admin/super_admin` 复核。普通员工即使伪造所有图片管理 action，也会在服务端被拒绝，且客户端无 `model_images` 数据库权限。

## 日志与删除顺序

- 首次上传：`upload_model_image`
- 更换：`replace_model_image`
- 删除：`delete_model_image`

日志 detail 只保存 `assemblyCode` 和 `slot`。更换时先确认新文件上传成功并完成数据库比较更新，然后才清理旧文件；旧文件清理失败会向管理员返回明确警告。删除固定槽位不会移动其他槽位。

## 与 Excel 的隔离

Excel 预览和确认导入只访问 `models`，不会查询、覆盖或删除 `model_images`。图片以 `assemblyCode` 独立关联，更新商品名称、模组编码或测试编码不会影响图片。
