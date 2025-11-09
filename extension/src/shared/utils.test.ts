import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { openDashboard } from './utils';

type ChromeMocks = {
  tabsCreate: Mock;
  tabsQuery: Mock;
  tabsUpdate: Mock;
  tabsSendMessage: Mock;
  windowsUpdate: Mock;
  runtimeGetURL: Mock;
};

const installChromeMocks = (): ChromeMocks => {
  const tabsCreate = vi.fn((createProperties?: { url?: string; active?: boolean }, callback?: (tab: any) => void) => {
    const tab = {
      id: 42,
      url: createProperties?.url ?? '',
      active: createProperties?.active ?? true,
      windowId: 1,
      index: 0,
      highlighted: true,
      incognito: false,
      pinned: false,
      discarded: false,
      autoDiscardable: true,
    };
    callback?.(tab);
  });
  const tabsQuery = vi.fn((_queryInfo?: unknown, callback?: (tabs: any[]) => void) => {
    callback?.([]);
  });
  const tabsUpdate = vi.fn((tabId?: number, updateProperties?: { url?: string; active?: boolean }, callback?: (tab: any) => void) => {
    const tab = {
      id: typeof tabId === 'number' ? tabId : 42,
      url: updateProperties?.url ?? '',
      active: updateProperties?.active ?? true,
      windowId: 1,
      index: 0,
      highlighted: true,
      incognito: false,
      pinned: false,
      discarded: false,
      autoDiscardable: true,
    };
    callback?.(tab);
  });
  const tabsSendMessage = vi.fn((...args: unknown[]) => {
    const maybeCallback = args.find((arg) => typeof arg === 'function') as (() => void) | undefined;
    maybeCallback?.();
  });
  const windowsUpdate = vi.fn((_windowId?: number, _updateInfo?: unknown, callback?: (window: any) => void) => {
    callback?.({ id: 1 });
  });
  const runtimeGetURL = vi.fn((path: string) => `chrome-extension://test-id/${path}`);

  const mockChrome = {
    runtime: {
      lastError: undefined,
      getURL: runtimeGetURL,
      sendMessage: vi.fn(),
    },
    tabs: {
      create: tabsCreate,
      query: tabsQuery,
      update: tabsUpdate,
      sendMessage: tabsSendMessage,
      onUpdated: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    windows: {
      update: windowsUpdate,
    },
  } as any;

  (globalThis as any).chrome = mockChrome;

  return { tabsCreate, tabsQuery, tabsUpdate, tabsSendMessage, windowsUpdate, runtimeGetURL };
};

describe('openDashboard parameter handling', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = installChromeMocks();
  });

  afterEach(() => {
    delete (globalThis as any).chrome;
  });

  it('sanitizes search query and trims control characters', async () => {
    await openDashboard({ q: '  Playwright\u0000 Rocks  ' });

    expect(mocks.tabsCreate).toHaveBeenCalledTimes(1);
    const [{ url }] = mocks.tabsCreate.mock.calls[0] ?? [{}];
    expect(url).toContain('dashboard.html?q=Playwright+Rocks');
    expect(url).not.toMatch(/\u0000/);
  });

  it('normalizes new bookmark parameters and de-duplicates tags', async () => {
    await openDashboard({
      new: '1',
      url: 'Example.com/path?b=2&a=1',
      title: '  Hello World  ',
      tags: ['Design', 'design', ' Ops '],
      hash: '##section\u0008',
    });

    expect(mocks.tabsCreate).toHaveBeenCalledTimes(1);
    const [{ url }] = mocks.tabsCreate.mock.calls[0] ?? [{}];
    expect(url).toContain('new=1');
    expect(url).toContain('title=Hello+World');
    expect(url).toContain('url=https%3A%2F%2Fexample.com%2Fpath%3Fb%3D2%26a%3D1');
    expect(url).toContain('tags=Design%2COps');
    expect(url?.endsWith('#section')).toBe(true);

    expect(mocks.tabsSendMessage).toHaveBeenCalledTimes(1);
    const [, message] = mocks.tabsSendMessage.mock.calls[0] ?? [];
    expect(message).toEqual({
      type: 'OPEN_NEW_WITH_PREFILL',
      payload: { url: 'https://example.com/path?b=2&a=1', title: 'Hello World', tags: ['Design', 'Ops'] },
    });
  });

  it('rejects when provided with an invalid URL for prefill', async () => {
    await expect(openDashboard({ new: '1', url: 'nota url' })).rejects.toThrow('Bitte eine gültige URL eingeben.');
  });

  it('reuses an existing dashboard tab when possible without forcing navigation', async () => {
    mocks.tabsQuery.mockImplementation((_queryInfo: unknown, callback?: (tabs: any[]) => void) => {
      callback?.([
        {
          id: 99,
          url: 'chrome-extension://test-id/dashboard.html',
          active: true,
          windowId: 7,
          index: 0,
          highlighted: true,
          incognito: false,
          pinned: false,
          discarded: false,
          autoDiscardable: true,
        },
      ]);
    });

    await openDashboard({ q: 'recent' });

    expect(mocks.tabsUpdate).toHaveBeenCalledWith(99, { active: true }, expect.any(Function));
    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(99, { type: 'FOCUS_SEARCH', payload: { q: 'recent' } }, expect.any(Function));
  });
});
