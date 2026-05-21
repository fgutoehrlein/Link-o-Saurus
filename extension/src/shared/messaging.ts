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

type QuickSaveTabMetadata = {
  readonly title?: string;
  readonly url?: string;
  readonly favIconUrl?: string;
};

type SessionMessageType =
  | 'quickSave.getActiveTab'
  | 'session.saveCurrentWindow'
  | 'session.openAll'
  | 'session.openSelected'
  | 'session.delete'
  | 'settings.applyNewTab'
  | 'readLater.refreshBadge'
  | 'sidePanel.open';

type SessionResponseType =
  | 'quickSave.getActiveTab.result'
  | 'session.saveCurrentWindow.result'
  | 'session.openAll.result'
  | 'session.openSelected.result'
  | 'session.delete.result'
  | 'settings.applyNewTab.result'
  | 'readLater.refreshBadge.result'
  | 'sidePanel.open.result'
  | 'session.error';

export type BackgroundRequest =
  | { type: 'quickSave.getActiveTab' }
  | { type: 'session.saveCurrentWindow'; title?: string }
  | { type: 'session.openAll'; sessionId: string }
  | { type: 'session.openSelected'; sessionId: string; tabIndexes: number[] }
  | { type: 'session.delete'; sessionId: string }
  | { type: 'settings.applyNewTab'; enabled: boolean }
  | { type: 'readLater.refreshBadge' }
  | { type: 'sidePanel.open'; windowId?: number };

export type BackgroundResponse =
  | { type: 'quickSave.getActiveTab.result'; tab?: QuickSaveTabMetadata }
  | { type: 'session.saveCurrentWindow.result'; session: SessionPack }
  | { type: 'session.openAll.result'; opened: number }
  | { type: 'session.openSelected.result'; opened: number }
  | { type: 'session.delete.result'; sessionId: string }
  | { type: 'settings.applyNewTab.result'; enabled: boolean }
  | { type: 'readLater.refreshBadge.result'; count: number }
  | { type: 'sidePanel.open.result'; opened: boolean }
  | {
      type: 'session.error';
      error: string;
      code?:
        | 'INVALID_MESSAGE'
        | 'INVALID_PAYLOAD'
        | 'UNAUTHORIZED'
        | 'NOT_FOUND'
        | 'INTERNAL_ERROR';
      details?: string;
    };

export type BackgroundResponseSuccess = Exclude<BackgroundResponse, { type: 'session.error' }>;

export type Message =
  | { type: 'OPEN_NEW_WITH_PREFILL'; payload: { url: string; title?: string; tags?: string[] } }
  | { type: 'FOCUS_SEARCH'; payload: { q: string } };

const MESSAGE_TYPES: ReadonlySet<SessionMessageType> = new Set([
  'quickSave.getActiveTab',
  'session.saveCurrentWindow',
  'session.openAll',
  'session.openSelected',
  'session.delete',
  'settings.applyNewTab',
  'readLater.refreshBadge',
  'sidePanel.open',
]);

const RESPONSE_TYPES: ReadonlySet<SessionResponseType> = new Set([
  'quickSave.getActiveTab.result',
  'session.saveCurrentWindow.result',
  'session.openAll.result',
  'session.openSelected.result',
  'session.delete.result',
  'session.error',
  'settings.applyNewTab.result',
  'readLater.refreshBadge.result',
  'sidePanel.open.result',
]);

export const isBackgroundRequest = (value: unknown): value is BackgroundRequest => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return validateBackgroundRequest(value).ok;
};

type BackgroundRequestValidationResult =
  | { ok: true; value: BackgroundRequest }
  | { ok: false; error: string; code: 'INVALID_MESSAGE' | 'INVALID_PAYLOAD'; details: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const validateBackgroundRequest = (value: unknown): BackgroundRequestValidationResult => {
  if (!isRecord(value)) {
    return { ok: false, error: 'Ungültige Nachricht.', code: 'INVALID_MESSAGE', details: 'message_not_object' };
  }

  const { type } = value;
  if (typeof type !== 'string' || !MESSAGE_TYPES.has(type as SessionMessageType)) {
    return { ok: false, error: 'Unbekannter Nachrichtentyp.', code: 'INVALID_MESSAGE', details: 'unknown_type' };
  }

  switch (type) {
    case 'quickSave.getActiveTab':
    case 'readLater.refreshBadge':
      return { ok: true, value: { type } };
    case 'session.saveCurrentWindow': {
      const { title } = value;
      if (typeof title !== 'undefined' && typeof title !== 'string') {
        return { ok: false, error: 'Ungültiger Titel für Session.', code: 'INVALID_PAYLOAD', details: 'title' };
      }
      return { ok: true, value: typeof title === 'string' ? { type, title } : { type } };
    }
    case 'session.openAll':
    case 'session.delete': {
      const { sessionId } = value;
      if (!isNonEmptyString(sessionId)) {
        return {
          ok: false,
          error: 'Ungültige Session-ID.',
          code: 'INVALID_PAYLOAD',
          details: 'sessionId',
        };
      }
      return { ok: true, value: { type, sessionId } };
    }
    case 'session.openSelected': {
      const { sessionId, tabIndexes } = value;
      if (!isNonEmptyString(sessionId)) {
        return { ok: false, error: 'Ungültige Session-ID.', code: 'INVALID_PAYLOAD', details: 'sessionId' };
      }
      if (
        !Array.isArray(tabIndexes) ||
        tabIndexes.some((index) => !Number.isInteger(index) || index < 0)
      ) {
        return {
          ok: false,
          error: 'Ungültige Tab-Auswahl.',
          code: 'INVALID_PAYLOAD',
          details: 'tabIndexes',
        };
      }
      return { ok: true, value: { type, sessionId, tabIndexes } };
    }
    case 'settings.applyNewTab': {
      const { enabled } = value;
      if (typeof enabled !== 'boolean') {
        return { ok: false, error: 'Ungültiger New-Tab-Wert.', code: 'INVALID_PAYLOAD', details: 'enabled' };
      }
      return { ok: true, value: { type, enabled } };
    }
    case 'sidePanel.open': {
      const { windowId } = value;
      if (
        typeof windowId !== 'undefined' &&
        (typeof windowId !== 'number' || !Number.isInteger(windowId) || windowId < 0)
      ) {
        return {
          ok: false,
          error: 'Ungültige Fenster-ID.',
          code: 'INVALID_PAYLOAD',
          details: 'windowId',
        };
      }
      return { ok: true, value: typeof windowId === 'number' ? { type, windowId } : { type } };
    }
    default:
      return { ok: false, error: 'Unbekannter Nachrichtentyp.', code: 'INVALID_MESSAGE', details: 'default' };
  }
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
