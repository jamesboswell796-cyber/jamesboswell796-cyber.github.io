# Project Hub AI interface · v0.2

This is a **copy–paste data protocol**, not a network API. No secrets or user data are baked into GitHub Pages.

## Human workflow

1. On any card, click `✧ AI` to copy an editing request. It includes the record ID, current `base_revision`, editable fields, and the user's optional editing preference.
2. Paste into ChatGPT and describe the desired change in natural language. ChatGPT returns **only JSON**, not an executable script.
3. In Project Hub, click `AI 导入` → paste JSON → `检查差异` → `确认应用`. The site validates the requested change before writing. `starred` and `pinned` are retained.

## Update example

```json
{
  "schema": "project-hub.patch.v2",
  "changes": [
    {"action": "update", "id": "existing-record-id", "base_revision": 3,
     "body": "修改后的完整提示词正文"}
  ]
}
```

On update, use the exact ID and `base_revision` from the **latest** AI editing request. If the record's revision changes before the patch is imported, the site rejects it. Supabase writes additionally compare the revision in the database.

## Create example

```json
{
  "schema": "project-hub.patch.v2",
  "changes": [
    {"action": "create", "kind": "prompt", "title": "新提示词", "body": "提示词正文"}
  ]
}
```

`create` must not contain an ID or base_revision. The client creates a stable ID. For `kind: "project"`, provide a verified `entry_url`. Allowed editable fields: `title`, `summary`, `body`, `kind`, `entry_url`, `current_url`. AI patches cannot delete or set `starred`, `pinned`, `revision`, `created_at` or `user_id`.

A `project-hub.patch.v1` **create** patch remains readable; older v1 **update** patches without `base_revision` require re-copying the current editing request for protection. Backup schema (`schema_version: 1`) is unchanged. Multiple changes are applied sequentially, not transactionally; the UI reports any partial failure.

## Versioning and permission model

- **Public GitHub repo and Pages:** website source, static assets, and this contract only. Worker with a user-connected GitHub tool may propose/push code changes with appropriate authorization. This is not the private prompt database.
- **Private records:** stored only in browser storage while running in local-demo mode. When explicitly configured, Supabase Auth + per-user RLS backs the private items. GitHub contents must never include the user's record collection or private backup.
- **No direct Worker data write API in v0.2.** Future connection may expose `get_item(id)` and `update_item(id, base_revision, patch)` with authenticated scoped permissions, read-back confirmation, and visible user approval. A URL alone does **not** confer write permission.
- Custom AI editing preferences are currently saved **per browser** (localStorage); they do not sync automatically. The fixed JSON contract is deliberately not editable by the user.
