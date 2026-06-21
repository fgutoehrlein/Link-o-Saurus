import { RefObject } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getUserSettings, listBookmarks, recordBookmarkVisit, saveUserSettings } from '../../shared/db';
import type { Bookmark, BookmarkSortMode } from '../../shared/types';
import { sortBookmarks } from '../../shared/bookmark-sort';
import { normalizeUrlForComparison } from '../utils/popup-url';
import {
  buildSearchEntry,
  getQuickAccessEntries,
  SEARCH_INDEX_LIMIT,
  type SearchEntry,
} from '../utils/popup-search';

type UsePopupSearchResult = {
  readonly bookmarkSortMode: BookmarkSortMode;
  readonly duplicateEntry: SearchEntry | undefined;
  readonly hasQuery: boolean;
  readonly quickAccessEntries: SearchEntry[];
  readonly searchEntriesRef: RefObject<SearchEntry[]>;
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly searchSelection: number;
  readonly searchTerm: string;
  readonly addBookmarkToIndex: (bookmark: Bookmark) => void;
  readonly handleSortModeChange: (event: Event) => void;
  readonly refreshSearchIndex: () => Promise<void>;
  readonly recordOpenedBookmark: (bookmark: Bookmark) => Promise<void>;
  readonly setSearchSelection: (updater: number | ((current: number) => number)) => void;
  readonly setSearchTerm: (term: string) => void;
};

export const usePopupSearch = (url: string): UsePopupSearchResult => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchEntries, setSearchEntries] = useState<SearchEntry[]>([]);
  const searchEntriesRef = useRef<SearchEntry[]>([]);
  const [searchSelection, setSearchSelection] = useState(-1);
  const [bookmarkSortMode, setBookmarkSortMode] = useState<BookmarkSortMode>('relevance');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    searchEntriesRef.current = searchEntries;
  }, [searchEntries]);

  const refreshSearchIndex = useCallback(async () => {
    const [bookmarks, settings] = await Promise.all([
      listBookmarks({ includeArchived: false, limit: SEARCH_INDEX_LIMIT }),
      getUserSettings(),
    ]);
    const nextEntries = sortBookmarks(bookmarks, settings.bookmarkSortMode).map((bookmark) => buildSearchEntry(bookmark));
    setBookmarkSortMode(settings.bookmarkSortMode);
    searchEntriesRef.current = nextEntries;
    setSearchEntries(nextEntries);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      const [bookmarks, settings] = await Promise.all([
        listBookmarks({ includeArchived: false, limit: SEARCH_INDEX_LIMIT }),
        getUserSettings(),
      ]);
      if (cancelled) {
        return;
      }
      setBookmarkSortMode(settings.bookmarkSortMode);
      setSearchEntries(sortBookmarks(bookmarks, settings.bookmarkSortMode).map((bookmark) => buildSearchEntry(bookmark)));
      window.setTimeout(() => searchInputRef.current?.focus(), 50);
    };
    void loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  const duplicateEntry = useMemo(() => {
    const normalizedUrl = normalizeUrlForComparison(url).toLowerCase();
    if (!normalizedUrl) {
      return undefined;
    }
    return searchEntries.find((entry) => entry.normalizedUrl === normalizedUrl);
  }, [searchEntries, url]);

  const hasQuery = searchTerm.trim().length > 0;

  const quickAccessEntries = useMemo(
    () => getQuickAccessEntries({ bookmarkSortMode, hasQuery, searchEntries, searchTerm }),
    [bookmarkSortMode, hasQuery, searchEntries, searchTerm],
  );

  useEffect(() => {
    setSearchSelection((current) => {
      const maxIndex = quickAccessEntries.length - 1;
      if (maxIndex < 0) {
        return -1;
      }
      if (current < 0 || current > maxIndex) {
        return 0;
      }
      return current;
    });
  }, [quickAccessEntries]);

  const addBookmarkToIndex = useCallback(
    (bookmark: Bookmark) => {
      setSearchEntries((previous) => {
        const next = sortBookmarks(
          [bookmark, ...previous.map((entry) => entry.bookmark).filter((entry) => entry.id !== bookmark.id)],
          bookmarkSortMode,
        )
          .slice(0, SEARCH_INDEX_LIMIT)
          .map((entry) => buildSearchEntry(entry));
        searchEntriesRef.current = next;
        return next;
      });
    },
    [bookmarkSortMode],
  );

  const recordOpenedBookmark = useCallback(
    async (bookmark: Bookmark) => {
      const visitedBookmark = await recordBookmarkVisit(bookmark.id);
      setSearchEntries((previous) =>
        sortBookmarks(
          previous.map((entry) => (entry.bookmark.id === visitedBookmark.id ? visitedBookmark : entry.bookmark)),
          bookmarkSortMode,
        ).map((item) => buildSearchEntry(item)),
      );
    },
    [bookmarkSortMode],
  );

  const handleSortModeChange = useCallback((event: Event) => {
    const nextMode = (event.currentTarget as HTMLSelectElement).value as BookmarkSortMode;
    setBookmarkSortMode(nextMode);
    setSearchEntries((previous) =>
      sortBookmarks(
        previous.map((entry) => entry.bookmark),
        nextMode,
      ).map((bookmark) => buildSearchEntry(bookmark)),
    );
    void saveUserSettings({ bookmarkSortMode: nextMode });
  }, []);

  return {
    bookmarkSortMode,
    duplicateEntry,
    hasQuery,
    quickAccessEntries,
    searchEntriesRef,
    searchInputRef,
    searchSelection,
    searchTerm,
    addBookmarkToIndex,
    handleSortModeChange,
    refreshSearchIndex,
    recordOpenedBookmark,
    setSearchSelection,
    setSearchTerm,
  };
};
