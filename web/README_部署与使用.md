# 随手写 · Hosted Web V0.3.0

## 直接使用

公开入口：

```text
https://jamesboswell796-cyber.github.io/web/index.html
```

可在 MenubarX 收藏为菜单栏窗口，也可由 Safari 添加到 Dock，或在普通浏览器中打开。无需 `.command`、终端、localhost 或原生辅助程序。

## 本地数据

- 笔记、回收站、快照、偏好与图片附件只保存在当前浏览器、当前 Origin 的 IndexedDB。
- 页面没有账号、云数据库、遥测、第三方脚本或笔记上传接口。
- Chrome 扩展与 Hosted Web 不自动同步；使用完整 JSON 人工迁移。
- 更换域名、协议或路径前必须先导出完整 JSON。

## 多标签安全

同一浏览器中打开多个相同网址的标签页时，应用通过 `BroadcastChannel` 通知正式状态变化。不同笔记的修改按笔记合并；同一笔记的陈旧并发写入保留冲突副本，而不是静默覆盖。

## 图片与备份

图片独立保存，正文只保留短引用；默认显示为小图卡。完整 JSON 和支持的目录备份会携带被引用图片。

若当前浏览器不提供 File System Access，持续写入指定文件夹不可用，但 IndexedDB 自动保存与手动完整 JSON 导出仍然有效。

## 离线与布局

- Service Worker 只缓存同源应用壳，不上传笔记。
- 左侧栏以 CSS Grid 独立占列，展开时挤压正文，不覆盖正文。
- 窄窗口自动收窄侧栏并隐藏低价值摘要，不使用 resize 轮询。
