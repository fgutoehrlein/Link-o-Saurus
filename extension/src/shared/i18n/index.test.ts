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
    expect(translateText('Tag Projekt entfernen', 'en')).toBe('Remove tag Projekt');
    expect(translateText('33 Ergebnisse', 'en')).toBe('33 results');
    expect(translateText('Kacheln', 'en')).toBe('Tiles');
    expect(translateText('Details', 'de')).toBe('Details');
  });
});
