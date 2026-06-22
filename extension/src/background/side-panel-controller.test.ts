import { afterEach, describe, expect, it, vi } from 'vitest';

import { rememberQuickSaveTab, resolveQuickSaveTab } from './side-panel-controller';

const setTabsQueryResult = (tabs: chrome.tabs.Tab[]) => {
  vi.stubGlobal('chrome', {
    tabs: {
      query: vi.fn().mockResolvedValue(tabs),
    },
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveQuickSaveTab', () => {
  it('prefers a freshly queried active tab over cached action metadata', async () => {
    rememberQuickSaveTab({ title: 'Alter Tab', url: 'https://old.example/' } as chrome.tabs.Tab);
    setTabsQueryResult([{ title: 'Neuer Tab', url: 'https://new.example/' } as chrome.tabs.Tab]);

    await expect(resolveQuickSaveTab()).resolves.toEqual({
      title: 'Neuer Tab',
      url: 'https://new.example/',
    });
  });

  it('falls back to cached action metadata when active tab metadata is not readable', async () => {
    rememberQuickSaveTab({ title: 'Fallback Tab', url: 'https://fallback.example/' } as chrome.tabs.Tab);
    setTabsQueryResult([]);

    await expect(resolveQuickSaveTab()).resolves.toEqual({
      title: 'Fallback Tab',
      url: 'https://fallback.example/',
    });
  });
});
