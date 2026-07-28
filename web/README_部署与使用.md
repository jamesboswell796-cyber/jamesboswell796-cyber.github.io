# 随手记 · MenubarX Web V0.2.0

## 普通使用不需要终端

本目录是静态网页应用。把整个发布包部署到一个固定 HTTPS 地址后，在 MenubarX 中收藏 `web/index.html`，以后点击菜单栏图标或使用 MenubarX 的全局显示/隐藏快捷键即可打开。

建议使用固定域名和固定路径。笔记保存在该网址对应的 MenubarX IndexedDB 中；更换域名、子域名、协议或路径前，先在设置中导出完整 JSON。

## 可用的静态托管

可使用 GitHub Pages、Cloudflare Pages、Netlify 或任何支持 HTTPS 的纯静态文件托管。上传发布包的全部内容，不能只上传 `web` 文件夹，因为页面会复用同包中的 `js`、`css` 与 `icons`。

入口为：

```text
https://你的固定地址/web/index.html
```

## 数据与网络边界

- HTML、CSS、JavaScript 和图标由静态站点提供。
- 笔记、回收站、安全快照和偏好只保存在当前浏览器的 IndexedDB。
- 本应用没有账号、云数据库、同步 API、统计、遥测或第三方脚本。
- 本地目录备份只在你点击“选择目录”后使用浏览器的 File System Access 能力。
- Service Worker 只缓存同源应用文件，供离线再次打开；不会缓存或上传笔记内容。

## 首次迁移

1. 在 Chrome V1.0.1/V1.0.2 中打开完整页面。
2. 设置与备份 → 导出完整 JSON。
3. 在 MenubarX 版中打开设置 → 导入 JSON。
4. 确认笔记无误后，再将 MenubarX 作为主要完整编辑器使用。

Chrome 与 MenubarX 暂不实时同步，不要同时编辑同一批内容后互相覆盖。

## MenubarX 建议

- 把页面收藏为单独的 Web App。
- 设置合适的全局显示/隐藏快捷键。
- 常用尺寸可从约 430×600 开始；窗口可自由拉宽或缩窄。
- 侧栏展开时会挤压正文，不会覆盖正文；窄窗口下侧栏会自动变窄。
