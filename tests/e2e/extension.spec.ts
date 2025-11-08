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

  test('supports bookmark, search, batch, import, and session workflows', async () => {
    const page = await context.newPage();
    page.on('console', (message: ConsoleMessage) => {
      console.log(`[popup console] ${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error: Error) => {
      console.error('[popup error]', error);
    });
    await openPopup(page, extensionId);

    await page.waitForFunction(() => window.__LINKOSAURUS_POPUP_READY === true);

    const newBookmarkTitle = 'Playwright Handbook';
    await page.evaluate(async (title: string) => {
      const harness = window.__LINKOSAURUS_POPUP_HARNESS;
      if (!harness) {
        throw new Error('Popup harness unavailable');
      }
      await harness.addBookmark({ title, url: 'https://playwright.dev/' });
    }, newBookmarkTitle);

    await expect(page.getByText(newBookmarkTitle).first()).toBeVisible();

    const searchField = page.getByPlaceholder('Search bookmarks (/)');
    await searchField.fill('Playwright');
    await expect(page.locator('.bookmark-row')).toHaveCount(1);

    await searchField.fill('');
    await page.waitForTimeout(50);

    const rows = page.locator('.bookmark-row');
    await rows.nth(0).click();
    await page.keyboard.down('Shift');
    await rows.nth(2).click();
    await page.keyboard.up('Shift');

    await expect(page.locator('.toolbar-actions span').first()).toContainText('3 ausgewählt');

    const tagButton = page.getByRole('button', { name: 'Tag hinzufügen' });
    await expect(tagButton).toBeEnabled();
    await tagButton.click();
    await page.waitForTimeout(250);

    const selectedIds = await page.evaluate(async () => {
      const harness = window.__LINKOSAURUS_POPUP_HARNESS;
      if (!harness) {
        return [];
      }
      return harness.getSelectedIds();
    });
    expect(selectedIds.length).toBeGreaterThanOrEqual(3);

    const totalCount = await page.evaluate(async () => {
      const harness = window.__LINKOSAURUS_POPUP_HARNESS;
      if (!harness) {
        throw new Error('Popup harness unavailable');
      }
      return harness.importBulk(5000);
    });
    expect(totalCount).toBeGreaterThanOrEqual(5000);

    const sessionInput = page.getByLabel('Session-Titel');
    await sessionInput.fill('E2E Session');
    await page.getByRole('button', { name: 'Tabs sichern' }).click();

    const feedback = page.locator('.session-feedback');
    await expect(feedback).toContainText('Session mit');

    const sessionButton = page.getByRole('button', { name: /E2E Session/ });
    await sessionButton.click();

    const firstCheckbox = page.locator('.session-tab input[type="checkbox"]').first();
    await firstCheckbox.click();

    await page.getByRole('button', { name: 'Auswahl öffnen' }).click();
    await expect(feedback).toContainText('Tabs geöffnet.');

    await page.locator('.session-detail').getByRole('button', { name: 'Löschen' }).click();
    await expect(feedback).toHaveText('Session gelöscht.');

    await page.close();
  });

  test('meets popup and new tab performance budgets', async () => {
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
    await newTabPage.goto(`chrome-extension://${extensionId}/newtab/index.html?e2e=1`);
    await newTabPage.waitForFunction(() => window.__LINKOSAURUS_NEWTAB_READY === true);

    const newTabMetrics = await newTabPage.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      const readyTime = window.__LINKOSAURUS_NEWTAB_READY_TIME ?? nav?.domInteractive ?? Number.POSITIVE_INFINITY;
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
  await page.goto(`chrome-extension://${extensionId}/popup/index.html?e2e=1`);
  await page.waitForLoadState('domcontentloaded');
}
