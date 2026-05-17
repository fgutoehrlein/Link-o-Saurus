import { useCallback } from 'preact/hooks';
import { sendBackgroundMessage } from '../../shared/messaging';

export type QuickSaveTabMetadata = {
  readonly title?: string;
  readonly url?: string;
};

const queryTabs = async (queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> => {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return [];
  }

  return new Promise<chrome.tabs.Tab[]>((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const error = chrome.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tabs ?? []);
    });
  });
};

const hasReadableTabMetadata = (tab: chrome.tabs.Tab | undefined): boolean => Boolean(tab?.url || tab?.pendingUrl || tab?.title);

const queryActiveTab = async (): Promise<chrome.tabs.Tab | undefined> => {
  const [currentWindowTab] = await queryTabs({ active: true, currentWindow: true });
  if (hasReadableTabMetadata(currentWindowTab)) {
    return currentWindowTab;
  }

  const [lastFocusedWindowTab] = await queryTabs({ active: true, lastFocusedWindow: true });
  if (hasReadableTabMetadata(lastFocusedWindowTab)) {
    return lastFocusedWindowTab;
  }

  return currentWindowTab ?? lastFocusedWindowTab;
};

const queryQuickSaveTabFromBackground = async (): Promise<QuickSaveTabMetadata | undefined> => {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return undefined;
  }

  try {
    const response = await sendBackgroundMessage({ type: 'quickSave.getActiveTab' });
    return response.type === 'quickSave.getActiveTab.result' ? response.tab : undefined;
  } catch {
    return undefined;
  }
};

export const resolveQuickSaveMetadata = async (): Promise<QuickSaveTabMetadata | undefined> => {
  const backgroundTab = await queryQuickSaveTabFromBackground();
  if (backgroundTab?.url || backgroundTab?.title) {
    return backgroundTab;
  }

  const activeTab = await queryActiveTab();
  if (!activeTab) {
    return undefined;
  }

  return {
    title: activeTab.title?.trim() ?? '',
    url: (activeTab.url ?? activeTab.pendingUrl ?? '').trim(),
  };
};

export const useActiveTab = (): (() => Promise<QuickSaveTabMetadata | undefined>) => useCallback(resolveQuickSaveMetadata, []);

export const openUrlInNewTab = async (url: string): Promise<void> => {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    await new Promise<void>((resolve, reject) => {
      chrome.tabs.create({ url, active: true }, () => {
        const error = chrome.runtime?.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
    return;
  }
  window.open(url, '_blank', 'noopener');
};
