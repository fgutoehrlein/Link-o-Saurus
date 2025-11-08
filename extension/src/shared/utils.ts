export const noop = () => {
  /* intentionally empty */
};

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[Feathermarks] ${message}`);
  }
}

export function openDashboard(params?: Record<string, string>): Promise<chrome.tabs.Tab> {
  const searchParams = new URLSearchParams();
  let hash = '';

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (key === 'hash') {
        hash = value;
        continue;
      }

      if (typeof value === 'string') {
        searchParams.set(key, value);
      }
    }
  }

  const query = searchParams.toString();
  const hashFragment = hash ? `#${hash.replace(/^#/, '')}` : '';
  const queryPrefix = query ? `?${query}` : '';
  const url = chrome.runtime.getURL(`dashboard.html${queryPrefix}${hashFragment}`);

  return chrome.tabs.create({ url });
}
