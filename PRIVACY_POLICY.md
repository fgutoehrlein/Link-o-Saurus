# Link-o-Saurus Privacy Policy

Last updated: 2026-09-04

Link-o-Saurus is an offline-first bookmark manager. The public MVP does not
require an account and does not send bookmark data, URLs, titles, tags,
comments, sessions, settings, or page content to a developer-controlled server.

## Data stored locally

The extension stores the following data in the browser's local IndexedDB and
browser bookmark APIs when the related feature is enabled:

- bookmarks, URLs, titles, notes, tags, comments, and visit metadata;
- saved tab sessions;
- extension preferences and optional native-bookmark sync mappings.

This data is used only to provide the extension's bookmark-management features.

## Local AI suggestions

When the user opens the Quick Save details, the extension may use the current
bookmark title and URL, locally stored bookmarks, categories, and tags to
suggest tags and a destination folder. If the user invokes page-context
suggestions, the extension also reads visible text, page title, description,
and selected text from the active tab.

The model and inference runtime are bundled with the extension. Inference runs
locally in a Web Worker; these inputs and generated embeddings do not leave the
browser. The AI feature is optional and does not save suggestions unless the
user chooses them while saving a bookmark.

## Data sharing and tracking

The MVP has no analytics, advertising, tracking identifiers, cookies, or remote
data collection. Exports are created only when the user explicitly requests a
local download. The extension does not sell or share user data. Firefox's
manifest therefore declares `data_collection_permissions.required: ["none"]`.

## Optional features

New-tab redirection and native bookmark synchronization are opt-in settings.
They can be disabled in Options. A future network-backed AI feature would
require a new disclosure, consent flow, and updated store classification before
activation.

## Data control

Users can export their data or clear the extension database from the extension
UI. Uninstalling the extension may remove browser-managed extension storage;
users should export data before uninstalling if they need a backup.

## Contact

For privacy questions or deletion requests, use the support contact listed on
the relevant Chrome Web Store or Firefox Add-ons listing.
