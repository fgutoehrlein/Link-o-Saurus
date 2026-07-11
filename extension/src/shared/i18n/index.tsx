import type { ComponentChildren, FunctionalComponent } from 'preact';
import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useState } from 'preact/hooks';

import { getUserSettings, saveUserSettings } from '../db';
import { sendBackgroundMessage } from '../messaging';
import type { LanguagePreference } from '../types';

export type AppLocale = 'de' | 'en';

type I18nContextValue = {
  locale: AppLocale;
  languagePreference: LanguagePreference;
  setLanguagePreference: (preference: LanguagePreference) => Promise<void>;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

const translations: Record<string, string> = {
  'Link-O-Saurus Datenportabilität': 'Link-O-Saurus data portability',
  'Importiere oder exportiere deine Bookmarks ohne die UI zu blockieren.': 'Import or export your bookmarks without blocking the UI.',
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
};

const reverseTranslations = Object.fromEntries(
  Object.entries(translations).map(([german, english]) => [english, german]),
) as Record<string, string>;

const dynamicTranslations = (value: string): string | undefined => {
  const patterns: Array<[RegExp, (...parts: string[]) => string]> = [
    [/^Tag (.+) entfernen$/, (tag) => `Remove tag ${tag}`],
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
  ];

  for (const [pattern, format] of patterns) {
    const match = value.match(pattern);
    if (match) return format(...match.slice(1));
  }
  return undefined;
};

export const resolveLocale = (preference: LanguagePreference | undefined, browserLanguage?: string): AppLocale => {
  if (preference === 'de' || preference === 'en') return preference;
  return browserLanguage?.toLowerCase().startsWith('de') ? 'de' : 'en';
};

export const getBrowserLanguage = (): string => {
  try {
    return chrome.i18n?.getUILanguage?.() ?? navigator.language;
  } catch {
    return navigator.language;
  }
};

export const translateText = (value: string, locale: AppLocale): string => {
  const leadingWhitespace = value.match(/^\s*/)?.[0] ?? '';
  const trailingWhitespace = value.match(/\s*$/)?.[0] ?? '';
  const normalized = value.trim().replace(/\s+/g, ' ');
  const translated = locale === 'de'
    ? reverseTranslations[normalized] ?? reverseDynamicTranslations(normalized)
    : translations[normalized] ?? dynamicTranslations(normalized);
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
