import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disconnectGitHub,
  getGitHubAccessToken,
  getStoredGitHubAuth,
  pollDeviceAuthorization,
  savePatToken,
  startDeviceAuthorization,
} from './auth';

describe('GitHub sync authentication', () => {
  let stored: Record<string, unknown>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stored = {};
    const local = {
      get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
      set: vi.fn(async (value: Record<string, unknown>) => Object.assign(stored, value)),
      remove: vi.fn(async (key: string) => { delete stored[key]; }),
    };
    vi.stubGlobal('chrome', { storage: { local } });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('saves a PAT locally and disconnect removes it', async () => {
    await savePatToken('github_pat_example');
    expect(await getGitHubAccessToken()).toBe('github_pat_example');
    expect(await getStoredGitHubAuth()).toMatchObject({ mode: 'pat' });
    await disconnectGitHub();
    expect(await getStoredGitHubAuth()).toBeUndefined();
  });

  it('starts GitHub App device authorization', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      device_code: 'device-code',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 600,
      interval: 5,
    }), { status: 200 }));

    const result = await startDeviceAuthorization('public-client-id');
    expect(result).toMatchObject({ deviceCode: 'device-code', userCode: 'ABCD-1234', interval: 5 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://github.com/login/device/code',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('handles pending and slow-down polling before saving the authorized token', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'slow_down' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'ghu_access',
        refresh_token: 'ghr_refresh',
        expires_in: 28_800,
        refresh_token_expires_in: 15_897_600,
      }), { status: 200 }));

    expect(await pollDeviceAuthorization('public-client-id', 'device-code', 5)).toEqual({ status: 'pending', interval: 5 });
    expect(await pollDeviceAuthorization('public-client-id', 'device-code', 5)).toEqual({ status: 'pending', interval: 10 });
    expect(await pollDeviceAuthorization('public-client-id', 'device-code', 10)).toEqual({ status: 'authorized' });
    expect(await getGitHubAccessToken()).toBe('ghu_access');
  });

  it('refreshes an expired GitHub App token without a client secret', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'ghu_old', refresh_token: 'ghr_old', expires_in: 1, refresh_token_expires_in: 60,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28_800, refresh_token_expires_in: 15_897_600,
      }), { status: 200 }));
    await pollDeviceAuthorization('public-client-id', 'device-code', 5);
    vi.setSystemTime(3_000);

    expect(await getGitHubAccessToken()).toBe('ghu_new');
    const refreshBody = String(fetchMock.mock.calls[1]?.[1]?.body);
    expect(refreshBody).toContain('grant_type=refresh_token');
    expect(refreshBody).not.toContain('client_secret');
  });
});
