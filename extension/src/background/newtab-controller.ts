import { getUserSettings, saveUserSettings } from '../shared/db';
import { initializeBookmarkSync } from '../shared/bookmark-sync';

const EXTENSION_NEW_TAB_URL = chrome.runtime.getURL('dashboard.html');
const CHROME_DEFAULT_NEW_TAB_URLS = new Set([
  'chrome://newtab/',
  'chrome-search://local-ntp/local-ntp.html',
]);
const FIREFOX_DEFAULT_NEW_TAB_URLS = new Set(['about:newtab', 'about:home']);

let newTabOverrideActive = false;
let newTabListenerRegistered = false;

const isSystemNewTabUrl = (url: string | undefined): boolean => {
  if (!url) {
    return false;
  }
  if (url.startsWith('about:')) {
    return FIREFOX_DEFAULT_NEW_TAB_URLS.has(url);
  }
  return CHROME_DEFAULT_NEW_TAB_URLS.has(url);
};

const handleTabCreatedForOverride = (tab: chrome.tabs.Tab): void => {
  if (!newTabOverrideActive || !tab.id) {
    return;
  }
  const candidateUrl = tab.pendingUrl ?? tab.url;
  if (!isSystemNewTabUrl(candidateUrl)) {
    return;
  }

  void chrome.tabs
    .update(tab.id, { url: EXTENSION_NEW_TAB_URL })
    .catch((error) => console.warn('[Link-o-Saurus] Failed to override new tab', error));
};

const registerNewTabOverride = (): void => {
  if (newTabListenerRegistered) {
    return;
  }
  chrome.tabs.onCreated.addListener(handleTabCreatedForOverride);
  newTabListenerRegistered = true;
};

const unregisterNewTabOverride = (): void => {
  if (!newTabListenerRegistered) {
    return;
  }
  chrome.tabs.onCreated.removeListener(handleTabCreatedForOverride);
  newTabListenerRegistered = false;
};

export const applyNewTabOverride = async (enabled: boolean): Promise<boolean> => {
  if (!enabled) {
    newTabOverrideActive = false;
    unregisterNewTabOverride();
    return false;
  }

  const hasPermission = await chrome.permissions.contains({ permissions: ['tabs'] });
  if (!hasPermission) {
    newTabOverrideActive = false;
    unregisterNewTabOverride();
    return false;
  }

  registerNewTabOverride();
  newTabOverrideActive = true;
  return true;
};

export const initializeNewTabController = async (): Promise<void> => {
  try {
    const settings = await getUserSettings();
    const applied = await applyNewTabOverride(settings.newTabEnabled);
    if (settings.newTabEnabled && !applied) {
      await saveUserSettings({ newTabEnabled: false });
    }
    if (settings.bookmarkSync?.enableBidirectional) {
      try {
        await initializeBookmarkSync(settings.bookmarkSync);
      } catch (syncError) {
        console.error('[Link-o-Saurus] Failed to initialize bookmark sync', syncError);
      }
    }
  } catch (error) {
    console.error('[Link-o-Saurus] Failed to initialize background features', error);
  }
};
