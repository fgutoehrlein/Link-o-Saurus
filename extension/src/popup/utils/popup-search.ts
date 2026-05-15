import type { Bookmark, BookmarkSortMode } from '../../shared/types';
import { sortBookmarks } from '../../shared/bookmark-sort';
import { extractDomain, normalizeUrlForComparison } from './popup-url';

export type SearchEntry = {
  readonly bookmark: Bookmark;
  readonly normalizedUrl: string;
  readonly normalizedTitle: string;
  readonly domain: string;
  readonly tokens: readonly string[];
};

export const SEARCH_INDEX_LIMIT = 250;
export const SEARCH_RESULTS_LIMIT = 12;
export const QUICK_ACCESS_LIMIT = 8;

export const createTokenSet = (source: string): Set<string> => {
  const tokens = new Set<string>();
  source
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.toLowerCase())
    .filter(Boolean)
    .forEach((token) => tokens.add(token));
  return tokens;
};

export const buildSearchEntry = (bookmark: Bookmark): SearchEntry => {
  const normalizedUrl = normalizeUrlForComparison(bookmark.url).toLowerCase();
  const normalizedTitle = bookmark.title.trim().toLowerCase();
  const domain = extractDomain(bookmark.url);

  const tokenSet = new Set<string>();
  const collect = (value: string) => createTokenSet(value).forEach((token) => tokenSet.add(token));

  collect(bookmark.title);
  collect(domain);
  collect(bookmark.url);
  bookmark.tags.forEach((tag) => collect(tag));

  return {
    bookmark,
    normalizedUrl,
    normalizedTitle,
    domain,
    tokens: Array.from(tokenSet),
  };
};

export const buildSearchEntries = (bookmarks: readonly Bookmark[], sortMode: BookmarkSortMode): SearchEntry[] =>
  sortBookmarks([...bookmarks], sortMode).map((bookmark) => buildSearchEntry(bookmark));

export const getQuickAccessEntries = ({
  bookmarkSortMode,
  hasQuery,
  searchEntries,
  searchTerm,
}: {
  readonly bookmarkSortMode: BookmarkSortMode;
  readonly hasQuery: boolean;
  readonly searchEntries: readonly SearchEntry[];
  readonly searchTerm: string;
}): SearchEntry[] => {
  if (!hasQuery) {
    return sortBookmarks(
      searchEntries.map((entry) => entry.bookmark),
      bookmarkSortMode,
    )
      .slice(0, QUICK_ACCESS_LIMIT)
      .map((bookmark) => buildSearchEntry(bookmark));
  }

  const tokens = searchTerm
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const scored = searchEntries
    .map((entry) => {
      const matches = tokens.every(
        (token) =>
          entry.tokens.some((candidate) => candidate.startsWith(token)) ||
          entry.normalizedTitle.includes(token) ||
          entry.normalizedUrl.includes(token),
      );
      if (!matches) {
        return null;
      }
      const startsWithTitle = entry.normalizedTitle.startsWith(tokens[0] ?? '') ? 0 : 1;
      return { entry, score: startsWithTitle };
    })
    .filter((item): item is { entry: SearchEntry; score: number } => Boolean(item));

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, SEARCH_RESULTS_LIMIT).map((item) => item.entry);
};
