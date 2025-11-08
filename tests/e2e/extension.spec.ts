import {
  BrowserContext,
  ConsoleMessage,
  Page,
  chromium,
  expect,
  test,
} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    __LINKOSAURUS_DASHBOARD_READY?: boolean;
    __LINKOSAURUS_DASHBOARD_READY_TIME?: number;
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

    const [dashboardPage] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: 'Zum Dashboard' }).click(),
    ]);
    await dashboardPage.waitForLoadState('domcontentloaded');
    expect(new URL(dashboardPage.url()).pathname).toBe('/dashboard.html');
    await dashboardPage.close();

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

    await popupPage.close();
    await newTabPage.close();
  });
});

async function openPopup(page: Page, extensionId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/popup.html?e2e=1`);
  await page.waitForLoadState('domcontentloaded');
}
