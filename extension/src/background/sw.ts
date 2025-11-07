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
import type { CreateSessionInput } from '../shared/db';
import type { BackgroundRequest, BackgroundResponse } from '../shared/messaging';
import { isBackgroundRequest } from '../shared/messaging';
import type { SessionPack } from '../shared/types';

const CONTEXT_MENU_ID = 'feathermarks-context-save';
const EXTENSION_NEW_TAB_URL = chrome.runtime.getURL('newtab/index.html');
const CHROME_DEFAULT_NEW_TAB_URLS = new Set([
  'chrome://newtab/',
  'chrome-search://local-ntp/local-ntp.html',
]);
const FIREFOX_DEFAULT_NEW_TAB_URLS = new Set(['about:newtab', 'about:home']);

let newTabOverrideActive = false;
let newTabListenerRegistered = false;

console.log('[Feathermarks] background service worker initialized');

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
    console.error('[Feathermarks] Failed to update read later badge', error);
    try {
      await chrome.action.setBadgeText({ text: '' });
    } catch (innerError) {
      console.warn('[Feathermarks] Unable to reset badge text', innerError);
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
    console.error('[Feathermarks] Failed to register read later alarm', error);
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
    .catch((error) => console.warn('[Feathermarks] Failed to override new tab', error));
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

void (async () => {
  try {
    const settings = await getUserSettings();
    const applied = await applyNewTabOverride(settings.newTabEnabled);
    if (settings.newTabEnabled && !applied) {
      await saveUserSettings({ newTabEnabled: false });
    }
  } catch (error) {
    console.error('[Feathermarks] Failed to initialize new tab override', error);
  }
})();

const registerContextMenu = (): void => {
  chrome.contextMenus.create(
    {
      id: CONTEXT_MENU_ID,
      title: 'Zu Feathermarks speichern',
      contexts: ['page', 'selection', 'frame'],
    },
    () => {
      const lastError = chrome.runtime.lastError;
      if (lastError && !lastError.message?.includes('duplicate id')) {
        console.error('[Feathermarks] Kontextmenü konnte nicht erstellt werden:', lastError);
      }
    },
  );
};

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenu();
  void ensureReadLaterAlarm();
  void updateReadLaterBadge();
  console.log('[Feathermarks] extension installed');
});

chrome.runtime.onStartup?.addListener(() => {
  registerContextMenu();
  void ensureReadLaterAlarm();
  void updateReadLaterBadge();
});

// Ensure the context menu exists when the service worker starts lazily.
registerContextMenu();
void ensureReadLaterAlarm();
void updateReadLaterBadge();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === READ_LATER_ALARM_NAME) {
    void updateReadLaterBadge();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) {
    return;
  }

  const tabId = tab.id;
  const url = info.pageUrl ?? tab.url;
  const title = tab.title ?? info.selectionText ?? url ?? 'Unbenannte Seite';

  if (!url) {
    console.warn('[Feathermarks] Kein URL-Kontext für Bookmark vorhanden.');
    return;
  }

  try {
    const categories = (await listCategories()).map((category) => ({
      id: category.id,
      title: category.title,
    }));

    const [dialogResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: presentFeathermarksQuickDialog,
      args: [{ title, url, categories }],
    });

    const response = dialogResult?.result as
      | { action: 'save'; categoryId?: string; tags: string[] }
      | { action: 'cancel' }
      | undefined;

    if (!response || response.action !== 'save') {
      return;
    }

    await createBookmark({
      id: crypto.randomUUID(),
      title,
      url,
      tags: response.tags,
      categoryId: response.categoryId || undefined,
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      func: showFeathermarksToast,
      args: ['Bookmark gespeichert'],
    });
  } catch (error) {
    console.error('[Feathermarks] Speichern über Kontextmenü fehlgeschlagen', error);
  }
});

function presentFeathermarksQuickDialog({
  title,
  url,
  categories,
}: {
  title: string;
  url: string;
  categories: { id: string; title: string }[];
}): Promise<{ action: 'save'; categoryId?: string; tags: string[] } | { action: 'cancel' }> {
  const escapeHtml = (value: string): string =>
    value.replace(/[&<>"']/g, (char) => {
      switch (char) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&#39;';
        default:
          return char;
      }
    });

  const existing = document.getElementById('feathermarks-quick-dialog-root');
  if (existing) {
    existing.remove();
  }

  return new Promise((resolve) => {
    if (!document.body) {
      resolve({ action: 'cancel' });
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'feathermarks-quick-dialog-root';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(15, 23, 42, 0.45)';
    overlay.style.zIndex = '2147483647';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '16px';

    const container = document.createElement('form');
    container.style.background = 'white';
    container.style.color = '#0f172a';
    container.style.minWidth = '280px';
    container.style.maxWidth = 'min(420px, 100%)';
    container.style.borderRadius = '12px';
    container.style.boxShadow = '0 16px 40px rgba(15, 23, 42, 0.25)';
    container.style.padding = '20px';
    container.style.fontFamily = `'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    container.style.display = 'grid';
    container.style.gap = '12px';

    const titleLabel = document.createElement('div');
    titleLabel.textContent = 'Feathermarks';
    titleLabel.style.fontSize = '16px';
    titleLabel.style.fontWeight = '600';
    container.appendChild(titleLabel);

    const contextInfo = document.createElement('div');
    contextInfo.style.fontSize = '13px';
    contextInfo.style.lineHeight = '1.4';
    contextInfo.style.color = '#334155';
    contextInfo.innerHTML = `${escapeHtml(title)}<br /><span style="color:#64748b">${escapeHtml(url)}</span>`;
    container.appendChild(contextInfo);

    const categoryBlock = document.createElement('div');
    categoryBlock.style.display = 'grid';
    categoryBlock.style.gap = '4px';
    categoryBlock.style.fontSize = '12px';
    categoryBlock.style.textTransform = 'uppercase';
    categoryBlock.style.letterSpacing = '0.04em';
    categoryBlock.style.color = '#64748b';

    const categoryLabel = document.createElement('span');
    categoryLabel.textContent = 'Kategorie';
    categoryLabel.style.fontWeight = '600';
    categoryBlock.appendChild(categoryLabel);

    let categorySelect: HTMLSelectElement | undefined;
    if (categories.length > 0) {
      categorySelect = document.createElement('select');
      categorySelect.style.border = '1px solid #cbd5f5';
      categorySelect.style.borderRadius = '8px';
      categorySelect.style.padding = '8px 10px';
      categorySelect.style.fontSize = '14px';
      categorySelect.style.color = '#0f172a';
      categorySelect.style.outline = 'none';
      categorySelect.style.background = '#ffffff';
      categorySelect.addEventListener('focus', () => {
        categorySelect!.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.35)';
        categorySelect!.style.borderColor = '#3b82f6';
      });
      categorySelect.addEventListener('blur', () => {
        categorySelect!.style.boxShadow = 'none';
        categorySelect!.style.borderColor = '#cbd5f5';
      });

      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = 'Keine Kategorie';
      categorySelect.appendChild(emptyOption);

      categories.forEach((category) => {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.title;
        categorySelect!.appendChild(option);
      });

      categoryBlock.appendChild(categorySelect);
    } else {
      const emptyState = document.createElement('div');
      emptyState.textContent = 'Keine Kategorien vorhanden';
      emptyState.style.fontSize = '12px';
      emptyState.style.color = '#94a3b8';
      emptyState.style.padding = '8px 10px';
      emptyState.style.border = '1px dashed #cbd5f5';
      emptyState.style.borderRadius = '8px';
      categoryBlock.appendChild(emptyState);
    }

    container.appendChild(categoryBlock);

    const tagField = document.createElement('label');
    tagField.style.display = 'grid';
    tagField.style.gap = '4px';
    tagField.style.fontSize = '12px';
    tagField.style.textTransform = 'uppercase';
    tagField.style.letterSpacing = '0.04em';
    tagField.style.color = '#64748b';
    tagField.textContent = 'Tags';

    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.placeholder = 'kommagetrennt, z. B. ux, ui';
    tagInput.style.border = '1px solid #cbd5f5';
    tagInput.style.borderRadius = '8px';
    tagInput.style.padding = '8px 10px';
    tagInput.style.fontSize = '14px';
    tagInput.style.color = '#0f172a';
    tagInput.style.outline = 'none';
    tagInput.addEventListener('focus', () => {
      tagInput.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.35)';
      tagInput.style.borderColor = '#3b82f6';
    });
    tagInput.addEventListener('blur', () => {
      tagInput.style.boxShadow = 'none';
      tagInput.style.borderColor = '#cbd5f5';
    });
    tagField.appendChild(tagInput);
    container.appendChild(tagField);

    const actionRow = document.createElement('div');
    actionRow.style.display = 'flex';
    actionRow.style.gap = '8px';
    actionRow.style.justifyContent = 'flex-end';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Abbrechen';
    cancelButton.style.border = 'none';
    cancelButton.style.background = 'transparent';
    cancelButton.style.color = '#64748b';
    cancelButton.style.fontSize = '13px';
    cancelButton.style.padding = '8px 12px';
    cancelButton.style.cursor = 'pointer';
    cancelButton.addEventListener('click', () => cleanup({ action: 'cancel' }));

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.textContent = 'Speichern';
    submitButton.style.border = 'none';
    submitButton.style.background = '#2563eb';
    submitButton.style.color = 'white';
    submitButton.style.fontSize = '13px';
    submitButton.style.fontWeight = '600';
    submitButton.style.borderRadius = '999px';
    submitButton.style.padding = '8px 16px';
    submitButton.style.cursor = 'pointer';

    actionRow.append(cancelButton, submitButton);
    container.appendChild(actionRow);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup({ action: 'cancel' });
      }
    };

    const cleanup = (
      result: { action: 'save'; categoryId?: string; tags: string[] } | { action: 'cancel' },
    ) => {
      window.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(result);
    };

    container.addEventListener('submit', (event) => {
      event.preventDefault();
      const category = categorySelect?.value ?? '';
      const tags = tagInput.value
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
      cleanup({ action: 'save', categoryId: category || undefined, tags });
    });

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        cleanup({ action: 'cancel' });
      }
    });

    window.addEventListener('keydown', onKeyDown);

    container.tabIndex = -1;
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    const focusTarget: HTMLElement | undefined = categorySelect ?? tagInput;
    setTimeout(() => focusTarget?.focus({ preventScroll: true }), 0);
  });
}

function showFeathermarksToast(message: string): void {
  if (!document.body) {
    return;
  }

  const existing = document.getElementById('feathermarks-toast');
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.id = 'feathermarks-toast';
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.right = '20px';
  toast.style.background = '#0f172a';
  toast.style.color = 'white';
  toast.style.padding = '10px 16px';
  toast.style.borderRadius = '999px';
  toast.style.fontSize = '13px';
  toast.style.fontWeight = '500';
  toast.style.boxShadow = '0 10px 30px rgba(15, 23, 42, 0.3)';
  toast.style.zIndex = '2147483647';
  toast.style.transition = 'opacity 200ms ease';
  toast.style.opacity = '0';

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, 2200);
}

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
    console.warn('[Feathermarks] Ungültige Tab-URL übersprungen', error);
    return undefined;
  }
};

const ensureTabsPermission = async (): Promise<void> => {
  const hasPermission = await chrome.permissions.contains({ permissions: ['tabs'] });
  if (hasPermission) {
    return;
  }
  const granted = await chrome.permissions.request({ permissions: ['tabs'] });
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
    default:
      throw new Error(`Unhandled message type: ${(message as BackgroundRequest).type}`);
  }
};

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isBackgroundRequest(message)) {
    return;
  }

  (async () => {
    try {
      const response = await handleBackgroundRequest(message);
      sendResponse(response);
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'Unbekannter Fehler beim Session-Handling.';
      sendResponse({ type: 'session.error', error: messageText });
    }
  })();

  return true;
});
