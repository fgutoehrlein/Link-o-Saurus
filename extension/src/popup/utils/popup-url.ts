import type { Bookmark } from '../../shared/types';

export const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const normalizeUrlForComparison = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  try {
    return new URL(trimmed).toString();
  } catch {
    try {
      return new URL(`https://${trimmed}`).toString();
    } catch {
      return trimmed;
    }
  }
};

export const normalizeUrlForSaving = (raw: string): string => {
  const normalized = normalizeUrlForComparison(raw);
  if (!normalized) {
    throw new Error('Bitte eine gültige URL eingeben.');
  }
  try {
    // eslint-disable-next-line no-new
    new URL(normalized);
  } catch {
    throw new Error('Bitte eine gültige URL eingeben.');
  }
  return normalized;
};

export const extractDomain = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

export const getFaviconUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return new URL('/favicon.ico', parsed.origin).toString();
  } catch {
    return null;
  }
};

export const getBookmarkInitial = (bookmark: Bookmark): string => {
  const source = normalizeWhitespace(bookmark.title || extractDomain(bookmark.url) || bookmark.url);
  const firstChar = source.charAt(0);
  return firstChar ? firstChar.toUpperCase() : '🔖';
};
