const chromeGlobal = typeof globalThis !== 'undefined' && 'chrome' in globalThis
  ? (globalThis as typeof globalThis & { chrome: unknown }).chrome
  : undefined;

const browserGlobal = typeof globalThis !== 'undefined' && 'browser' in globalThis
  ? (globalThis as typeof globalThis & { browser: unknown }).browser
  : undefined;

export const IS_CHROME = Boolean(chromeGlobal && !(browserGlobal && (browserGlobal as Record<string, unknown>).__isFirefox));
export const IS_FIREFOX = Boolean(browserGlobal);

export const runtimeEnvironment = IS_FIREFOX ? 'firefox' : 'chrome';
