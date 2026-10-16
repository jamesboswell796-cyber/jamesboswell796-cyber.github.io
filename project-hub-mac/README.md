# Project Hub Shelf · macOS MVP

**Scope:** macOS 14+ only. No Windows client. Existing Project Hub website remains the mobile/browser interface.

This is a **native SwiftUI/AppKit accessory prototype** inside the existing Project Hub repository. It is not an Accepted product or synchronized cloud client. The website remains unchanged. This implementation is inspired by [ClipLine](https://github.com/lixiaoshuang79/ClipLine); no ClipLine source code is included. Consult upstream Apache-2.0 and Tendedero MIT licence terms before any source reuse.

## Build on a Mac

Requires Xcode 15+ and macOS 14+:

~~~sh
cd project-hub-mac
swift build
swift run ProjectHubShelf
~~~

It is a menu-bar accessory. Press **Control–Option–V** to toggle the floating shelf, or use the menu-bar icon. Use Control-C in the terminal to stop during development. A signed distributable app bundle has **not** been produced or tested.

## Implemented scope

- Native floating NSPanel with fullScreenAuxiliary and canJoinAllSpaces for macOS Spaces. Real Chrome full-screen appearance and input focus remain unverified.
- ClipLine-inspired clothesline/cards, with views for temporary clips, pinned/starred records, ordinary prompts, projects and local idea notes.
- **Explicit** user-triggered clipboard capture of text or images, up to 30 items kept in process memory. No background clipboard monitor, no automatic cloud upload.
- Local idea notes saved in Application Support as ideas.json; explicit export to Project Hub schema_version:1 draft JSON for manual review/import.
- Read-only import of existing Project Hub v0.4.1 JSON backup. Validates version, unique IDs, record types and important fields; errors do not overwrite previous cache.
- Clicking a prompt copies its text. Project cards copy the website's **temporary-reference** prompt, not a takeover instruction.
- Open the original Project Hub browser site from the floating panel.

## Project boundaries

The sole authority remains **TOOL/PROJECT-HUB**. Its existing two web demos (Supabase and Notion routes) currently store independent local data. This Mac prototype reads only an explicit **JSON snapshot**, with no real cloud synchronization. It cannot write to the website; idea exports require manual import confirmation.

Temporary clipboard content is discarded when the app exits, and only user-selected permanent idea notes are stored locally. Initial tests should use non-sensitive sample data, not student or secret information.

## Next acceptance checks

1. Compile with actual Xcode on macOS. Verify shortcut, menu-bar item and window behavior.
2. Test Chrome native full-screen and multi-display, focus, text editing and absence of automatic sends.
3. Import a non-sensitive Project Hub backup and validate category/cards/copy, plus rejection of malformed backups.
4. Create a local idea, export its draft JSON, and manually import it through the existing website with no record overwrite.
5. Only after these pass, consider packaging and a protected cloud API. No automatic Accepted, cloud, project takeovers or changes to existing websites.
