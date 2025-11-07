# Link-O-Saurus

Link-O-Saurus ist eine Offline-first Browser-Erweiterung für das Sammeln, Strukturieren und Wiederfinden von Links. Die Erweiterung kombiniert Bookmark-Verwaltung, Team-Notizen und Session-Speicherung in einer schnellen Preact-Oberfläche und speichert alle Daten lokal in IndexedDB.

## Kundenfunktionen

- **Sammlungen & Boards organisieren** – Links werden als `Bookmark` mit Boards, Kategorien und Tags gespeichert. So lassen sich Sammlungen logisch gliedern und mit Regeln automatisieren.【F:extension/src/shared/types.ts†L3-L58】【F:extension/src/shared/db.ts†L1-L120】
- **Tagging mit Hierarchien** – Tags werden kanonisiert, als Pfad gespeichert und beim Filtern hierarchisch ausgewertet. Dadurch funktionieren auch verschachtelte Themenbereiche zuverlässig.【F:extension/src/shared/tag-utils.ts†L1-L160】【F:extension/src/shared/search-worker.ts†L1-L88】
- **Kommentare pro Bookmark** – Nutzer:innen können Kommentare mit Markdown verfassen, bearbeiten oder löschen; alle Einträge bleiben chronologisch sortiert.【F:extension/src/popup/CommentsSection.tsx†L1-L165】
- **„Später lesen“ mit Snooze** – Fällige Links erscheinen in einer separaten Liste, können geöffnet, priorisiert oder auf vordefinierte Zeiträume verschoben werden.【F:extension/src/popup/ReadLaterList.tsx†L1-L160】
- **Session Packs sichern & wiederherstellen** – Aktuelle Tab-Sitzungen lassen sich speichern, benennen und später selektiv erneut öffnen – inklusive Feedback über den Erfolg.【F:extension/src/popup/SessionManager.tsx†L1-L160】
- **Volltextsuche & Filter** – Ein FlexSearch-basierter Worker indexiert Titel, URLs, Notizen und Tags und unterstützt Filter auf Tags, Archivstatus oder Pins.【F:extension/src/shared/search-worker.ts†L1-L160】
- **Import & Export** – Bookmarks können in einem Worker gebündelt importiert oder exportiert werden, um Datenmigrationen oder Backups zu ermöglichen.【F:extension/src/shared/import-export.ts†L1-L200】【F:extension/src/shared/import-export-worker.ts†L1-L200】
- **Markdown & sichere Darstellung** – Inhalte werden mit `marked` gerendert und anschließend via `sanitize-html` gesichert, damit Notizen im Popup sicher angezeigt werden.【F:extension/src/shared/markdown.ts†L1-L140】
- **Hintergrundaktionen & Badges** – Popup-Komponenten kommunizieren asynchron mit dem Service Worker, z. B. um Sitzungen zu speichern oder Read-Later-Badges zu aktualisieren.【F:extension/src/popup/ReadLaterList.tsx†L35-L76】【F:extension/src/popup/SessionManager.tsx†L40-L120】

## Technischer Überblick

| Bereich | Technologie |
| --- | --- |
| UI | [Preact](https://preactjs.com/) + `react-window` für performante Listen-Renderings.【F:extension/src/popup/App.tsx†L1-L68】 |
| Datenhaltung | IndexedDB via Dexie, inklusive Utilities für IDs, Zeitstempel und Tag-Normalisierung.【F:extension/src/shared/db.ts†L1-L160】 |
| Suche | FlexSearch im Web-Worker (`shared/search-worker.ts`).【F:extension/src/shared/search-worker.ts†L1-L160】 |
| Markdown/Notizen | `marked` + `sanitize-html` für sichere Darstellung.【F:extension/src/shared/markdown.ts†L1-L140】 |
| Tests | Vitest-Konfiguration inkl. Fake-IndexedDB für DB-Tests.【F:vitest.config.ts†L1-L80】【F:package.json†L6-L34】 |
| Build-Pipeline | Vite + benutzerdefinierte Build-Skripte für Chrome/Firefox sowie Zip-Export.【F:scripts/build.ts†L1-L200】【F:package.json†L6-L34】 |

## Projektstruktur

```
.
├─ extension/
│  ├─ manifest.json        # WebExtension Manifest für Chrome/Firefox
│  ├─ src/
│  │  ├─ background/       # Service Worker & Hintergrundlogik
│  │  ├─ popup/            # Popup-App (Preact)
│  │  ├─ options/          # Options-Seite (Platzhalter)
│  │  └─ shared/           # Geteilte Daten- & Utility-Module
├─ scripts/                # Build- und Packaging-Skripte
├─ types/                  # Zusätzliche TypeScript-Typen
└─ vitest.config.ts        # Testkonfiguration
```

## Entwicklung & Setup

1. Repository klonen und Abhängigkeiten installieren:
   ```bash
   pnpm install
   ```
2. Entwicklungs-Build für Chrome oder Firefox starten:
   ```bash
   pnpm dev:chrome
   # oder
   pnpm dev:firefox
   ```
3. Ziel-Browser öffnen und den Ordner `dist/<browser>` als „Unpacked Extension“ laden.

Weitere nützliche Skripte:

- `pnpm build:chrome` / `pnpm build:firefox` – Produktionsbuild ohne Watcher.【F:package.json†L6-L20】
- `pnpm zip:chrome` / `pnpm zip:firefox` – Release-Pakete erstellen.【F:package.json†L6-L20】
- `pnpm test` – Vitest-Suite (inkl. Worker- und DB-Tests) ausführen.【F:package.json†L6-L20】
- `pnpm lint` – TypeScript-Typprüfung ohne Ausgabe.【F:package.json†L6-L20】

## Qualitäts- und UX-Richtlinien

- Der Popup-Start muss unter 100 ms bleiben; Listen werden virtualisiert, damit auch große Link-Sammlungen flüssig scrollen.【F:extension/src/popup/App.tsx†L1-L80】
- Schreiboperationen laufen gesammelt über Dexie-Transaktionen, um IndexedDB effizient zu nutzen.【F:extension/src/shared/db.ts†L160-L320】
- Suche, Import/Export und andere rechenintensive Aufgaben laufen in Web Workern, damit die UI reaktionsschnell bleibt.【F:extension/src/shared/search-worker.ts†L1-L160】【F:extension/src/shared/import-export-worker.ts†L1-L200】
- Einstellungen wie Theme oder New-Tab-Modus werden lokal gespeichert, sodass die Erweiterung komplett offline funktioniert.【F:extension/src/shared/db.ts†L1-L80】

## Tests

Die Vitest-Suite umfasst Unit- und Worker-Tests für Tagging, Markdown-Rendering, Suche und Datenbankinteraktionen. Führe sie lokal mit `pnpm test` aus, bevor du Änderungen veröffentlichst.【F:extension/src/shared/tag-utils.test.ts†L1-L160】【F:extension/src/shared/search-worker.test.ts†L1-L120】【F:extension/src/shared/markdown.test.ts†L1-L120】

## Lizenz

Der Lizenztext ist noch nicht final definiert. Ergänze hier die gewünschte Lizenz, bevor die Erweiterung veröffentlicht wird.
