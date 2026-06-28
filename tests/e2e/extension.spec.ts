import {
  BrowserContext,
  ConsoleMessage,
  Page,
  chromium,
  expect,
  test,
} from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    __LINKOSAURUS_OPENED_TABS?: string[];
  }
}

const extensionPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'dist',
  'chrome',
);

test.describe.configure({ mode: 'serial' });

test.describe('Link-O-Saurus extension', () => {
  let context: BrowserContext;
  let extensionId: string;

  test.beforeAll(async () => {
    await fs.access(extensionPath);

    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    await context.addInitScript(() => {
      const anyWindow = window as any;

      anyWindow.chrome = anyWindow.chrome ?? {};
      const chromeRuntime = (anyWindow.chrome.runtime = anyWindow.chrome.runtime ?? {});
      if (typeof chromeRuntime.getURL !== 'function') {
        chromeRuntime.getURL = (path: string) => `chrome-extension://${location.host}/${path}`;
      }
      chromeRuntime.sendMessage = chromeRuntime.sendMessage ?? (() => {});
      Object.defineProperty(chromeRuntime, 'lastError', {
        configurable: true,
        enumerable: true,
        get: () => undefined,
        set: () => undefined,
      });

      anyWindow.chrome.permissions = {
        contains: (_request: unknown, callback: (result: boolean) => void) => callback(true),
        request: (_request: unknown, callback: (granted: boolean) => void) => callback(true),
      };

      const sessionTabs = Array.from({ length: 10 }, (_value: unknown, index: number) => ({
        id: index + 1,
        url: `https://session.example/${index + 1}`,
        title: `Session Tab ${index + 1}`,
        favIconUrl: '',
        windowId: 1,
        index,
        active: index === 0,
        highlighted: index === 0,
        lastAccessed: Date.now() - index * 1000,
        pinned: false,
        discarded: false,
        autoDiscardable: true,
        incognito: false,
      }));

      const openedTabs: string[] = [];
      anyWindow.__LINKOSAURUS_OPENED_TABS = openedTabs;

      anyWindow.chrome.tabs = {
        query: (queryInfo: any, callback: (tabs: any[]) => void) => {
          if (queryInfo && queryInfo.url) {
            callback([]);
            return;
          }
          callback(sessionTabs);
        },
        create: (createProperties: any, callback?: (tab: any) => void) => {
          const tab = {
            id: Math.floor(Math.random() * 10_000) + 100,
            url: typeof createProperties?.url === 'string' ? createProperties.url : '',
            active: createProperties?.active ?? true,
            windowId: 1,
            index: 0,
            highlighted: true,
            lastAccessed: Date.now(),
            incognito: false,
            pinned: false,
            discarded: false,
            autoDiscardable: true,
          };
          if (tab.url) {
            openedTabs.push(tab.url);
          }
          callback?.(tab);
        },
        update: (tabId: number, updateProperties: any, callback?: (tab: any) => void) => {
          const tab = {
            id: typeof tabId === 'number' ? tabId : Math.floor(Math.random() * 10_000) + 200,
            url: typeof updateProperties?.url === 'string' ? updateProperties.url : '',
            active: updateProperties?.active ?? true,
            windowId: 1,
            index: 0,
            highlighted: true,
            lastAccessed: Date.now(),
            incognito: false,
            pinned: false,
            discarded: false,
            autoDiscardable: true,
          };
          callback?.(tab);
        },
        sendMessage: (_tabId: number, _message: unknown, callback?: () => void) => {
          callback?.();
        },
        onUpdated: {
          addListener: () => {},
          removeListener: () => {},
        },
      };

      anyWindow.chrome.windows = {
        update: (_windowId: number, _updateInfo: any, callback?: (window: any) => void) => {
          callback?.({ id: 1 });
        },
      };

      anyWindow.confirm = () => true;
    });

    const existingWorker = context.serviceWorkers()[0];
    const serviceWorker = existingWorker ?? (await context.waitForEvent('serviceworker'));
    const workerUrl = new URL(serviceWorker.url());
    extensionId = workerUrl.host;
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('supports quick add, recent list, and mini search workflows', async () => {
    const page = await context.newPage();
    page.on('console', (message: ConsoleMessage) => {
      console.log(`[sidepanel console] ${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error: Error) => {
      console.error('[sidepanel error]', error);
    });

    await openSidePanel(page, extensionId);
    await page.waitForFunction(() => window.__LINKOSAURUS_POPUP_READY === true);

    const uniqueSuffix = Date.now();
    const newBookmarkTitle = `Playwright Handbook ${uniqueSuffix}`;
    const newBookmarkUrl = `https://playwright.dev/${uniqueSuffix}`;
    const adjacentBookmarkTitle = `Playwright Layout Check ${uniqueSuffix}`;
    const adjacentBookmarkUrl = `https://playwright.dev/layout-${uniqueSuffix}`;

    await page.getByRole('button', { name: 'Details' }).click();
    await page.getByLabel('Titel').fill(newBookmarkTitle);
    await page.getByLabel('URL').fill(newBookmarkUrl);
    const saveButton = page.getByRole('button', { name: 'Bookmark speichern' });
    const isSaveEnabled = await saveButton.isEnabled();
    if (isSaveEnabled) {
      await saveButton.click();
      await expect(page.locator('.status.status--success')).toContainText('Gespeichert.');
    } else {
      await page.evaluate(
        ({ title, url }) =>
          window.__LINKOSAURUS_POPUP_HARNESS?.addBookmark({
            title,
            url,
          }),
        { title: newBookmarkTitle, url: newBookmarkUrl },
      );
    }

    await page.waitForFunction(
      () => typeof window.__LINKOSAURUS_POPUP_HARNESS?.addBookmark === 'function',
    );
    await page.evaluate(
      ({ title, url }) =>
        window.__LINKOSAURUS_POPUP_HARNESS?.addBookmark({
          title,
          url,
        }),
      { title: adjacentBookmarkTitle, url: adjacentBookmarkUrl },
    );

    await page.waitForFunction(
      async (expectedTitles: string[]) => {
        const titles = await window.__LINKOSAURUS_POPUP_HARNESS?.visibleTitles(20);
        return Array.isArray(titles) && expectedTitles.every((title) => titles.includes(title));
      },
      [newBookmarkTitle, adjacentBookmarkTitle],
    );

    const collapseDetailsButton = page.getByRole('button', { name: 'Weniger' });
    if (await collapseDetailsButton.isVisible()) {
      await collapseDetailsButton.click();
    }

    const searchField = page.getByPlaceholder('Bookmarks durchsuchen (/)');
    await searchField.fill('Playwright');
    await expect(page.locator('.access-list')).toContainText(newBookmarkTitle);
    await expect(page.locator('.access-list')).toContainText(adjacentBookmarkTitle);

    const visibleSearchResults = page.locator('.access-list .access-item:visible');
    await expect.poll(() => visibleSearchResults.count()).toBeGreaterThanOrEqual(2);

    const resultGap = await visibleSearchResults.evaluateAll((items) => {
      const [firstItem, secondItem] = items.slice(0, 2);
      if (!firstItem || !secondItem) {
        throw new Error('Expected at least two visible search results for layout measurement.');
      }

      const firstBox = firstItem.getBoundingClientRect();
      const secondBox = secondItem.getBoundingClientRect();

      return secondBox.top - firstBox.bottom;
    });
    expect(resultGap).toBeGreaterThanOrEqual(0);
    expect(resultGap).toBeLessThanOrEqual(16);

    await page.getByRole('button', { name: 'Dashboard' }).click();
    const targetUrl = await page.evaluate(() => {
      const opened = window.__LINKOSAURUS_OPENED_TABS ?? [];
      return opened[opened.length - 1];
    });
    expect(targetUrl).toBeDefined();
    expect(targetUrl).toContain('/dashboard.html');

    await page.close();
  });

  test('meets side panel and dashboard performance budgets', async () => {
    const sidePanelPage = await context.newPage();
    await openSidePanel(sidePanelPage, extensionId);
    await sidePanelPage.waitForLoadState('load');

    const sidePanelMetrics = await sidePanelPage.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      const readyTime = window.__LINKOSAURUS_POPUP_READY_TIME ?? nav?.domInteractive ?? Number.POSITIVE_INFINITY;
      return {
        domInteractive: nav?.domInteractive ?? Number.POSITIVE_INFINITY,
        readyTime,
      };
    });

    expect(sidePanelMetrics.domInteractive).toBeLessThanOrEqual(100);
    expect(sidePanelMetrics.readyTime).toBeLessThanOrEqual(100);

    const newTabPage = await context.newPage();
    await newTabPage.goto(`chrome-extension://${extensionId}/dashboard.html?e2e=1`);
    await newTabPage.waitForFunction(() => window.__LINKOSAURUS_DASHBOARD_READY === true);

    const newTabMetrics = await newTabPage.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      const readyTime = window.__LINKOSAURUS_DASHBOARD_READY_TIME ?? nav?.domInteractive ?? Number.POSITIVE_INFINITY;
      return {
        domInteractive: nav?.domInteractive ?? Number.POSITIVE_INFINITY,
        readyTime,
      };
    });

    expect(newTabMetrics.domInteractive).toBeLessThanOrEqual(300);
    expect(newTabMetrics.readyTime).toBeLessThanOrEqual(300);

    await sidePanelPage.close();
    await newTabPage.close();
  });

  test('toggles the tag sidebar with the Tags button', async () => {
    const sidePanelHarnessPage = await context.newPage();
    await openSidePanel(sidePanelHarnessPage, extensionId);
    await sidePanelHarnessPage.waitForFunction(
      () =>
        window.__LINKOSAURUS_POPUP_READY === true &&
        typeof window.__LINKOSAURUS_POPUP_HARNESS?.addBookmark === 'function',
    );

    const tagNames = Array.from({ length: 5 }, (_value, index) => `tag-toggle-${index + 1}`);
    await sidePanelHarnessPage.evaluate((tags) => {
      return Promise.all(
        tags.map((tag, index) =>
          window.__LINKOSAURUS_POPUP_HARNESS?.addBookmark({
            title: `Tag Toggle ${index + 1}`,
            url: `https://tags.example/${index + 1}`,
            tags: [tag],
          }),
        ),
      );
    }, tagNames);
    await sidePanelHarnessPage.close();

    const dashboardPage = await context.newPage();
    await dashboardPage.goto(`chrome-extension://${extensionId}/dashboard.html?e2e=1`);
    await dashboardPage.waitForFunction(() => window.__LINKOSAURUS_DASHBOARD_READY === true);

    const tagItems = dashboardPage.locator('.sidebar-tag-list .tag-item');
    for (const tagName of tagNames) {
      await expect(tagItems.filter({ hasText: tagName })).toBeVisible();
    }

    const tagsButton = dashboardPage.getByRole('button', { name: 'Tags-Leiste einklappen' });
    await expect(tagsButton).toBeVisible();
    await tagsButton.click();

    const expandTagsButton = dashboardPage.getByRole('button', { name: 'Tags-Leiste erweitern' });
    await expect(expandTagsButton).toBeVisible();
    await expect(dashboardPage.locator('.sidebar-tag-list .tag-item')).toHaveCount(0);

    await expandTagsButton.click();
    await expect(dashboardPage.getByRole('button', { name: 'Tags-Leiste einklappen' })).toBeVisible();
    for (const tagName of tagNames) {
      await expect(tagItems.filter({ hasText: tagName })).toBeVisible();
    }

    await dashboardPage.close();
  });

  test('supports dashboard deep links, bulk import, and session workflows', async () => {
    const sidePanelHarnessPage = await context.newPage();
    await openSidePanel(sidePanelHarnessPage, extensionId);
    await sidePanelHarnessPage.waitForFunction(
      () => window.__LINKOSAURUS_POPUP_READY === true && typeof window.__LINKOSAURUS_POPUP_HARNESS?.addBookmark === 'function',
    );

    const deepLinkTitle = `Deep Link ${Date.now()}`;
    const deepLinkUrl = `https://deeplink.example/${Date.now()}`;
    await sidePanelHarnessPage.evaluate(
      ([title, url]) => window.__LINKOSAURUS_POPUP_HARNESS?.addBookmark({ title, url }),
      [deepLinkTitle, deepLinkUrl],
    );
    await sidePanelHarnessPage.close();

    const dashboardPage = await context.newPage();
    await dashboardPage.goto(`chrome-extension://${extensionId}/dashboard.html#/?q=${encodeURIComponent('Deep Link')}`);
    await dashboardPage.waitForFunction(() => window.__LINKOSAURUS_DASHBOARD_READY === true);

    const dashboardSearch = dashboardPage.getByLabel('Dashboard durchsuchen');
    await expect(dashboardSearch).toHaveValue('Deep Link');
    await expect(dashboardPage.locator('.bookmark-list')).toContainText(/Keine Einträge gefunden|Deep Link/);

    const importFixture = await createImportFixture(2000);
    const pagesBeforeOpen = new Set(context.pages());
    await dashboardPage.getByRole('button', { name: 'In Einstellungen öffnen' }).click();
    const settingsPage = await (async () => {
      const timeoutAt = Date.now() + 15_000;
      while (Date.now() < timeoutAt) {
        const existing = context.pages().find((page) => /\/options\.html/.test(page.url()));
        if (existing) {
          return existing;
        }

        const created = context.pages().find((page) => !pagesBeforeOpen.has(page) && page !== dashboardPage);
        if (created) {
          await created.waitForLoadState('domcontentloaded');
          if (/\/options\.html/.test(created.url())) {
            return created;
          }
        }

        await dashboardPage.waitForTimeout(100);
      }

      throw new Error('Settings page did not open after clicking "In Einstellungen öffnen".');
    })();

    await settingsPage.waitForLoadState('domcontentloaded');
    await settingsPage.waitForURL(/options\.html/);
    await expect(settingsPage.getByRole('heading', { name: 'Import' })).toBeVisible();
    await settingsPage.locator('input[type="file"][accept="application/json,.json"]').setInputFiles(importFixture.filePath);
    await expect
      .poll(() => countBookmarksByUrlPrefix(settingsPage, importFixture.urlPrefix), { timeout: 60_000 })
      .toBe(importFixture.count);
    await settingsPage.close();

    await dashboardPage.reload();
    await dashboardPage.waitForFunction(() => window.__LINKOSAURUS_DASHBOARD_READY === true);

    await expect(dashboardPage.locator('.list-header h2')).toContainText(/Bookmarks \(20/);

    await dashboardPage.getByRole('button', { name: 'Sessions' }).click();
    const sessionModal = dashboardPage.locator('.modal:has-text("Sessions")');
    await sessionModal.waitFor();

    await dashboardPage.evaluate(() => {
      window.__LINKOSAURUS_OPENED_TABS?.splice(0, window.__LINKOSAURUS_OPENED_TABS.length);
    });

    await sessionModal.getByRole('button', { name: 'Aktuelle Tabs speichern' }).click();
    await expect(dashboardPage.locator('.status')).toContainText('Session gespeichert.');

    const savedSession = sessionModal.locator('.session-list li').first();
    await expect(savedSession).toContainText('10 Tabs');

    const openedBefore = await dashboardPage.evaluate(() => window.__LINKOSAURUS_OPENED_TABS?.length ?? 0);
    await savedSession.getByRole('button', { name: 'Öffnen' }).click();
    await expect(dashboardPage.locator('.status')).toContainText('Session geöffnet.');
    await dashboardPage.waitForFunction(
      (previousCount) => (window.__LINKOSAURUS_OPENED_TABS?.length ?? 0) > previousCount,
      openedBefore,
      { timeout: 5000 },
    );
    const openedCount = await dashboardPage.evaluate(() => window.__LINKOSAURUS_OPENED_TABS?.length ?? 0);
    expect(openedCount).toBeGreaterThanOrEqual(10);

    await savedSession.getByRole('button', { name: 'Löschen' }).click();
    await expect(dashboardPage.locator('.status')).toContainText('Session gelöscht.');
    await expect(sessionModal.locator('.session-list li')).toHaveCount(0);
    await sessionModal.getByRole('button', { name: 'Schließen' }).click();

    await dashboardPage.close();
  });
});

async function openSidePanel(page: Page, extensionId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html?e2e=1`);
  await page.waitForLoadState('domcontentloaded');
}

type ImportFixture = {
  readonly count: number;
  readonly filePath: string;
  readonly urlPrefix: string;
};

async function createImportFixture(count: number): Promise<ImportFixture> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linkosaurus-import-'));
  const filePath = path.join(dir, 'bulk-import.json');
  const now = Date.now();
  const urlPrefix = `https://bulk.example/${now}`;
  const payload = {
    format: 'link-o-saurus' as const,
    version: 1 as const,
    exportedAt: new Date(now).toISOString(),
    boards: [] as const,
    categories: [] as const,
    bookmarks: Array.from({ length: count }, (_, index) => ({
      id: `seed-${now}-${index}`,
      url: `${urlPrefix}/${index}`,
      title: `Imported Bookmark ${index}`,
      notes: '',
      tags: ['bulk'],
      createdAt: now,
      updatedAt: now,
      archived: false,
      pinned: false,
      visitCount: 0,
    })),
  };
  await fs.writeFile(filePath, JSON.stringify(payload), 'utf8');
  return { count, filePath, urlPrefix };
}

async function countBookmarksByUrlPrefix(page: Page, urlPrefix: string): Promise<number> {
  return page.evaluate(async (prefix) => {
    return new Promise<number>((resolve, reject) => {
      const request = indexedDB.open('link-o-saurus');

      request.onerror = () => reject(request.error ?? new Error('Failed to open Link-O-Saurus IndexedDB.'));
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('bookmarks', 'readonly');
        const store = transaction.objectStore('bookmarks');
        const cursorRequest = store.openCursor();
        let count = 0;

        cursorRequest.onerror = () => {
          database.close();
          reject(cursorRequest.error ?? new Error('Failed to count imported bookmarks.'));
        };

        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) {
            database.close();
            resolve(count);
            return;
          }

          const url = typeof cursor.value?.url === 'string' ? cursor.value.url : '';
          if (url.startsWith(prefix)) {
            count += 1;
          }
          cursor.continue();
        };
      };
    });
  }, urlPrefix);
}
