# Project Hub · 个人云同步接入手册（v0.3.1）

目的：保持**一个静态网站 + 一个受 RLS 保护的 Supabase 项目**。不增加独立服务器、复杂后台或私人数据 GitHub 存储。

## 操作前

1. 先在当前浏览器的 Project Hub 设置里执行 **导出 JSON 备份**，单独保管。尤其是已经在本地演示模式使用过的设备：切换云模式不会自动将 `localStorage` 中的个人提示词迁到 Supabase，也不要误认为它们被删除。
2. 由本人创建并控制一个 Supabase 项目；可连接 ChatGPT 的 Supabase 插件，在明确授权后让 Worker 协助查看数据库结构、执行下面两个 SQL 文件及核实 RLS，避免粘贴密钥或密码到聊天中。
3. 确保 Supabase Auth 只允许本人注册或仅由管理员创建个人账号。不要开放不受控的公开注册；不要在 GitHub、聊天或网页里传送登录密码、`service_role` / `secret` Key、数据库连接字符串。

## 在 Supabase 中

4. 在 SQL Editor 中先执行 `docs/schema.sql`，再执行 `docs/batch-rpc-v03.sql`。第二个脚本创建具有 `SECURITY INVOKER` 权限的**单事务**批量修改 RPC `hub_apply_batch`。
5. 检查 `hub_items` 开启 RLS，`authenticated` 用户只可以读写自己 `user_id = auth.uid()` 的记录；`anon` 不允许读写；`hub_apply_batch` 只向 `authenticated` 授予执行权限。
6. 仅获取项目的 **Project URL** 和 **publishable / anon** 客户端公钥（不是 secret / service_role key）。用它们填写 GitHub 仓库 `project-hub/config.js` 的 `supabaseUrl` 与 `supabaseAnonKey`。客户端密钥可公开，但安全前提是第 4、5 步确实正确。

## 上线验收

7. GitHub Pages 发布后，用私人账号登录 Project Hub。在 A 设备创建测试记录、更改正文、收藏和置顶；B 设备使用**同一账号**重新打开或点击「刷新」，确保读到更改；B 设备再修改，A 设备刷新。系统不承诺无需刷新就立即推送。
8. 用两个设备制造基于旧 `base_revision` 的并发更新，必须拒绝旧版本覆盖。用 2 条以上变更制造其中一条冲突，`hub_apply_batch` 必须让**全部变更失败**。撤销同样要保留版本检查。
9. 确认登出后无法读写私人记录；使用第二个测试账号（仅在需要测试隔离时创建）验证看不到对方的任何数据。不得因为缺少此项而宣称 RLS 验收通过。
10. 完成真实云验证后，再把第 1 步的个人 JSON 备份从网页「导入 JSON 备份」合并到云端，预览差异、确认后写入。未验证前先保管好备份，不自动上传全部资料。

## 故障时

- 网络失败时网页保留最后成功加载的列表，不表示云端数据已删除；写入失败不会悄悄回退到本地。修复连接后刷新。
- 登录过期时重新登录；**不要**把密码发给 Worker。
- 已连接账号但保存操作失败：先检查是否执行了 `batch-rpc-v03.sql`，并检查 RPC `authenticated` 权限和 RLS。不要改成逐条 REST 更新绕开原子提交。
- 私人 AI 编辑偏好目前单设备保存，暂未启用跨设备同步；网站源码和发布 SQL 是公开资料。

当前状态：GitHub Pages 工作流已成功；**尚无实际 Supabase 项目连接或真实跨设备/RLS 通过证据**。
