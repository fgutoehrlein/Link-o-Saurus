import { describe, expect, it } from 'vitest';

import { resolveLocale, translateText } from './index';

describe('i18n', () => {
  it('uses the manual language choice before the browser language', () => {
    expect(resolveLocale('en', 'de-DE')).toBe('en');
    expect(resolveLocale('de', 'en-US')).toBe('de');
  });

  it('uses German only for a German browser UI in automatic mode', () => {
    expect(resolveLocale('auto', 'de-DE')).toBe('de');
    expect(resolveLocale('auto', 'en-GB')).toBe('en');
    expect(resolveLocale('auto', 'fr-FR')).toBe('en');
    expect(resolveLocale(undefined, undefined)).toBe('en');
  });

  it('translates fixed and interpolated UI labels', () => {
    expect(translateText('Dashboard öffnen', 'en')).toBe('Open dashboard');
    expect(translateText('Synchronisation & Regeln', 'en')).toBe('Synchronization & rules');
    expect(translateText('Datensouveränität', 'en')).toBe('Data ownership');
    expect(translateText('Tag Projekt entfernen', 'en')).toBe('Remove tag Projekt');
    expect(translateText('33 Ergebnisse', 'en')).toBe('33 results');
    expect(translateText('Kacheln', 'en')).toBe('Tiles');
    expect(translateText('Details', 'de')).toBe('Details');
    expect(translateText('Favicon aktualisieren', 'en')).toBe('Update favicon');
    expect(translateText('Öffnen', 'en')).toBe('Open');
    expect(translateText('3 Tabs geöffnet.', 'en')).toBe('Opened 3 tabs.');
    expect(translateText('2 / 5 ausgewählt', 'en')).toBe('2 / 5 selected');
    expect(translateText('Host entspricht: example.com', 'en')).toBe('Host matches: example.com');
    expect(translateText('Sollen 2 Lesezeichen gelöscht werden?', 'en')).toBe('Delete 2 bookmarks?');
    expect(translateText('Opened 3 tabs.', 'de')).toBe('3 Tabs geöffnet.');
    expect(translateText('z. B. Videos', 'en')).toBe('e.g. Videos');
    expect(translateText('Invalid file payload', 'de')).toBe('Ungültige Dateidaten.');
  });
});
