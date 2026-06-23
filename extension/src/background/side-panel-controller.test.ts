import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeSidePanelForWindow, rememberQuickSaveTab, resolveQuickSaveTab } from './side-panel-controller';

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


describe('closeSidePanelForWindow', () => {
  it('closes the side panel for the provided window id', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', {
      sidePanel: { close },
    });

    await expect(closeSidePanelForWindow(7)).resolves.toBe(true);
    expect(close).toHaveBeenCalledWith({ windowId: 7 });
  });

  it('returns false when the close API is unavailable', async () => {
    vi.stubGlobal('chrome', {
      sidePanel: {},
    });

    await expect(closeSidePanelForWindow(7)).resolves.toBe(false);
  });
});
