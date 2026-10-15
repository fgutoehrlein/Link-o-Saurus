import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGitHubSyncSettings, saveGitHubSyncSettings } from './settings';

describe('GitHub sync settings', () => {
  let stored: Record<string, unknown>;

  beforeEach(() => {
    stored = {};
    vi.stubGlobal('chrome', { storage: { local: {
      get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
      set: vi.fn(async (value: Record<string, unknown>) => { stored = { ...stored, ...value }; }),
    } } });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('defaults the sync file path and saves selected repository settings', async () => {
    expect(await getGitHubSyncSettings()).toEqual({ owner: '', repo: '', branch: '', path: 'link-o-saurus/sync.json' });
    await saveGitHubSyncSettings({ owner: 'me', repo: 'links', branch: 'main' });
    expect(await getGitHubSyncSettings()).toEqual({ owner: 'me', repo: 'links', branch: 'main', path: 'link-o-saurus/sync.json' });
  });
});
