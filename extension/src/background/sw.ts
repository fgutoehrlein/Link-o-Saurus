import {
  createBookmark,
  createSession,
  deleteSession,
  getSession,
  getUserSettings,
  listCategories,
  listDueReadLater,
  saveUserSettings,
} from '../shared/db';
import { initializeBookmarkSync } from '../shared/bookmark-sync';
import type { CreateSessionInput } from '../shared/db';
import type { BackgroundRequest, BackgroundResponse } from '../shared/messaging';
import { validateBackgroundRequest } from '../shared/messaging';
import type { SessionPack } from '../shared/types';
import { presentLinkOSaurusQuickDialog, showLinkOSaurusToast } from './injected/quick-save-dialog';

const CONTEXT_MENU_ID = 'link-o-saurus-context-save';
const CONTEXT_MENU_OPEN_SIDE_PANEL_ID = 'link-o-saurus-context-open-side-panel';
const EXTENSION_NEW_TAB_URL = chrome.runtime.getURL('dashboard.html');
const CHROME_DEFAULT_NEW_TAB_URLS = new Set([
  'chrome://newtab/',
  'chrome-search://local-ntp/local-ntp.html',
]);
const FIREFOX_DEFAULT_NEW_TAB_URLS = new Set(['about:newtab', 'about:home']);

let newTabOverrideActive = false;
let newTabListenerRegistered = false;

type QuickSaveTabMetadata = {
  readonly title?: string;
  readonly url?: string;
  readonly favIconUrl?: string;
};

const QUICK_SAVE_TAB_CACHE_TTL_MS = 60_000;

let lastQuickSaveTab:
  | {
      readonly capturedAt: number;
      readonly tab: QuickSaveTabMetadata;
    }
  | undefined;

console.log('[Link-o-Saurus] background service worker initialized');

const READ_LATER_ALARM_NAME = 'link-o-saurus:read-later-refresh';
const READ_LATER_REFRESH_INTERVAL_MINUTES = 1;
const READ_LATER_BADGE_COLOR = '#DC2626';

const formatBadgeCount = (count: number): string => {
  if (count <= 0) {
    return '';
  }
  if (count > 99) {
    return '99+';
  }
  return `${count}`;
};

const updateReadLaterBadge = async (): Promise<number> => {
  if (!chrome.action?.setBadgeText) {
    return 0;
  }

  try {
    const dueEntries = await listDueReadLater();
    const count = dueEntries.length;
    const text = formatBadgeCount(count);
    await chrome.action.setBadgeBackgroundColor({ color: READ_LATER_BADGE_COLOR });
    await chrome.action.setBadgeText({ text });
    return count;
  } catch (error) {
    console.error('[Link-o-Saurus] Failed to update read later badge', error);
    try {
      await chrome.action.setBadgeText({ text: '' });
    } catch (innerError) {
      console.warn('[Link-o-Saurus] Unable to reset badge text', innerError);
    }
    return 0;
  }
};

const ensureReadLaterAlarm = async (): Promise<void> => {
  try {
    const existing = await chrome.alarms.get(READ_LATER_ALARM_NAME);
    if (existing) {
      return;
    }
    await chrome.alarms.create(READ_LATER_ALARM_NAME, {
      delayInMinutes: 0.1,
      periodInMinutes: READ_LATER_REFRESH_INTERVAL_MINUTES,
    });
  } catch (error) {
    console.error('[Link-o-Saurus] Failed to register read later alarm', error);
  }
};

const isSystemNewTabUrl = (url: string | undefined): boolean => {
  if (!url) {
    return false;
  }
  if (url.startsWith('about:')) {
    return FIREFOX_DEFAULT_NEW_TAB_URLS.has(url);
  }
  return CHROME_DEFAULT_NEW_TAB_URLS.has(url);
};

const toQuickSaveTabMetadata = (tab: chrome.tabs.Tab | undefined): QuickSaveTabMetadata | undefined => {
  const url = (tab?.url ?? tab?.pendingUrl ?? '').trim();
  const title = tab?.title?.trim() ?? '';
  const favIconUrl = tab?.favIconUrl?.trim() ?? '';

  if (!url && !title) {
    return undefined;
  }

  return {
    ...(title ? { title } : {}),
    ...(url ? { url } : {}),
    ...(favIconUrl ? { favIconUrl } : {}),
  };
};

const rememberQuickSaveTab = (tab: chrome.tabs.Tab | undefined): QuickSaveTabMetadata | undefined => {
  const metadata = toQuickSaveTabMetadata(tab);
  if (!metadata) {
    return undefined;
  }

  lastQuickSaveTab = {
    capturedAt: Date.now(),
    tab: metadata,
  };
  return metadata;
};

const getCachedQuickSaveTab = (): QuickSaveTabMetadata | undefined => {
  if (!lastQuickSaveTab) {
    return undefined;
  }
  if (Date.now() - lastQuickSaveTab.capturedAt > QUICK_SAVE_TAB_CACHE_TTL_MS) {
    lastQuickSaveTab = undefined;
    return undefined;
  }
  return lastQuickSaveTab.tab;
};

const queryTabsForQuickSave = async (queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> => {
  if (!chrome.tabs?.query) {
    return [];
  }
  try {
    return await chrome.tabs.query(queryInfo);
  } catch {
    return [];
  }
};

const resolveQuickSaveTab = async (): Promise<QuickSaveTabMetadata | undefined> => {
  const cached = getCachedQuickSaveTab();
  if (cached) {
    return cached;
  }

  const [currentWindowTab] = await queryTabsForQuickSave({ active: true, currentWindow: true });
  const currentWindowMetadata = rememberQuickSaveTab(currentWindowTab);
  if (currentWindowMetadata?.url || currentWindowMetadata?.title) {
    return currentWindowMetadata;
  }

  const [lastFocusedWindowTab] = await queryTabsForQuickSave({ active: true, lastFocusedWindow: true });
  return rememberQuickSaveTab(lastFocusedWindowTab);
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

const applyNewTabOverride = async (enabled: boolean): Promise<boolean> => {
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

const setSidePanelActionBehavior = async (): Promise<void> => {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return;
  }
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch (error) {
    console.warn('[Link-o-Saurus] Side panel behavior could not be applied.', error);
  }
};

const openSidePanelForWindow = async (windowId?: number): Promise<boolean> => {
  const sidePanelApi = chrome.sidePanel as typeof chrome.sidePanel & {
    open?: (options: { windowId: number }) => Promise<void>;
  };

  if (!sidePanelApi?.open) {
    return false;
  }

  const resolvedWindowId =
    typeof windowId === 'number'
      ? windowId
      : (
          await chrome.windows.getLastFocused({
            populate: false,
            windowTypes: ['normal'],
          })
        ).id;

  if (typeof resolvedWindowId !== 'number') {
    return false;
  }

  await sidePanelApi.open({ windowId: resolvedWindowId });
  return true;
};

void (async () => {
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
})();

const registerContextMenu = (): void => {
  chrome.contextMenus.create(
    {
      id: CONTEXT_MENU_ID,
      title: 'Zu Link-o-Saurus speichern',
      contexts: ['page', 'selection', 'frame'],
    },
    () => {
      const lastError = chrome.runtime.lastError;
      if (lastError && !lastError.message?.includes('duplicate id')) {
        console.error('[Link-o-Saurus] Kontextmenü konnte nicht erstellt werden:', lastError);
      }
    },
  );
  chrome.contextMenus.create(
    {
      id: CONTEXT_MENU_OPEN_SIDE_PANEL_ID,
      title: 'Link-o-Saurus Seitenleiste öffnen',
      contexts: ['action'],
    },
    () => {
      const lastError = chrome.runtime.lastError;
      if (lastError && !lastError.message?.includes('duplicate id')) {
        console.error('[Link-o-Saurus] Sidepanel-Kontextmenü konnte nicht erstellt werden:', lastError);
      }
    },
  );
};

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenu();
  void setSidePanelActionBehavior();
  void ensureReadLaterAlarm();
  void updateReadLaterBadge();
  console.log('[Link-o-Saurus] extension installed');
});

chrome.runtime.onStartup?.addListener(() => {
  registerContextMenu();
  void setSidePanelActionBehavior();
  void ensureReadLaterAlarm();
  void updateReadLaterBadge();
});

// Ensure the context menu exists when the service worker starts lazily.
registerContextMenu();
void setSidePanelActionBehavior();
void ensureReadLaterAlarm();
void updateReadLaterBadge();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === READ_LATER_ALARM_NAME) {
    void updateReadLaterBadge();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_OPEN_SIDE_PANEL_ID) {
    rememberQuickSaveTab(tab);
    try {
      await openSidePanelForWindow(tab?.windowId);
    } catch (error) {
      console.error('[Link-o-Saurus] Side panel konnte nicht geöffnet werden.', error);
    }
    return;
  }

  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) {
    return;
  }

  const tabId = tab.id;
  const url = info.pageUrl ?? tab.url;
  const title = tab.title ?? info.selectionText ?? url ?? 'Unbenannte Seite';

  if (!url) {
    console.warn('[Link-o-Saurus] Kein URL-Kontext für Bookmark vorhanden.');
    return;
  }

  try {
    const categories = (await listCategories()).map((category) => ({
      id: category.id,
      title: category.title,
    }));

    const [dialogResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: presentLinkOSaurusQuickDialog,
      args: [{ title, url, categories }],
    });

    const response = dialogResult?.result as
      | { action: 'save'; title: string; categoryId?: string; tags: string[] }
      | { action: 'cancel' }
      | undefined;

    if (!response || response.action !== 'save') {
      return;
    }

    await createBookmark({
      id: crypto.randomUUID(),
      title: response.title,
      url,
      faviconUrl: tab.favIconUrl ?? undefined,
      tags: response.tags,
      categoryId: response.categoryId || undefined,
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      func: showLinkOSaurusToast,
      args: ['Bookmark gespeichert'],
    });
    } catch (error) {
      console.error('[Link-o-Saurus] Speichern über Kontextmenü fehlgeschlagen', error);
    }
  });

chrome.action?.onClicked?.addListener((tab) => {
  rememberQuickSaveTab(tab);
  void openSidePanelForWindow(tab.windowId).catch((error) => {
    console.error('[Link-o-Saurus] Extension action failed to open side panel.', error);
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'open-side-panel') {
    return;
  }
  void openSidePanelForWindow().catch((error) => {
    console.error('[Link-o-Saurus] Shortcut failed to open side panel.', error);
  });
});

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'ftp:']);

const resolveTabUrl = (tab: chrome.tabs.Tab): string | undefined => {
  const url = tab.url ?? tab.pendingUrl;
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return undefined;
    }
    return parsed.toString();
  } catch (error) {
    console.warn('[Link-o-Saurus] Ungültige Tab-URL übersprungen', error);
    return undefined;
  }
};

const ensureTabsPermission = async (): Promise<void> => {
  const permissions: chrome.permissions.Permissions = { permissions: ['tabs', 'windows'] };
  const hasPermission = await chrome.permissions.contains(permissions);
  if (hasPermission) {
    return;
  }
  const granted = await chrome.permissions.request(permissions);
  if (!granted) {
    throw new Error('Berechtigung für Tabs wurde nicht erteilt.');
  }
};

const saveCurrentWindowAsSession = async (title?: string): Promise<SessionPack> => {
  await ensureTabsPermission();
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const sessionTabs = tabs
    .map((tab) => {
      const url = resolveTabUrl(tab);
      if (!url) {
        return undefined;
      }
      const sanitized: SessionPack['tabs'][number] = { url };
      if (tab.title && tab.title.trim().length > 0) {
        sanitized.title = tab.title;
      }
      if (tab.favIconUrl && tab.favIconUrl.trim().length > 0) {
        sanitized.favIconUrl = tab.favIconUrl;
      }
      return sanitized;
    })
    .filter((tab): tab is SessionPack['tabs'][number] => Boolean(tab));

  if (sessionTabs.length === 0) {
    throw new Error('Keine speicherbaren Tabs im aktuellen Fenster gefunden.');
  }

  const trimmedTitle = title?.trim();
  const sessionTitle =
    trimmedTitle && trimmedTitle.length > 0
      ? trimmedTitle
      : `Fenster vom ${new Date().toLocaleString()}`;

  const session: CreateSessionInput = {
    id: crypto.randomUUID(),
    title: sessionTitle,
    tabs: sessionTabs,
    savedAt: Date.now(),
  };

  await createSession(session);
  return session;
};

const openTabsInNewWindow = async (tabs: SessionPack['tabs']): Promise<void> => {
  if (!tabs.length) {
    return;
  }
  const [first, ...rest] = tabs;
  const createdWindow = await chrome.windows.create({ url: first.url, focused: true });
  const windowId = createdWindow.id;
  if (!windowId || rest.length === 0) {
    return;
  }

  for (const tab of rest) {
    await chrome.tabs.create({ windowId, url: tab.url, active: false });
  }
};

const openTabsInCurrentWindow = async (tabs: SessionPack['tabs']): Promise<void> => {
  if (!tabs.length) {
    return;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const windowId = activeTab?.windowId;
  if (!windowId) {
    await openTabsInNewWindow(tabs);
    return;
  }

  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index];
    await chrome.tabs.create({ windowId, url: tab.url, active: index === 0 });
  }
};

const handleBackgroundRequest = async (
  message: BackgroundRequest,
): Promise<BackgroundResponse> => {
  switch (message.type) {
    case 'quickSave.getActiveTab': {
      const tab = await resolveQuickSaveTab();
      return { type: 'quickSave.getActiveTab.result', ...(tab ? { tab } : {}) };
    }
    case 'session.saveCurrentWindow': {
      const session = await saveCurrentWindowAsSession(message.title);
      return { type: 'session.saveCurrentWindow.result', session };
    }
    case 'session.openAll': {
      await ensureTabsPermission();
      const session = await getSession(message.sessionId);
      if (!session) {
        throw new Error('Session konnte nicht gefunden werden.');
      }
      const tabs = session.tabs.filter((tab) => Boolean(tab.url));
      if (!tabs.length) {
        throw new Error('Diese Session enthält keine gültigen Tabs.');
      }
      await openTabsInNewWindow(tabs);
      return { type: 'session.openAll.result', opened: tabs.length };
    }
    case 'session.openSelected': {
      await ensureTabsPermission();
      const session = await getSession(message.sessionId);
      if (!session) {
        throw new Error('Session konnte nicht gefunden werden.');
      }
      const uniqueIndexes = Array.from(new Set(message.tabIndexes))
        .filter((index) => Number.isInteger(index) && index >= 0)
        .sort((a, b) => a - b);
      const tabs = uniqueIndexes
        .map((index) => session.tabs[index])
        .filter((tab): tab is SessionPack['tabs'][number] => Boolean(tab?.url));
      if (!tabs.length) {
        throw new Error('Bitte wähle mindestens einen Tab aus.');
      }
      await openTabsInCurrentWindow(tabs);
      return { type: 'session.openSelected.result', opened: tabs.length };
    }
    case 'session.delete': {
      await deleteSession(message.sessionId);
      return { type: 'session.delete.result', sessionId: message.sessionId };
    }
    case 'settings.applyNewTab': {
      const applied = await applyNewTabOverride(message.enabled);
      return { type: 'settings.applyNewTab.result', enabled: applied };
    }
    case 'readLater.refreshBadge': {
      const count = await updateReadLaterBadge();
      return { type: 'readLater.refreshBadge.result', count };
    }
    case 'sidePanel.open': {
      const opened = await openSidePanelForWindow(message.windowId);
      return { type: 'sidePanel.open.result', opened };
    }
    default:
      throw new Error(`Unhandled message type: ${(message as BackgroundRequest).type}`);
  }
};

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const validation = validateBackgroundRequest(message);
  if (!validation.ok) {
    sendResponse({
      type: 'session.error',
      error: validation.error,
      code: validation.code,
      details: validation.details,
    });
    return false;
  }

  (async () => {
    try {
      const response = await handleBackgroundRequest(validation.value);
      sendResponse(response);
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'Unbekannter Fehler beim Session-Handling.';
      sendResponse({ type: 'session.error', error: messageText, code: 'INTERNAL_ERROR' });
    }
  })();

  return true;
});
