import { createBookmark, getUserSettings, listCategories } from '../shared/db';
import { getBrowserLanguage, resolveLocale, translateText, type AppLocale } from '../shared/i18n';
import { presentLinkOSaurusQuickDialog, showLinkOSaurusToast } from './injected/quick-save-dialog';
import { openSidePanelForWindow, rememberQuickSaveTab } from './side-panel-controller';

export const CONTEXT_MENU_ID = 'link-o-saurus-context-save';
export const CONTEXT_MENU_OPEN_SIDE_PANEL_ID = 'link-o-saurus-context-open-side-panel';

const removeAllContextMenus = (): Promise<void> =>
  new Promise((resolve) => chrome.contextMenus.removeAll(() => resolve()));

const resolveContextMenuLocale = (language: Parameters<typeof resolveLocale>[0]): AppLocale =>
  resolveLocale(language, getBrowserLanguage());

const contextMenuText = (locale: AppLocale) => ({
  save: translateText('Zu Link-o-Saurus speichern', locale),
  openSidePanel: translateText('Link-o-Saurus Seitenleiste öffnen', locale),
});

export const registerContextMenu = async (): Promise<void> => {
  const settings = await getUserSettings();
  const locale = resolveContextMenuLocale(settings.language);
  const labels = contextMenuText(locale);
  await removeAllContextMenus();
  chrome.contextMenus.create(
    {
      id: CONTEXT_MENU_ID,
      title: labels.save,
      contexts: ['page', 'selection', 'frame'],
    },
    () => {
      const lastError = chrome.runtime.lastError;
      if (lastError && !lastError.message?.includes('duplicate id')) {
        console.error(`[Link-o-Saurus] ${translateText('Kontextmenü konnte nicht erstellt werden:', locale)}`, lastError);
      }
    },
  );
  chrome.contextMenus.create(
    {
      id: CONTEXT_MENU_OPEN_SIDE_PANEL_ID,
      title: labels.openSidePanel,
      contexts: ['action'],
    },
    () => {
      const lastError = chrome.runtime.lastError;
      if (lastError && !lastError.message?.includes('duplicate id')) {
        console.error(`[Link-o-Saurus] ${translateText('Sidepanel-Kontextmenü konnte nicht erstellt werden:', locale)}`, lastError);
      }
    },
  );
};

export const registerContextMenuController = (): void => {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID && info.menuItemId !== CONTEXT_MENU_OPEN_SIDE_PANEL_ID) {
      return;
    }
    const settings = await getUserSettings();
    const locale = resolveContextMenuLocale(settings.language);
    if (info.menuItemId === CONTEXT_MENU_OPEN_SIDE_PANEL_ID) {
      rememberQuickSaveTab(tab);
      try {
        await openSidePanelForWindow(tab?.windowId);
      } catch (error) {
        console.error(`[Link-o-Saurus] ${translateText('Side panel konnte nicht geöffnet werden.', locale)}`, error);
      }
      return;
    }

    if (!tab?.id) {
      return;
    }

    const tabId = tab.id;
    const url = info.pageUrl ?? tab.url;
    const title = tab.title ?? info.selectionText ?? url ?? translateText('Unbenannte Seite', locale);

    if (!url) {
      console.warn(`[Link-o-Saurus] ${translateText('Kein URL-Kontext für Bookmark vorhanden.', locale)}`);
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
        args: [{ title, url, categories, locale, theme: settings.theme }],
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
        args: [translateText('Bookmark gespeichert', locale), settings.theme],
      });
    } catch (error) {
      console.error(`[Link-o-Saurus] ${translateText('Speichern über Kontextmenü fehlgeschlagen', locale)}`, error);
    }
  });
};
