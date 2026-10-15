# GitHub Repository Sync Implementation Plan

> **For agentic workers:** Implement task by task, keeping each task independently testable. Do not run tests unless the user asks for verification.

**Goal:** Let a user connect with either a fine-grained PAT or GitHub App login, choose a repository and JSON path, then safely push or pull Link-o-Saurus bookmarks and sessions across PCs.

**Architecture:** Add an independent GitHub sync module that handles authentication, repository/file API calls, snapshot validation, merge, and encryption. Use Dexie for app data and the last synchronized baseline; use extension-local storage for credentials and per-device connection settings. Keep current browser-native bookmark mirroring unchanged.

**Tech Stack:** TypeScript, Preact, Dexie/IndexedDB, Web Crypto, WebExtension APIs, GitHub REST Contents API, Vitest.

**Spec:** Approved design in the conversation on 2026-10-13; this plan records its implementation details.

## Global Constraints

- Keep the extension offline-first; cloud access happens only during an explicit sync action.
- Keep Chrome and Firefox supported, and request only GitHub API/auth host access required for sync.
- Do not upload native browser bookmark IDs, bookmark mappings, UI preferences, caches, or credentials.
- Never overwrite a changed remote file without re-reading it and resolving the resulting merge.
- Preserve existing records on malformed data, failed authentication, network errors, and unresolved conflicts.
- Push and pull operate on a versioned JSON snapshot containing bookmarks, their organization and metadata, and sessions.
- Use a fine-grained PAT mode and a GitHub App user-auth mode behind one auth interface.
- Keep the GitHub JSON snapshot separate from the existing browser-native bookmark sync and the current partial JSON export.

---

## Scope and Data Contract

The snapshot carries `boards`, `categories`, `bookmarks`, `tags`, `comments`, `readLater`, and `sessions`, plus a format identifier, schema version, and export timestamp. It preserves stable IDs and references. Smart Rules, user settings, browser bookmark mappings, and machine-specific caches are excluded from the first version.

The cloud file is an encrypted JSON envelope. Web Crypto encrypts/decrypts the serialized snapshot with a passphrase shared by the user across PCs; the passphrase is entered when connecting/syncing and is not stored alongside the GitHub token. The repo must be private. The local comparison baseline stays in IndexedDB, so deletion-vs-edit conflicts can be detected without maintaining a remote operation log.

Merge uses a three-way comparison of local state, remote state, and the last common baseline. Independent record changes combine. A local or remote deletion wins only when the other side left that record unchanged. Edit/edit and delete/edit conflicts are returned for explicit resolution. Apply a resolved snapshot atomically. The first push/pull on a machine with no baseline must ask whether to download into an empty local DB, or merge with existing local data; do not silently replace populated local data.

## Planned Files

- Create `extension/src/shared/github-sync/types.ts` for snapshot, conflict, and provider contracts.
- Create `extension/src/shared/github-sync/snapshot.ts` for snapshot collection, validation, and three-way merge.
- Create `extension/src/shared/github-sync/crypto.ts` for authenticated encryption using Web Crypto.
- Create `extension/src/shared/github-sync/auth.ts` for PAT and GitHub App device-flow token handling.
- Create `extension/src/shared/github-sync/github-api.ts` for repository listing and file read/write calls.
- Create `extension/src/shared/github-sync/service.ts` to coordinate pull, merge, apply, and push.
- Modify `extension/src/shared/db/index.ts` and Dexie exports/schema for atomic snapshots and persisted sync baseline.
- Modify `extension/src/shared/messaging.ts`, `extension/src/background/message-router.ts`, and `extension/src/background/sw.ts` only if credential/device flow or sync needs background mediation; keep long network actions in a surface with a live user gesture if service-worker lifetime makes that safer.
- Modify `extension/src/options/App.tsx` and `extension/src/options/App.css` for auth choice, repo/branch/path selection, passphrase input, push/pull actions, progress, and conflicts.
- Modify `extension/manifest.json` for the minimum required GitHub host permissions.
- Add focused tests alongside new modules and DB tests under `extension/src/shared/`.

## Implementation Tasks

### Task 1: Define and validate the sync snapshot

**Files:**
- Create: `extension/src/shared/github-sync/types.ts`
- Create: `extension/src/shared/github-sync/snapshot.ts`
- Test: `extension/src/shared/github-sync/snapshot.test.ts`

**Interfaces:**
- Produce `SyncSnapshotV1` with fields `format: 'link-o-saurus-sync'`, `version: 1`, `exportedAt`, and arrays `boards`, `categories`, `bookmarks`, `tags`, `comments`, `readLater`, `sessions`.
- Produce `collectSyncSnapshot(database): Promise<SyncSnapshotV1>`.
- Produce `validateSyncSnapshot(value: unknown): SyncSnapshotV1`; reject unknown format/version, malformed records, duplicate IDs, and dangling category/bookmark references before any DB write.
- Produce `mergeSyncSnapshots(base, local, remote): { snapshot, conflicts }`; each conflict includes collection, record ID, base/local/remote values, including `null` to mean deleted.

- [ ] Write tests for a valid full snapshot round-trip, missing/invalid required arrays, duplicate IDs, invalid record references, independent additions/edits, same-record edit conflict, delete-versus-unchanged, and delete-versus-edit conflict.
- [ ] Run `pnpm vitest run extension/src/shared/github-sync/snapshot.test.ts` and confirm the new tests fail before implementation.
- [ ] Implement collection, schema validation, stable-ID merge, and referential checks with no DB mutation in this module.
- [ ] Re-run the focused test command and confirm all snapshot cases pass.

### Task 2: Add atomic DB snapshot and baseline persistence

**Files:**
- Modify: `extension/src/shared/db/index.ts`
- Modify: `extension/src/shared/db.ts` only if needed to expose the new repository methods
- Test: `extension/src/shared/db.test.ts`

**Interfaces:**
- Produce `applySyncSnapshot(database, snapshot): Promise<void>` that writes all included tables in one Dexie read-write transaction, retaining supplied IDs.
- Produce `getSyncBaseline(database): Promise<{ snapshot: SyncSnapshotV1; fileSha: string } | undefined>`.
- Produce `setSyncBaseline(database, value): Promise<void>` and `clearSyncBaseline(database): Promise<void>`.
- Add a Dexie `cloudSyncState` store keyed by a fixed ID for baseline; do not put tokens or passphrases in this store.

- [ ] Write DB tests that application preserves IDs and relations, replaces each included collection consistently, stores/retrieves/clears baseline, and rolls back all table writes when validation or transaction fails.
- [ ] Run `pnpm vitest run extension/src/shared/db.test.ts` and confirm the new tests fail first.
- [ ] Add the next Dexie schema version with `cloudSyncState`; existing records must remain untouched by migration.
- [ ] Implement transactional apply and baseline functions; do not call existing `importFromJson`, which remaps IDs and omits sessions/metadata.
- [ ] Re-run the DB-focused tests.

### Task 3: Implement encryption and authentication modes

**Files:**
- Create: `extension/src/shared/github-sync/crypto.ts`
- Create: `extension/src/shared/github-sync/auth.ts`
- Test: `extension/src/shared/github-sync/crypto.test.ts`
- Test: `extension/src/shared/github-sync/auth.test.ts`

**Interfaces:**
- Produce `encryptSnapshot(snapshot, passphrase): Promise<EncryptedSyncFile>` and `decryptSnapshot(file, passphrase): Promise<SyncSnapshotV1>`.
- Use a versioned JSON envelope containing algorithm/KDF parameters, random salt and IV, and base64 ciphertext; authenticate it with AES-GCM and derive the key with PBKDF2.
- Produce `GitHubAuthProvider` methods `getAccessToken()`, `listRepositories()`, and `disconnect()`; PAT and GitHub App modes both implement the token method.
- PAT mode stores only the user-entered token in `chrome.storage.local`, masked in UI; never log tokens or include them in error messages.
- GitHub App mode uses device authorization: request a device code, show GitHub URL and user code, poll at GitHub’s returned interval, handle `authorization_pending`, `slow_down`, denial, and expiry; persist access/refresh token metadata locally and rotate on refresh. Do not ship an App private key or client secret.

- [ ] Test encryption/decryption round-trip, wrong passphrase, modified ciphertext, malformed envelopes, and unsupported envelope versions.
- [ ] Test PAT storage/removal and device-flow pending, slow-down, denial, expiration, token success, and refresh success/failure with mocked fetch/storage.
- [ ] Implement crypto using platform `crypto.subtle`; add no dependency.
- [ ] Implement both auth modes behind the same provider contract; make polling cancellable and bounded by GitHub’s expiry data.
- [ ] Run the focused crypto/auth tests.

### Task 4: Implement repository listing and JSON file operations

**Files:**
- Create: `extension/src/shared/github-sync/github-api.ts`
- Test: `extension/src/shared/github-sync/github-api.test.ts`
- Modify: `extension/manifest.json`

**Interfaces:**
- Produce `listAccessibleRepositories(auth): Promise<GitHubRepository[]>` returning stable ID, owner, name, default branch, and privacy status.
- Produce `readSyncFile(auth, repo, branch, path): Promise<{ encryptedFile: EncryptedSyncFile; sha: string } | null>`.
- Produce `writeSyncFile(auth, repo, branch, path, encryptedFile, currentSha?): Promise<{ sha: string }>`.
- Send GitHub API version and JSON accept headers; send bearer tokens only in authorization headers.

- [ ] Mock API tests for repository pagination, missing file, valid read, malformed response, 401/403, rate limiting, transient errors, first create, update with SHA, and 409/422 conflict.
- [ ] Implement request validation and actionable typed errors without exposing credentials.
- [ ] On `409`/`422`, return a conflict to the service layer; never silently retry an old payload.
- [ ] Add only the API and OAuth/device-flow origins required by the selected flow to Chrome and Firefox manifest host permissions; no wildcard host access.
- [ ] Run focused GitHub API tests and verify manifest output in both browser builds.

### Task 5: Coordinate push, pull, merge, and first-device setup

**Files:**
- Create: `extension/src/shared/github-sync/service.ts`
- Test: `extension/src/shared/github-sync/service.test.ts`
- Modify: DB APIs from Task 2 if service integration exposes a gap

**Interfaces:**
- Produce `pushSync(options): Promise<SyncResult>` and `pullSync(options): Promise<SyncResult>` with options for repo, branch, path, passphrase, and conflict decisions.
- `SyncResult` reports direction, item counts, updated file SHA, and unresolved conflicts; no success result is returned before DB and remote states are both consistent.

- [ ] Test initial push, empty-local first pull, populated-local first-pull prompt, normal merge, successful write, concurrent remote SHA change, invalid/decryption-failed remote file, network failure, and no-data-loss behavior.
- [ ] Implement flow: fetch remote + SHA; decrypt/validate; collect local; merge against baseline; stop for unresolved conflict; atomically apply merged state; upload with the fetched SHA; persist new baseline only after successful remote write.
- [ ] If the remote SHA changed before upload, re-fetch/re-merge once; if it changes again or conflicts remain, return a resolvable conflict without replacing local or remote data.
- [ ] On first push to an empty file, upload a validated local snapshot. On first pull into an empty local DB, ask the UI for confirmation before applying. Never silently replace a populated DB.
- [ ] Re-run service and dependent DB/snapshot tests.

### Task 6: Add the Options workflow

**Files:**
- Modify: `extension/src/options/App.tsx`
- Modify: `extension/src/options/App.css`
- Modify: `extension/src/shared/messaging.ts` and `extension/src/background/message-router.ts` only for operations that must run through the service worker
- Test: add focused tests for extracted Options sync view-model/helpers if existing Options tests are available

**UI states:** disconnected → choose PAT or GitHub login → connected → choose repository/branch/path → enter passphrase → push/pull → show success, progress, or conflict decisions.

- [ ] Add accessible labels, keyboard operation, live status announcements, masked PAT/passphrase inputs, connect/disconnect controls, repository picker, branch/path fields, Push and Pull buttons, and clear error/status messages.
- [ ] For OAuth device flow, show the verification URL and code, indicate polling state, and provide Cancel.
- [ ] Require explicit confirmation before applying a first pull into a populated local database; require explicit conflict decisions before completing merge.
- [ ] Keep connection settings in extension-local storage and exclude them from snapshots. Clear tokens on disconnect; do not delete the remote file.
- [ ] Check responsive layout and keyboard flow; do not run tests/build unless requested.

### Task 7: Integration review and completion checks

**Files:**
- Review: all `extension/src/shared/github-sync/` files, Options integration, DB migration, and both generated manifests
- Update: user-facing documentation for GitHub sync setup, fine-grained PAT permissions, GitHub App device login, private-repo requirement, and passphrase recovery limits

- [ ] Run Graphify and inspect `explain`/`impacted` for changed shared modules before editing any newly discovered callers.
- [ ] When the user asks to verify, run `pnpm lint`, `pnpm test`, `pnpm build:chrome`, and `pnpm build:firefox`; fix failures before calling the feature complete.
- [ ] Manually verify first connect, repo selection, push, second-device pull, independent edits from both devices, same-record conflict, disconnect, and invalid passphrase.
- [ ] Confirm failed push leaves the local baseline unchanged; failed pull leaves local DB unchanged; failed/cancelled auth leaves no partial credentials.

## Risks and Decisions

- PAT mode requires the user to create and revoke their token; GitHub recommends fine-grained tokens restricted to selected repositories. GitHub App mode needs a registered public GitHub App and device-flow configuration; its authorization tokens expire and must be refreshed or reacquired.
- GitHub’s device flow is a deliberate tradeoff for avoiding a client secret/backend in an extension. Revisit OAuth authorization-code flow with PKCE if GitHub’s supported extension flow or security review indicates device flow is unsuitable.
- The encrypted file is still JSON, but its snapshot data is ciphertext. Losing the passphrase makes the remote snapshot unrecoverable; show this clearly before first push and never upload plaintext as an implicit fallback.
- Browser-native bookmark trees may also sync through Chrome/Firefox. GitHub sync must not import or copy device-specific native IDs, or it risks duplicating native mirror folders.
- This is manual sync in the first release. Automatic background sync, conflict auto-resolution, arbitrary remotes, and repository creation are out of scope.
