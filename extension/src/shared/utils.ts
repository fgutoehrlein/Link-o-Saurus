import type { Message } from './messaging';
import { normalizeUrl } from './url';

export const noop = () => {
  /* intentionally empty */
};

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[Link-o-Saurus] ${message}`);
  }
}

export type DashboardOpenParams = {
  readonly q?: string;
  readonly new?: '1';
  readonly url?: string;
  readonly title?: string;
  readonly tags?: readonly string[];
  readonly hash?: string;
};

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const DASHBOARD_PATH = 'dashboard.html';
const MAX_URL_LENGTH = 1800;
const MAX_SEARCH_LENGTH = 512;
const MAX_TITLE_LENGTH = 256;
const MAX_TAG_LENGTH = 64;
const MAX_TAG_COUNT = 32;

const sanitizePlainText = (value: string, limit: number): string =>
  value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit);

const sanitizeHash = (value: string): string =>
  value.replace(CONTROL_CHARACTERS, '').replace(/^#/u, '').slice(0, 256);

const sanitizeSearchQuery = (value: string): string => sanitizePlainText(value, MAX_SEARCH_LENGTH);

const sanitizeTitle = (value: string): string => sanitizePlainText(value, MAX_TITLE_LENGTH);

const sanitizeTags = (tags: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const sanitized = sanitizePlainText(tag, MAX_TAG_LENGTH);
    if (!sanitized) {
      continue;
    }
    const key = sanitized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(sanitized);
    if (result.length >= MAX_TAG_COUNT) {
      break;
    }
  }
  return result;
};

const sanitizePrefillUrl = (input: string): string | null => {
  const trimmed = input.replace(CONTROL_CHARACTERS, '').trim();
  if (!trimmed) {
    return null;
  }

  const attempt = (value: string): string | null =>
    normalizeUrl(value, { removeHash: false, sortQueryParameters: false });

  return attempt(trimmed) ?? attempt(`https://${trimmed}`);
};

const buildDashboardUrl = (baseUrl: string, params: URLSearchParams, hash: string): string => {
  const query = params.toString();
  const hashFragment = hash ? `#${hash}` : '';
  return `${baseUrl}${query ? `?${query}` : ''}${hashFragment}`;
};

const getDashboardBaseUrl = (): string => {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(DASHBOARD_PATH);
  }
  return DASHBOARD_PATH;
};

const queryDashboardTabs = async (matchPattern: string): Promise<chrome.tabs.Tab[]> => {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return [];
  }
  return new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query({ url: matchPattern }, (tabs) => {
      const error = chrome.runtime?.lastError;
      if (error) {
        resolve([]);
        return;
      }
      resolve(tabs ?? []);
    });
  });
};

const focusDashboardTab = async (
  tab: chrome.tabs.Tab,
  url: string | null,
): Promise<chrome.tabs.Tab> => {
  if (typeof chrome === 'undefined' || !chrome.tabs?.update || typeof tab.id !== 'number') {
    return tab;
  }

  const updateProperties: chrome.tabs.UpdateProperties = { active: true };
  if (url && tab.url !== url) {
    updateProperties.url = url;
  }

  return new Promise<chrome.tabs.Tab>((resolve, reject) => {
    chrome.tabs.update(tab.id!, updateProperties, (updatedTab) => {
      const error = chrome.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      const result = updatedTab ?? tab;
      if (typeof chrome.windows?.update === 'function' && typeof result.windowId === 'number') {
        chrome.windows.update(result.windowId, { focused: true }, () => {
          const windowError = chrome.runtime?.lastError;
          if (windowError) {
            // Ignore window focus errors but still resolve with the tab.
            console.warn('Focusing dashboard window failed', windowError);
          }
          resolve(result);
        });
        return;
      }

      resolve(result);
    });
  });
};

const createDashboardTab = async (url: string): Promise<chrome.tabs.Tab> => {
  if (typeof chrome === 'undefined' || !chrome.tabs?.create) {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    return Promise.resolve({} as chrome.tabs.Tab);
  }

  return new Promise<chrome.tabs.Tab>((resolve, reject) => {
    chrome.tabs.create({ url, active: true }, (tab) => {
      const error = chrome.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tab);
    });
  });
};

const sendMessageToTab = async (tabId: number | undefined, message: Message | null): Promise<void> => {
  if (!message || typeof chrome === 'undefined') {
    return;
  }

  if (typeof tabId !== 'number' || !chrome.tabs?.sendMessage) {
    if (chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(message, () => {
        const error = chrome.runtime?.lastError;
        if (error) {
          console.warn('Dashboard message broadcast failed', error);
        }
      });
    }
    return;
  }

  await new Promise<void>((resolve) => {
    let completed = false;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;
    let listener: ((tabId: number, info: chrome.tabs.TabChangeInfo) => void) | undefined;

    const cleanup = () => {
      if (listener) {
        chrome.tabs.onUpdated.removeListener(listener);
        listener = undefined;
      }
      if (typeof retryTimeout !== 'undefined') {
        clearTimeout(retryTimeout);
        retryTimeout = undefined;
      }
    };

    const attempt = () => {
      if (completed) {
        return;
      }

      chrome.tabs.sendMessage(tabId, message, () => {
        const error = chrome.runtime?.lastError;
        if (!error) {
          completed = true;
          cleanup();
          resolve();
          return;
        }

        if (error.message && /Receiving end does not exist/u.test(error.message)) {
          listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
            if (updatedTabId === tabId && info.status === 'complete') {
              cleanup();
              attempt();
            }
          };

          chrome.tabs.onUpdated.addListener(listener);

          retryTimeout = setTimeout(() => {
            if (!completed) {
              cleanup();
              completed = true;
              resolve();
            }
          }, 2000);
          return;
        }

        completed = true;
        cleanup();
        resolve();
      });
    };

    attempt();
  });
};

export async function openDashboard(params?: DashboardOpenParams): Promise<chrome.tabs.Tab> {
  const baseUrl = getDashboardBaseUrl();
  const hash = params?.hash ? sanitizeHash(params.hash) : '';

  const searchQuery = params?.q ? sanitizeSearchQuery(params.q) : '';
  const wantsNew = params?.new === '1' || Boolean(params?.url);
  const title = params?.title ? sanitizeTitle(params.title) : '';
  const tags = params?.tags ? sanitizeTags(params.tags) : [];

  let urlForPrefill: string | null = null;
  if (wantsNew) {
    if (!params?.url) {
      throw new Error('Eine URL wird für das Vorbefüllen benötigt.');
    }
    urlForPrefill = sanitizePrefillUrl(params.url);
    if (!urlForPrefill) {
      throw new Error('Bitte eine gültige URL eingeben.');
    }
  }

  const queryParams = new URLSearchParams();
  if (searchQuery) {
    queryParams.set('q', searchQuery);
  }
  if (wantsNew) {
    queryParams.set('new', '1');
    if (title) {
      queryParams.set('title', title);
    }
    if (urlForPrefill) {
      queryParams.set('url', urlForPrefill);
    }
    if (tags.length > 0) {
      queryParams.set('tags', tags.join(','));
    }
  }

  let message: Message | null = null;
  if (wantsNew && urlForPrefill) {
    message = {
      type: 'OPEN_NEW_WITH_PREFILL',
      payload: {
        url: urlForPrefill,
        ...(title ? { title } : {}),
        ...(tags.length > 0 ? { tags } : {}),
      },
    };
  } else if (searchQuery) {
    message = { type: 'FOCUS_SEARCH', payload: { q: searchQuery } };
  }

  let targetUrl = buildDashboardUrl(baseUrl, queryParams, hash);

  if (targetUrl.length > MAX_URL_LENGTH && message) {
    const minimalParams = new URLSearchParams();
    if (wantsNew) {
      minimalParams.set('new', '1');
    }
    targetUrl = buildDashboardUrl(baseUrl, minimalParams, hash);
  }

  const tabs = await queryDashboardTabs(`${baseUrl}*`);
  const existing = tabs
    .slice()
    .sort((a, b) => {
      const bAccessed = (b as { lastAccessed?: number }).lastAccessed ?? 0;
      const aAccessed = (a as { lastAccessed?: number }).lastAccessed ?? 0;
      return bAccessed - aAccessed;
    })[0];

  try {
    if (existing) {
      const shouldNavigate = message === null;
      const tab = await focusDashboardTab(existing, shouldNavigate ? targetUrl : null);
      await sendMessageToTab(tab.id, message);
      return tab;
    }

    const tab = await createDashboardTab(targetUrl);
    await sendMessageToTab(tab.id, message);
    return tab;
  } catch (error) {
    console.error('Failed to open dashboard tab', error);
    const tab = await createDashboardTab(targetUrl);
    await sendMessageToTab(tab.id, message);
    return tab;
  }
}
