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
import { isBackgroundRequest } from '../shared/messaging';
import type { SessionPack } from '../shared/types';

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
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
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

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'open-side-panel') {
    return;
  }
  void openSidePanelForWindow().catch((error) => {
    console.error('[Link-o-Saurus] Shortcut failed to open side panel.', error);
  });
});

function presentLinkOSaurusQuickDialog({
  title,
  url,
  categories,
}: {
  title: string;
  url: string;
  categories: { id: string; title: string }[];
}): Promise<{ action: 'save'; title: string; categoryId?: string; tags: string[] } | { action: 'cancel' }> {
  const existing = document.getElementById('link-o-saurus-quick-dialog-root');
  if (existing) {
    existing.remove();
  }

  return new Promise((resolve) => {
    if (!document.body) {
      resolve({ action: 'cancel' });
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'link-o-saurus-quick-dialog-root';
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

    const uiTokens = {
      surface: '#0f172a',
      panel: 'rgba(15, 23, 42, 0.92)',
      panelStrong: 'rgba(21, 32, 58, 0.98)',
      text: '#edf2ff',
      muted: '#a3b0cb',
      line: 'rgba(148, 163, 184, 0.24)',
      accent: '#4f7cff',
      accentStrong: '#2d63ff',
      chip: 'rgba(79, 124, 255, 0.3)',
      danger: '#ff8e8e',
    };

    const applyStyles = (element: HTMLElement, styles: Record<string, string>): void => {
      Object.assign(element.style, styles);
    };

    const container = document.createElement('form');
    applyStyles(container, {
      background:
        'linear-gradient(160deg, rgba(8, 13, 27, 0.98), rgba(12, 20, 39, 0.95))',
      color: uiTokens.text,
      width: 'min(360px, 100%)',
      border: `1px solid ${uiTokens.line}`,
      borderRadius: '14px',
      boxShadow: '0 16px 40px rgba(15, 23, 42, 0.35)',
      padding: '16px',
    });
    container.style.fontFamily = `'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    container.style.display = 'grid';
    container.style.gap = '12px';

    const header = document.createElement('div');
    applyStyles(header, { display: 'flex', alignItems: 'center', gap: '10px' });

    const favicon = document.createElement('img');
    favicon.width = 22;
    favicon.height = 22;
    favicon.alt = '';
    favicon.src = `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url)}&sz=64`;
    applyStyles(favicon, {
      borderRadius: '999px',
      background: 'rgba(148, 163, 184, 0.16)',
      flexShrink: '0',
    });
    favicon.addEventListener('error', () => {
      favicon.style.display = 'none';
    });

    const titleLabel = document.createElement('h2');
    titleLabel.textContent = 'Bookmark speichern';
    applyStyles(titleLabel, {
      margin: '0',
      fontSize: '15px',
      letterSpacing: '0.03em',
      fontWeight: '600',
      color: uiTokens.text,
    });
    header.append(favicon, titleLabel);
    container.appendChild(header);

    const metadata = document.createElement('section');
    metadata.setAttribute('aria-label', 'Metadaten');
    applyStyles(metadata, {
      background: uiTokens.panel,
      border: `1px solid ${uiTokens.line}`,
      borderRadius: '12px',
      padding: '12px',
      display: 'grid',
      gap: '8px',
    });

    const makeLabel = (text: string): HTMLSpanElement => {
      const label = document.createElement('span');
      label.textContent = text;
      applyStyles(label, {
        fontSize: '11px',
        color: uiTokens.muted,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      });
      return label;
    };

    const titleField = document.createElement('label');
    applyStyles(titleField, { display: 'grid', gap: '4px' });
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = title;
    titleInput.required = true;
    titleInput.setAttribute('aria-label', 'Titel');
    titleField.append(makeLabel('Titel'), titleInput);

    const urlField = document.createElement('div');
    applyStyles(urlField, { display: 'grid', gap: '4px' });
    const urlPreview = document.createElement('div');
    urlPreview.title = url;
    urlPreview.textContent = url;
    applyStyles(urlPreview, {
      fontSize: '12px',
      color: uiTokens.muted,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      padding: '8px 10px',
      borderRadius: '9px',
      border: `1px solid ${uiTokens.line}`,
      background: uiTokens.panelStrong,
    });
    urlField.append(makeLabel('URL'), urlPreview);
    metadata.append(titleField, urlField);
    container.appendChild(metadata);

    const formSection = document.createElement('section');
    applyStyles(formSection, { display: 'grid', gap: '12px' });

    const baseInputStyles = {
      width: '100%',
      borderRadius: '9px',
      border: `1px solid ${uiTokens.line}`,
      background: uiTokens.panelStrong,
      color: uiTokens.text,
      padding: '8px 10px',
      fontSize: '13px',
      transition: 'border-color 180ms ease, box-shadow 180ms ease, background 180ms ease',
    };

    const applyFocusableInputBehavior = (element: HTMLElement): void => {
      element.style.outline = 'none';
      element.addEventListener('focus', () => {
        element.style.borderColor = uiTokens.accent;
        element.style.boxShadow = '0 0 0 2px rgba(130, 168, 255, 0.3)';
      });
      element.addEventListener('blur', () => {
        element.style.borderColor = uiTokens.line;
        element.style.boxShadow = 'none';
      });
      element.addEventListener('mouseenter', () => {
        if (document.activeElement !== element) {
          element.style.borderColor = 'rgba(130, 168, 255, 0.45)';
        }
      });
      element.addEventListener('mouseleave', () => {
        if (document.activeElement !== element) {
          element.style.borderColor = uiTokens.line;
        }
      });
    };

    let selectedCategoryId = '';
    let dropdownOpen = false;

    const categoryBlock = document.createElement('label');
    applyStyles(categoryBlock, { display: 'grid', gap: '4px' });
    categoryBlock.appendChild(makeLabel('Kategorie'));

    const selectRoot = document.createElement('div');
    applyStyles(selectRoot, { position: 'relative' });
    const selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.textContent = 'Kategorie auswählen';
    applyStyles(selectButton, {
      ...baseInputStyles,
      textAlign: 'left',
      cursor: 'pointer',
    });
    selectButton.setAttribute('aria-haspopup', 'listbox');
    selectButton.setAttribute('aria-expanded', 'false');
    applyFocusableInputBehavior(selectButton);

    const optionsList = document.createElement('div');
    applyStyles(optionsList, {
      position: 'absolute',
      top: 'calc(100% + 6px)',
      left: '0',
      right: '0',
      maxHeight: '176px',
      overflowY: 'auto',
      display: 'none',
      borderRadius: '10px',
      background: uiTokens.panelStrong,
      border: `1px solid ${uiTokens.line}`,
      boxShadow: '0 10px 24px rgba(2, 6, 23, 0.45)',
      zIndex: '3',
      padding: '4px',
    });

    const closeDropdown = (): void => {
      dropdownOpen = false;
      optionsList.style.display = 'none';
      selectButton.setAttribute('aria-expanded', 'false');
    };
    const openDropdown = (): void => {
      dropdownOpen = true;
      optionsList.style.display = 'grid';
      selectButton.setAttribute('aria-expanded', 'true');
    };

    const setCategory = (id: string, label: string): void => {
      selectedCategoryId = id;
      selectButton.textContent = label;
      selectButton.style.color = id ? uiTokens.text : uiTokens.muted;
      closeDropdown();
    };

    const selectOptions: Array<{ id: string; title: string }> = [
      { id: '', title: 'Kategorie auswählen' },
      ...categories.map((category) => ({ id: category.id, title: category.title })),
    ];

    selectOptions.forEach((option) => {
      const optionButton = document.createElement('button');
      optionButton.type = 'button';
      optionButton.textContent = option.title;
      applyStyles(optionButton, {
        border: 'none',
        background: 'transparent',
        color: uiTokens.text,
        textAlign: 'left',
        borderRadius: '8px',
        padding: '8px',
        cursor: 'pointer',
        fontSize: '13px',
        transition: 'background 170ms ease',
      });
      optionButton.addEventListener('mouseenter', () => {
        optionButton.style.background = 'rgba(148, 163, 184, 0.15)';
      });
      optionButton.addEventListener('mouseleave', () => {
        optionButton.style.background = 'transparent';
      });
      optionButton.addEventListener('click', () => setCategory(option.id, option.title));
      optionsList.appendChild(optionButton);
    });

    selectButton.addEventListener('click', () => {
      if (dropdownOpen) {
        closeDropdown();
        return;
      }
      openDropdown();
    });
    selectRoot.append(selectButton, optionsList);
    categoryBlock.appendChild(selectRoot);

    const tagField = document.createElement('label');
    applyStyles(tagField, { display: 'grid', gap: '4px' });
    tagField.appendChild(makeLabel('Tags'));

    const tagRoot = document.createElement('div');
    applyStyles(tagRoot, {
      ...baseInputStyles,
      minHeight: '42px',
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '6px',
      padding: '7px',
    });
    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.placeholder = 'Tags hinzufügen (Enter drücken)';
    applyStyles(tagInput, {
      flex: '1',
      minWidth: '120px',
      border: 'none',
      background: 'transparent',
      color: uiTokens.text,
      fontSize: '13px',
      outline: 'none',
      padding: '2px',
    });

    const tags: string[] = [];
    const normalizeTag = (value: string): string => value.trim().replace(/\s+/g, ' ');
    const renderTags = (): void => {
      const chips = Array.from(tagRoot.querySelectorAll('[data-tag-chip="true"]'));
      chips.forEach((chip) => chip.remove());
      tags.forEach((tag) => {
        const chip = document.createElement('span');
        chip.setAttribute('data-tag-chip', 'true');
        chip.textContent = tag;
        applyStyles(chip, {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          borderRadius: '999px',
          background: uiTokens.chip,
          color: uiTokens.text,
          fontSize: '12px',
          padding: '2px 8px',
        });
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.textContent = '×';
        removeButton.setAttribute('aria-label', `Tag ${tag} entfernen`);
        applyStyles(removeButton, {
          border: 'none',
          background: 'transparent',
          color: uiTokens.text,
          cursor: 'pointer',
          padding: '0',
          lineHeight: '1',
        });
        removeButton.addEventListener('click', () => {
          const index = tags.findIndex((candidate) => candidate === tag);
          if (index >= 0) {
            tags.splice(index, 1);
            renderTags();
          }
        });
        chip.appendChild(removeButton);
        tagRoot.insertBefore(chip, tagInput);
      });
    };

    const commitTagDraft = (): void => {
      const normalized = normalizeTag(tagInput.value);
      if (!normalized) {
        return;
      }
      if (!tags.some((tag) => tag.toLowerCase() === normalized.toLowerCase())) {
        tags.push(normalized);
        renderTags();
      }
      tagInput.value = '';
    };

    applyFocusableInputBehavior(tagRoot);
    tagRoot.addEventListener('click', () => tagInput.focus());
    tagInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitTagDraft();
        return;
      }
      if (event.key === 'Backspace' && tagInput.value.length === 0 && tags.length > 0) {
        tags.pop();
        renderTags();
      }
    });
    tagInput.addEventListener('blur', commitTagDraft);
    tagRoot.appendChild(tagInput);
    tagField.appendChild(tagRoot);

    formSection.append(categoryBlock, tagField);
    container.appendChild(formSection);

    const divider = document.createElement('div');
    applyStyles(divider, { height: '1px', background: uiTokens.line });
    container.appendChild(divider);

    if (categories.length > 0) {
      setCategory('', 'Kategorie auswählen');
    } else {
      selectButton.disabled = true;
      selectButton.textContent = 'Keine Kategorie verfügbar';
      selectButton.style.color = uiTokens.muted;
      selectButton.style.cursor = 'not-allowed';
    }

    const actionRow = document.createElement('div');
    applyStyles(actionRow, { display: 'flex', gap: '8px', justifyContent: 'flex-end' });

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Abbrechen';
    applyStyles(cancelButton, {
      border: `1px solid ${uiTokens.line}`,
      background: 'rgba(148, 163, 184, 0.12)',
      color: uiTokens.text,
      borderRadius: '10px',
      fontSize: '13px',
      padding: '8px 12px',
      cursor: 'pointer',
      transition: 'background 180ms ease, border-color 180ms ease',
    });
    cancelButton.addEventListener('mouseenter', () => {
      cancelButton.style.background = 'rgba(148, 163, 184, 0.2)';
    });
    cancelButton.addEventListener('mouseleave', () => {
      cancelButton.style.background = 'rgba(148, 163, 184, 0.12)';
    });
    cancelButton.addEventListener('click', () => cleanup({ action: 'cancel' }));

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.textContent = 'Speichern';
    applyStyles(submitButton, {
      border: 'none',
      background: `linear-gradient(140deg, ${uiTokens.accent}, ${uiTokens.accentStrong})`,
      color: 'white',
      fontSize: '13px',
      fontWeight: '600',
      borderRadius: '10px',
      padding: '8px 16px',
      cursor: 'pointer',
      boxShadow: '0 8px 16px rgba(45, 99, 255, 0.35)',
      transition: 'transform 170ms ease, filter 170ms ease',
    });
    submitButton.addEventListener('mouseenter', () => {
      submitButton.style.filter = 'brightness(1.06)';
    });
    submitButton.addEventListener('mouseleave', () => {
      submitButton.style.filter = 'none';
    });

    actionRow.append(cancelButton, submitButton);
    container.appendChild(actionRow);

    applyFocusableInputBehavior(titleInput);
    applyFocusableInputBehavior(cancelButton);
    applyFocusableInputBehavior(submitButton);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup({ action: 'cancel' });
      }
    };

    const cleanup = (
      result: { action: 'save'; title: string; categoryId?: string; tags: string[] } | { action: 'cancel' },
    ) => {
      window.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(result);
    };

    container.addEventListener('submit', (event) => {
      event.preventDefault();
      commitTagDraft();
      const normalizedTitle = titleInput.value.trim();
      if (!normalizedTitle) {
        titleInput.style.borderColor = uiTokens.danger;
        titleInput.focus();
        return;
      }
      titleInput.value = normalizedTitle;
      cleanup({
        action: 'save',
        title: normalizedTitle,
        categoryId: selectedCategoryId || undefined,
        tags: [...tags],
      });
    });

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        cleanup({ action: 'cancel' });
        return;
      }
      if (dropdownOpen && !selectRoot.contains(event.target as Node)) {
        closeDropdown();
      }
    });

    window.addEventListener('keydown', onKeyDown);

    container.tabIndex = -1;
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    setTimeout(() => titleInput.focus({ preventScroll: true }), 0);
  });
}

  function showLinkOSaurusToast(message: string): void {
  if (!document.body) {
    return;
  }

    const existing = document.getElementById('link-o-saurus-toast');
  if (existing) {
    existing.remove();
  }

    const toast = document.createElement('div');
    toast.id = 'link-o-saurus-toast';
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
