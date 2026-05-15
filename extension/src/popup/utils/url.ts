export const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const extractDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export const getFaviconUrl = (url: string): string | null => {
  if (!url) {
    return null;
  }
  try {
    return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url)}&sz=64`;
  } catch {
    return null;
  }
};
