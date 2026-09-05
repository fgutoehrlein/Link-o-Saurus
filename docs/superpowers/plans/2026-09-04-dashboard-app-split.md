# Dashboard App Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `extension/src/dashboard/App.tsx` by extracting cohesive dashboard views and behavior without changing user-visible behavior.

**Architecture:** Keep `DashboardApp` as the state owner and page coordinator. Extract presentational panels first, then move cohesive behavior into hooks only where the state and effects form a complete unit. Preserve existing public entry points and imports.

**Tech Stack:** TypeScript, Preact, Vitest, Vite, Graphify.

**Spec:** The approved in-chat dashboard decomposition: detail panel first, then layout components, then sessions/preferences/mutations/search; preserve shared state ownership.

## Global Constraints

- Keep `dashboard/main.tsx` as the only consumer-facing entry point.
- Do not duplicate `draft`, `detailState`, or `selectedIds` state in extracted components.
- Do not change runtime behavior, routing, permissions, persistence, or localization.
- Run Graphify before each analysis/change/QA step as required by `AGENTS.md`.
- Keep the public database and dashboard APIs unchanged.

---

### Task 1: Extract dashboard detail panel

**Files:**
- Create: `extension/src/dashboard/components/DashboardDetailPanel.tsx`
- Modify: `extension/src/dashboard/App.tsx:1911-2181`
- Test: Existing dashboard/unit tests and typecheck; no new production behavior test is required for a pure render extraction.

**Interfaces:**
- Consumes the existing `detailState`, `draft`, `selectedIds`, lookup maps, refs, and event handlers through explicit props.
- Produces one `DashboardDetailPanel` component that renders the same four detail-panel modes currently returned by `detailPanel()`.

- [ ] **Step 1: Record the current detail-panel behavior**

Run:

```bash
pnpm graphify && pnpm graphify -- explain extension/src/dashboard/App.tsx
```

Confirm that `detailPanel()` has four modes: new bookmark, single bookmark, batch selection, and empty selection.

- [ ] **Step 2: Extract the render function into a component**

Move the existing panel JSX and only the required render-local calculations into `DashboardDetailPanel.tsx`. Define a typed props object using existing dashboard types. Keep callbacks supplied by `DashboardApp`; do not move state or database operations.

- [ ] **Step 3: Replace the local render function**

Import `DashboardDetailPanel` in `App.tsx`, remove `detailPanel()`, and replace its call with the component while passing the same values and handlers.

- [ ] **Step 4: Run focused verification**

Run:

```bash
pnpm graphify && pnpm graphify -- summary && pnpm graphify -- explain extension/src/dashboard/App.tsx && pnpm graphify -- impacted extension/src/dashboard/App.tsx
pnpm lint
pnpm test
pnpm build:chrome
git diff --check
```

Expected: typecheck, tests, build, and whitespace validation exit successfully; runtime behavior remains unchanged.

---

### Task 2: Extract dashboard layout components

**Files:**
- Create: `extension/src/dashboard/components/DashboardHeader.tsx`
- Create: `extension/src/dashboard/components/DashboardSidebar.tsx`
- Create: `extension/src/dashboard/components/BookmarkWorkspace.tsx`
- Modify: `extension/src/dashboard/App.tsx` render section

Move only JSX and its direct props. Keep virtualization refs and state in `DashboardApp` until a separate tested step proves the layout hook boundary.

---

### Task 3: Extract cohesive dashboard actions

**Files:**
- Create: `extension/src/dashboard/hooks/useDashboardSessions.ts`
- Create: `extension/src/dashboard/hooks/useDashboardPreferences.ts`
- Create: `extension/src/dashboard/hooks/useBookmarkMutations.ts`
- Modify: `extension/src/dashboard/App.tsx`

Move session, preference, detail mutation, and batch mutation logic as separate units. Each hook must receive explicit dependencies and return named actions; no catch-all `useDashboardController` abstraction.

---

### Task 4: Extract search, route, and data effects

**Files:**
- Create: `extension/src/dashboard/hooks/useDashboardSearch.ts`
- Create: `extension/src/dashboard/hooks/useDashboardRoute.ts`
- Create: `extension/src/dashboard/hooks/useDashboardData.ts`
- Modify: `extension/src/dashboard/App.tsx`

Move only complete effect/state groups. Keep route state, search worker lifecycle, and initialization behavior identical. Verify cancellation and worker cleanup with focused tests before removing the original code.

---

### Task 5: Final dashboard review

Run the full quality gate:

```bash
pnpm graphify
pnpm lint
pnpm test
pnpm build:chrome
pnpm build:firefox
pnpm test:e2e
git diff --check
```

Review that `App.tsx` remains a coordinator, no extracted module has become a new monolith, and `dashboard/main.tsx` remains unchanged unless an import path requires it.
