import { createSession, deleteSession, getSession } from '../shared/db';
import type { CreateSessionInput } from '../shared/db';
import type { SessionPack } from '../shared/types';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'ftp:']);
const SESSION_RESTORE_BATCH_SIZE = 6;

type SessionRestoreMode = 'new-window' | 'current-window';

type SessionRestoreProgress = {
  mode: SessionRestoreMode;
  total: number;
  opened: number;
  failed: number;
};

const emitSessionRestoreProgress = (progress: SessionRestoreProgress): void => {
  void chrome.runtime.sendMessage({
    type: 'session.restore.progress',
    ...progress,
  });
};

const resolveTabUrl = (tab: chrome.tabs.Tab): string | undefined => {
  const url = tab.url ?? tab.pendingUrl;
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return undefined;
    }
    return parsed.toString();
  } catch (error) {
    console.warn('[Link-o-Saurus] Ungültige Tab-URL übersprungen', error);
    return undefined;
  }
};

export const ensureTabsPermission = async (): Promise<void> => {
  const permissions: chrome.permissions.Permissions = { permissions: ['tabs', 'windows'] };
  const hasPermission = await chrome.permissions.contains(permissions);
  if (hasPermission) {
    return;
  }
  const granted = await chrome.permissions.request(permissions);
  if (!granted) {
    throw new Error('Berechtigung für Tabs wurde nicht erteilt.');
  }
};

export const saveCurrentWindowAsSession = async (title?: string): Promise<SessionPack> => {
  await ensureTabsPermission();
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const sessionTabs = tabs
    .map((tab) => {
      const url = resolveTabUrl(tab);
      if (!url) {
        return undefined;
      }
      const sanitized: SessionPack['tabs'][number] = { url };
      if (tab.title && tab.title.trim().length > 0) {
        sanitized.title = tab.title;
      }
      if (tab.favIconUrl && tab.favIconUrl.trim().length > 0) {
        sanitized.favIconUrl = tab.favIconUrl;
      }
      return sanitized;
    })
    .filter((tab): tab is SessionPack['tabs'][number] => Boolean(tab));

  if (sessionTabs.length === 0) {
    throw new Error('Keine speicherbaren Tabs im aktuellen Fenster gefunden.');
  }

  const trimmedTitle = title?.trim();
  const sessionTitle =
    trimmedTitle && trimmedTitle.length > 0
      ? trimmedTitle
      : `Fenster vom ${new Date().toLocaleString()}`;

  const session: CreateSessionInput = {
    id: crypto.randomUUID(),
    title: sessionTitle,
    tabs: sessionTabs,
    savedAt: Date.now(),
  };

  await createSession(session);
  return session;
};

const openTabsInNewWindow = async (tabs: SessionPack['tabs']): Promise<void> => {
  if (!tabs.length) {
    return;
  }
  const [first, ...rest] = tabs;
  const createdWindow = await chrome.windows.create({ url: first.url, focused: true });
  const windowId = createdWindow.id;
  if (!windowId) {
    return;
  }

  let opened = 1;
  let failed = 0;
  emitSessionRestoreProgress({ mode: 'new-window', total: tabs.length, opened, failed });

  if (rest.length === 0) {
    return;
  }

  for (let index = 0; index < rest.length; index += SESSION_RESTORE_BATCH_SIZE) {
    const batch = rest.slice(index, index + SESSION_RESTORE_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((tab) => chrome.tabs.create({ windowId, url: tab.url, active: false })),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        opened += 1;
      } else {
        failed += 1;
        console.warn('[Link-o-Saurus] Tab konnte nicht in neuem Fenster wiederhergestellt werden.', result.reason);
      }
    }

    emitSessionRestoreProgress({ mode: 'new-window', total: tabs.length, opened, failed });
  }
};

export const openTabsInCurrentWindow = async (tabs: SessionPack['tabs']): Promise<void> => {
  if (!tabs.length) {
    return;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const windowId = activeTab?.windowId;
  if (!windowId) {
    await openTabsInNewWindow(tabs);
    return;
  }

  let opened = 0;
  let failed = 0;
  emitSessionRestoreProgress({ mode: 'current-window', total: tabs.length, opened, failed });

  for (let index = 0; index < tabs.length; index += SESSION_RESTORE_BATCH_SIZE) {
    const batch = tabs.slice(index, index + SESSION_RESTORE_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((tab, batchIndex) =>
        chrome.tabs.create({
          windowId,
          url: tab.url,
          active: index === 0 && batchIndex === 0,
        }),
      ),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        opened += 1;
      } else {
        failed += 1;
        console.warn('[Link-o-Saurus] Tab konnte im aktuellen Fenster nicht wiederhergestellt werden.', result.reason);
      }
    }

    emitSessionRestoreProgress({ mode: 'current-window', total: tabs.length, opened, failed });
  }
};

export const openAllSessionTabs = async (sessionId: string): Promise<number> => {
  await ensureTabsPermission();
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error('Session konnte nicht gefunden werden.');
  }
  const tabs = session.tabs.filter((tab) => Boolean(tab.url));
  if (!tabs.length) {
    throw new Error('Diese Session enthält keine gültigen Tabs.');
  }
  await openTabsInNewWindow(tabs);
  return tabs.length;
};

export const openSelectedSessionTabs = async (
  sessionId: string,
  tabIndexes: number[],
): Promise<number> => {
  await ensureTabsPermission();
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error('Session konnte nicht gefunden werden.');
  }
  const uniqueIndexes = Array.from(new Set(tabIndexes))
    .filter((index) => Number.isInteger(index) && index >= 0)
    .sort((a, b) => a - b);
  const tabs = uniqueIndexes
    .map((index) => session.tabs[index])
    .filter((tab): tab is SessionPack['tabs'][number] => Boolean(tab?.url));
  if (!tabs.length) {
    throw new Error('Bitte wähle mindestens einen Tab aus.');
  }
  await openTabsInCurrentWindow(tabs);
  return tabs.length;
};

export const removeSession = async (sessionId: string): Promise<void> => {
  await deleteSession(sessionId);
};
