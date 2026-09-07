# 随手记 · MenubarX Web V0.4.0

V0.4 是一次 controlled rebuild：保留原有本地数据与安全能力，重做 MenubarX 的默认交互和 Markdown 编辑核心。

## 核心使用方式

MenubarX 版默认是单栏“复制架 / 随手记”界面：

1. 打开后先看到笔记列表和搜索。
2. 列表中的“复制”可直接复制完整 Markdown 正文，不必进入编辑器。
3. 点击笔记进入阅读态，Markdown 在这里渲染显示。
4. 只有点击“编辑”才进入源码编辑态；编辑区直接保存 Markdown 字符串，不再通过 contenteditable / HTML 反向猜测 Markdown。
5. 新建笔记会直接进入编辑态。

这意味着 `#`、`##`、`###`、列表、引用、换行等 Markdown 源文本以实际输入内容为准；切换笔记或重新打开后不会因为 HTML 序列化而改变源码。

## MenubarX 建议

- 把固定 HTTPS 地址下的 `web/index.html` 收藏为单独的 Web App。
- 设置一个全局显示 / 隐藏快捷键。
- 常用尺寸可从约 430×600 开始；V0.4 已按这种窄窗口优先设计，不再默认展示桌面式永久侧栏。
- 高频流程应尽量保持为：打开 → 搜索 / 找到 → 复制 → 关闭。

## 数据兼容与本地边界

V0.4 继续使用原有数据库名 `quickNotesMenubarX`，因此同一网址、同一浏览器环境下会继续读取已有笔记。

- 笔记、回收站、安全快照和偏好保存在当前网址对应的 IndexedDB。
- 紧急草稿继续使用当前页面的 localStorage。
- 删除、导入和恢复仍有安全快照保护，最多保留 8 份。
- 设置中继续支持完整 JSON 导入 / 导出和当前笔记 Markdown 导出。
- 本地目录备份只在用户主动选择目录后使用 File System Access 能力。
- 本应用没有账号、云数据库、统计、遥测或第三方同步服务。

更换域名、子域名、协议或路径前，请先导出完整 JSON。不同 origin 的 IndexedDB 彼此独立。

## 离线缓存

Service Worker 缓存 V0.4 所需的静态应用壳和共享数据模块，缓存名称为 `quick-notes-menubarx-v0.4.0`。升级版本时必须同步更新 Service Worker 缓存版本，避免 MenubarX 长时间继续使用旧应用文件。

Service Worker 只缓存同源静态资源，不缓存或上传用户笔记内容。

## 部署

这是纯静态网页应用。可以部署到 GitHub Pages、Cloudflare Pages、Netlify 或其他 HTTPS 静态托管。

入口：

```text
https://你的固定地址/web/index.html
```

页面会复用仓库中的 `js`、`css` 和 `icons`，因此发布时需要保持完整目录结构，不能只单独上传 `web` 文件夹。

## 从旧版迁移

如果你已经在同一个 MenubarX URL 使用 V0.3，V0.4 会沿用同一个 IndexedDB 数据库，无需重新导入。

如果从 Chrome 扩展版或其他网址迁移：

1. 在旧环境导出完整 JSON。
2. 打开 MenubarX V0.4 → 设置与备份。
3. 导入 JSON。
4. 确认笔记、回收站和关键内容无误后再继续使用。

Chrome 扩展环境与 MenubarX 网页环境不实时同步，不要把两边当成同一个在线数据库同时编辑。
