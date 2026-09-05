import { describe, expect, it } from 'vitest';

import { resolveLocale, translateText } from './index';

describe('i18n', () => {
  it('uses the manual language choice before the browser language', () => {
    expect(resolveLocale('en', 'de-DE')).toBe('en');
    expect(resolveLocale('de', 'en-US')).toBe('de');
  });

  it('detects supported browser languages and falls back to English', () => {
    expect(resolveLocale('auto', 'de-DE')).toBe('de');
    expect(resolveLocale('auto', 'en-GB')).toBe('en');
    expect(resolveLocale('auto', 'es-ES')).toBe('es');
    expect(resolveLocale('auto', 'fr-FR')).toBe('fr');
    expect(resolveLocale('auto', 'pt-PT')).toBe('pt-BR');
    expect(resolveLocale('auto', 'it-IT')).toBe('it');
    expect(resolveLocale('auto', 'ru-RU')).toBe('ru');
    expect(resolveLocale('auto', 'ja-JP')).toBe('ja');
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
    expect(translateText('Verschieben', 'en')).toBe('Move');
    expect(translateText('Side panel konnte nicht geöffnet werden.', 'en')).toBe(
      'Could not open side panel.',
    );
    expect(translateText('Could not open side panel.', 'de')).toBe(
      'Side panel konnte nicht geöffnet werden.',
    );
    expect(translateText('Öffnen', 'en')).toBe('Open');
    expect(translateText('3 Tabs geöffnet.', 'en')).toBe('Opened 3 tabs.');
    expect(translateText('2 / 5 ausgewählt', 'en')).toBe('2 / 5 selected');
    expect(translateText('Host entspricht: example.com', 'en')).toBe('Host matches: example.com');
    expect(translateText('Sollen 2 Lesezeichen gelöscht werden?', 'en')).toBe('Delete 2 bookmarks?');
    expect(translateText('Opened 3 tabs.', 'de')).toBe('3 Tabs geöffnet.');
    expect(translateText('z. B. Videos', 'en')).toBe('e.g. Videos');
    expect(translateText('Invalid file payload', 'de')).toBe('Ungültige Dateidaten.');
    expect(translateText('Dashboard öffnen', 'es')).toBe('Abrir panel');
    expect(translateText('Einstellungen öffnen', 'fr')).toBe('Ouvrir les paramètres');
    expect(translateText('Speichern', 'pt-BR')).toBe('Salvar');
    expect(translateText('Löschen', 'it')).toBe('Elimina');
    expect(translateText('Öffnen', 'ru')).toBe('Открыть');
    expect(translateText('Einstellungen', 'ja')).toBe('設定');
    expect(translateText('3 Tabs geöffnet.', 'es')).toBe('Se abrieron 3 pestañas.');
  });
});
