import type { ComponentChildren, FunctionalComponent } from 'preact';
import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useState } from 'preact/hooks';

import { getUserSettings, saveUserSettings } from '../db';
import { sendBackgroundMessage } from '../messaging';
import type { LanguagePreference } from '../types';

export type AppLocale = Exclude<LanguagePreference, 'auto'>;

type I18nContextValue = {
  locale: AppLocale;
  languagePreference: LanguagePreference;
  setLanguagePreference: (preference: LanguagePreference) => Promise<void>;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

const translations: Record<string, string> = {
  'Link-O-Saurus Datenportabilität': 'Link-O-Saurus data portability',
  'Importiere oder exportiere deine Bookmarks ohne die UI zu blockieren.': 'Import or export your bookmarks without blocking the UI.',
  'Einstellungsbereiche': 'Settings sections',
  'Allgemein': 'General',
  'Synchronisation': 'Synchronization',
  'Daten': 'Data',
  'Arbeitsbereich': 'Workspace',
  'Neuer Tab': 'New tab',
  'Automatisierung': 'Automation',
  'Synchronisation & Regeln': 'Synchronization & rules',
  'Datensouveränität': 'Data ownership',
  'Sprache': 'Language',
  'Wähle die Sprache der Erweiterung. Bei „Automatisch“ wird die Browser-Sprache verwendet.': 'Choose the extension language. “Automatic” uses your browser language.',
  'Automatisch (Browser-Sprache)': 'Automatic (browser language)',
  'Neuer Tab (Opt-in)': 'New tab (opt-in)',
  'Link-o-Saurus als neuen Tab verwenden': 'Use Link-o-Saurus as the new tab',
  'Aktualisiere Einstellung…': 'Updating setting…',
  'Bookmark-Sync': 'Bookmark sync',
  'Bidirektionale Synchronisation aktivieren': 'Enable bidirectional synchronization',
  'Ordnerhierarchie importieren': 'Import folder hierarchy',
  'Beim Löschen': 'On deletion',
  'Nativer Bookmark wird gelöscht': 'Delete native bookmark',
  'Nur archivieren (native Kopie bleibt)': 'Archive only (native copy remains)',
  'Import läuft…': 'Importing…',
  'Initial-Import jetzt ausführen': 'Run initial import now',
  'Smart Rules': 'Smart rules',
  'Name': 'Name',
  'Host (optional)': 'Host (optional)',
  'URL enthält (optional)': 'URL contains (optional)',
  'MIME-Typ (optional)': 'MIME type (optional)',
  'Tags hinzufügen': 'Add tags',
  'Kategorie setzen': 'Set category',
  'Regel speichern': 'Save rule',
  'Regeln werden geladen…': 'Loading rules…',
  'Bedingungen': 'Conditions',
  'Aktionen': 'Actions',
  'Noch keine Regeln gespeichert.': 'No rules saved yet.',
  'Import & Export': 'Import & export',
  'Import': 'Import',
  'Export': 'Export',
  'HTML importieren': 'Import HTML',
  'JSON importieren': 'Import JSON',
  'Verarbeitet': 'Processed',
  'Importiert': 'Imported',
  'Übersprungen': 'Skipped',
  'Duplikate': 'Duplicates',
  'Fehler': 'Error',
  'Schließen': 'Close',
  'Sessions': 'Sessions',
  'Suchen & öffnen': 'Search & open',
  'Sortierung': 'Sort order',
  'Relevanz': 'Relevance',
  'Neueste': 'Newest',
  'Alphabetisch': 'Alphabetical',
  'Bookmarks durchsuchen': 'Search bookmarks',
  'Bookmarks durchsuchen (/)': 'Search bookmarks (/)',
  'Aktuellen Tab speichern': 'Save current tab',
  'Titel': 'Title',
  'Tags': 'Tags',
  'Folder (Vorschlag)': 'Folder (suggested)',
  'Kein Folder': 'No folder',
  'KI-Vorschläge': 'AI suggestions',
  'berechne…': 'calculating…',
  'Keine sicheren Tag-Vorschläge.': 'No confident tag suggestions.',
  'Keine Tags': 'No tags',
  'Tags (optional)': 'Tags (optional)',
  'Tag hinzufügen': 'Add tag',
  'Kommentare': 'Comments',
  'Kommentare werden geladen …': 'Loading comments …',
  'Noch keine Kommentare.': 'No comments yet.',
  'Kommentar': 'Comment',
  'Dein Name': 'Your name',
  'Markdown erlaubt. @Name für lokale Mentions.': 'Markdown supported. Use @Name for local mentions.',
  'Dashboard öffnen': 'Open dashboard',
  'Einstellungen': 'Settings',
  'Einstellungen öffnen': 'Open settings',
  'Später lesen': 'Read later',
  'Keine Wiedervorlagen fällig.': 'No read-later items due.',
  'Auswählen …': 'Select …',
  'Session-Titel (optional)': 'Session title (optional)',
  'Fenstername': 'Window name',
  'Session-Titel': 'Session title',
  'Neues Lesezeichen': 'New bookmark',
  'Füge Kerninformationen hinzu. Weitere Angaben sind optional.': 'Add the essential information. Additional details are optional.',
  'Allgemeine Informationen': 'General information',
  'Kategorie': 'Category',
  'Ohne Kategorie': 'No category',
  'Notizen': 'Notes',
  'Metadaten & Icon': 'Metadata & icon',
  'Erstellt': 'Created',
  'Besuche': 'Visits',
  'Mehr Aktionen': 'More actions',
  'Board': 'Board',
  'Board wählen': 'Choose board',
  'Verschieben': 'Move',
  'Auto': 'Automatic',
  'Wähle ein Lesezeichen aus, um Details zu bearbeiten oder Batch-Aktionen auszuführen.': 'Select a bookmark to edit its details or run batch actions.',
  'Dashboard durchsuchen': 'Search dashboard',
  'Suche nach Titeln, URLs, Tags oder Notizen…': 'Search titles, URLs, tags or notes…',
  'Theme auswählen': 'Choose theme',
  'Light-Mode aktivieren': 'Enable light mode',
  'Light-Mode': 'Light mode',
  'Dark-Mode aktivieren': 'Enable dark mode',
  'Dark-Mode': 'Dark mode',
  'Tags-Leiste erweitern': 'Expand tags sidebar',
  'Tags-Leiste einklappen': 'Collapse tags sidebar',
  'Aktive Filter': 'Active filters',
  'Details': 'Details',
  'Detailbereich': 'Details panel',
  'Detailbereich öffnen': 'Open details panel',
  'Detailbereich einklappen': 'Collapse details panel',
  'Auswahl entfernen': 'Clear selection',
  'Bookmark-Hierarchie': 'Bookmark hierarchy',
  'Darstellung und Einstellungen': 'Appearance and settings',
  'Darstellung der Bookmark-Liste': 'Bookmark list view',
  'Keine aktiven Filter – alle Bookmarks sichtbar.': 'No active filters – all bookmarks are visible.',
  'Tab-Sessions sichern und wiederherstellen': 'Save and restore tab sessions',
  'Aktiven Tab neu laden': 'Reload active tab',
  'Kein aktiver Tab erkannt': 'No active tab detected',
  'Icon hochladen': 'Upload icon',
  'oder klicken, um eine Bilddatei auszuwählen.': 'or click to select an image file.',
  'Tags hinzufügen/entfernen': 'Add/remove tags',
  'Zu Link-o-Saurus speichern': 'Save to Link-o-Saurus',
  'Link-o-Saurus Seitenleiste öffnen': 'Open Link-o-Saurus side panel',
  'Bookmark gespeichert': 'Bookmark saved',
  'Kategorie auswählen': 'Choose category',
  'Keine Kategorie verfügbar': 'No category available',
  'Tags hinzufügen (Enter drücken)': 'Add tags (press Enter)',
  'Klick: einschließen · Rechtsklick oder Taste N: ausschließen': 'Click to include · right-click or press N to exclude',
  'Speichere deine aktuellen Tabs oder öffne gespeicherte Sessions.': 'Save your current tabs or open saved sessions.',
  'Löschen': 'Delete',
  'Speichern': 'Save',
  'Kommentar hinzufügen': 'Add comment',
  'Nächste Woche': 'Next week',
  'Lädt Sessions …': 'Loading sessions …',
  'Alle öffnen': 'Open all',
  'Auswahl öffnen': 'Open selection',
  'Keine Auswahl': 'No selection',
  'Keine Einträge gefunden.': 'No entries found.',
  'Link im neuen Tab öffnen': 'Open link in new tab',
  'Ausgewählte löschen': 'Delete selected',
  'Auswahl löschen': 'Delete selection',
  'Suche eventuell eingeschränkt.': 'Search may be limited.',
  'Bitte eine Bilddatei für das Icon auswählen.': 'Please select an image file for the icon.',
  'Alle Filter zurückgesetzt.': 'All filters reset.',
  'Bitte eine gültige URL angeben.': 'Please enter a valid URL.',
  'Tags hinzugefügt.': 'Tags added.',
  'Tags konnten nicht hinzugefügt werden.': 'Could not add tags.',
  'Lesezeichen gelöscht.': 'Bookmark deleted.',
  'Löschen fehlgeschlagen.': 'Delete failed.',
  'Session geöffnet.': 'Session opened.',
  'Session konnte nicht geöffnet werden.': 'Could not open session.',
  'Session gelöscht.': 'Session deleted.',
  'Session konnte nicht gelöscht werden.': 'Could not delete session.',
  'Einstellungen konnten nicht geöffnet werden.': 'Could not open settings.',
  'Tab konnte nicht geöffnet werden.': 'Could not open tab.',
  'Gespeichert. Mit Enter kannst du sofort den nächsten Tab sichern.': 'Saved. Press Enter to save the next tab right away.',
  'Kommentar konnte nicht gelöscht werden.': 'Could not delete comment.',
  'Keine Tabs ausgewählt.': 'No tabs selected.',
  'Tabs konnten nicht geöffnet werden.': 'Could not open tabs.',
  'Auswahl konnte nicht geöffnet werden.': 'Could not open selection.',
  'Bitte einen Namen für die Regel vergeben.': 'Please provide a name for the rule.',
  'Regel konnte nicht gelöscht werden.': 'Could not delete rule.',
  'Duplikate anhand normalisierter URLs überspringen': 'Skip duplicates based on normalized URLs',
  'Favicons in ZIP aufnehmen (falls verfügbar)': 'Include favicons in ZIP (when available)',
  'Importiere HTML- oder JSON-Dateien. Vorgang läuft im Worker ohne UI-Blockade.': 'Import HTML or JSON files. The operation runs in a worker without blocking the UI.',
  'Import/Export läuft…': 'Import/export in progress…',
  'Unterstützte Formate:': 'Supported formats:',
  'Mehrere Tags oder URL-Teile bitte mit Komma trennen. Host-Matches gelten auch für Subdomains.': 'Separate multiple tags or URL parts with commas. Host matches also apply to subdomains.',
  'Liste': 'List',
  'Kacheln': 'Tiles',
  'Detaillierte Zeilenansicht mit Metadaten zum schnellen Scannen.': 'Detailed row view with metadata for quick scanning.',
  'Visueller Überblick mit Fokus auf Titel, Icons und schnelle Orientierung.': 'Visual overview focused on titles, icons and quick orientation.',
  'Neu': 'New',
  'Details anzeigen': 'Show details',
  'Details ausblenden': 'Hide details',
  'Alle Filter entfernen': 'Clear all filters',
  'Suche…': 'Searching…',
  'Auto-Modus aktiv': 'Auto mode active',
  'Manueller Modus aktiv': 'Manual mode active',
  'Öffnen': 'Open',
  'Vorhandenes öffnen': 'Open existing',
  'Diese URL ist bereits gespeichert.': 'This URL is already saved.',
  'Link-O-Saurus Einstellungen': 'Link-O-Saurus settings',
  'Verwalte Darstellung, Synchronisation, Regeln und deine portablen Bookmark-Daten.': 'Manage appearance, synchronization, rules, and portable bookmark data.',
  'Keine passenden Bookmarks gefunden.': 'No matching bookmarks found.',
  'Entferne Suchbegriffe oder Filter, oder erstelle ein neues Bookmark.': 'Remove search terms or filters, or create a new bookmark.',
  'Filter zurücksetzen': 'Reset filters',
  'Neues Bookmark': 'New bookmark',
  'Noch keine Bookmarks.': 'No bookmarks yet.',
  'Speichere einen Link im Popup oder lege hier dein erstes Bookmark an.': 'Save a link from the popup or create your first bookmark here.',
  'Noch keine Sessions gespeichert.': 'No sessions saved yet.',
  'Importiere HTML- oder JSON-Dateien. Der Vorgang läuft im Hintergrund weiter.': 'Import HTML or JSON files. The operation continues in the background.',
  'Einstellungen konnten nicht geladen werden.': 'Could not load settings.',
  'Regeln konnten nicht geladen werden.': 'Could not load rules.',
  'Mindestens eine Bedingung angeben (Host, URL-Teil oder MIME-Typ).': 'Provide at least one condition (host, URL part, or MIME type).',
  'Mindestens eine Aktion angeben (Tags oder Kategorie).': 'Provide at least one action (tags or category).',
  'Regel konnte nicht gespeichert werden.': 'Could not save rule.',
  'Regel konnte nicht aktualisiert werden.': 'Could not update rule.',
  'Die Tabs-Berechtigung wurde nicht erteilt.': 'The tabs permission was not granted.',
  'Unerwartete Antwort vom Hintergrunddienst.': 'Unexpected response from the background service.',
  'Der Browser hat das Setzen von chrome_url_overrides verhindert. Prüfe die Tabs-Berechtigung.': 'The browser prevented setting chrome_url_overrides. Check the tabs permission.',
  'Neuer Tab aktiviert. Chrome übernimmt die chrome_url_overrides-Einstellung nach dem nächsten geöffneten Tab. Falls nichts passiert, lade die Erweiterung auf chrome://extensions neu. Firefox erfordert zusätzlich die Aktivierung von „Als Startseite verwenden“ in den Add-on-Einstellungen.': 'New tab enabled. Chrome applies the chrome_url_overrides setting after the next opened tab. If nothing happens, reload the extension at chrome://extensions. Firefox also requires enabling “Use as homepage” in the add-on settings.',
  'Neuer Tab deaktiviert. Der nächste neue Tab öffnet wieder die Standard-Startseite deines Browsers.': 'New tab disabled. The next new tab will open your browser’s default start page again.',
  'Sync-Einstellungen gespeichert. Service Worker ggf. neu laden.': 'Sync settings saved. Reload the service worker if needed.',
  'Initial-Import abgeschlossen.': 'Initial import completed.',
  'Link-o-Saurus kann als besonders schneller Startpunkt genutzt werden. Die Einstellung bleibt komplett optional und lässt sich jederzeit zurücksetzen.': 'Link-o-Saurus can be used as a particularly fast starting point. This setting is completely optional and can be reset at any time.',
  'Beim Aktivieren wird die': 'When enabled, the',
  '-Zuweisung gesetzt. Chrome lädt sie nach dem Öffnen des nächsten Tabs (oder nach einem manuellen Reload unter': 'assignment is set. Chrome loads it after opening the next tab (or after a manual reload at',
  '). Firefox zeigt einen Hinweis, falls du das Add-on zusätzlich im Einstellungsdialog als Startseite freigeben musst.': '). Firefox shows a notice if you also need to enable the add-on as the homepage in settings.',
  'Steuere die bidirektionale Synchronisation mit dem nativen Lesezeichenbaum. Änderungen an den Einstellungen greifen sofort; bei Bedarf den Service Worker neu laden.': 'Control bidirectional synchronization with the native bookmark tree. Setting changes apply immediately; reload the service worker if needed.',
  'Warnung: Bei destruktiven Aktionen (Löschen/Archivieren) werden Änderungen sofort übernommen. Starte den Import nur, wenn der Mirror-Ordner aktuell ist.': 'Warning: destructive actions (delete/archive) apply immediately. Start the import only when the mirror folder is current.',
  'Automatisiere die Kategorisierung neuer Bookmarks anhand von Host- oder URL-Mustern. Regeln wirken auf alle Speicher-Vorgänge, inklusive Importen.': 'Automate categorizing new bookmarks using host or URL patterns. Rules apply to all save operations, including imports.',
  'z. B. Videos': 'e.g. Videos',
  'Aktiv': 'Active',
  'Inaktiv': 'Inactive',
  'Aktivieren': 'Enable',
  'Deaktivieren': 'Disable',
  'Entfernen': 'Remove',
  '(Chrome/Firefox) und das': '(Chrome/Firefox) and the',
  '-Format.': 'format.',
  'Erzeuge portierbare Backups. Der HTML-Export ist kompatibel mit Chrome und Firefox.': 'Create portable backups. The HTML export is compatible with Chrome and Firefox.',
  'HTML exportieren': 'Export HTML',
  'JSON exportieren': 'Export JSON',
  'ZIP exportieren': 'Export ZIP',
  'Parsing bookmarks…': 'Lesezeichen werden verarbeitet…',
  'Saving to database…': 'In Datenbank speichern…',
  'Initialdaten konnten nicht geladen werden.': 'Could not load initial data.',
  'Suche fehlgeschlagen.': 'Search failed.',
  'Sortierung konnte nicht gespeichert werden.': 'Could not save sort order.',
  'Kein Favicon gefunden.': 'No favicon found.',
  'Favicon ist bereits aktuell.': 'Favicon is already current.',
  'Favicon aktualisiert.': 'Favicon updated.',
  'Favicon konnte nicht aktualisiert werden.': 'Could not update favicon.',
  'Icon wurde manuell gesetzt.': 'Icon was set manually.',
  'Icon konnte nicht hochgeladen werden.': 'Could not upload icon.',
  'Lesezeichen erstellt.': 'Bookmark created.',
  'Lesezeichen konnte nicht erstellt werden.': 'Could not create bookmark.',
  'Lesezeichen aktualisiert.': 'Bookmark updated.',
  'Aktualisierung fehlgeschlagen.': 'Update failed.',
  'Tags entfernt.': 'Tags removed.',
  'Tags konnten nicht entfernt werden.': 'Could not remove tags.',
  'Lesezeichen verschoben.': 'Bookmarks moved.',
  'Verschieben fehlgeschlagen.': 'Move failed.',
  'Drag & Drop erfolgreich.': 'Drag and drop succeeded.',
  'Verschieben per Drag & Drop fehlgeschlagen.': 'Drag and drop move failed.',
  'Berechtigung erforderlich.': 'Permission required.',
  'Session gespeichert.': 'Session saved.',
  'Session konnte nicht gespeichert werden.': 'Could not save session.',
  'Theme gespeichert.': 'Theme saved.',
  'Theme konnte nicht gespeichert werden.': 'Could not save theme.',
  'Ansicht konnte nicht gespeichert werden.': 'Could not save view.',
  'Tags und Notizen': 'Tags and notes',
  'Unbenanntes Lesezeichen': 'Untitled bookmark',
  'Favicon wird aktualisiert…': 'Updating favicon…',
  'Favicon aktualisieren': 'Update favicon',
  'Icon wird hochgeladen…': 'Uploading icon…',
  'Icon hier ablegen': 'Drop icon here',
  'Batch-Aktionen werden auf die gesamte Auswahl angewendet.': 'Batch actions apply to the entire selection.',
  'Tags entfernen': 'Remove tags',
  'Als HTML exportieren': 'Export as HTML',
  'Als JSON exportieren': 'Export as JSON',
  'Aktuelle Tabs speichern': 'Save current tabs',
  'Import/Export findest du unter Einstellungen.': 'Find import/export in settings.',
  'In Einstellungen öffnen': 'Open in settings',
  'Import und Export in den Einstellungen öffnen': 'Open import and export in settings',
  'Aktiver Tab und Bookmark-Liste wurden aktualisiert.': 'Active tab and bookmark list updated.',
  'Aktualisieren fehlgeschlagen.': 'Refresh failed.',
  'Kommentare konnten nicht geladen werden.': 'Could not load comments.',
  'Name und Kommentar sind erforderlich.': 'Name and comment are required.',
  'Kommentar konnte nicht gespeichert werden.': 'Could not save comment.',
  'Keine Kommentare': 'No comments',
  'Keine Treffer gefunden.': 'No results found.',
  'Noch keine Bookmarks gespeichert.': 'No bookmarks saved yet.',
  'Titel wird geladen…': 'Loading title…',
  'URL wird geladen…': 'Loading URL…',
  'Speichert…': 'Saving…',
  'Bereits gespeichert': 'Already saved',
  'Bookmark speichern': 'Save bookmark',
  'Weniger': 'Less',
  'Alternativen:': 'Alternatives:',
  'Im Dashboard weiter bearbeiten': 'Continue editing in dashboard',
  'Speichern fehlgeschlagen.': 'Save failed.',
  'Sessions konnten nicht geladen werden.': 'Could not load sessions.',
  'Unerwartete Antwort beim Speichern.': 'Unexpected response while saving.',
  'Unerwartete Antwort beim Öffnen.': 'Unexpected response while opening.',
  'Unerwartete Antwort beim Löschen.': 'Unexpected response while deleting.',
  'Sichern …': 'Saving …',
  'Tabs sichern': 'Save tabs',
  'Konnte Wiedervorlagen nicht laden': 'Could not load read-later reminders',
  'Snooze konnte nicht gespeichert werden': 'Could not save snooze',
  'Später lesen Wiedervorlagen': 'Read-later reminders',
  'Aktualisiere …': 'Updating …',
  'Aktualisieren': 'Refresh',
  'Unbenannter Bookmark': 'Untitled bookmark',
  'Hoch': 'High',
  'Mittel': 'Medium',
  'Niedrig': 'Low',
  'Snooze': 'Snooze',
  '15 Min': '15 min',
  '1 Stunde': '1 hour',
  'Morgen': 'Tomorrow',
  'Keine speicherbaren Tabs im aktuellen Fenster gefunden.': 'No savable tabs found in the current window.',
  'Session konnte nicht gefunden werden.': 'Could not find session.',
  'Diese Session enthält keine gültigen Tabs.': 'This session contains no valid tabs.',
  'Bitte wähle mindestens einen Tab aus.': 'Select at least one tab.',
  'Berechtigung für Tabs wurde nicht erteilt.': 'Permission for tabs was not granted.',
  'Ungültige Nachricht.': 'Invalid message.',
  'Unbekannter Nachrichtentyp.': 'Unknown message type.',
  'Ungültiger Titel für Session.': 'Invalid session title.',
  'Ungültige Session-ID.': 'Invalid session ID.',
  'Ungültige Tab-Auswahl.': 'Invalid tab selection.',
  'Ungültiger New-Tab-Wert.': 'Invalid new-tab value.',
  'Ungültige Fenster-ID.': 'Invalid window ID.',
  'Unerwartete Antwort vom Hintergrundskript.': 'Unexpected response from the background script.',
  'Eine URL wird für das Vorbefüllen benötigt.': 'A URL is required for prefill.',
  'Bitte eine gültige URL eingeben.': 'Enter a valid URL.',
  'Unbekannter Fehler beim Session-Handling.': 'Unknown error while handling the session.',
  'Datei konnte nicht gelesen werden.': 'Could not read file.',
  'Ungültige Dateidaten.': 'Invalid file payload',
  'Side panel konnte nicht geöffnet werden.': 'Could not open side panel.',
  'Side panel konnte nicht geschlossen werden.': 'Could not close side panel.',
  'Kein URL-Kontext für Bookmark vorhanden.': 'No URL context available for bookmark.',
  'Speichern über Kontextmenü fehlgeschlagen': 'Saving through context menu failed',
  'Kontextmenü konnte nicht erstellt werden:': 'Could not create context menu:',
  'Sidepanel-Kontextmenü konnte nicht erstellt werden:': 'Could not create side-panel context menu:',
  'Ungültige Tab-URL übersprungen': 'Skipped invalid tab URL',
  'Tab konnte nicht in neuem Fenster wiederhergestellt werden.': 'Could not restore tab in new window.',
  'Tab konnte im aktuellen Fenster nicht wiederhergestellt werden.': 'Could not restore tab in current window.',
  'Sessions konnten nicht geladen werden': 'Could not load sessions',
  'Session konnte nicht gespeichert werden': 'Could not save session',
  'Session konnte nicht geöffnet werden': 'Could not open session',
  'Auswahl konnte nicht geöffnet werden': 'Could not open selection',
  'Session konnte nicht gelöscht werden': 'Could not delete session',
};

const reverseTranslations = Object.fromEntries(
  Object.entries(translations).map(([german, english]) => [english, german]),
) as Record<string, string>;

const localizedTranslations: Partial<Record<AppLocale, Record<string, string>>> = {
  es: {
    'Allgemein': 'General', 'Daten': 'Datos', 'Sprache': 'Idioma', 'Einstellungen': 'Configuración',
    'Automatisch (Browser-Sprache)': 'Automático (idioma del navegador)', 'Deutsch': 'Alemán', 'English': 'Inglés',
    'Dashboard öffnen': 'Abrir panel', 'Einstellungen öffnen': 'Abrir configuración', 'Speichern': 'Guardar',
    'Löschen': 'Eliminar', 'Öffnen': 'Abrir', 'Schließen': 'Cerrar', 'Suchen & öffnen': 'Buscar y abrir',
    'Neueste': 'Más recientes', 'Alphabetisch': 'Alfabético', 'Keine Auswahl': 'Ninguna selección',
    'Keine Einträge gefunden.': 'No se encontraron entradas.', 'Keine Tags': 'Sin etiquetas',
    'Tag hinzufügen': 'Añadir etiqueta', 'Tags hinzufügen': 'Añadir etiquetas', 'Kategorie': 'Categoría',
    'Ohne Kategorie': 'Sin categoría', 'Neues Lesezeichen': 'Nuevo marcador', 'Bookmark speichern': 'Guardar marcador',
    'Aktualisieren': 'Actualizar', 'Filter zurücksetzen': 'Restablecer filtros', 'Import': 'Importar', 'Export': 'Exportar',
    'Session geöffnet.': 'Sesión abierta.', 'Session gelöscht.': 'Sesión eliminada.',
    'Session konnte nicht geöffnet werden.': 'No se pudo abrir la sesión.', 'Session konnte nicht gelöscht werden.': 'No se pudo eliminar la sesión.',
    'Bitte eine gültige URL eingeben.': 'Introduce una URL válida.', 'Keine Tabs ausgewählt.': 'No hay pestañas seleccionadas.',
    'Could not open side panel.': 'No se pudo abrir el panel lateral.',
  },
  fr: {
    'Allgemein': 'Général', 'Daten': 'Données', 'Sprache': 'Langue', 'Einstellungen': 'Paramètres',
    'Automatisch (Browser-Sprache)': 'Automatique (langue du navigateur)', 'Deutsch': 'Allemand', 'English': 'Anglais',
    'Dashboard öffnen': 'Ouvrir le tableau de bord', 'Einstellungen öffnen': 'Ouvrir les paramètres', 'Speichern': 'Enregistrer',
    'Löschen': 'Supprimer', 'Öffnen': 'Ouvrir', 'Schließen': 'Fermer', 'Suchen & öffnen': 'Rechercher et ouvrir',
    'Neueste': 'Plus récent', 'Alphabetisch': 'Alphabétique', 'Keine Auswahl': 'Aucune sélection',
    'Keine Einträge gefunden.': 'Aucune entrée trouvée.', 'Keine Tags': 'Aucun tag',
    'Tag hinzufügen': 'Ajouter un tag', 'Tags hinzufügen': 'Ajouter des tags', 'Kategorie': 'Catégorie',
    'Ohne Kategorie': 'Sans catégorie', 'Neues Lesezeichen': 'Nouveau favori', 'Bookmark speichern': 'Enregistrer le favori',
    'Aktualisieren': 'Actualiser', 'Filter zurücksetzen': 'Réinitialiser les filtres', 'Import': 'Importer', 'Export': 'Exporter',
    'Session geöffnet.': 'Session ouverte.', 'Session gelöscht.': 'Session supprimée.',
    'Session konnte nicht geöffnet werden.': 'Impossible d’ouvrir la session.', 'Session konnte nicht gelöscht werden.': 'Impossible de supprimer la session.',
    'Bitte eine gültige URL eingeben.': 'Saisissez une URL valide.', 'Keine Tabs ausgewählt.': 'Aucun onglet sélectionné.',
    'Could not open side panel.': 'Impossible d’ouvrir le panneau latéral.',
  },
  'pt-BR': {
    'Allgemein': 'Geral', 'Daten': 'Dados', 'Sprache': 'Idioma', 'Einstellungen': 'Configurações',
    'Automatisch (Browser-Sprache)': 'Automático (idioma do navegador)', 'Deutsch': 'Alemão', 'English': 'Inglês',
    'Dashboard öffnen': 'Abrir painel', 'Einstellungen öffnen': 'Abrir configurações', 'Speichern': 'Salvar',
    'Löschen': 'Excluir', 'Öffnen': 'Abrir', 'Schließen': 'Fechar', 'Suchen & öffnen': 'Pesquisar e abrir',
    'Neueste': 'Mais recentes', 'Alphabetisch': 'Alfabético', 'Keine Auswahl': 'Nenhuma seleção',
    'Keine Einträge gefunden.': 'Nenhuma entrada encontrada.', 'Keine Tags': 'Nenhuma tag',
    'Tag hinzufügen': 'Adicionar tag', 'Tags hinzufügen': 'Adicionar tags', 'Kategorie': 'Categoria',
    'Ohne Kategorie': 'Sem categoria', 'Neues Lesezeichen': 'Novo favorito', 'Bookmark speichern': 'Salvar favorito',
    'Aktualisieren': 'Atualizar', 'Filter zurücksetzen': 'Redefinir filtros', 'Import': 'Importar', 'Export': 'Exportar',
    'Session geöffnet.': 'Sessão aberta.', 'Session gelöscht.': 'Sessão excluída.',
    'Session konnte nicht geöffnet werden.': 'Não foi possível abrir a sessão.', 'Session konnte nicht gelöscht werden.': 'Não foi possível excluir a sessão.',
    'Bitte eine gültige URL eingeben.': 'Digite uma URL válida.', 'Keine Tabs ausgewählt.': 'Nenhuma aba selecionada.',
    'Could not open side panel.': 'Não foi possível abrir o painel lateral.',
  },
  it: {
    'Allgemein': 'Generale', 'Daten': 'Dati', 'Sprache': 'Lingua', 'Einstellungen': 'Impostazioni',
    'Automatisch (Browser-Sprache)': 'Automatico (lingua del browser)', 'Deutsch': 'Tedesco', 'English': 'Inglese',
    'Dashboard öffnen': 'Apri dashboard', 'Einstellungen öffnen': 'Apri impostazioni', 'Speichern': 'Salva',
    'Löschen': 'Elimina', 'Öffnen': 'Apri', 'Schließen': 'Chiudi', 'Suchen & öffnen': 'Cerca e apri',
    'Neueste': 'Più recenti', 'Alphabetisch': 'Alfabetico', 'Keine Auswahl': 'Nessuna selezione',
    'Keine Einträge gefunden.': 'Nessuna voce trovata.', 'Keine Tags': 'Nessun tag',
    'Tag hinzufügen': 'Aggiungi tag', 'Tags hinzufügen': 'Aggiungi tag', 'Kategorie': 'Categoria',
    'Ohne Kategorie': 'Senza categoria', 'Neues Lesezeichen': 'Nuovo segnalibro', 'Bookmark speichern': 'Salva segnalibro',
    'Aktualisieren': 'Aggiorna', 'Filter zurücksetzen': 'Reimposta filtri', 'Import': 'Importa', 'Export': 'Esporta',
    'Session geöffnet.': 'Sessione aperta.', 'Session gelöscht.': 'Sessione eliminata.',
    'Session konnte nicht geöffnet werden.': 'Impossibile aprire la sessione.', 'Session konnte nicht gelöscht werden.': 'Impossibile eliminare la sessione.',
    'Bitte eine gültige URL eingeben.': 'Inserisci un URL valido.', 'Keine Tabs ausgewählt.': 'Nessuna scheda selezionata.',
    'Could not open side panel.': 'Impossibile aprire il pannello laterale.',
  },
  ru: {
    'Allgemein': 'Общие', 'Daten': 'Данные', 'Sprache': 'Язык', 'Einstellungen': 'Настройки',
    'Automatisch (Browser-Sprache)': 'Автоматически (язык браузера)', 'Deutsch': 'Немецкий', 'English': 'Английский',
    'Dashboard öffnen': 'Открыть панель', 'Einstellungen öffnen': 'Открыть настройки', 'Speichern': 'Сохранить',
    'Löschen': 'Удалить', 'Öffnen': 'Открыть', 'Schließen': 'Закрыть', 'Suchen & öffnen': 'Найти и открыть',
    'Neueste': 'Новые', 'Alphabetisch': 'По алфавиту', 'Keine Auswahl': 'Ничего не выбрано',
    'Keine Einträge gefunden.': 'Записи не найдены.', 'Keine Tags': 'Нет тегов',
    'Tag hinzufügen': 'Добавить тег', 'Tags hinzufügen': 'Добавить теги', 'Kategorie': 'Категория',
    'Ohne Kategorie': 'Без категории', 'Neues Lesezeichen': 'Новая закладка', 'Bookmark speichern': 'Сохранить закладку',
    'Aktualisieren': 'Обновить', 'Filter zurücksetzen': 'Сбросить фильтры', 'Import': 'Импорт', 'Export': 'Экспорт',
    'Session geöffnet.': 'Сессия открыта.', 'Session gelöscht.': 'Сессия удалена.',
    'Session konnte nicht geöffnet werden.': 'Не удалось открыть сессию.', 'Session konnte nicht gelöscht werden.': 'Не удалось удалить сессию.',
    'Bitte eine gültige URL eingeben.': 'Введите действительный URL.', 'Keine Tabs ausgewählt.': 'Вкладки не выбраны.',
    'Could not open side panel.': 'Не удалось открыть боковую панель.',
  },
  ja: {
    'Allgemein': '一般', 'Daten': 'データ', 'Sprache': '言語', 'Einstellungen': '設定',
    'Automatisch (Browser-Sprache)': '自動（ブラウザーの言語）', 'Deutsch': 'ドイツ語', 'English': '英語',
    'Dashboard öffnen': 'ダッシュボードを開く', 'Einstellungen öffnen': '設定を開く', 'Speichern': '保存',
    'Löschen': '削除', 'Öffnen': '開く', 'Schließen': '閉じる', 'Suchen & öffnen': '検索して開く',
    'Neueste': '新しい順', 'Alphabetisch': 'アルファベット順', 'Keine Auswahl': '選択なし',
    'Keine Einträge gefunden.': '項目が見つかりません。', 'Keine Tags': 'タグなし',
    'Tag hinzufügen': 'タグを追加', 'Tags hinzufügen': 'タグを追加', 'Kategorie': 'カテゴリ',
    'Ohne Kategorie': 'カテゴリなし', 'Neues Lesezeichen': '新しいブックマーク', 'Bookmark speichern': 'ブックマークを保存',
    'Aktualisieren': '更新', 'Filter zurücksetzen': 'フィルターをリセット', 'Import': 'インポート', 'Export': 'エクスポート',
    'Session geöffnet.': 'セッションを開きました。', 'Session gelöscht.': 'セッションを削除しました。',
    'Session konnte nicht geöffnet werden.': 'セッションを開けませんでした。', 'Session konnte nicht gelöscht werden.': 'セッションを削除できませんでした。',
    'Bitte eine gültige URL eingeben.': '有効なURLを入力してください。', 'Keine Tabs ausgewählt.': 'タブが選択されていません。',
    'Could not open side panel.': 'サイドパネルを開けませんでした。',
  },
};

const dynamicTranslations = (value: string): string | undefined => {
  const patterns: Array<[RegExp, (...parts: string[]) => string]> = [
    [/^Tag (.+) entfernen$/, (tag) => `Remove tag ${tag}`],
    [/^(\d+) Ergebnis$/, (count) => `${count} result`],
    [/^(\d+) Ergebnisse$/, (count) => `${count} results`],
    [/^(\d+) ausgewählt$/, (count) => `${count} selected`],
    [/^(\d+) weitere Tags$/, (count) => `${count} more tags`],
    [/^Zuletzt aktualisiert (.+)$/, (date) => `Last updated ${date}`],
    [/^Kommentare zu (.+)$/, (title) => `Comments on ${title}`],
    [/^Ordner einklappen: (.+)$/, (title) => `Collapse folder: ${title}`],
    [/^Ordner ausklappen: (.+)$/, (title) => `Expand folder: ${title}`],
    [/^(.+) ausgeschlossen$/, (tag) => `${tag} excluded`],
    [/^(.+) eingeschlossen$/, (tag) => `${tag} included`],
    [/^(.+) filtern$/, (tag) => `Filter ${tag}`],
    [/^(.+) filtern \(negativ\)$/, (tag) => `Filter ${tag} (exclude)`],
    [/^(.+) filtern \(positiv\)$/, (tag) => `Filter ${tag} (include)`],
    [/^(.+) filtern \(inaktiv\)$/, (tag) => `Filter ${tag} (inactive)`],
    [/^(\d+) Bookmarks$/, (count) => `${count} bookmarks`],
    [/^Öffnen: (.+)$/, (title) => `Open: ${title}`],
    [/^(\d+) Lesezeichen ausgewählt$/, (count) => `${count} bookmarks selected`],
    [/^Sollen (\d+) Lesezeichen gelöscht werden\?$/, (count) => `Delete ${count} bookmarks?`],
    [/^Session "(.+)" löschen\?$/, (title) => `Delete session "${title}"?`],
    [/^Ansicht auf (Liste|Kacheln) gestellt\.$/, (view) => `View set to ${view === 'Liste' ? 'list' : 'tiles'}.`],
    [/^Host entspricht: (.+)$/, (host) => `Host matches: ${host}`],
    [/^URL enthält: (.+)$/, (value) => `URL contains: ${value}`],
    [/^MIME-Typ: (.+)$/, (value) => `MIME type: ${value}`],
    [/^Tags hinzufügen: (.+)$/, (tags) => `Add tags: ${tags}`],
    [/^Kategorie setzen: (.+)$/, (category) => `Set category: ${category}`],
    [/^(\d+) Tabs geöffnet\.$/, (count) => `Opened ${count} tabs.`],
    [/^Session mit (\d+) Tabs gespeichert\.$/, (count) => `Session with ${count} tabs saved.`],
    [/^(\d+) \/ (\d+) ausgewählt$/, (selected, total) => `${selected} / ${total} selected`],
    [/^(\d+) Tabs$/, (count) => `${count} tabs`],
    [/^(\d+) Kommentar$/, (count) => `${count} comment`],
    [/^(\d+) Kommentare$/, (count) => `${count} comments`],
    [/^Fenster vom (.+)$/, (date) => `Window from ${date}`],
  ];

  for (const [pattern, format] of patterns) {
    const match = value.match(pattern);
    if (match) return format(...match.slice(1));
  }
  return undefined;
};

const reverseDynamicTranslations = (value: string): string | undefined => {
  const patterns: Array<[RegExp, (...parts: string[]) => string]> = [
    [/^Remove tag (.+)$/, (tag) => `Tag ${tag} entfernen`],
    [/^(\d+) result$/, (count) => `${count} Ergebnis`],
    [/^(\d+) results$/, (count) => `${count} Ergebnisse`],
    [/^(\d+) selected$/, (count) => `${count} ausgewählt`],
    [/^(\d+) more tags$/, (count) => `${count} weitere Tags`],
    [/^Last updated (.+)$/, (date) => `Zuletzt aktualisiert ${date}`],
    [/^Comments on (.+)$/, (title) => `Kommentare zu ${title}`],
    [/^Collapse folder: (.+)$/, (title) => `Ordner einklappen: ${title}`],
    [/^Expand folder: (.+)$/, (title) => `Ordner ausklappen: ${title}`],
    [/^(.+) excluded$/, (tag) => `${tag} ausgeschlossen`],
    [/^(.+) included$/, (tag) => `${tag} eingeschlossen`],
    [/^Filter (.+) \(exclude\)$/, (tag) => `${tag} filtern (negativ)`],
    [/^Filter (.+) \(include\)$/, (tag) => `${tag} filtern (positiv)`],
    [/^Filter (.+) \(inactive\)$/, (tag) => `${tag} filtern (inaktiv)`],
    [/^Filter (.+)$/, (tag) => `${tag} filtern`],
    [/^(\d+) bookmarks$/, (count) => `${count} Bookmarks`],
    [/^Open: (.+)$/, (title) => `Öffnen: ${title}`],
    [/^(\d+) bookmarks selected$/, (count) => `${count} Lesezeichen ausgewählt`],
    [/^Delete (\d+) bookmarks\?$/, (count) => `Sollen ${count} Lesezeichen gelöscht werden?`],
    [/^Delete session "(.+)"\?$/, (title) => `Session "${title}" löschen?`],
    [/^View set to (list|tiles)\.$/, (view) => `Ansicht auf ${view === 'list' ? 'Liste' : 'Kacheln'} gestellt.`],
    [/^Host matches: (.+)$/, (host) => `Host entspricht: ${host}`],
    [/^URL contains: (.+)$/, (value) => `URL enthält: ${value}`],
    [/^MIME type: (.+)$/, (value) => `MIME-Typ: ${value}`],
    [/^Add tags: (.+)$/, (tags) => `Tags hinzufügen: ${tags}`],
    [/^Set category: (.+)$/, (category) => `Kategorie setzen: ${category}`],
    [/^Opened (\d+) tabs\.$/, (count) => `${count} Tabs geöffnet.`],
    [/^Session with (\d+) tabs saved\.$/, (count) => `Session mit ${count} Tabs gespeichert.`],
    [/^(\d+) \/ (\d+) selected$/, (selected, total) => `${selected} / ${total} ausgewählt`],
    [/^(\d+) tabs$/, (count) => `${count} Tabs`],
    [/^(\d+) comment$/, (count) => `${count} Kommentar`],
    [/^(\d+) comments$/, (count) => `${count} Kommentare`],
    [/^Window from (.+)$/, (date) => `Fenster vom ${date}`],
  ];

  for (const [pattern, format] of patterns) {
    const match = value.match(pattern);
    if (match) return format(...match.slice(1));
  }
  return undefined;
};

const localizedDynamicTranslations: Partial<Record<AppLocale, (value: string) => string | undefined>> = {
  es: (value) => {
    const tabs = value.match(/^(\d+) Tabs geöffnet\.$/);
    if (tabs) return `Se abrieron ${tabs[1]} pestañas.`;
    const results = value.match(/^(\d+) Ergebnisse$/);
    if (results) return `${results[1]} resultados`;
    const selected = value.match(/^(\d+) ausgewählt$/);
    if (selected) return `${selected[1]} seleccionados`;
    return undefined;
  },
  fr: (value) => {
    const tabs = value.match(/^(\d+) Tabs geöffnet\.$/);
    if (tabs) return `${tabs[1]} onglets ouverts.`;
    const results = value.match(/^(\d+) Ergebnisse$/);
    if (results) return `${results[1]} résultats`;
    const selected = value.match(/^(\d+) ausgewählt$/);
    if (selected) return `${tabs?.[1] ?? selected[1]} sélectionnés`;
    return undefined;
  },
  'pt-BR': (value) => {
    const tabs = value.match(/^(\d+) Tabs geöffnet\.$/);
    if (tabs) return `${tabs[1]} abas abertas.`;
    const results = value.match(/^(\d+) Ergebnisse$/);
    if (results) return `${results[1]} resultados`;
    const selected = value.match(/^(\d+) ausgewählt$/);
    if (selected) return `${selected[1]} selecionados`;
    return undefined;
  },
  it: (value) => {
    const tabs = value.match(/^(\d+) Tabs geöffnet\.$/);
    if (tabs) return `${tabs[1]} schede aperte.`;
    const results = value.match(/^(\d+) Ergebnisse$/);
    if (results) return `${results[1]} risultati`;
    const selected = value.match(/^(\d+) ausgewählt$/);
    if (selected) return `${selected[1]} selezionati`;
    return undefined;
  },
  ru: (value) => {
    const tabs = value.match(/^(\d+) Tabs geöffnet\.$/);
    if (tabs) return `Открыто вкладок: ${tabs[1]}.`;
    const results = value.match(/^(\d+) Ergebnisse$/);
    if (results) return `${results[1]} результата`;
    const selected = value.match(/^(\d+) ausgewählt$/);
    if (selected) return `Выбрано: ${selected[1]}`;
    return undefined;
  },
  ja: (value) => {
    const tabs = value.match(/^(\d+) Tabs geöffnet\.$/);
    if (tabs) return `${tabs[1]}個のタブを開きました。`;
    const results = value.match(/^(\d+) Ergebnisse$/);
    if (results) return `${results[1]}件の結果`;
    const selected = value.match(/^(\d+) ausgewählt$/);
    if (selected) return `${selected[1]}件選択中`;
    return undefined;
  },
};

export const resolveLocale = (preference: LanguagePreference | undefined, browserLanguage?: string): AppLocale => {
  if (preference && preference !== 'auto') return preference;
  const language = browserLanguage?.toLowerCase() ?? '';
  if (language.startsWith('de')) return 'de';
  if (language.startsWith('es')) return 'es';
  if (language.startsWith('fr')) return 'fr';
  if (language.startsWith('pt')) return 'pt-BR';
  if (language.startsWith('it')) return 'it';
  if (language.startsWith('ru')) return 'ru';
  if (language.startsWith('ja')) return 'ja';
  return 'en';
};

export const getBrowserLanguage = (): string => {
  try {
    return chrome.i18n?.getUILanguage?.() ?? navigator.language;
  } catch {
    return navigator.language;
  }
};

export const getUserLocale = async (): Promise<AppLocale> => {
  const settings = await getUserSettings();
  return resolveLocale(settings.language, getBrowserLanguage());
};

export const translateText = (value: string, locale: AppLocale): string => {
  const leadingWhitespace = value.match(/^\s*/)?.[0] ?? '';
  const trailingWhitespace = value.match(/\s*$/)?.[0] ?? '';
  const normalized = value.trim().replace(/\s+/g, ' ');
  const translated = locale === 'de'
    ? reverseTranslations[normalized] ?? reverseDynamicTranslations(normalized)
    : localizedTranslations[locale]?.[normalized]
      ?? localizedDynamicTranslations[locale]?.(normalized)
      ?? translations[normalized]
      ?? dynamicTranslations(normalized);
  return translated ? `${leadingWhitespace}${translated}${trailingWhitespace}` : value;
};

const localizeElement = (element: Element, locale: AppLocale): void => {
  for (const attribute of ['aria-label', 'title', 'placeholder']) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const translated = translateText(value, locale);
    if (translated !== value) element.setAttribute(attribute, translated);
  }
};

const localizeNode = (node: Node, locale: AppLocale): void => {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.textContent ?? '';
    const translated = translateText(value, locale);
    if (translated !== value) node.textContent = translated;
    return;
  }
  if (node.nodeType === Node.ELEMENT_NODE) localizeElement(node as Element, locale);
};

const localizeDocument = (locale: AppLocale): (() => void) => {
  document.documentElement.lang = locale;
  const root = document.body;
  if (!root) return () => undefined;

  root.querySelectorAll('*').forEach((element) => localizeElement(element, locale));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) localizeNode(node, locale);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData' || record.type === 'attributes') localizeNode(record.target, locale);
      record.addedNodes.forEach((node) => {
        localizeNode(node, locale);
        if (node.nodeType === Node.ELEMENT_NODE) {
          (node as Element).querySelectorAll('*').forEach((element) => localizeElement(element, locale));
        }
      });
    }
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['aria-label', 'title', 'placeholder'],
    characterData: true,
    childList: true,
    subtree: true,
  });
  return () => observer.disconnect();
};

export const I18nProvider: FunctionalComponent<{ children: ComponentChildren }> = ({ children }) => {
  const [languagePreference, setLanguagePreferenceState] = useState<LanguagePreference>('auto');
  const locale = resolveLocale(languagePreference, getBrowserLanguage());

  useEffect(() => {
    let cancelled = false;
    void getUserSettings().then((settings) => {
      if (!cancelled) setLanguagePreferenceState(settings.language);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => localizeDocument(locale), [locale]);

  const setLanguagePreference = useCallback(async (preference: LanguagePreference) => {
    setLanguagePreferenceState(preference);
    await saveUserSettings({ language: preference });
    void sendBackgroundMessage({ type: 'settings.refreshContextMenu' }).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ locale, languagePreference, setLanguagePreference }),
    [locale, languagePreference, setLanguagePreference],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextValue => {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
};
