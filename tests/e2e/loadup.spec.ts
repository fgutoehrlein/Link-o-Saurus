import { BrowserContext, ConsoleMessage, chromium, expect, test } from '@playwright/test';
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

test.describe('Link-O-Saurus extension loadup', () => {
  let context: BrowserContext | undefined;
  let extensionId: string;

  test.beforeAll(async () => {
    await fs.access(extensionPath);

    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-sandbox',
      ],
    });

    const worker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const workerUrl = new URL(worker.url());
    extensionId = workerUrl.host;
  });

  test.afterAll(async () => {
    if (context) {
      await context.close();
    }
  });

  test('loads the popup without console or runtime errors', async () => {
    if (!context) {
      throw new Error('Persistent Chromium context failed to initialize');
    }

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const page = await context.newPage();

    page.on('console', (message: ConsoleMessage) => {
      console.log(`[popup console] ${message.type()}: ${message.text()}`);
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    page.on('pageerror', (error: Error) => {
      console.error('[popup error]', error);
      pageErrors.push(error.message);
    });

    await page.goto(`chrome-extension://${extensionId}/popup/index.html?e2e=1&loadup=1`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () => window.__LINKOSAURUS_POPUP_READY === true,
      undefined,
      { timeout: 30_000 },
    );

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);

    await page.close();
  });
});
