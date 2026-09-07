'use strict'
const fs = require('fs'), path = require('path'), vm = require('vm')
const root = path.resolve(__dirname, '..')
const files = []
function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes:true })) { if (entry.name === 'node_modules') continue; const p=path.join(dir,entry.name); entry.isDirectory()?walk(p):files.push(p) } }
walk(path.join(root, 'miniprogram')); walk(path.join(root, 'cloudfunctions'))
let failed = false
for (const file of files) {
  try {
    if (file.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'))
    if (file.endsWith('.js')) new vm.Script(fs.readFileSync(file, 'utf8'), { filename:file })
  } catch (e) { failed=true; console.error(e.message) }
}
const app = JSON.parse(fs.readFileSync(path.join(root,'miniprogram/app.json'),'utf8'))
for (const page of app.pages) if (!fs.existsSync(path.join(root,'miniprogram',page+'.js'))) { failed=true; console.error(`页面缺少 JS: ${page}`) }
if (failed) process.exit(1)
console.log(`校验通过：${files.length} 个项目文件，${app.pages.length} 个页面。`)
