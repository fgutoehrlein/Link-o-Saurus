const STORAGE_KEY = 'github-sync-auth';

export type StoredGitHubAuth =
  | { mode: 'pat'; token: string }
  | {
      mode: 'github-app';
      clientId: string;
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      refreshTokenExpiresAt?: number;
    };

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type DeviceAuthorizationPoll = { status: 'pending'; interval: number } | { status: 'authorized' };

const getStorage = (): chrome.storage.LocalStorageArea => {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    throw new Error('Extension local storage is unavailable');
  }
  return chrome.storage.local;
};

const postForm = async (url: string, parameters: Record<string, string>): Promise<Record<string, unknown>> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(parameters),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== 'object') {
    throw new Error(`GitHub authentication failed (${response.status})`);
  }
  return body as Record<string, unknown>;
};

export const getStoredGitHubAuth = async (): Promise<StoredGitHubAuth | undefined> => {
  const result = await getStorage().get(STORAGE_KEY);
  const auth: unknown = result[STORAGE_KEY];
  if (!auth || typeof auth !== 'object') return undefined;
  const value = auth as Partial<StoredGitHubAuth>;
  if (value.mode === 'pat' && typeof value.token === 'string') return value as StoredGitHubAuth;
  if (value.mode === 'github-app' && typeof value.clientId === 'string' && typeof value.accessToken === 'string') {
    return value as StoredGitHubAuth;
  }
  return undefined;
};

export const savePatToken = async (input: string): Promise<void> => {
  const token = input.trim();
  if (!token) throw new Error('GitHub token must not be empty');
  await getStorage().set({ [STORAGE_KEY]: { mode: 'pat', token } satisfies StoredGitHubAuth });
};

export const disconnectGitHub = async (): Promise<void> => {
  await getStorage().remove(STORAGE_KEY);
};

export const startDeviceAuthorization = async (clientId: string): Promise<DeviceAuthorization> => {
  if (!clientId.trim()) throw new Error('GitHub App client ID is not configured');
  const body = await postForm('https://github.com/login/device/code', { client_id: clientId.trim() });
  if (typeof body.device_code !== 'string'
    || typeof body.user_code !== 'string'
    || typeof body.verification_uri !== 'string'
    || typeof body.expires_in !== 'number'
    || typeof body.interval !== 'number') {
    throw new Error('GitHub returned an invalid device authorization response');
  }
  const verification = new URL(body.verification_uri);
  if (verification.protocol !== 'https:' || verification.hostname !== 'github.com') {
    throw new Error('GitHub returned an unexpected verification URL');
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: verification.toString(),
    expiresIn: body.expires_in,
    interval: body.interval,
  };
};

export const pollDeviceAuthorization = async (
  clientId: string,
  deviceCode: string,
  interval: number,
): Promise<DeviceAuthorizationPoll> => {
  const body = await postForm('https://github.com/login/oauth/access_token', {
    client_id: clientId,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (body.error === 'authorization_pending') return { status: 'pending', interval };
  if (body.error === 'slow_down') return { status: 'pending', interval: interval + 5 };
  if (body.error === 'expired_token') throw new Error('GitHub device code expired; start sign-in again');
  if (body.error === 'access_denied') throw new Error('GitHub sign-in was denied');
  if (typeof body.access_token !== 'string' || !body.access_token) {
    throw new Error('GitHub returned an invalid access token response');
  }
  const now = Date.now();
  const auth: StoredGitHubAuth = {
    mode: 'github-app',
    clientId,
    accessToken: body.access_token,
    ...(typeof body.refresh_token === 'string' ? { refreshToken: body.refresh_token } : {}),
    ...(typeof body.expires_in === 'number' ? { expiresAt: now + body.expires_in * 1000 } : {}),
    ...(typeof body.refresh_token_expires_in === 'number'
      ? { refreshTokenExpiresAt: now + body.refresh_token_expires_in * 1000 }
      : {}),
  };
  await getStorage().set({ [STORAGE_KEY]: auth });
  return { status: 'authorized' };
};

export const getGitHubAccessToken = async (): Promise<string> => {
  const auth = await getStoredGitHubAuth();
  if (!auth) throw new Error('Connect a GitHub account or save a PAT first');
  if (auth.mode === 'pat') return auth.token;
  if (!auth.expiresAt || auth.expiresAt > Date.now() + 30_000) return auth.accessToken;
  if (!auth.refreshToken || (auth.refreshTokenExpiresAt && auth.refreshTokenExpiresAt <= Date.now())) {
    throw new Error('GitHub authorization expired; connect again');
  }
  const body = await postForm('https://github.com/login/oauth/access_token', {
    client_id: auth.clientId,
    grant_type: 'refresh_token',
    refresh_token: auth.refreshToken,
  });
  if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
    throw new Error('GitHub returned an invalid refreshed token');
  }
  const refreshed: StoredGitHubAuth = {
    mode: 'github-app',
    clientId: auth.clientId,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    ...(typeof body.expires_in === 'number' ? { expiresAt: Date.now() + body.expires_in * 1000 } : {}),
    ...(typeof body.refresh_token_expires_in === 'number'
      ? { refreshTokenExpiresAt: Date.now() + body.refresh_token_expires_in * 1000 }
      : {}),
  };
  await getStorage().set({ [STORAGE_KEY]: refreshed });
  return refreshed.accessToken;
};
