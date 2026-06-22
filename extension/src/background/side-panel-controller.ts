type SidePanelCloseOptions = { windowId?: number; tabId?: number };

type SidePanelPanelInfo = { windowId: number; tabId?: number; path?: string };

type SidePanelEvent = {
  addListener?: (callback: (info: SidePanelPanelInfo) => void) => void;
};

type ToggleableSidePanelApi = typeof chrome.sidePanel & {
  open?: (options: { windowId: number }) => Promise<void>;
  close?: (options: SidePanelCloseOptions) => Promise<void>;
  onOpened?: SidePanelEvent;
  onClosed?: SidePanelEvent;
};

const getSidePanelApi = (): ToggleableSidePanelApi | undefined => chrome.sidePanel as ToggleableSidePanelApi | undefined;

const openSidePanelWindows = new Set<number>();

export type QuickSaveTabMetadata = {
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

export const rememberQuickSaveTab = (tab: chrome.tabs.Tab | undefined): QuickSaveTabMetadata | undefined => {
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

export const resolveQuickSaveTab = async (): Promise<QuickSaveTabMetadata | undefined> => {
  const [currentWindowTab] = await queryTabsForQuickSave({ active: true, currentWindow: true });
  const currentWindowMetadata = rememberQuickSaveTab(currentWindowTab);
  if (currentWindowMetadata?.url || currentWindowMetadata?.title) {
    return currentWindowMetadata;
  }

  const [lastFocusedWindowTab] = await queryTabsForQuickSave({ active: true, lastFocusedWindow: true });
  const lastFocusedWindowMetadata = rememberQuickSaveTab(lastFocusedWindowTab);
  if (lastFocusedWindowMetadata?.url || lastFocusedWindowMetadata?.title) {
    return lastFocusedWindowMetadata;
  }

  return getCachedQuickSaveTab();
};

export const registerSidePanelStateTracking = (): void => {
  const sidePanelApi = getSidePanelApi();

  sidePanelApi?.onOpened?.addListener?.((info) => {
    openSidePanelWindows.add(info.windowId);
  });

  sidePanelApi?.onClosed?.addListener?.((info) => {
    openSidePanelWindows.delete(info.windowId);
  });
};

export const setSidePanelActionBehavior = async (): Promise<void> => {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return;
  }
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch (error) {
    console.warn('[Link-o-Saurus] Side panel behavior could not be applied.', error);
  }
};

const getLastFocusedWindowId = async (): Promise<number | undefined> => {
  return (
    await chrome.windows.getLastFocused({
      populate: false,
      windowTypes: ['normal'],
    })
  ).id;
};

export const openSidePanelForWindow = async (windowId?: number): Promise<boolean> => {
  const sidePanelApi = getSidePanelApi();

  if (!sidePanelApi?.open) {
    return false;
  }

  const resolvedWindowId = typeof windowId === 'number' ? windowId : await getLastFocusedWindowId();

  if (typeof resolvedWindowId !== 'number') {
    return false;
  }

  await sidePanelApi.open({ windowId: resolvedWindowId });
  openSidePanelWindows.add(resolvedWindowId);
  return true;
};

export const toggleSidePanelForWindow = async (windowId?: number): Promise<boolean> => {
  const sidePanelApi = getSidePanelApi();
  const resolvedWindowId = typeof windowId === 'number' ? windowId : await getLastFocusedWindowId();

  if (typeof resolvedWindowId !== 'number') {
    return false;
  }

  if (openSidePanelWindows.has(resolvedWindowId) && sidePanelApi?.close) {
    await sidePanelApi.close({ windowId: resolvedWindowId });
    openSidePanelWindows.delete(resolvedWindowId);
    return true;
  }

  return openSidePanelForWindow(resolvedWindowId);
};
