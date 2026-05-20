# Production Review — Link-o-Saurus

## Executive summary
- Core architecture is directionally good: shared DB layer and worker-based heavy tasks are in place, but background logic is too broad and needs modularization.
- Message validation is currently insufficient at runtime and enables malformed payloads to reach privileged code paths.
- A critical schema design bug exists: the tags table uses `&name` uniqueness while IDs are canonicalized separately; this can reject valid hierarchical tags that share the same leaf name.
- Large-session restore opens tabs sequentially and can degrade UX/performance for 50+ tabs; bounded concurrency is needed.
- Observability is mostly ad-hoc `console.*`; no structured error taxonomy, correlation IDs, or health metrics exist.
- Security posture is decent (sanitized markdown, strict link schemes), but web-accessible resources are overly broad (`<all_urls>`).
- Test coverage is good for units/workers, but weak at key boundaries: message validation fuzzing, permission-failure flows, migrations, and large-session perf.

## Critical issues (must fix before release)

### 1) Runtime message validation only checks `type`
- **File/location:** `extension/src/shared/messaging.ts` (`isBackgroundRequest`) and `extension/src/background/sw.ts` (`handleBackgroundRequest` usage).
- **Why it matters:** `isBackgroundRequest` currently accepts any object with a recognized `type`, without validating required fields (e.g., `sessionId`, `tabIndexes`, booleans). Malformed messages can reach privileged handlers, causing undefined behavior, noisy failures, or accidental resource abuse.
- **Risk:** **Critical**.
- **Suggested fix:** Implement per-message payload validation (discriminated union runtime guards) before invoking handlers. Reject invalid payloads with explicit error codes.
- **Example pseudocode:**
  ```ts
  function isOpenSelected(m: unknown): m is { type:'session.openSelected'; sessionId:string; tabIndexes:number[] } {
    return isObject(m)
      && m.type === 'session.openSelected'
      && typeof m.sessionId === 'string'
      && Array.isArray(m.tabIndexes)
      && m.tabIndexes.every((n) => Number.isInteger(n) && n >= 0);
  }
  ```

### 2) Tag schema uniqueness can break valid data model
- **File/location:** `extension/src/shared/db/index.ts` (Dexie schema for version 3: `tags: 'id, &name, usageCount'`) and tag metadata logic using canonical IDs/paths.
- **Why it matters:** Hierarchical tagging commonly allows same leaf under different paths (e.g., `work/dev` and `hobby/dev`). Enforcing unique `name` can fail writes or corrupt intended semantics.
- **Risk:** **Critical** (data integrity + failed writes in production).
- **Suggested fix:** Unique key should be canonical ID or normalized full path, not leaf name. Add migration to remove/repair conflicting entries.
- **Example patch direction:**
  - Change index to `tags: 'id, &path, usageCount, *slugParts'`.
  - Migration: rebuild tag rows by canonical path, merge usage counts when duplicates exist.

## Important issues (should fix soon)

### 3) Service worker has high responsibility concentration
- **File/location:** `extension/src/background/sw.ts`.
- **Why it matters:** One file currently handles context menus, permissions, session management, badge alarms, side panel behavior, new-tab override, and request routing. This increases regression risk and slows onboarding.
- **Risk:** **High**.
- **Suggested fix:** Split into modules: `session-controller`, `badge-controller`, `context-menu-controller`, `newtab-controller`, `message-router`.

### 4) Sequential tab creation for session restore scales poorly
- **File/location:** `extension/src/background/sw.ts` (`openTabsInNewWindow`, `openTabsInCurrentWindow`).
- **Why it matters:** Opening many tabs one-by-one increases total restore latency and may violate the stated 50+ tab UX expectations.
- **Risk:** **High**.
- **Suggested fix:** Use bounded concurrency (e.g., batches of 5–10 tabs with `Promise.allSettled`) and progress feedback.

### 5) Over-broad web-accessible resource match pattern
- **File/location:** `extension/manifest.json` (`web_accessible_resources.matches: ["<all_urls>"]`).
- **Why it matters:** Allows all websites to request listed extension resources; increases fingerprinting surface and accidental exposure.
- **Risk:** **Medium**.
- **Suggested fix:** Restrict `matches` to only required origins or extension-internal use patterns.

### 6) Error responses collapse into generic `session.error`
- **File/location:** `extension/src/background/sw.ts` (`onMessage` catch block) + `extension/src/shared/messaging.ts` response types.
- **Why it matters:** Loses operation context and structured diagnostics, making failures hard to debug and hard for UI to handle precisely.
- **Risk:** **Medium**.
- **Suggested fix:** Introduce typed error envelope: `{ type:'error', code, operation, message, retriable }`.

## Minor improvements (optional cleanup)

### 7) Mixed language logs/messages reduce operability
- **File/location:** `extension/src/background/sw.ts`.
- **Why it matters:** Mixed German/English logs complicate alerting and search in shared telemetry.
- **Risk:** **Low**.
- **Suggested fix:** Standardize user-facing locale separately from log language.

### 8) README contains file citations intended for agent output
- **File/location:** `README.md`.
- **Why it matters:** In-repo docs currently include artifact-style citations (`【F:...】`) that reduce readability for contributors.
- **Risk:** **Low**.
- **Suggested fix:** Replace with normal markdown links or plain references.

## Missing tests (add concrete cases)
- Runtime message guard tests for every `BackgroundRequest` variant, including malformed payload fuzz cases.
- Migration tests for tags uniqueness/index changes and duplicate leaf-name scenarios.
- Permission denial tests for `tabs/windows` flows (`ensureTabsPermission`) ensuring UI receives actionable errors.
- Large session restore test (e.g., 100 tabs) with timing budget and partial failure handling.
- Background request contract test verifying error envelope shape for each operation.

## Refactoring recommendations
1. **Introduce command handlers map** in background router (`Record<type, handler>`), each with local schema validation.
2. **Extract domain services** from `sw.ts` (session, badge, newtab) to reduce merge conflicts and cognitive load.
3. **Unify validation utilities** for URL/tab/session payloads in `shared/validation.ts`.
4. **Add lightweight telemetry wrapper** (log levels + operation context) over raw `console.*`.

## Suggested implementation plan (ordered by impact)
1. Harden runtime message validation + structured error envelope.
2. Fix tag schema uniqueness and ship migration with rollback-safe tests.
3. Split service worker into modules with stable interfaces.
4. Optimize session restore using bounded concurrency and progress events.
5. Tighten `web_accessible_resources` matches and re-verify extension flows.
6. Expand tests around boundary conditions and migration safety.
