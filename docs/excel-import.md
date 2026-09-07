# Excel 安全导入

真实 Excel 不需要放进项目，也不要提交到 Git。脚本只在本机读取文件，不联网；数值单元格使用底层值并转为字符串，避免 `#,##0` 等显示格式制造假变化。测试编码不会按 `/`、空格、换行或括号拆分，也不会按重复测试编码去重。

1. 本地安装工具依赖：`npm install`。
2. 执行：

   ```powershell
   npm run excel:prepare -- "D:\内部资料\2026.7.21系统型号和测试编码(1).xlsx"
   ```

3. 查看 `local-import-output/import-report.json`，重点确认：记录数、空总成编号、空测试编码、重复总成编号和 Demo 编号 E001 的 `testCodeBlank`。脚本发现空总成编号或重复总成编号时返回非零退出码，但仍生成文件供人工核对；不会擅自删除记录。
4. 在云开发控制台 `models` 集合使用“导入”，优先选择 `local-import-output/models-import.json`；若控制台要求每行一个 JSON 文档，使用 `models-import.ndjson`。选择“插入”而不是覆盖已有生产数据。
5. 导入后在测试环境确认记录总数，并查询重复报告中的编号、空测试编码记录和 Demo 编号 E001。E001 原值为空时页面应显示“暂无测试编码”。

首次正式导入建议在空 `models` 集合操作。若集合已有数据，应先在独立测试环境验证或由数据库管理员制定合并方案，避免重复总成编号。生成目录已被 Git 忽略。

2026-08-30 已由 Codex 使用本机捆绑工作簿引擎 `scripts/prepare-excel-import.mjs` 对真实文件完成一次只读复核；日常可移植命令仍使用上面的 `npm run excel:prepare`。两者都只生成本地导入产物，不修改原 Excel。
