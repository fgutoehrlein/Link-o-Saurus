# Store listing draft

## Short description

Offline-first bookmark manager for saving, organizing, searching, and restoring links.

## Full description

Link-o-Saurus keeps your bookmarks organized locally in your browser. Save the
current page from the popup or side panel, find links quickly with worker-backed
search, organize them with boards, categories, and tags, and restore saved tab
sessions when you need them.

The MVP includes:

- Quick Save from the popup and side panel;
- local bookmark search and a dashboard with virtualized lists;
- boards, categories, tags, comments, and read-later items;
- Chrome HTML bookmark import;
- JSON, HTML, and ZIP export for backup and migration;
- session save and restore with partial-failure handling.
- optional local AI suggestions for tags and destination folders; page context
  is read only when the user opens the details/suggestion flow.

No account is required. Bookmark data stays in local browser storage. There
are no ads, analytics, tracking identifiers, or remote AI services. AI
suggestions run locally with a bundled model.

## Permissions explanation

- `storage`: browser extension preferences and small runtime state.
- `bookmarks`: optional native-browser bookmark import/synchronization flows.
- `contextMenus`: user-initiated save actions from the browser context menu.
- `activeTab`: read the currently selected tab when the user invokes Quick Save.
- `scripting`: user-initiated extraction for context-menu save actions.
- `alarms`: refresh the read-later badge.
- `sidePanel`: provide the optional side-panel interface.
- `tabs`, `windows` (optional): save and restore sessions only after the user grants access.

New-tab redirection and native bookmark synchronization are opt-in. AI
suggestions are optional and local; they do not transmit page content or
bookmark data.

## Reviewer test instructions

1. Install the extension in a fresh browser profile.
2. Open any normal HTTPS page and use Quick Save from the extension action.
3. Open the dashboard, verify the saved bookmark, add a tag, and search for it.
4. Import a Netscape/Chrome HTML bookmark file from Options.
5. Export JSON or HTML and verify that the download is created locally.
6. Grant optional `tabs`/`windows` access and save/restore a session.
7. Leave New Tab disabled and verify that the browser's default New Tab remains unchanged.

Build commands:

```bash
pnpm install
pnpm build:chrome
pnpm build:firefox
```
