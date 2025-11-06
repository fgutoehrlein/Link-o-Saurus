# AGENTS.md — Link-O-Saurus (Codex Assistant Guide)

Dieses Dokument definiert, **wie der Codex-Agent arbeiten soll**, um an der Browser-Erweiterung **Link-O-Saurus** (Chrome + Firefox, WebExtension, offline-first) zu entwickeln.  
Es dient als „Arbeitsanleitung“ für den automatisierten Code-Generator-Agenten.

---

## Projektziele (für den Agenten)
- Schreibe **klaren, modularen, dokumentierten** Code in **TypeScript**.
- Implementiere **offline-first** über IndexedDB, ohne unnötige Serverabhängigkeiten.
- Halte die Extension **leichtgewichtig**: schnelle UI, keine Rendering-Lags.
- Respektiere **Minimal-Permissions**, keine unnötigen `host_permissions`.
- Stelle **Import/Export**, **Tags**, **Batch-Funktionen**, **Session-Speicherung** bereit.
- Alle UI-Features müssen **Tastatur-navigierbar** und **barrierearm (a11y)** sein.

---

## Repo / Workspace Struktur (Soll-Zustand)

```

/extension
/src
/background
sw.ts
/popup
App.tsx
main.tsx
/options
App.tsx
main.tsx
/newtab (optional, togglebar)
App.tsx
main.tsx
/shared
db.ts
search-worker.ts
utils.ts
types.ts
manifest.json

/pwa  (später)
src/...
service-worker.ts

/scripts
build.ts
zip.ts

package.json
tsconfig.json

```

**UI-Stack:** Preact oder Svelte + Vite  
**Daten:** IndexedDB (`idb` oder Dexie) + Web Worker für Suche

---

## Build & Dev-Anweisungen (für den Agenten)

### Lokale Entwicklung
- **Chrome (unpacked):**
  - `pnpm dev:chrome` → erstellt `dist/chrome`
  - In Chrome: `chrome://extensions` → Developer Mode → „Load unpacked“ → `dist/chrome`

- **Firefox (unpacked):**
  - `pnpm dev:firefox` → erstellt `dist/firefox`
  - In Firefox: `about:debugging#/runtime/this-firefox` → „Load Temporary Add-on“

### Produktion
- `pnpm build:chrome` → optimierter Build
- `pnpm build:firefox` → optimierter Build
- `pnpm zip:*` → Release-Artefakte

---

## Codex-Arbeitsregeln

### 1) Schreibe Code Schritt für Schritt
- **Keine großen Dateien in einem Schritt überschreiben.**
- Baue kleine, abgeschlossene Module.
- Nach jeder Teilaufgabe: **prüfen, kompilieren, Referenzen aktualisieren.**

### 2) Halte die Architektur sauber
- UI liest niemals direkt aus IndexedDB → **immer über API-Funktionen** in `db.ts`.
- Intensive Arbeit (Suche, Dedupe, Import/Export) → **Web Worker**.
- Hintergrundlogik (Sync, Tab-Sessions, Kontextmenüs) → **nur in background/sw.ts**.

### 3) Performance-Prinzipien
- Verwende **Virtualized Lists** (z. B. react-window) für große Mengen Bookmarks.
- Schreibzugriffe bündeln (`transaction` / `batch`), keine einzelnen Write-Pro-Bookmark-Loops.
- Nur **lazy-load** von Favicons / Thumbnails.

---

## Testing-Anweisungen (für den Agenten)
- Test-Framework: **Vitest**
- **DB-Tests:** CRUD + Migrationen
- **Worker-Tests:** Suchindex (Queries, Incremental Updates)
- **UI-Tests:** minimale Smoke-Tests + Tastaturnavigation

### Befehle
```

pnpm test
pnpm vitest run -t "<test name>"

```

Akzeptanzkriterium vor Merge: **Alle Tests grün.**

---

## PR & Code-Review-Regeln (für den Agenten)
- PR-Titel: `[Link-O-Saurus] <Änderung>`
- Vor Commit:
  - `pnpm lint`
  - `pnpm test`
  - Build prüfen (`pnpm build:chrome`)
- Wenn UI geändert → Screenshots in PR-Beschreibung einfügen.

---

## Wichtige UX-Vorgaben
| Bereich | Richtlinie |
|--------|------------|
| New-Tab-Seite | **Nicht automatisch aktivieren**. Muss in Options-Seite opt-in sein. |
| Kontextmenüs | Aktionen minimal halten, keine UI-Überladung. |
| Tagging | Schnelles Tag-Auto-Suggest, keine Popup-Dialoge die blockieren. |
| Session-Saver | Fail-sicher + reversible (Tabs wiederherstellbar). |

---

## Bekannte „Don’ts“ (basierend auf negativen Papaly-Feedbacks)
❌ Keine erzwungene Konto-Registrierung  
❌ Keine Werbung / Sponsoring-Blöcke  
❌ Keine unklaren Entwickler-Permissions  
❌ Keine UI, die langsam lädt (TTI Ziel <100ms im Popup)  
❌ Keine irreversible Daten-Speicherung ohne Export-Möglichkeit

---

## „Fertig“-Definition (Definition of Done)
- Popup startet <100ms und zeigt mindestens:
  - Boards/Tags-Panel
  - Bookmark-Liste (scrollbar, virtualisiert)
  - Suche (Worker unterstützt)
- Import/Export funktioniert mit Chrome-HTML-Bookmark-Dateien.
- Session-Pack/Unpack funktioniert mit 50+ offenen Tabs.
- New-Tab arbeit optional & abschaltbar.
- Code ist dokumentiert & verständlich.

---

**Kurzfassung:**  
Codex soll in **kleinen, getesteten Schritten** arbeiten, Fokus auf **Performance**, **Portabilität**, **Datensouveränität**, und **klare, minimalistische UI**.

Link-O-Saurus ist **leicht, schnell, zuverlässig, offline-first.**
