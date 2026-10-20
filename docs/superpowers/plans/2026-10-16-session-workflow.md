# Session Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make saved tab sessions easy to capture from the popup and easy to find, preview, selectively restore, and delete from a first-class dashboard Sessions view.

**Architecture:** Keep session data in the existing IndexedDB `SessionPack` store and use the existing background session controller for permission checks, URL filtering, batched tab restoration, and runtime messaging. Replace the dashboard’s one-off Sessions modal entry with an in-dashboard Sessions view, and add a compact popup action that saves the current window through the existing background API. Do not add board associations or automatic bookmark creation in this pass.

**Tech Stack:** Preact, TypeScript, WebExtension runtime messaging, existing Dexie repositories, Vitest.

**Spec:** Agreed in conversation on 2026-10-16; no separate design spec file.

## Global Constraints

- Preserve offline-first storage in IndexedDB; do not add a server or dependency.
- Use the background session controller for tab permission and restore operations.
- Keep popup startup light and add only a compact save action; do not load the full session manager there.
- Keep restore reversible: saving never closes tabs, and deleting a saved session never closes browser tabs.
- Make controls keyboard accessible and provide visible/live feedback for save, restore, and errors.
- Keep existing session records compatible; no database migration is needed.

---

## File Map

- Modify `extension/src/dashboard/App.tsx`: switch between the existing bookmark workspace and a Sessions workspace; route all session actions through background messaging; keep state and error/status handling.
- Modify `extension/src/dashboard/components/DashboardSidebar.tsx`: add an always-visible Sessions navigation item, including when the tag sidebar is compact.
- Replace `extension/src/dashboard/components/SessionDialog.tsx` with `extension/src/dashboard/components/SessionWorkspace.tsx`: show session list and selected-session tab preview with selection and restore actions.
- Modify `extension/src/dashboard/components/index.ts`: export the Sessions workspace component if created separately.
- Modify `extension/src/dashboard/App.css` and the relevant dashboard style files: style active navigation, session cards, tab rows, empty/loading/error states, responsive layout, and focus states.
- Modify `extension/src/popup/App.tsx`: add a compact “Save this window” action with busy/success/error feedback using the existing runtime message protocol.
- Modify popup styles (`extension/src/popup/App.css` and a focused popup style file if the existing structure supports it): keep the action visually attached to quick access and compact in popup and sidepanel layouts.
- Modify `extension/src/dashboard/utils/dashboard-route.ts`: add a `view=sessions` route parameter so the popup can link directly to the Sessions view while preserving current route filters.
- Reuse existing `session.saveCurrentWindow`, `session.openAll`, `session.openSelected`, and `session.delete` messages; no background message changes are needed for the defined behavior.
- Leave `extension/src/popup/SessionManager.tsx` unused; the popup only needs a compact save action, and the full management UI belongs in the dashboard.
- Add focused tests beside existing dashboard and session-controller tests for selection, restore request shape, and visible state transitions.
- Update `extension/src/shared/i18n/index.tsx` for all new user-facing strings in supported locales.

## Task 1: Add persistent Sessions navigation and view state

**Files:**
- Modify: `extension/src/dashboard/components/DashboardSidebar.tsx`
- Modify: `extension/src/dashboard/App.tsx`
- Modify: `extension/src/dashboard/App.css`
- Test: `extension/src/dashboard` tests for navigation/view state, following existing Vitest conventions

**Interfaces:**
- Sidebar receives `activeView: 'bookmarks' | 'sessions'` and `onSelectView(view)`.
- Dashboard owns the active view; selecting Sessions does not clear bookmark filters or selected bookmark state.

- [ ] Add a Sessions navigation button outside the compactable tag list so it remains discoverable when tags are collapsed.
- [ ] Add active-state styling and `aria-current="page"`; ensure both destinations work by keyboard.
- [ ] Add dashboard view state initialized from the route; render the existing `BookmarkWorkspace` only in the bookmarks view and the Sessions workspace only in the Sessions view.
- [ ] Extend `RouteSnapshot` with `view: 'bookmarks' | 'sessions'`; parse `view=sessions`, default to bookmarks, and preserve the view when `updateRouteHash` writes other route state.
- [ ] Keep existing sidebar settings and tag behavior unchanged.
- [ ] Add route tests for `view=sessions`, default bookmarks view, and preserving the view while route filters change.
- [ ] Run the focused test and `pnpm lint`.

## Task 2: Build a session list and tab preview workspace

**Files:**
- Create: `extension/src/dashboard/components/SessionWorkspace.tsx`
- Modify: `extension/src/dashboard/components/index.ts`
- Modify: `extension/src/dashboard/App.tsx`
- Modify: `extension/src/dashboard/App.css` and dashboard session styles
- Modify: `extension/src/shared/i18n/index.tsx`
- Test: focused session workspace tests

**Interfaces:**
- `SessionWorkspaceProps` supplies `sessions`, `busy`, `error`, `restoreProgress`, `onSave`, `onDelete`, and `onRestore(sessionId, tabIndexes, mode)`.
- A session row displays title, localized saved date, and tab count. Selecting a row displays its tabs with title and URL.
- All tabs are selected initially. Users can select individual tabs or toggle all. “Open selected” restores in the current window; “Open all in new window” restores the full session in a new window.

- [ ] Create the workspace with an empty state and a prominent “Save current window” action.
- [ ] Add a session list sorted newest first (the loaded `sessions` state remains the source of truth); select the newest session by default when available.
- [ ] Add accessible checkboxes for selecting tabs, with a select-all control and disabled restore actions when no tabs are selected.
- [ ] Listen for the existing `session.restore.progress` runtime event while a restore is active and show opened/failed/total counts; remove the listener on unmount.
- [ ] Keep generated session titles in this pass; do not add rename or board association.
- [ ] Add an accessible confirmation before delete; deleting only removes the saved record.
- [ ] Add responsive styles and a clear keyboard focus indicator.
- [ ] Add tests for default selection, deselecting tabs, select-all, and disabled empty-selection restore.
- [ ] Run focused tests and `pnpm lint`.

## Task 3: Route dashboard session operations through the background controller

**Files:**
- Modify: `extension/src/dashboard/App.tsx`
- Modify: `extension/src/shared/messaging.ts` only if a typed request/response is missing
- Modify: `extension/src/background/message-router.ts` only if request semantics need a small extension
- Modify: `extension/src/background/session-controller.ts` only if restore mode needs to be selectable
- Test: session-controller or messaging tests

**Interfaces:**
- Save uses `session.saveCurrentWindow` and receives `session.saveCurrentWindow.result` with the persisted `SessionPack`.
- Delete uses `session.delete` and removes the row only after the background confirms success.
- Restore uses existing `session.openSelected` for the selected indices and `session.openAll` for full-session restore. If callers need a different restore mode, extend the existing request with an explicit mode rather than duplicating tab-creation logic in the dashboard.

- [ ] Remove dashboard-side direct calls to `queryCurrentWindowTabs`, `createSession`, and `openTabs` from the save/restore handlers.
- [ ] Use the existing `sendBackgroundMessage` helper for save, restore, and delete; preserve returned errors for visible feedback.
- [ ] Ensure a successful save prepends the returned session; ensure failed save/delete leaves current state intact.
- [ ] Confirm the Sessions workspace’s progress listener is removed on unmount and ignores events when no restore is active.
- [ ] Add tests that verify the dashboard sends selected indices and does not mutate local session state before a successful delete response.
- [ ] Run focused tests and `pnpm lint`.

## Task 4: Add contextual popup capture

**Files:**
- Modify: `extension/src/popup/App.tsx`
- Modify: `extension/src/popup/App.css` and relevant popup styles
- Modify: `extension/src/shared/i18n/index.tsx`
- Test: popup action tests or the existing popup harness coverage

**Interfaces:**
- The popup action sends `{ type: 'session.saveCurrentWindow' }` and handles the typed success/error response.
- On success it shows a short confirmation and a “Manage sessions” action that opens the dashboard URL with `#/?view=sessions`.

- [ ] Place “Save this window” beside quick-access content, not inside the bookmark form, so users can distinguish session capture from saving one bookmark.
- [ ] Disable the action while saving and expose status through a polite live region.
- [ ] Do not automatically open or close tabs and do not request additional permissions directly from popup code; background owns permission handling.
- [ ] Preserve the popup’s quick startup path by not loading all saved sessions in the popup.
- [ ] Add a test for successful save feedback and an error response.
- [ ] Run focused tests and `pnpm lint`.

## Task 5: Verify integration and update Graphify impact

**Files:**
- No new source files; inspect the changed dashboard, popup, messaging, background, and localization paths.

- [ ] Run `pnpm graphify`, `pnpm graphify -- summary`, and `explain`/`impacted` for the changed dashboard navigation/workspace and popup entry points.
- [ ] Run `pnpm lint` and focused session/popup/dashboard tests.
- [ ] Run `pnpm build:chrome` and `pnpm build:firefox` to catch extension-specific compilation issues.
- [ ] Manually verify: compact sidebar still exposes Sessions; popup “Manage sessions” deep link opens that view; save current window persists without closing tabs; empty state is clear; selecting a subset restores only those tabs in the current window; full restore creates a new window; deleting a session does not close any tabs; popup feedback is visible in popup and sidepanel layouts.
- [ ] Record Graphify findings and any verification limitation in the PR description.

## Scope exclusions

- No cloud sync or account requirement; sessions remain local in IndexedDB.
- No automatic saving, crash recovery, or periodic snapshots.
- No board association or automatic conversion of sessions into bookmarks.
- No session import/export, sorting controls, or search until the session list becomes large enough to need them.
