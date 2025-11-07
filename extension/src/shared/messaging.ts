import type { SessionPack } from './types';

type SessionMessageType =
  | 'session.saveCurrentWindow'
  | 'session.openAll'
  | 'session.openSelected'
  | 'session.delete'
  | 'settings.applyNewTab';

type SessionResponseType =
  | 'session.saveCurrentWindow.result'
  | 'session.openAll.result'
  | 'session.openSelected.result'
  | 'session.delete.result'
  | 'settings.applyNewTab.result'
  | 'session.error';

export type BackgroundRequest =
  | { type: 'session.saveCurrentWindow'; title?: string }
  | { type: 'session.openAll'; sessionId: string }
  | { type: 'session.openSelected'; sessionId: string; tabIndexes: number[] }
  | { type: 'session.delete'; sessionId: string }
  | { type: 'settings.applyNewTab'; enabled: boolean };

export type BackgroundResponse =
  | { type: 'session.saveCurrentWindow.result'; session: SessionPack }
  | { type: 'session.openAll.result'; opened: number }
  | { type: 'session.openSelected.result'; opened: number }
  | { type: 'session.delete.result'; sessionId: string }
  | { type: 'settings.applyNewTab.result'; enabled: boolean }
  | { type: 'session.error'; error: string };

export type BackgroundResponseSuccess = Exclude<BackgroundResponse, { type: 'session.error' }>;

const MESSAGE_TYPES: ReadonlySet<SessionMessageType> = new Set([
  'session.saveCurrentWindow',
  'session.openAll',
  'session.openSelected',
  'session.delete',
  'settings.applyNewTab',
]);

const RESPONSE_TYPES: ReadonlySet<SessionResponseType> = new Set([
  'session.saveCurrentWindow.result',
  'session.openAll.result',
  'session.openSelected.result',
  'session.delete.result',
  'session.error',
  'settings.applyNewTab.result',
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
