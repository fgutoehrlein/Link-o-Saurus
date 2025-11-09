import { wrap, releaseProxy } from 'comlink';
import type { Remote } from 'comlink';
import type { FunctionalComponent, JSX } from 'preact';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { FixedSizeList, type FixedSizeListProps, type ListChildComponentProps } from 'react-window';
import ImportExportWorkerFactory from '../shared/import-export-worker?worker&module';
import SearchWorkerFactory from '../shared/search-worker?worker&module';
import {
  createBookmark,
  createSession,
  deleteBookmark,
  deleteSession,
  getUserSettings,
  listBoards,
  listBookmarks,
  listCategories,
  listSessions,
  listTags,
  saveUserSettings,
  updateBookmark,
} from '../shared/db';
import type {
  Bookmark,
  Board,
  Category,
  SessionPack,
  Tag,
  UserSettings,
} from '../shared/types';
import type {
  ImportExportWorkerApi,
  ImportProgressHandler,
} from '../shared/import-export-worker';
import type { ExportFormat, ImportProgress } from '../shared/import-export';
import type { SearchHit, SearchWorker } from '../shared/search-worker';
import { canonicalizeTagId, normalizeTagList, normalizeTagPath } from '../shared/tag-utils';
import { normalizeUrl } from '../shared/url';
import { isDashboardMessage } from '../shared/messaging';
import './App.css';

declare global {
  interface Window {
    __LINKOSAURUS_DASHBOARD_READY?: boolean;
    __LINKOSAURUS_DASHBOARD_READY_TIME?: number;
  }
}

type BookmarkListEntry = {
  readonly id: string;
  readonly bookmark: Bookmark;
  readonly category?: Category;
  readonly board?: Board;
};

type BookmarkListData = {
  readonly ids: readonly string[];
  readonly bookmarkById: Map<string, BookmarkListEntry>;
  readonly selected: Set<string>;
  readonly onRowClick: (event: MouseEvent | KeyboardEvent, id: string) => void;
  readonly onRowContextMenu: (event: MouseEvent, id: string) => void;
  readonly onDragStart: (event: DragEvent, id: string) => void;
};

type DraftBookmark = {
  title: string;
  url: string;
  tags: string;
  notes: string;
  categoryId?: string;
};

type BatchMoveState = {
  boardId: string;
  categoryId: string;
};

type ImportDialogState = {
  busy: boolean;
  progress: ImportProgress | null;
  error: string | null;
};

type SessionDialogState = {
  busy: boolean;
  error: string | null;
};

type ThemeChoice = UserSettings['theme'];

type SelectionChange = {
  ids: readonly string[];
  anchorIndex: number | null;
};

type RouteSnapshot = {
  readonly search: string;
  readonly boardId: string;
  readonly tag: string;
  readonly isNew: boolean;
  readonly newTitle: string;
  readonly newUrl: string;
  readonly newTags: string;
};

const DEFAULT_ITEM_HEIGHT = 76;
const MAX_QUERY_RESULTS = 600;
const MIN_RESIZE_WIDTH = 320;

const ROUTE_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const ROUTE_MAX_SEARCH_LENGTH = 512;
const ROUTE_MAX_TITLE_LENGTH = 256;
const ROUTE_MAX_TAG_LENGTH = 64;
const ROUTE_MAX_TAG_COUNT = 32;

const sanitizeRouteText = (value: string, limit: number): string =>
  value.replace(ROUTE_CONTROL_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit);

const sanitizeRouteTagsList = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const sanitized = sanitizeRouteText(value, ROUTE_MAX_TAG_LENGTH);
    if (!sanitized) {
      continue;
    }
    const key = sanitized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(sanitized);
    if (result.length >= ROUTE_MAX_TAG_COUNT) {
      break;
    }
  }
  return result;
};

const sanitizeRouteTagsParam = (values: readonly string[]): string[] => {
  const flattened: string[] = [];
  values.forEach((value) => {
    value
      .split(',')
      .map((part) => part)
      .forEach((part) => flattened.push(part));
  });
  return sanitizeRouteTagsList(flattened);
};

const sanitizeRouteUrl = (value: string): string => {
  const trimmed = value.replace(ROUTE_CONTROL_CHARACTERS, '').trim();
  if (!trimmed) {
    return '';
  }
  const normalized =
    normalizeUrl(trimmed, { removeHash: false, sortQueryParameters: false }) ??
    normalizeUrl(`https://${trimmed}`, { removeHash: false, sortQueryParameters: false });
  return normalized ?? '';
};

const formatTimestamp = (timestamp: number | undefined): string => {
  if (!timestamp) {
    return '';
  }
  try {
    const formatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    return formatter.format(timestamp);
  } catch {
    return new Date(timestamp).toLocaleString();
  }
};

const getFaviconUrl = (url: string): string | null => {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return new URL('/favicon.ico', parsed.origin).toString();
  } catch {
    return null;
  }
};

const createDragPayload = (ids: readonly string[]): string => {
  return JSON.stringify({ ids: Array.from(new Set(ids)) });
};

const parseDragPayload = (event: DragEvent): string[] => {
  const payload = event.dataTransfer?.getData('application/x-linkosaurus-bookmark');
  if (!payload) {
    return [];
  }
  try {
    const parsed = JSON.parse(payload) as { ids?: unknown };
    if (Array.isArray(parsed.ids)) {
      return parsed.ids.map((id) => String(id));
    }
  } catch (error) {
    console.warn('Failed to parse drag payload', error);
  }
  return [];
};

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `bookmark-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const combineClassNames = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');

const parseInitialRoute = (): RouteSnapshot => {
  const params = new URLSearchParams(window.location.search);

  const hash = window.location.hash;
  if (hash.includes('?')) {
    const hashParams = new URLSearchParams(hash.replace(/^#\/?/, ''));
    hashParams.forEach((value, key) => {
      params.set(key, value);
    });
  }

  const search = sanitizeRouteText(params.get('q') ?? '', ROUTE_MAX_SEARCH_LENGTH);
  const boardId = params.get('board')?.replace(ROUTE_CONTROL_CHARACTERS, '').trim() ?? '';
  const tag = params.get('tag')?.replace(ROUTE_CONTROL_CHARACTERS, '').trim() ?? '';
  const isNew = params.get('new') === '1';
  const newTitle = sanitizeRouteText(params.get('title') ?? '', ROUTE_MAX_TITLE_LENGTH);
  const newUrl = sanitizeRouteUrl(params.get('url') ?? '');
  const tags = sanitizeRouteTagsParam(params.getAll('tags'));
  const newTags = tags.join(', ');

  return { search, boardId, tag, isNew, newTitle, newUrl, newTags };
};

const updateRouteHash = (snapshot: RouteSnapshot): void => {
  const params = new URLSearchParams();
  if (snapshot.search) {
    params.set('q', snapshot.search);
  }
  if (snapshot.boardId) {
    params.set('board', snapshot.boardId);
  }
  if (snapshot.tag) {
    params.set('tag', snapshot.tag);
  }
  if (snapshot.isNew) {
    params.set('new', '1');
    if (snapshot.newTitle) {
      params.set('title', snapshot.newTitle);
    }
    if (snapshot.newUrl) {
      params.set('url', snapshot.newUrl);
    }
    if (snapshot.newTags) {
      const serializedTags = sanitizeRouteTagsList(
        snapshot.newTags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      );
      if (serializedTags.length > 0) {
        params.set('tags', serializedTags.join(','));
      }
    }
  }
  const serialized = params.toString();
  const nextHash = serialized ? `#/?${serialized}` : '#/';
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
};

const containsTabsPermission = async (): Promise<boolean> => {
  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) {
    return false;
  }
  return new Promise((resolve) => {
    chrome.permissions.contains({ permissions: ['tabs'] }, (granted) => {
      resolve(Boolean(granted));
    });
  });
};

const requestTabsPermission = async (): Promise<boolean> => {
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) {
    return false;
  }
  return new Promise((resolve) => {
    chrome.permissions.request({ permissions: ['tabs'] }, (granted) => {
      resolve(Boolean(granted));
    });
  });
};

const queryCurrentWindowTabs = async (): Promise<chrome.tabs.Tab[]> => {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return [];
  }
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      const error = chrome.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tabs ?? []);
    });
  });
};

const openTabs = async (tabs: SessionPack['tabs']): Promise<void> => {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    for (const tab of tabs) {
      if (!tab.url) {
        continue;
      }
      await new Promise<void>((resolve, reject) => {
        chrome.tabs.create({ url: tab.url, active: false }, () => {
          const error = chrome.runtime?.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve();
        });
      });
    }
  } else {
    tabs.forEach((tab) => {
      if (tab.url) {
        window.open(tab.url, '_blank', 'noopener,noreferrer');
      }
    });
  }
};

const getBookmarkInitial = (bookmark: Bookmark): string => {
  const source = bookmark.title?.trim() || bookmark.url;
  return source ? source.charAt(0).toUpperCase() : '🔖';
};

type BookmarkRowProps = ListChildComponentProps<BookmarkListData>;

const VirtualList = FixedSizeList as unknown as FunctionalComponent<FixedSizeListProps<BookmarkListData>>;

const BookmarkRow: FunctionalComponent<BookmarkRowProps> = ({ index, style, data }) => {
  const id = data.ids[index];
  const entry = data.bookmarkById.get(id);
  if (!entry) {
    return <div style={style as JSX.CSSProperties} className="bookmark-row placeholder" />;
  }
  const { bookmark, board, category } = entry;
  const isSelected = data.selected.has(id);
  const favicon = getFaviconUrl(bookmark.url);

  const handleClick = (event: MouseEvent) => {
    data.onRowClick(event, id);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      data.onRowClick(event, id);
    }
  };

  const handleContextMenu = (event: MouseEvent) => {
    data.onRowContextMenu(event, id);
  };

  const handleDragStart = (event: DragEvent) => {
    data.onDragStart(event, id);
  };

  return (
    <div
      role="option"
      aria-selected={isSelected}
      tabIndex={0}
      className={combineClassNames('bookmark-row', isSelected && 'selected')}
      style={style as JSX.CSSProperties}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
      draggable
      onDragStart={handleDragStart}
    >
      <div className="bookmark-avatar" aria-hidden="true">
        {favicon ? <img src={favicon} alt="" /> : <span>{getBookmarkInitial(bookmark)}</span>}
      </div>
      <div className="bookmark-content">
        <div className="bookmark-title" title={bookmark.title || bookmark.url}>
          {bookmark.title || bookmark.url}
        </div>
        <div className="bookmark-meta">
          <span className="bookmark-url" title={bookmark.url}>
            {bookmark.url}
          </span>
          {category ? <span className="bookmark-category">{category.title}</span> : null}
          {board ? <span className="bookmark-board">{board.title}</span> : null}
        </div>
        {bookmark.tags.length > 0 ? (
          <ul className="bookmark-tags" aria-label="Tags">
            {bookmark.tags.map((tag) => (
              <li key={`${bookmark.id}-${tag}`}>{tag}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="bookmark-updated" title={`Zuletzt aktualisiert ${formatTimestamp(bookmark.updatedAt)}`}>
        {formatTimestamp(bookmark.updatedAt)}
      </div>
    </div>
  );
};

const DashboardApp: FunctionalComponent = () => {
  const [boards, setBoards] = useState<readonly Board[]>([]);
  const [categories, setCategories] = useState<readonly Category[]>([]);
  const [bookmarks, setBookmarks] = useState<readonly Bookmark[]>([]);
  const [tags, setTags] = useState<readonly Tag[]>([]);
  const [sessions, setSessions] = useState<readonly SessionPack[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeBoardId, setActiveBoardId] = useState<string>('');
  const [activeCategoryId, setActiveCategoryId] = useState<string>('');
  const [activeTag, setActiveTag] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [searchHits, setSearchHits] = useState<readonly SearchHit[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchGeneration, setSearchGeneration] = useState<number>(0);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [viewportWidth, setViewportWidth] = useState<number>(() => window.innerWidth || MIN_RESIZE_WIDTH);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => window.innerWidth >= 900);
  const [isImportDialogOpen, setImportDialogOpen] = useState<boolean>(false);
  const [importState, setImportState] = useState<ImportDialogState>({ busy: false, progress: null, error: null });
  const [isSessionDialogOpen, setSessionDialogOpen] = useState<boolean>(false);
  const [sessionState, setSessionState] = useState<SessionDialogState>({ busy: false, error: null });
  const [draft, setDraft] = useState<DraftBookmark | null>(null);
  const [detailState, setDetailState] = useState<DraftBookmark | null>(null);
  const [batchMove, setBatchMove] = useState<BatchMoveState>({ boardId: '', categoryId: '' });
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>('system');
  const [statusMessage, setStatusMessage] = useState<string>('');

  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const [listHeight, setListHeight] = useState<number>(320);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const lastSelectionRef = useRef<SelectionChange>({ ids: [], anchorIndex: null });
  const hashSyncRef = useRef<boolean>(false);

  const searchWorkerRef = useRef<Remote<SearchWorker> | null>(null);
  const searchWorkerInstanceRef = useRef<Worker | null>(null);
  const importWorkerRef = useRef<Remote<ImportExportWorkerApi> | null>(null);
  const importWorkerInstanceRef = useRef<Worker | null>(null);

  useEffect(() => {
    return () => {
      delete window.__LINKOSAURUS_DASHBOARD_READY;
      delete window.__LINKOSAURUS_DASHBOARD_READY_TIME;
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(Math.max(window.innerWidth, MIN_RESIZE_WIDTH));
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const layoutMode = viewportWidth >= 1200 ? 'triple' : viewportWidth >= 900 ? 'double' : 'single';

  useEffect(() => {
    if (layoutMode === 'triple') {
      setSidebarOpen(true);
    } else if (layoutMode === 'single') {
      setSidebarOpen(false);
    }
  }, [layoutMode]);

  useEffect(() => {
    if (!listContainerRef.current) {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      if (!entries.length) {
        return;
      }
      const entry = entries[0];
      setListHeight(entry.contentRect.height);
    });
    observer.observe(listContainerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const worker = new SearchWorkerFactory();
    const api = wrap<SearchWorker>(worker);
    searchWorkerInstanceRef.current = worker;
    searchWorkerRef.current = api;
    return () => {
      if (searchWorkerRef.current) {
        void searchWorkerRef.current[releaseProxy]();
        searchWorkerRef.current = null;
      }
      worker.terminate();
      searchWorkerInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const worker = new ImportExportWorkerFactory();
    const api = wrap<ImportExportWorkerApi>(worker);
    importWorkerInstanceRef.current = worker;
    importWorkerRef.current = api;
    return () => {
      if (importWorkerRef.current) {
        void importWorkerRef.current[releaseProxy]();
        importWorkerRef.current = null;
      }
      worker.terminate();
      importWorkerInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const snapshot = parseInitialRoute();
    setSearchQuery(snapshot.search);
    setActiveBoardId(snapshot.boardId);
    setActiveTag(snapshot.tag);
    if (snapshot.isNew) {
      setDraft({
        title: snapshot.newTitle,
        url: snapshot.newUrl,
        tags: snapshot.newTags,
        notes: '',
      });
    }
    if (snapshot.search && searchInputRef.current) {
      searchInputRef.current.focus();
    }

    const handleHashChange = () => {
      if (hashSyncRef.current) {
        hashSyncRef.current = false;
        return;
      }
      const nextSnapshot = parseInitialRoute();
      setSearchQuery(nextSnapshot.search);
      setActiveBoardId(nextSnapshot.boardId);
      setActiveTag(nextSnapshot.tag);
      if (nextSnapshot.isNew) {
        setDraft({
          title: nextSnapshot.newTitle,
          url: nextSnapshot.newUrl,
          tags: nextSnapshot.newTags,
          notes: '',
        });
      } else {
        setDraft(null);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  useEffect(() => {
    const snapshot: RouteSnapshot = {
      search: searchQuery,
      boardId: activeBoardId,
      tag: activeTag,
      isNew: draft !== null,
      newTitle: draft?.title ?? '',
      newUrl: draft?.url ?? '',
      newTags: draft?.tags ?? '',
    };
    hashSyncRef.current = true;
    updateRouteHash(snapshot);
  }, [searchQuery, activeBoardId, activeTag, draft?.title, draft?.url, draft?.tags]);

  useEffect(() => {
    let listener:
      | ((
          message: unknown,
          sender: chrome.runtime.MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => void)
      | null = null;
    const timeoutId = setTimeout(() => {
      if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) {
        return;
      }
      listener = (rawMessage) => {
        if (!isDashboardMessage(rawMessage)) {
          return;
        }
        if (rawMessage.type === 'FOCUS_SEARCH') {
          const sanitized = sanitizeRouteText(rawMessage.payload.q, ROUTE_MAX_SEARCH_LENGTH);
          setStatusMessage('');
          setDraft(null);
          setDetailState(null);
          setActiveBoardId('');
          setActiveCategoryId('');
          setActiveTag('');
          setSelectedIds([]);
          lastSelectionRef.current = { ids: [], anchorIndex: null };
          setSearchQuery(sanitized);
          if (sanitized && searchInputRef.current) {
            searchInputRef.current.focus();
          }
          return;
        }
        if (rawMessage.type === 'OPEN_NEW_WITH_PREFILL') {
          const normalizedUrl = sanitizeRouteUrl(rawMessage.payload.url);
          if (!normalizedUrl) {
            return;
          }
          const normalizedTitle = rawMessage.payload.title
            ? sanitizeRouteText(rawMessage.payload.title, ROUTE_MAX_TITLE_LENGTH)
            : '';
          const normalizedTags = Array.isArray(rawMessage.payload.tags)
            ? sanitizeRouteTagsList(rawMessage.payload.tags)
            : [];
          const tagsText = normalizedTags.join(', ');
          const newDraft: DraftBookmark = {
            title: normalizedTitle || '',
            url: normalizedUrl,
            tags: tagsText,
            notes: '',
          };
          setStatusMessage('');
          setActiveBoardId('');
          setActiveCategoryId('');
          setActiveTag('');
          setSelectedIds([]);
          lastSelectionRef.current = { ids: [], anchorIndex: null };
          setDraft(newDraft);
          setDetailState(newDraft);
          setSearchQuery('');
          if (searchInputRef.current) {
            searchInputRef.current.blur();
          }
        }
      };
      chrome.runtime.onMessage.addListener(listener);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      if (listener) {
        chrome.runtime.onMessage.removeListener(listener);
      }
    };
  }, []);

  const categoryById = useMemo(() => {
    const map = new Map<string, Category>();
    categories.forEach((category) => {
      map.set(category.id, category);
    });
    return map;
  }, [categories]);

  const boardById = useMemo(() => {
    const map = new Map<string, Board>();
    boards.forEach((board) => {
      map.set(board.id, board);
    });
    return map;
  }, [boards]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [loadedBoards, loadedCategories, loadedBookmarks, loadedTags, loadedSessions, settings] = await Promise.all([
          listBoards(),
          listCategories(),
          listBookmarks({ includeArchived: true }),
          listTags(),
          listSessions(),
          getUserSettings(),
        ]);
        if (cancelled) {
          return;
        }
        setBoards(loadedBoards);
        setCategories(loadedCategories);
        setBookmarks(loadedBookmarks);
        setTags(loadedTags);
        setSessions(loadedSessions);
        setThemeChoice(settings.theme);
        document.documentElement.dataset.theme = settings.theme;
        if (searchWorkerRef.current) {
          await searchWorkerRef.current.rebuildIndex(loadedBookmarks);
          setSearchGeneration((value) => value + 1);
        }
        if (!cancelled) {
          window.__LINKOSAURUS_DASHBOARD_READY = true;
          window.__LINKOSAURUS_DASHBOARD_READY_TIME = performance.now();
        }
      } catch (error) {
        console.error('Failed to initialize dashboard data', error);
        setStatusMessage('Initialdaten konnten nicht geladen werden.');
        if (!cancelled) {
          window.__LINKOSAURUS_DASHBOARD_READY = true;
          window.__LINKOSAURUS_DASHBOARD_READY_TIME = performance.now();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!searchWorkerRef.current) {
      return;
    }
    let cancelled = false;
    const runSearch = async () => {
      const trimmed = searchQuery.trim();
      if (!trimmed) {
        setSearchHits([]);
        return;
      }
      setIsSearching(true);
      try {
        const hits = await searchWorkerRef.current!.query(trimmed, activeTag ? { tags: [activeTag] } : undefined, MAX_QUERY_RESULTS);
        if (!cancelled) {
          setSearchHits(hits);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Search failed', error);
          setStatusMessage('Suche fehlgeschlagen.');
        }
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    };
    void runSearch();
    return () => {
      cancelled = true;
    };
  }, [searchQuery, activeTag, searchGeneration]);

  const bookmarkEntries = useMemo(() => {
    const map = new Map<string, BookmarkListEntry>();
    bookmarks.forEach((bookmark) => {
      const category = bookmark.categoryId ? categoryById.get(bookmark.categoryId) : undefined;
      const board = category ? boardById.get(category.boardId) : undefined;
      map.set(bookmark.id, { id: bookmark.id, bookmark, category, board });
    });
    return map;
  }, [bookmarks, categoryById, boardById]);

  const activeTagCanonical = useMemo(() => canonicalizeTagId(activeTag ?? ''), [activeTag]);

  const filteredIds = useMemo(() => {
    const matchesFilters = (entry: BookmarkListEntry): boolean => {
      if (!showArchived && entry.bookmark.archived) {
        return false;
      }
      if (activeBoardId) {
        if (!entry.category || entry.category.boardId !== activeBoardId) {
          return false;
        }
      }
      if (activeCategoryId) {
        if (entry.bookmark.categoryId !== activeCategoryId) {
          return false;
        }
      }
      if (activeTagCanonical) {
        const normalized = entry.bookmark.tags
          .map((tag) => canonicalizeTagId(normalizeTagPath(tag)))
          .filter((tag): tag is string => Boolean(tag));
        if (!normalized.some((tag) => tag === activeTagCanonical || tag.startsWith(`${activeTagCanonical}/`))) {
          return false;
        }
      }
      return true;
    };

    if (searchQuery.trim()) {
      const ordered: BookmarkListEntry[] = [];
      for (const hit of searchHits) {
        const entry = bookmarkEntries.get(hit.id);
        if (!entry || !matchesFilters(entry)) {
          continue;
        }
        ordered.push(entry);
      }
      return ordered.map((entry) => entry.id);
    }

    return Array.from(bookmarkEntries.values())
      .filter(matchesFilters)
      .sort((a, b) => b.bookmark.updatedAt - a.bookmark.updatedAt)
      .map((entry) => entry.id);
  }, [searchQuery, searchHits, bookmarkEntries, activeBoardId, activeCategoryId, activeTagCanonical, showArchived]);

  useEffect(() => {
    setSelectedIds((previous) => previous.filter((id) => bookmarkEntries.has(id)));
  }, [bookmarkEntries]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    if (selectedIds.length === 1) {
      const entry = bookmarkEntries.get(selectedIds[0]);
      if (entry) {
        setDetailState({
          title: entry.bookmark.title ?? '',
          url: entry.bookmark.url ?? '',
          tags: entry.bookmark.tags.join(', '),
          notes: entry.bookmark.notes ?? '',
          categoryId: entry.bookmark.categoryId,
        });
      }
      setDraft(null);
    } else if (selectedIds.length === 0 && draft) {
      setDetailState(draft);
    } else {
      setDetailState(null);
    }
  }, [selectedIds, bookmarkEntries, draft]);

  const updateBookmarksState = useCallback(
    (updated: Bookmark[]) => {
      setBookmarks((previous) => {
        const map = new Map(previous.map((bookmark) => [bookmark.id, bookmark] as const));
        updated.forEach((bookmark) => {
          map.set(bookmark.id, bookmark);
        });
        return Array.from(map.values());
      });
    },
    [],
  );

  const handleRowSelection = useCallback(
    (event: MouseEvent | KeyboardEvent, id: string) => {
      event.preventDefault();
      const currentIndex = filteredIds.indexOf(id);
      if (currentIndex === -1) {
        return;
      }
      const isMeta = (event as MouseEvent).metaKey || (event as MouseEvent).ctrlKey;
      const isShift = (event as MouseEvent).shiftKey;

      setSelectedIds((previous) => {
        const set = new Set(previous);
        if (isShift && lastSelectionRef.current.anchorIndex !== null) {
          const anchor = lastSelectionRef.current.anchorIndex ?? currentIndex;
          const [start, end] = anchor < currentIndex ? [anchor, currentIndex] : [currentIndex, anchor];
          for (let index = start; index <= end; index += 1) {
            const rangeId = filteredIds[index];
            if (rangeId) {
              set.add(rangeId);
            }
          }
        } else if (isMeta) {
          if (set.has(id)) {
            set.delete(id);
          } else {
            set.add(id);
          }
          lastSelectionRef.current.anchorIndex = currentIndex;
        } else {
          set.clear();
          set.add(id);
          lastSelectionRef.current.anchorIndex = currentIndex;
        }
        lastSelectionRef.current.ids = Array.from(set);
        return Array.from(set);
      });
    },
    [filteredIds],
  );

  const handleRowContextMenu = useCallback((event: MouseEvent, id: string) => {
    if (!selectedSet.has(id)) {
      handleRowSelection(event, id);
    }
  }, [handleRowSelection, selectedSet]);

  const handleRowDragStart = useCallback(
    (event: DragEvent, id: string) => {
      const ids = selectedSet.has(id) && selectedIds.length > 0 ? selectedIds : [id];
      const payload = createDragPayload(ids);
      event.dataTransfer?.setData('application/x-linkosaurus-bookmark', payload);
      event.dataTransfer?.setData('text/plain', ids.join(','));
      event.dataTransfer?.setDragImage(new Image(), 0, 0);
      event.dataTransfer!.effectAllowed = 'move';
    },
    [selectedIds, selectedSet],
  );

  const listData = useMemo<BookmarkListData>(() => ({
    ids: filteredIds,
    bookmarkById: bookmarkEntries,
    selected: selectedSet,
    onRowClick: handleRowSelection,
    onRowContextMenu: handleRowContextMenu,
    onDragStart: handleRowDragStart,
  }), [filteredIds, bookmarkEntries, selectedSet, handleRowSelection, handleRowContextMenu, handleRowDragStart]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    lastSelectionRef.current = { ids: [], anchorIndex: null };
  }, []);

  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  const handleSearchChange = useCallback((event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    setSearchQuery(input.value);
  }, []);

  const handleToggleArchived = useCallback((event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    setShowArchived(input.checked);
  }, []);

  const handleSelectBoard = useCallback((boardId: string) => {
    setActiveBoardId((previous) => (previous === boardId ? '' : boardId));
    setActiveCategoryId('');
    clearSelection();
  }, [clearSelection]);

  const handleSelectCategory = useCallback((categoryId: string, boardId: string) => {
    setActiveBoardId(boardId);
    setActiveCategoryId((previous) => (previous === categoryId ? '' : categoryId));
    clearSelection();
  }, [clearSelection]);

  const handleSelectTag = useCallback((tag: string) => {
    setActiveTag((previous) => (previous === tag ? '' : tag));
    clearSelection();
  }, [clearSelection]);

  const handleClearFilters = useCallback(() => {
    setActiveBoardId('');
    setActiveCategoryId('');
    setActiveTag('');
    clearSelection();
  }, [clearSelection]);

  const applySearchWorkerUpdate = useCallback(async (bookmark: Bookmark) => {
    if (searchWorkerRef.current) {
      try {
        await searchWorkerRef.current.updateDoc(bookmark);
        setSearchGeneration((value) => value + 1);
      } catch (error) {
        console.warn('Failed to update search index', error);
      }
    }
  }, [setSearchGeneration]);

  const applySearchWorkerRemoval = useCallback(async (id: string) => {
    if (searchWorkerRef.current) {
      try {
        await searchWorkerRef.current.removeDoc(id);
        setSearchGeneration((value) => value + 1);
      } catch (error) {
        console.warn('Failed to remove from search index', error);
      }
    }
  }, [setSearchGeneration]);

  const handleDetailChange = useCallback(
    (field: keyof DraftBookmark) => (event: Event) => {
      const input = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
      setDetailState((previous) => {
        if (!previous) {
          return previous;
        }
        return { ...previous, [field]: input.value };
      });
    },
    [],
  );

  const handleDetailCategoryChange = useCallback((event: Event) => {
    const select = event.currentTarget as HTMLSelectElement;
    setDetailState((previous) => {
      if (!previous) {
        return previous;
      }
      return { ...previous, categoryId: select.value || undefined };
    });
  }, []);

  const handleSaveDetail = useCallback(async () => {
    if (!detailState) {
      return;
    }
    const normalizedTags = normalizeTagList(detailState.tags.split(',').map((tag) => tag.trim()));
    const normalizedUrl = normalizeUrl(detailState.url);
    if (!normalizedUrl) {
      setStatusMessage('Bitte eine gültige URL angeben.');
      return;
    }
    if (draft) {
      try {
        const bookmark: Bookmark = await createBookmark({
          title: detailState.title,
          url: normalizedUrl,
          tags: normalizedTags,
          notes: detailState.notes,
          categoryId: detailState.categoryId || undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          visitCount: 0,
          id: generateId(),
        });
        setBookmarks((previous) => [bookmark, ...previous]);
        await applySearchWorkerUpdate(bookmark);
        setDraft(null);
        setDetailState(null);
        setSelectedIds([bookmark.id]);
        setStatusMessage('Lesezeichen erstellt.');
      } catch (error) {
        console.error('Failed to create bookmark', error);
        setStatusMessage('Lesezeichen konnte nicht erstellt werden.');
      }
      return;
    }

    if (selectedIds.length !== 1) {
      return;
    }
    try {
      const updated = await updateBookmark(selectedIds[0], {
        title: detailState.title,
        url: normalizedUrl,
        tags: normalizedTags,
        notes: detailState.notes,
        categoryId: detailState.categoryId || undefined,
      });
      await applySearchWorkerUpdate(updated);
      updateBookmarksState([updated]);
      setStatusMessage('Lesezeichen aktualisiert.');
    } catch (error) {
      console.error('Failed to update bookmark', error);
      setStatusMessage('Aktualisierung fehlgeschlagen.');
    }
  }, [detailState, selectedIds, draft, updateBookmarksState, applySearchWorkerUpdate]);

  const handleBatchAddTags = useCallback(
    async (event: Event) => {
      event.preventDefault();
      if (!detailState || selectedIds.length === 0) {
        return;
      }
      const rawInput = detailState.tags;
      const tagsToAdd = normalizeTagList(rawInput.split(',').map((tag) => tag.trim()));
      if (tagsToAdd.length === 0) {
        return;
      }
      const updates: Bookmark[] = [];
      try {
        for (const id of selectedIds) {
          const entry = bookmarkEntries.get(id);
          if (!entry) {
            continue;
          }
          const merged = normalizeTagList([...entry.bookmark.tags, ...tagsToAdd]);
          const updated = await updateBookmark(id, { tags: merged });
          updates.push(updated);
          await applySearchWorkerUpdate(updated);
        }
        updateBookmarksState(updates);
        setStatusMessage('Tags hinzugefügt.');
      } catch (error) {
        console.error('Failed to add tags', error);
        setStatusMessage('Tags konnten nicht hinzugefügt werden.');
      }
    },
    [detailState, selectedIds, bookmarkEntries, applySearchWorkerUpdate, updateBookmarksState],
  );

  const handleBatchRemoveTags = useCallback(
    async (event: Event) => {
      event.preventDefault();
      if (!detailState || selectedIds.length === 0) {
        return;
      }
      const rawInput = detailState.tags;
      const tagsToRemove = normalizeTagList(rawInput.split(',').map((tag) => tag.trim()));
      if (tagsToRemove.length === 0) {
        return;
      }
      const removalSet = new Set(tagsToRemove.map((tag) => canonicalizeTagId(tag)).filter(Boolean) as string[]);
      const updates: Bookmark[] = [];
      try {
        for (const id of selectedIds) {
          const entry = bookmarkEntries.get(id);
          if (!entry) {
            continue;
          }
          const filtered = normalizeTagList(
            entry.bookmark.tags.filter((tag) => {
              const canonical = canonicalizeTagId(tag);
              if (!canonical) {
                return true;
              }
              return !removalSet.has(canonical);
            }),
          );
          const updated = await updateBookmark(id, { tags: filtered });
          updates.push(updated);
          await applySearchWorkerUpdate(updated);
        }
        updateBookmarksState(updates);
        setStatusMessage('Tags entfernt.');
      } catch (error) {
        console.error('Failed to remove tags', error);
        setStatusMessage('Tags konnten nicht entfernt werden.');
      }
    },
    [detailState, selectedIds, bookmarkEntries, applySearchWorkerUpdate, updateBookmarksState],
  );

  const handleBatchMove = useCallback(
    async (event: Event) => {
      event.preventDefault();
      if (!batchMove.boardId) {
        return;
      }
      const targetCategories = categories.filter((category) => category.boardId === batchMove.boardId);
      const targetCategoryId = batchMove.categoryId || targetCategories[0]?.id;
      const updates: Bookmark[] = [];
      try {
        for (const id of selectedIds) {
          const updated = await updateBookmark(id, { categoryId: targetCategoryId });
          updates.push(updated);
          await applySearchWorkerUpdate(updated);
        }
        updateBookmarksState(updates);
        setStatusMessage('Lesezeichen verschoben.');
      } catch (error) {
        console.error('Failed to move bookmarks', error);
        setStatusMessage('Verschieben fehlgeschlagen.');
      }
    },
    [batchMove, categories, selectedIds, applySearchWorkerUpdate, updateBookmarksState],
  );

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.length === 0) {
      return;
    }
    if (!window.confirm(`Sollen ${selectedIds.length} Lesezeichen gelöscht werden?`)) {
      return;
    }
    try {
      for (const id of selectedIds) {
        await deleteBookmark(id);
        await applySearchWorkerRemoval(id);
      }
      setBookmarks((previous) => previous.filter((bookmark) => !selectedSet.has(bookmark.id)));
      clearSelection();
      setStatusMessage('Lesezeichen gelöscht.');
    } catch (error) {
      console.error('Failed to delete bookmarks', error);
      setStatusMessage('Löschen fehlgeschlagen.');
    }
  }, [selectedIds, selectedSet, applySearchWorkerRemoval, clearSelection]);

  const handleDropOnCategory = useCallback(
    async (categoryId: string) => {
      if (!categoryId) {
        return;
      }
      const ids = Array.from(selectedSet.size > 0 ? selectedSet : new Set(selectedIds));
      if (ids.length === 0) {
        return;
      }
      const updates: Bookmark[] = [];
      try {
        for (const id of ids) {
          const updated = await updateBookmark(id, { categoryId });
          updates.push(updated);
          await applySearchWorkerUpdate(updated);
        }
        updateBookmarksState(updates);
        setStatusMessage('Drag & Drop erfolgreich.');
      } catch (error) {
        console.error('Drag & drop failed', error);
        setStatusMessage('Verschieben per Drag & Drop fehlgeschlagen.');
      }
    },
    [selectedIds, selectedSet, applySearchWorkerUpdate, updateBookmarksState],
  );

  const handleDropOnBoard = useCallback(
    async (boardId: string) => {
      const targetCategories = categories.filter((category) => category.boardId === boardId);
      const targetCategoryId = targetCategories[0]?.id ?? '';
      await handleDropOnCategory(targetCategoryId);
    },
    [categories, handleDropOnCategory],
  );

  const handleImportFile = useCallback(
    async (file: File, format: 'html' | 'json') => {
      if (!importWorkerRef.current) {
        return;
      }
      setImportState({ busy: true, progress: null, error: null });
      const onProgress: ImportProgressHandler = (progress) => {
        setImportState((previous) => ({ ...previous, progress }));
      };
      try {
        const result =
          format === 'html'
            ? await importWorkerRef.current.importHtml(file, { dedupe: true }, { onProgress })
            : await importWorkerRef.current.importJson(file, { dedupe: true }, { onProgress });
        setImportState({ busy: false, progress: null, error: null });
        setStatusMessage(`Import abgeschlossen (${result.stats.createdBookmarks} neue Einträge).`);
        const [updatedBookmarks, updatedTags] = await Promise.all([
          listBookmarks({ includeArchived: true }),
          listTags(),
        ]);
        setBookmarks(updatedBookmarks);
        setTags(updatedTags);
        if (searchWorkerRef.current) {
          await searchWorkerRef.current.rebuildIndex(updatedBookmarks);
          setSearchGeneration((value) => value + 1);
        }
      } catch (error) {
        console.error('Import failed', error);
        setImportState({ busy: false, progress: null, error: 'Import fehlgeschlagen.' });
      }
    },
    [setSearchGeneration],
  );

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (!importWorkerRef.current) {
        return;
      }
      setImportState({ busy: true, progress: null, error: null });
      try {
        const result = await importWorkerRef.current.export(format);
        const url = URL.createObjectURL(result.blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = result.fileName;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        setImportState({ busy: false, progress: null, error: null });
        setStatusMessage('Export vorbereitet.');
      } catch (error) {
        console.error('Export failed', error);
        setImportState({ busy: false, progress: null, error: 'Export fehlgeschlagen.' });
      }
    },
    [],
  );

  const handleSessionSave = useCallback(async () => {
    setSessionState({ busy: true, error: null });
    try {
      if (!(await containsTabsPermission()) && !(await requestTabsPermission())) {
        throw new Error('Berechtigung erforderlich.');
      }
      const tabs = await queryCurrentWindowTabs();
      const filtered = tabs
        .filter((tab) => tab.url && !tab.url.startsWith('chrome://'))
        .map((tab) => ({ url: tab.url as string, title: tab.title ?? '', favIconUrl: tab.favIconUrl ?? '' }));
      const session = await createSession({
        id: crypto.randomUUID(),
        title: `Session ${new Date().toLocaleString()}`,
        tabs: filtered,
        savedAt: Date.now(),
      });
      setSessions((previous) => [session, ...previous]);
      setSessionState({ busy: false, error: null });
      setStatusMessage('Session gespeichert.');
    } catch (error) {
      console.error('Failed to save session', error);
      setSessionState({ busy: false, error: 'Session konnte nicht gespeichert werden.' });
    }
  }, []);

  const handleSessionOpen = useCallback(async (session: SessionPack) => {
    setSessionState({ busy: true, error: null });
    try {
      if (!(await containsTabsPermission()) && !(await requestTabsPermission())) {
        throw new Error('Berechtigung erforderlich.');
      }
      await openTabs(session.tabs);
      setSessionState({ busy: false, error: null });
      setStatusMessage('Session geöffnet.');
    } catch (error) {
      console.error('Failed to open session', error);
      setSessionState({ busy: false, error: 'Session konnte nicht geöffnet werden.' });
    }
  }, []);

  const handleSessionDelete = useCallback(async (session: SessionPack) => {
    if (!window.confirm(`Session "${session.title}" löschen?`)) {
      return;
    }
    try {
      await deleteSession(session.id);
      setSessions((previous) => previous.filter((entry) => entry.id !== session.id));
      setStatusMessage('Session gelöscht.');
    } catch (error) {
      console.error('Failed to delete session', error);
      setSessionState({ busy: false, error: 'Session konnte nicht gelöscht werden.' });
    }
  }, []);

  const handleThemeChange = useCallback(async (event: Event) => {
    const select = event.currentTarget as HTMLSelectElement;
    const theme = (select.value as ThemeChoice) ?? 'system';
    setThemeChoice(theme);
    document.documentElement.dataset.theme = theme;
    try {
      await saveUserSettings({ theme });
      setStatusMessage('Theme gespeichert.');
    } catch (error) {
      console.error('Failed to save theme', error);
      setStatusMessage('Theme konnte nicht gespeichert werden.');
    }
  }, []);

  const selectedEntries = useMemo(() => selectedIds.map((id) => bookmarkEntries.get(id)).filter(Boolean) as BookmarkListEntry[], [selectedIds, bookmarkEntries]);

  const activeBoardCategories = useMemo(
    () => categories.filter((category) => !activeBoardId || category.boardId === activeBoardId),
    [categories, activeBoardId],
  );

  const detailPanel = () => {
    if (draft) {
      return (
        <div className="detail-panel" aria-live="polite">
          <h2>Neues Lesezeichen</h2>
          <label>
            <span>Titel</span>
            <input type="text" value={detailState?.title ?? ''} onInput={handleDetailChange('title')} />
          </label>
          <label>
            <span>URL</span>
            <input type="url" value={detailState?.url ?? ''} onInput={handleDetailChange('url')} />
          </label>
          <label>
            <span>Tags (Kommagetrennt)</span>
            <input type="text" value={detailState?.tags ?? ''} onInput={handleDetailChange('tags')} />
          </label>
          <label>
            <span>Notizen</span>
            <textarea value={detailState?.notes ?? ''} onInput={handleDetailChange('notes')} />
          </label>
          <label>
            <span>Kategorie</span>
            <select value={detailState?.categoryId ?? ''} onChange={handleDetailCategoryChange}>
              <option value="">Ohne Kategorie</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {boardById.get(category.boardId)?.title ?? 'Board'} · {category.title}
                </option>
              ))}
            </select>
          </label>
          <div className="detail-actions">
            <button type="button" className="primary" onClick={handleSaveDetail}>
              Speichern
            </button>
            <button type="button" onClick={() => setDraft(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      );
    }

    if (selectedIds.length === 1 && detailState) {
      const entry = selectedEntries[0];
      return (
        <div className="detail-panel" aria-live="polite">
          <h2>Details</h2>
          <p className="detail-meta">
            Zuletzt aktualisiert {formatTimestamp(entry?.bookmark.updatedAt)}
          </p>
          <label>
            <span>Titel</span>
            <input type="text" value={detailState.title} onInput={handleDetailChange('title')} />
          </label>
          <label>
            <span>URL</span>
            <input type="url" value={detailState.url} onInput={handleDetailChange('url')} />
          </label>
          <label>
            <span>Tags (Kommagetrennt)</span>
            <input type="text" value={detailState.tags} onInput={handleDetailChange('tags')} />
          </label>
          <label>
            <span>Notizen</span>
            <textarea value={detailState.notes} onInput={handleDetailChange('notes')} />
          </label>
          <label>
            <span>Kategorie</span>
            <select value={detailState.categoryId ?? ''} onChange={handleDetailCategoryChange}>
              <option value="">Ohne Kategorie</option>
              {activeBoardCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {boardById.get(category.boardId)?.title ?? 'Board'} · {category.title}
                </option>
              ))}
            </select>
          </label>
          <div className="detail-actions">
            <button type="button" className="primary" onClick={handleSaveDetail}>
              Speichern
            </button>
            <button type="button" onClick={handleBatchDelete}>
              Löschen
            </button>
          </div>
        </div>
      );
    }

    if (selectedIds.length > 1) {
      return (
        <div className="detail-panel" aria-live="polite">
          <h2>{selectedIds.length} Lesezeichen ausgewählt</h2>
          <label>
            <span>Tags hinzufügen/entfernen</span>
            <input
              type="text"
              value={detailState?.tags ?? ''}
              onInput={handleDetailChange('tags')}
              placeholder="tag-a, tag-b"
            />
          </label>
          <div className="detail-actions">
            <button type="button" onClick={handleBatchAddTags}>
              Tags hinzufügen
            </button>
            <button type="button" onClick={handleBatchRemoveTags}>
              Tags entfernen
            </button>
          </div>
          <form className="batch-move" onSubmit={handleBatchMove}>
            <label>
              <span>Board</span>
              <select
                value={batchMove.boardId}
                onChange={(event) =>
                  setBatchMove((previous) => ({ ...previous, boardId: (event.currentTarget as HTMLSelectElement).value }))
                }
              >
                <option value="">Board wählen</option>
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Kategorie</span>
              <select
                value={batchMove.categoryId}
                onChange={(event) =>
                  setBatchMove((previous) => ({ ...previous, categoryId: (event.currentTarget as HTMLSelectElement).value }))
                }
              >
                <option value="">Auto</option>
                {categories
                  .filter((category) => !batchMove.boardId || category.boardId === batchMove.boardId)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.title}
                    </option>
                  ))}
              </select>
            </label>
            <button type="submit" className="primary">
              Verschieben
            </button>
          </form>
          <button type="button" className="danger" onClick={handleBatchDelete}>
            Ausgewählte löschen
          </button>
        </div>
      );
    }

    return (
      <div className="detail-panel" aria-live="polite">
        <h2>Aktionen</h2>
        <p>Wähle ein Lesezeichen aus, um Details zu bearbeiten oder Batch-Aktionen auszuführen.</p>
        <button type="button" onClick={() => setDraft({ title: '', url: '', tags: '', notes: '' })}>
          Neues Lesezeichen
        </button>
        <button type="button" onClick={clearSelection}>
          Auswahl löschen
        </button>
      </div>
    );
  };

  return (
    <div className={combineClassNames('dashboard-shell', `layout-${layoutMode}`, sidebarOpen && 'sidebar-open')}>
      <header className="dashboard-header" role="banner">
        <button
          type="button"
          className="sidebar-toggle"
          aria-label="Navigation umschalten"
          onClick={() => setSidebarOpen((value) => !value)}
        >
          ☰
        </button>
        <div className="header-titles">
          <h1>Link-o-Saurus Dashboard</h1>
          <p>Alle Boards, Tags, Sessions und Exporte in einer Arbeitsfläche.</p>
        </div>
        <div className="header-actions">
          <label className="search-field">
            <span className="sr-only">Suche</span>
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onInput={handleSearchChange}
              placeholder="Suche nach Titel, URL oder Tag"
            />
          </label>
          <button type="button" onClick={focusSearch}>
            Fokus Suche
          </button>
        </div>
      </header>
      <div className="dashboard-toolbar">
        <div>
          <label className="toggle">
            <input type="checkbox" checked={showArchived} onChange={handleToggleArchived} />
            Archivierte anzeigen
          </label>
        </div>
        <div className="status" aria-live="polite">
          {isSearching ? 'Suche…' : statusMessage}
        </div>
      </div>
      <div className="dashboard-main">
        <aside className={combineClassNames('dashboard-sidebar', sidebarOpen && 'open')}>
          <section>
            <header>
              <h2>Boards</h2>
              <button type="button" onClick={handleClearFilters}>
                Filter zurücksetzen
              </button>
            </header>
            <ul className="sidebar-list">
              {boards.map((board) => (
                <li key={board.id}>
                  <button
                    type="button"
                    className={combineClassNames('sidebar-item', activeBoardId === board.id && 'active')}
                    onClick={() => handleSelectBoard(board.id)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer!.dropEffect = 'move';
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const ids = parseDragPayload(event);
                      if (ids.length > 0) {
                        ids.forEach((id) => {
                          if (!selectedSet.has(id)) {
                            setSelectedIds([id]);
                          }
                        });
                      }
                      void handleDropOnBoard(board.id);
                    }}
                  >
                    {board.title}
                  </button>
                  <ul className="sidebar-sublist">
                    {categories
                      .filter((category) => category.boardId === board.id)
                      .map((category) => (
                        <li key={category.id}>
                          <button
                            type="button"
                            className={combineClassNames(
                              'sidebar-subitem',
                              activeCategoryId === category.id && 'active',
                            )}
                            onClick={() => handleSelectCategory(category.id, board.id)}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer!.dropEffect = 'move';
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              const ids = parseDragPayload(event);
                              if (ids.length > 0) {
                                ids.forEach((id) => {
                                  if (!selectedSet.has(id)) {
                                    setSelectedIds([id]);
                                  }
                                });
                              }
                              void handleDropOnCategory(category.id);
                            }}
                          >
                            {category.title}
                          </button>
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <header>
              <h2>Tags</h2>
            </header>
            <ul className="sidebar-tag-list">
              {tags.slice(0, 20).map((tag) => (
                <li key={tag.id}>
                  <button
                    type="button"
                    className={combineClassNames('tag-item', activeTag === tag.path && 'active')}
                    onClick={() => handleSelectTag(tag.path)}
                  >
                    {tag.path} <span className="usage">{tag.usageCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="sidebar-actions">
            <button type="button" onClick={() => setImportDialogOpen(true)}>
              Import / Export
            </button>
            <button type="button" onClick={() => setSessionDialogOpen(true)}>
              Sessions
            </button>
            <label>
              <span>Theme</span>
              <select value={themeChoice} onChange={handleThemeChange}>
                <option value="system">System</option>
                <option value="light">Hell</option>
                <option value="dark">Dunkel</option>
              </select>
            </label>
          </section>
        </aside>
        <section className="bookmark-list" role="listbox" aria-multiselectable="true">
          <div className="list-header">
            <h2>Bookmarks ({filteredIds.length})</h2>
            <div className="list-actions">
              <button type="button" onClick={clearSelection}>
                Auswahl leeren
              </button>
              <button type="button" onClick={() => setDraft({ title: '', url: '', tags: '', notes: '' })}>
                Neu
              </button>
            </div>
          </div>
          <div ref={listContainerRef} className="list-viewport" aria-busy={isSearching}>
            {filteredIds.length === 0 ? (
              <div className="empty-state">
                {isSearching ? 'Suche…' : 'Keine Einträge gefunden.'}
              </div>
            ) : listHeight > 0 ? (
              <VirtualList
                height={listHeight}
                width="100%"
                itemCount={filteredIds.length}
                itemSize={DEFAULT_ITEM_HEIGHT}
                itemData={listData}
              >
                {BookmarkRow}
              </VirtualList>
            ) : null}
          </div>
        </section>
        <aside className="detail-column">{detailPanel()}</aside>
      </div>

      {isImportDialogOpen ? (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-content">
            <header>
              <h2>Import &amp; Export</h2>
              <button type="button" aria-label="Schließen" onClick={() => setImportDialogOpen(false)}>
                ×
              </button>
            </header>
            <div className="modal-body">
              <p>Importiere HTML- oder JSON-Dateien. Vorgang läuft im Worker ohne UI-Blockade.</p>
              <div className="modal-actions">
                <label className="file-button">
                  HTML importieren
                  <input
                    type="file"
                    accept=".html,.htm,text/html"
                    disabled={importState.busy}
                    onChange={(event) => {
                      const file = (event.currentTarget as HTMLInputElement).files?.[0];
                      if (file) {
                        void handleImportFile(file, 'html');
                      }
                    }}
                  />
                </label>
                <label className="file-button">
                  JSON importieren
                  <input
                    type="file"
                    accept="application/json,.json"
                    disabled={importState.busy}
                    onChange={(event) => {
                      const file = (event.currentTarget as HTMLInputElement).files?.[0];
                      if (file) {
                        void handleImportFile(file, 'json');
                      }
                    }}
                  />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => handleExport('html')} disabled={importState.busy}>
                  Als HTML exportieren
                </button>
                <button type="button" onClick={() => handleExport('json')} disabled={importState.busy}>
                  Als JSON exportieren
                </button>
              </div>
              {importState.busy ? <p>Import/Export läuft…</p> : null}
              {importState.progress ? (
                <pre className="progress">{JSON.stringify(importState.progress, null, 2)}</pre>
              ) : null}
              {importState.error ? <p className="error">{importState.error}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {isSessionDialogOpen ? (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-content">
            <header>
              <h2>Sessions</h2>
              <button type="button" aria-label="Schließen" onClick={() => setSessionDialogOpen(false)}>
                ×
              </button>
            </header>
            <div className="modal-body">
              <p>Speichere deine aktuellen Tabs oder öffne gespeicherte Sessions.</p>
              <div className="modal-actions">
                <button type="button" onClick={handleSessionSave} disabled={sessionState.busy}>
                  Aktuelle Tabs speichern
                </button>
              </div>
              {sessionState.error ? <p className="error">{sessionState.error}</p> : null}
              <ul className="session-list">
                {sessions.map((session) => (
                  <li key={session.id}>
                    <div>
                      <strong>{session.title}</strong>
                      <span>{session.tabs.length} Tabs</span>
                    </div>
                    <div className="session-actions">
                      <button type="button" onClick={() => handleSessionOpen(session)} disabled={sessionState.busy}>
                        Öffnen
                      </button>
                      <button type="button" onClick={() => handleSessionDelete(session)} disabled={sessionState.busy}>
                        Löschen
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default DashboardApp;
