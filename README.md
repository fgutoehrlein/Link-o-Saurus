# Link-O-Saurus

Link-O-Saurus ist eine offline-first Browser-Erweiterung zum Sammeln, Organisieren und Wiederfinden von Links. Die Daten bleiben lokal in IndexedDB, die UI ist in Preact umgesetzt und rechenintensive Aufgaben laufen in Web Workern.

## Was die Erweiterung kann

- Schnelles Speichern von Bookmarks im Popup oder in der Sidepanel-Ansicht.
- Suche und Schnellzugriff auf Bookmarks mit Worker-gestütztem Index.
- Boards, Kategorien, Tags und regelbasierte Automatisierung.
- Kommentare pro Bookmark.
- „Später lesen“ mit Snooze-Logik.
- Session-Speicherung und Wiederherstellung offener Tabs.
- Import und Export für Backup- und Migrationsszenarien.
- Optionale AI-gestützte Vorschläge für Tags und Zielordner.
- Optionale New-Tab-Umleitung über die Einstellungen.

## Oberflächen

- Popup: Quick Save, Mini-Suche, Recent-/Quick-Access-Liste und der Wechsel ins Dashboard.
- Dashboard: Vollansicht für Verwaltung, Detailbearbeitung, virtuelle Listen, Import/Export, Sessions und Regeln.
- Options-Seite: Einstellungen für New Tab, Sync, Import/Export-Verhalten und Regelverwaltung.
- Sidepanel: dieselbe Schnellansicht wie das Popup, aber in der Browser-Seitenleiste.

## Technischer Aufbau

- UI: Preact
- Datenhaltung: IndexedDB über Dexie
- Suche und Import/Export: Web Workers
- Build-System: Vite
- Tests: Vitest
- E2E-Tests: Playwright

Die wichtigsten Bereiche liegen unter `extension/src/`:

- `background/` für Service-Worker-Logik, Messaging, Sessions, Sidepanel und New-Tab-Handling
- `popup/` für Quick Save, Suche und Schnellzugriff
- `dashboard/` für die Verwaltungsoberfläche
- `options/` für die Einstellungen
- `sidepanel/` für den Sidepanel-Einstieg
- `shared/` für Datenbank, Typen, Suche, Import/Export und allgemeine Hilfsfunktionen

## Projektstruktur

```text
.
├─ extension/
│  ├─ manifest.json
│  ├─ assets/
│  └─ src/
│     ├─ background/
│     ├─ content/
│     ├─ dashboard/
│     ├─ options/
│     ├─ popup/
│     ├─ sidepanel/
│     └─ shared/
├─ scripts/
├─ package.json
└─ README.md
```

## Setup

```bash
pnpm install
```

## Entwicklung

Chrome im Watch-Modus:

```bash
pnpm dev:chrome
```

Firefox im Watch-Modus:

```bash
pnpm dev:firefox
```

Danach die jeweilige Extension aus `dist/chrome` oder `dist/firefox` als unpacked extension laden.

## Produktion

```bash
pnpm build:chrome
pnpm build:firefox
pnpm zip:chrome
pnpm zip:firefox
```

## Tests und Qualität

```bash
pnpm lint
pnpm test
pnpm test:e2e
```

## Graphify

Für Architektur- und Impact-Analysen ist ein lokaler Graphify-Workflow eingebaut.

```bash
pnpm graphify
pnpm graphify:summary
pnpm graphify -- explain extension/src/shared/db/index.ts
pnpm graphify -- impacted extension/src/shared/db/index.ts
```

`pnpm graphify` erzeugt `.graphify/graph.json` und `.graphify/graph.md`. Die Summary- und Explain-/Impacted-Ausgaben helfen dabei, Änderungen auf ihre Abhängigkeiten zu begrenzen.

## Build- und Laufzeitdaten

Das Manifest ist auf Chrome und Firefox ausgelegt. Die Erweiterung verwendet keine `host_permissions`; optionale Rechte werden nur angefordert, wenn sie für konkrete Funktionen nötig sind.

## Lizenz

Die Lizenz ist noch nicht final festgelegt. Bitte vor einer Veröffentlichung ergänzen.
