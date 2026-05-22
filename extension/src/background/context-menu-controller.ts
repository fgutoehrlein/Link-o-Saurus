import { createBookmark, listCategories } from '../shared/db';
import { presentLinkOSaurusQuickDialog, showLinkOSaurusToast } from './injected/quick-save-dialog';
import { openSidePanelForWindow, rememberQuickSaveTab } from './side-panel-controller';

export const CONTEXT_MENU_ID = 'link-o-saurus-context-save';
export const CONTEXT_MENU_OPEN_SIDE_PANEL_ID = 'link-o-saurus-context-open-side-panel';

export const registerContextMenu = (): void => {
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

export const registerContextMenuController = (): void => {
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
};
