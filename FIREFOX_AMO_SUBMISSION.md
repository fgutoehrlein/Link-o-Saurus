# Firefox AMO submission notes

## Data collection classification

The Firefox build declares:

```json
"browser_specific_settings": {
  "gecko": {
    "id": "link-o-saurus@example.com",
    "strict_min_version": "140.0",
    "data_collection_permissions": {
      "required": ["none"]
    }
  }
}
```

`none` is correct for this release because Link-o-Saurus does not collect or
transmit data outside the add-on or the local browser. The extension does
access bookmarks, URLs, and—only after the user opens AI suggestions—visible
active-tab content. Those values are inputs to the bundled local ONNX model and
remain inside the browser.

Do not select `browsingActivity`, `websiteContent`, or `bookmarksInfo` unless a
future release transmits those values outside the local add-on. If that changes,
update the manifest, privacy policy, consent flow, and AMO classification
together.

## Build environment

- Ubuntu/Linux or macOS/Windows with a POSIX-compatible shell
- Node.js 22.x (the release build was verified with Node 22.23.1)
- pnpm 9+
- no network service, API key, account, or external model download is required
  at runtime; the model and inference assets are bundled in `extension/assets`

Mozilla reviewers should use their supported Node version if compatible with
the lockfile. The repository contains the complete `pnpm-lock.yaml`.

## Reproduce the Firefox build

From the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build:firefox
pnpm zip:firefox
```

The unpacked extension is written to `dist/firefox/` and the submission archive
to `dist/firefox.zip`. The build script copies static assets, the bundled model,
the ONNX runtime, and the Firefox-specific manifest metadata.

For source submission, upload the human-readable repository source including
`extension/`, `scripts/`, `types/`, `package.json`, `pnpm-lock.yaml`, and this
file. Exclude `node_modules/`, `dist/`, test reports, and local caches. The
build uses open-source Vite, TypeScript, Preact, and pnpm-managed dependencies;
it does not use obfuscation or remote build services.

## Third-party library links

The exact resolved versions are recorded in `pnpm-lock.yaml`. Reviewer links:

- [Preact](https://github.com/preactjs/preact/releases/tag/10.19.6)
- [Dexie](https://github.com/dexie/Dexie.js/releases/tag/v4.0.4)
- [Comlink](https://github.com/GoogleChromeLabs/comlink/releases/tag/v4.4.1)
- [fflate](https://github.com/101arrowz/fflate/releases/tag/0.8.2)
- [FlexSearch](https://github.com/nextapps-de/flexsearch/releases/tag/0.7.31)
- [marked](https://github.com/markedjs/marked/releases/tag/v17.0.0)
- [sanitize-html](https://github.com/apostrophes/sanitize-html/releases/tag/2.17.0)
- [react-window](https://github.com/bvaughn/react-window/releases/tag/1.8.10)
- [Transformers.js](https://github.com/huggingface/transformers.js/releases/tag/3.8.1)
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime/releases)
- [Vite](https://github.com/vitejs/vite/releases/tag/v5.4.21)
- [TypeScript](https://github.com/microsoft/TypeScript/releases/tag/v5.9.3)

## Reviewer test flow

Install `dist/firefox/` temporarily or use the submitted archive, then:

1. Save an HTTPS page with Quick Save.
2. Open Details and request local AI suggestions.
3. Confirm suggestions appear without network access.
4. Select a tag/folder suggestion and save the bookmark.
5. Verify search, export, import, and session save/restore.
6. Verify New Tab remains unchanged unless explicitly enabled in Options.
