import type { Bookmark } from '../../shared/types';

export const getBookmarkInitial = (bookmark: Bookmark): string => {
  const source = bookmark.title?.trim() || bookmark.url;
  return source ? source.charAt(0).toUpperCase() : '🔖';
};

export const getBookmarkDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return url;
  }
};
