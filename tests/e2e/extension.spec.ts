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
    await context.close();
  });

  test('supports quick add, recent list, and mini search workflows', async () => {
    const page = await context.newPage();
    page.on('console', (message: ConsoleMessage) => {
      console.log(`[popup console] ${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error: Error) => {
      console.error('[popup error]', error);
    });

    await openPopup(page, extensionId);
    await page.waitForFunction(() => window.__LINKOSAURUS_POPUP_READY === true);

    const uniqueSuffix = Date.now();
    const newBookmarkTitle = `Playwright Handbook ${uniqueSuffix}`;
    const newBookmarkUrl = `https://playwright.dev/${uniqueSuffix}`;

    await page.fill('#quick-add-title', newBookmarkTitle);
    await page.fill('#quick-add-url', newBookmarkUrl);
    await page.getByRole('button', { name: 'Bookmark speichern' }).click();

    await expect(page.locator('.status-success')).toContainText('Bookmark gespeichert.');

    const firstRecentItem = page.locator('.recent-item__title').first();
    await expect(firstRecentItem).toHaveText(newBookmarkTitle);

    const searchField = page.getByPlaceholder('Suchen (/)');
    await searchField.fill('Playwright');
    await expect(page.locator('.search-result__title')).toContainText(newBookmarkTitle);

    await page.getByRole('button', { name: 'Zum Dashboard' }).click();
    const targetUrl = await page.evaluate(() => {
      const opened = window.__LINKOSAURUS_OPENED_TABS ?? [];
      return opened[opened.length - 1];
    });
    expect(targetUrl).toBeDefined();
    expect(targetUrl).toContain('/dashboard.html');

    await page.close();
  });

  test('meets popup and dashboard performance budgets', async () => {
    const popupPage = await context.newPage();
    await openPopup(popupPage, extensionId);
    await popupPage.waitForLoadState('load');

    const popupMetrics = await popupPage.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      const readyTime = window.__LINKOSAURUS_POPUP_READY_TIME ?? nav?.domInteractive ?? Number.POSITIVE_INFINITY;
      return {
        domInteractive: nav?.domInteractive ?? Number.POSITIVE_INFINITY,
        readyTime,
      };
    });

    expect(popupMetrics.domInteractive).toBeLessThanOrEqual(100);
    expect(popupMetrics.readyTime).toBeLessThanOrEqual(100);

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

    await popupPage.close();
    await newTabPage.close();
  });

  test('supports dashboard deep links, bulk import, and session workflows', async () => {
    const popupHarnessPage = await context.newPage();
    await openPopup(popupHarnessPage, extensionId);
    await popupHarnessPage.waitForFunction(
      () => window.__LINKOSAURUS_POPUP_READY === true && typeof window.__LINKOSAURUS_POPUP_HARNESS?.addBookmark === 'function',
    );

    const deepLinkTitle = `Deep Link ${Date.now()}`;
    const deepLinkUrl = `https://deeplink.example/${Date.now()}`;
    await popupHarnessPage.evaluate(
      ([title, url]) => window.__LINKOSAURUS_POPUP_HARNESS?.addBookmark({ title, url }),
      [deepLinkTitle, deepLinkUrl],
    );
    await popupHarnessPage.close();

    const dashboardPage = await context.newPage();
    await dashboardPage.goto(`chrome-extension://${extensionId}/dashboard.html#/?q=${encodeURIComponent('Deep Link')}`);
    await dashboardPage.waitForFunction(() => window.__LINKOSAURUS_DASHBOARD_READY === true);

    const firstResult = dashboardPage.locator('.bookmark-row .bookmark-title').first();
    await expect(firstResult).toContainText('Deep Link');

    const importFile = await createImportFixture(2000);
    await dashboardPage.getByRole('button', { name: 'Import / Export' }).click();
    const importModal = dashboardPage.locator('.modal:has-text("Import & Export")');
    await importModal.waitFor();
    await importModal.locator('input[type="file"][accept="application/json,.json"]').setInputFiles(importFile);
    await expect
      .poll(
        async () => (await dashboardPage.locator('.status').textContent())?.trim(),
        { timeout: 60_000 },
      )
      .toContain('Import abgeschlossen (2000 neue Einträge).');
    await importModal.getByRole('button', { name: 'Schließen' }).click();

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

async function openPopup(page: Page, extensionId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/popup.html?e2e=1`);
  await page.waitForLoadState('domcontentloaded');
}

async function createImportFixture(count: number): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linkosaurus-import-'));
  const filePath = path.join(dir, 'bulk-import.json');
  const now = Date.now();
  const payload = {
    format: 'link-o-saurus' as const,
    version: 1 as const,
    exportedAt: new Date(now).toISOString(),
    boards: [] as const,
    categories: [] as const,
    bookmarks: Array.from({ length: count }, (_, index) => ({
      id: `seed-${index}`,
      url: `https://bulk.example/${index}`,
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
  return filePath;
}
