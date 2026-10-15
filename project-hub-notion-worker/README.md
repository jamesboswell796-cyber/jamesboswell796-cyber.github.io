# Project Hub · Notion independent experiment v0.4

## Two completely independent websites

- Supabase site: GitHub Pages `/project-hub/`, using separate Supabase database (when configured).
- Notion site: GitHub Pages `/project-hub-notion/` is a **local-demo site**, not Notion sync. Local data has a different storage key and never mixes with the Supabase demo.
- Production Notion site: privately deploy this package's site + `worker/index.js` as **one Cloudflare Worker protected by Cloudflare Access**. The Worker serves the *same* UI but provides private Notion API calls.

## Security: must do before connecting real data

1. Create a Notion database `Project Hub Test`, with the exact columns described below; grant an internal Notion integration access **only to that database**.
2. Create a Cloudflare Worker with static assets from `site/`, using `wrangler.jsonc`. **Before any use**, protect the *entire Worker* (including previews) with Cloudflare Access (single-user allow policy). Do not deploy production to an unprotected hostname.
3. Set Worker secrets, never in GitHub / `config.js`:
   - `NOTION_TOKEN`: Notion integration token.
   - `NOTION_DATA_SOURCE_ID`: the database data source ID (`collection://...` is Notion tool format; store raw UUID).
   - `ACCESS_TEAM_DOMAIN`: Cloudflare Access team domain, e.g. `team.cloudflareaccess.com`.
   - `ACCESS_AUD`: Access application's JWT audience.
   - `ALLOWED_EMAIL`: the owner's exact email address; enforces single-account access.
4. Worker additionally verifies the signed Access JWT, domain, audience and email and **fails closed** without required secrets. Do not expose an API to public GitHub Pages.
5. On the Worker private URL, test one create, one read, one update, one draft promotion, then verify denied requests and another user cannot access. Test Notion 429 / partial failure. Until verified, production is NOT accepted.

## Notion database properties (exact names and types)

| Property | Notion type |
|---|---|
| `Name` | Title |
| `HubID` | Text / Rich text |
| `Kind` | Select (`prompt`, `project`) |
| `Status` | Select (`draft`, `published`) |
| `Body` | Text / Rich text |
| `Summary` | Text / Rich text |
| `EntryUrl` | URL |
| `CurrentUrl` | URL |
| `Starred` | Checkbox |
| `Pinned` | Checkbox |

Notion integration token must have read, insert, update capabilities, and be shared with the test database only. Each prompt is one Notion database page; longer bodies are stored as multiple rich-text chunks.

## Important differences

- Notion update safety uses Notion `last_edited_time` as the record revision, so edits made directly from ChatGPT/Notion invalidate stale website changes. This is best-effort; Notion does not expose a true compare-and-swap mutation.
- Notion is **not** a transactional database for multi-page writes. The backend prevalidates all changes, then writes sequentially; partial failures are possible and explicitly reported and reconciled in the UI.
- The custom website and ChatGPT's Notion connector are **separate integrations**. Connecting the website's Worker token does not automatically connect ChatGPT, and vice versa. To edit via ChatGPT, connect Notion in ChatGPT and give it access to the same authorized database.
- The two websites have no automatic import or background synchronization. Migrate individual prompts through explicit JSON export/import or authorized tools after checking duplicates.

## Experiment acceptance checklist

- Static Notion-demo UI can create multiple independent drafts, autosave, promote, search, copy, export/import locally.
- Cloudflare private Worker, Access, signed JWT validation and Notion data source must be configured by the account owner. No external Notion writes were performed while producing the source package.
- Real integration test must include ChatGPT Notion plugin changing a record externally; reopen website and verify the version changed and stale AI patches fail.
- If a batch fails after writing some pages, it must show a partial failure, not claim all-or-nothing.
