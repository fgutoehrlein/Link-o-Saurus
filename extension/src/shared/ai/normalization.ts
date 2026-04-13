const GENERIC_STOPWORDS = new Set([
  'bookmark',
  'link',
  'seite',
  'web',
  'www',
  'http',
  'https',
  'com',
]);

export const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const normalizeTag = (value: string): string =>
  normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

export const normalizeToken = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .trim();

export const tokenize = (value: string): string[] =>
  normalizeWhitespace(value)
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => normalizeToken(token))
    .filter(Boolean);

export const parseDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

export const isGenericTag = (tag: string): boolean => GENERIC_STOPWORDS.has(normalizeTag(tag));

export const dedupeTags = (tags: string[]): string[] => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (!normalized || seen.has(normalized) || isGenericTag(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
};
