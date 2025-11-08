import type { SessionPack } from './types';

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    __LINKOSAURUS_TEST_CHANNEL?: (
      message: BackgroundRequest,
    ) => Promise<BackgroundResponseSuccess>;
  }
  // eslint-disable-next-line no-var
  var __LINKOSAURUS_TEST_CHANNEL: ((
    message: BackgroundRequest,
  ) => Promise<BackgroundResponseSuccess>) | undefined;
}

type SessionMessageType =
  | 'session.saveCurrentWindow'
  | 'session.openAll'
  | 'session.openSelected'
  | 'session.delete'
  | 'settings.applyNewTab'
  | 'readLater.refreshBadge';

type SessionResponseType =
  | 'session.saveCurrentWindow.result'
  | 'session.openAll.result'
  | 'session.openSelected.result'
  | 'session.delete.result'
  | 'settings.applyNewTab.result'
  | 'readLater.refreshBadge.result'
  | 'session.error';

export type BackgroundRequest =
  | { type: 'session.saveCurrentWindow'; title?: string }
  | { type: 'session.openAll'; sessionId: string }
  | { type: 'session.openSelected'; sessionId: string; tabIndexes: number[] }
  | { type: 'session.delete'; sessionId: string }
  | { type: 'settings.applyNewTab'; enabled: boolean }
  | { type: 'readLater.refreshBadge' };

export type BackgroundResponse =
  | { type: 'session.saveCurrentWindow.result'; session: SessionPack }
  | { type: 'session.openAll.result'; opened: number }
  | { type: 'session.openSelected.result'; opened: number }
  | { type: 'session.delete.result'; sessionId: string }
  | { type: 'settings.applyNewTab.result'; enabled: boolean }
  | { type: 'readLater.refreshBadge.result'; count: number }
  | { type: 'session.error'; error: string };

export type BackgroundResponseSuccess = Exclude<BackgroundResponse, { type: 'session.error' }>;

export type Message =
  | { type: 'OPEN_NEW_WITH_PREFILL'; payload: { url: string; title?: string; tags?: string[] } }
  | { type: 'FOCUS_SEARCH'; payload: { q: string } };

const MESSAGE_TYPES: ReadonlySet<SessionMessageType> = new Set([
  'session.saveCurrentWindow',
  'session.openAll',
  'session.openSelected',
  'session.delete',
  'settings.applyNewTab',
  'readLater.refreshBadge',
]);

const RESPONSE_TYPES: ReadonlySet<SessionResponseType> = new Set([
  'session.saveCurrentWindow.result',
  'session.openAll.result',
  'session.openSelected.result',
  'session.delete.result',
  'session.error',
  'settings.applyNewTab.result',
  'readLater.refreshBadge.result',
]);

export const isBackgroundRequest = (value: unknown): value is BackgroundRequest => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { type?: unknown };
  if (typeof candidate.type !== 'string') {
    return false;
  }
  return MESSAGE_TYPES.has(candidate.type as SessionMessageType);
};

export const isBackgroundResponse = (value: unknown): value is BackgroundResponse => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { type?: unknown };
  if (typeof candidate.type !== 'string') {
    return false;
  }
  return RESPONSE_TYPES.has(candidate.type as SessionResponseType);
};

export const sendBackgroundMessage = async (
  message: BackgroundRequest,
): Promise<BackgroundResponseSuccess> =>
  new Promise<BackgroundResponseSuccess>((resolve, reject) => {
    const testChannel = globalThis.__LINKOSAURUS_TEST_CHANNEL;
    if (typeof testChannel === 'function') {
      testChannel(message)
        .then(resolve)
        .catch(reject);
      return;
    }

    chrome.runtime.sendMessage(message, (rawResponse) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }

      if (!isBackgroundResponse(rawResponse)) {
        reject(new Error('Unerwartete Antwort vom Hintergrundskript.'));
        return;
      }

      if (rawResponse.type === 'session.error') {
        reject(new Error(rawResponse.error));
        return;
      }

      resolve(rawResponse);
    });
  });

export const isDashboardMessage = (value: unknown): value is Message => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { type?: unknown; payload?: unknown };
  if (candidate.type === 'OPEN_NEW_WITH_PREFILL') {
    if (!candidate.payload || typeof candidate.payload !== 'object') {
      return false;
    }
    const payload = candidate.payload as { url?: unknown; title?: unknown; tags?: unknown };
    if (typeof payload.url !== 'string' || !payload.url) {
      return false;
    }
    if (
      typeof payload.title !== 'undefined' &&
      typeof payload.title !== 'string'
    ) {
      return false;
    }
    if (
      typeof payload.tags !== 'undefined' &&
      (!Array.isArray(payload.tags) || payload.tags.some((tag) => typeof tag !== 'string'))
    ) {
      return false;
    }
    return true;
  }
  if (candidate.type === 'FOCUS_SEARCH') {
    if (!candidate.payload || typeof candidate.payload !== 'object') {
      return false;
    }
    const payload = candidate.payload as { q?: unknown };
    return typeof payload.q === 'string';
  }
  return false;
};
