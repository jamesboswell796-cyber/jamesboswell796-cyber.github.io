# Project Hub · AI 数据接口 v0.3

本文件是人与 ChatGPT Worker 协作使用的 **复制粘贴协议**，不是公开可写的网络 API。

## 日常流程（不增加首页入口）

1. 点击卡片「✧ AI」，复制记录 ID、当前 `base_revision`、可编辑字段，以及你在设置中修改的 AI 编辑偏好。
2. 在 ChatGPT 用自然语言提出改动，令 AI 只返回 JSON 对象（完整 JSON 外面有一个 ```json 代码块也可以识别）。
3. 网站「AI 导入」粘贴后自动校验并预览；长正文可以展开查看全文。
4. 点击 **确认应用**，一次事务整体保存全部修改（如有版本冲突，全部取消）；操作成功后短暂出现「撤销」，设置里也可以撤销本次会话的最近操作。

## 记录修改格式

```json
{
  "schema": "project-hub.patch.v2",
  "changes": [
    {"action": "update", "id": "现有稳定ID", "base_revision": 3, "body": "修改后的完整正文"},
    {"action": "create", "kind": "prompt", "title": "新提示词", "body": "完整正文"}
  ]
}
```

- `update` 必须使用复制时的 `id`、`base_revision`，且仅发送要修改的字段。
- `create` 不应填写 `id` 或 `base_revision`；程序生成随机稳定 ID。
- 允许修改：`title`、`summary`、`body`、`kind`、`entry_url`、`current_url`。`kind=project` 需要核验入口链接，项目动态 Current 仍由原项目管理。
- 不允许 AI 修改系统字段：星标、置顶、版本、所有权、创建时间。对未知字段报错，而非忽略。
- 兼容 v1 的 create；缺少 base_revision 的旧版 update 不能直接覆盖。
- 原记录版本不符、目标不存在、字段非法时 **整包不提交**。本地一次写入 localStorage；Supabase 需先部署 `docs/batch-rpc-v03.sql`，通过单一有事务保障的 RPC 完成写入。

## 恢复及边界

- 最近 5 次提交仅保留在当前打开页面内存中，提供逐步撤销；刷新页面后内存撤销记录消失。长期恢复仍通过 JSON 备份。
- 撤销也基于原版本检查；遇到其他设备修改，停止撤销而不是覆盖。
- 备份文件 schema_version 保持 **1**，旧插件 schemaVersion 1/2 保持可读，导入只合并不删旧数据。
- 个人数据在本地或配置后在 Supabase 的 per-user RLS 表内，不存入公开 GitHub Pages 文件。
- 网站的源码可由有授权的 GitHub 工具修改；**修改仓库不等于修改私人提示词数据库**。未来的 Worker 直连 API 需单独有身份授权，仅允许小范围 get/update，并保留用户确认。
- Supabase 并未在本仓库中配置：`config.js` 的 URL/公钥仍为空。配置前网站处于单浏览器本地模式；跨设备云同步、真实 RLS、MenuBarX/手机实际点击仍待验证。
