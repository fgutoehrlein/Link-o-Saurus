export type NormalizedUrlOptions = {
  readonly removeHash?: boolean;
  readonly sortQueryParameters?: boolean;
};

const DEFAULT_OPTIONS: NormalizedUrlOptions = {
  removeHash: true,
  sortQueryParameters: true,
};

const DEFAULT_HTTP_PORT = '80';
const DEFAULT_HTTPS_PORT = '443';

const normalizeSearchParams = (searchParams: URLSearchParams): string => {
  const entries: [string, string][] = [];
  searchParams.forEach((value, key) => {
    if (/^utm_/iu.test(key)) {
      return;
    }
    entries.push([key, value]);
  });
  entries.sort((a, b) => {
    if (a[0] === b[0]) {
      return a[1].localeCompare(b[1]);
    }
    return a[0].localeCompare(b[0]);
  });
  const sorted = new URLSearchParams();
  for (const [key, value] of entries) {
    sorted.append(key, value);
  }
  const serialized = sorted.toString();
  return serialized ? `?${serialized}` : '';
};

export const normalizeUrl = (
  input: string,
  options: NormalizedUrlOptions = DEFAULT_OPTIONS,
): string | null => {
  if (!input) {
    return null;
  }

  try {
    const url = new URL(input);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();

    if (options.removeHash !== false) {
      url.hash = '';
    }

    if (
      (url.protocol === 'http:' && url.port === DEFAULT_HTTP_PORT) ||
      (url.protocol === 'https:' && url.port === DEFAULT_HTTPS_PORT)
    ) {
      url.port = '';
    }

    if (url.pathname && url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/u, '');
      if (!url.pathname.startsWith('/')) {
        url.pathname = `/${url.pathname}`;
      }
    }

    if (url.pathname === '/') {
      url.pathname = '';
    }

    if (options.sortQueryParameters !== false && url.search) {
      url.search = normalizeSearchParams(url.searchParams);
    }

    return url.toString();
  } catch {
    return null;
  }
};
