import { wrap, releaseProxy } from 'comlink';
import type { Remote } from 'comlink';
import type { CSSProperties, FunctionalComponent, JSX } from 'preact';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import type { VariableSizeList as VariableSizeListHandle } from 'react-window';
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
  recordBookmarkVisit,
  saveUserSettings,
  updateBookmark,
} from '../shared/db';
import type {
  Bookmark,
  BookmarkSortMode,
  Board,
  Category,
  SessionPack,
  Tag,
  UserSettings,
} from '../shared/types';
import type { SearchHit, SearchWorker } from '../shared/search-worker';
import { canonicalizeTagId, normalizeTagList } from '../shared/tag-utils';
import { normalizeUrl } from '../shared/url';
import { isDashboardMessage } from '../shared/messaging';
import {
  EMPTY_TAG_FILTER_STATE,
  applyNegativeTagContextAction,
  getTagFilterMode,
  matchesTagFilter,
  normalizeTagFilterState,
  toggleTagFilter,
  type TagFilterMode,
  type TagFilterState,
} from '../shared/tag-filter';
import './App.css';
import { capE2EReadyTimestamp } from '../shared/e2e-flags';
import { sortBookmarks } from '../shared/bookmark-sort';
import { buildBookmarkTreeRows, getExpandedFolderIdsForBookmarks } from './bookmark-tree-view-model';
import {
  getGridColumnCount,
  resolveBookmarkViewMode,
  toGridRows,
  type BookmarkViewMode,
} from './view-mode';
import type { BookmarkListData, BookmarkListEntry, BookmarkTileListData, VisibleRow } from './types';
import { getParentIndex, getTreeKeyAction } from './tree-navigation';
import {
  BookmarkRowRenderer,
  BookmarkTileRowRenderer,
  SessionDialog,
  TileVirtualList,
  VirtualList,
  type SessionDialogState,
} from './components';
import {
  ROUTE_MAX_SEARCH_LENGTH,
  ROUTE_MAX_TITLE_LENGTH,
  parseInitialRoute,
  sanitizeRouteTagsList,
  sanitizeRouteText,
  sanitizeRouteUrl,
  updateRouteHash,
  type RouteSnapshot,
} from './utils/dashboard-route';
import { createDragPayload, parseDragPayload } from './utils/drag';
import { getFaviconUrl } from './utils/favicon';
import { combineClassNames, formatTimestamp } from './utils/formatting';
import { DASHBOARD_LIST_HELP_TEXT, SIDEBAR_ACTIONS } from './ui-controls';
import linkOSaurusIcon from '../../assets/link-o-saurus-icon.png';

declare global {
  interface Window {
    __LINKOSAURUS_DASHBOARD_READY?: boolean;
    __LINKOSAURUS_DASHBOARD_READY_TIME?: number;
  }
}

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

type ActiveFilterChip = {
  readonly id: string;
  readonly label: string;
  readonly tone?: 'default' | 'include' | 'exclude';
  readonly remove: () => void;
};

type SidebarTooltipState = {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
};

type ThemeChoice = UserSettings['theme'];

type SelectionChange = {
  ids: readonly string[];
  anchorIndex: number | null;
};

const DEFAULT_FOLDER_ROW_HEIGHT = 42;
const DEFAULT_BOOKMARK_ROW_HEIGHT = 68;
const DEFAULT_TILE_ROW_HEIGHT = 248;
const TILE_VIEW_TOP_GAP = 24;
const MAX_QUERY_RESULTS = 600;
const ROW_HEIGHT_UPDATE_THRESHOLD = 1;
const MAX_VISIBLE_BOOKMARK_TAGS = 3;
const MAX_VISIBLE_TILE_TITLE_LINES = 3;
const MAX_VISIBLE_TILE_DETAIL_LINES = 1;

type ViewModeOption = {
  readonly value: BookmarkViewMode;
  readonly label: string;
  readonly description: string;
  readonly icon: JSX.Element;
};

const ListViewIcon: FunctionalComponent = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 6.75h16M4 12h16M4 17.25h16" />
  </svg>
);

const TileViewIcon: FunctionalComponent = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.25" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.25" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.25" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.25" />
  </svg>
);

const SearchIcon: FunctionalComponent = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </svg>
);

const FontAwesomeIcon: FunctionalComponent<{ readonly name: string; readonly style?: 'regular' | 'solid' }> = ({
  name,
  style = 'solid',
}) => <i className={`fa-${style} ${name}`} aria-hidden="true" />;

const VIEW_MODE_OPTIONS: readonly ViewModeOption[] = [
  {
    value: 'list',
    label: 'Liste',
    description: 'Detaillierte Zeilenansicht mit Metadaten zum schnellen Scannen.',
    icon: <ListViewIcon />,
  },
  {
    value: 'tiles',
    label: 'Kacheln',
    description: 'Visueller Überblick mit Fokus auf Titel, Icons und schnelle Orientierung.',
    icon: <TileViewIcon />,
  },
];
const MIN_RESIZE_WIDTH = 320;

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Invalid file payload'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('File konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });

const waitForTabFavicon = async (tabId: number, timeoutMs = 10_000): Promise<string | undefined> => {
  if (typeof chrome === 'undefined' || !chrome.tabs?.onUpdated) {
    return undefined;
  }
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timeoutHandle);
    };
    const finish = (value?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (updatedTabId !== tabId) {
        return;
      }
      if (typeof changeInfo.favIconUrl === 'string' && changeInfo.favIconUrl.trim()) {
        finish(changeInfo.favIconUrl);
        return;
      }
      if (changeInfo.status === 'complete') {
        const candidate = tab.favIconUrl?.trim();
        finish(candidate || undefined);
      }
    };
    const timeoutHandle = window.setTimeout(() => finish(undefined), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
};

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `bookmark-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

const openBookmarkLink = async (bookmark: Bookmark): Promise<string | undefined> => {
  const url = bookmark.url?.trim();
  if (!url) {
    return undefined;
  }

  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    try {
      const tab = await new Promise<chrome.tabs.Tab>((resolve, reject) => {
        chrome.tabs.create({ url, active: true }, (createdTab) => {
          const error = chrome.runtime?.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(createdTab);
        });
      });
      if (typeof tab.id === 'number') {
        const loadedFavicon = await waitForTabFavicon(tab.id);
        if (loadedFavicon) {
          return loadedFavicon;
        }
      }
      return tab.favIconUrl?.trim() || undefined;
    } catch (error) {
      console.warn('Falling back to window.open after chrome.tabs.create failure', error);
    }
  }

  window.open(url, '_blank', 'noopener,noreferrer');
  return undefined;
};

const refreshBookmarkFavicon = async (bookmark: Bookmark): Promise<string | undefined> => {
  const url = bookmark.url?.trim();
  if (!url) {
    return undefined;
  }

  const fallbackFavicon = getFaviconUrl(url) ?? bookmark.faviconUrl;
  if (typeof chrome === 'undefined' || !chrome.tabs?.create) {
    return fallbackFavicon ?? undefined;
  }

  let tabId: number | undefined;
  try {
    const tab = await new Promise<chrome.tabs.Tab>((resolve, reject) => {
      chrome.tabs.create({ url, active: false }, (createdTab) => {
        const error = chrome.runtime?.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(createdTab);
      });
    });
    tabId = typeof tab.id === 'number' ? tab.id : undefined;
    const loadedFavicon = tabId ? await waitForTabFavicon(tabId) : undefined;
    return loadedFavicon ?? tab.favIconUrl?.trim() ?? fallbackFavicon ?? undefined;
  } catch (error) {
    console.warn('Failed to refresh favicon via hidden tab', error);
    return fallbackFavicon ?? undefined;
  } finally {
    if (typeof tabId === 'number' && chrome.tabs?.remove) {
      chrome.tabs.remove(tabId, () => {
        void chrome.runtime?.lastError;
      });
    }
  }
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
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('dashboard.expandedFolders');
      if (!raw) return new Set<string>();
      return new Set<string>(JSON.parse(raw) as string[]);
    } catch {
      return new Set<string>();
    }
  });
  const [activeTagFilters, setActiveTagFilters] = useState<TagFilterState>(EMPTY_TAG_FILTER_STATE);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [activeRowIndex, setActiveRowIndex] = useState<number>(0);
  const [searchHits, setSearchHits] = useState<readonly SearchHit[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchGeneration, setSearchGeneration] = useState<number>(0);
  const [viewportWidth, setViewportWidth] = useState<number>(() => window.innerWidth || MIN_RESIZE_WIDTH);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => window.innerWidth >= 900);
  const [isSessionDialogOpen, setSessionDialogOpen] = useState<boolean>(false);
  const [sessionState, setSessionState] = useState<SessionDialogState>({ busy: false, error: null });
  const [draft, setDraft] = useState<DraftBookmark | null>(null);
  const [detailState, setDetailState] = useState<DraftBookmark | null>(null);
  const [batchMove, setBatchMove] = useState<BatchMoveState>({ boardId: '', categoryId: '' });
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>('system');
  const [bookmarkViewMode, setBookmarkViewMode] = useState<BookmarkViewMode>('list');
  const [bookmarkSortMode, setBookmarkSortMode] = useState<BookmarkSortMode>('relevance');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);
  const [areTagsExpanded, setTagsExpanded] = useState<boolean>(true);
  const [isSidebarCompact, setSidebarCompact] = useState<boolean>(false);
  const [isRefreshingFavicon, setRefreshingFavicon] = useState<boolean>(false);
  const [isIconDropActive, setIconDropActive] = useState<boolean>(false);
  const [isUploadingIcon, setUploadingIcon] = useState<boolean>(false);
  const [isDetailPanelOpen, setDetailPanelOpen] = useState<boolean>(false);
  const [isDetailAutoOpenEnabled, setDetailAutoOpenEnabled] = useState<boolean>(true);
  const [showFilterDetails, setShowFilterDetails] = useState<boolean>(false);
  const [sidebarTooltip, setSidebarTooltip] = useState<SidebarTooltipState>({
    label: '',
    x: 0,
    y: 0,
    visible: false,
  });

  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const [listHeight, setListHeight] = useState<number>(320);
  const [listWidth, setListWidth] = useState<number>(MIN_RESIZE_WIDTH);
  const listRef = useRef<VariableSizeListHandle<BookmarkListData> | null>(null);
  const treeItemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const tileListRef = useRef<VariableSizeListHandle<BookmarkTileListData> | null>(null);
  const listRowHeightsRef = useRef<Map<number, number>>(new Map());
  const tileRowHeightsRef = useRef<Map<number, number>>(new Map());
  const pendingListResetIndexRef = useRef<number | null>(null);
  const pendingListResetFrameRef = useRef<number | null>(null);
  const pendingTileResetIndexRef = useRef<number | null>(null);
  const pendingTileResetFrameRef = useRef<number | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const manualIconInputRef = useRef<HTMLInputElement | null>(null);
  const lastSelectionRef = useRef<SelectionChange>({ ids: [], anchorIndex: null });
  const hashSyncRef = useRef<boolean>(false);
  const initialRouteRef = useRef<RouteSnapshot | null>(null);

  const searchWorkerRef = useRef<Remote<SearchWorker> | null>(null);
  const searchWorkerInstanceRef = useRef<Worker | null>(null);
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
  const canUseCompactSidebar = layoutMode !== 'single';
  const isSearchActive = isSearchFocused || searchQuery.trim().length > 0;
  const showCompactTooltip = canUseCompactSidebar && isSidebarCompact;
  const shortcutHint = useMemo(() => {
    if (typeof navigator !== 'undefined') {
      const navigatorWithUAData = navigator as Navigator & { userAgentData?: { platform?: string } };
      const platform = navigatorWithUAData.userAgentData?.platform ?? navigator.platform;
      if (/\b(mac|iphone|ipad)\b/i.test(platform)) {
        return '⌘K';
      }
    }
    return 'Ctrl + K';
  }, []);

  useEffect(() => {
    if (layoutMode === 'triple') {
      setSidebarOpen(true);
    } else if (layoutMode === 'single') {
      setSidebarOpen(false);
      setSidebarCompact(false);
    }
  }, [layoutMode]);

  const showSidebarTooltip = useCallback((target: EventTarget | null, label: string) => {
    if (!(target instanceof HTMLElement) || !showCompactTooltip) {
      return;
    }
    const rect = target.getBoundingClientRect();
    setSidebarTooltip({
      label,
      x: rect.right + 12,
      y: rect.top + rect.height / 2,
      visible: true,
    });
  }, [showCompactTooltip]);

  const hideSidebarTooltip = useCallback(() => {
    setSidebarTooltip((current) => (current.visible ? { ...current, visible: false } : current));
  }, []);

  useEffect(() => {
    if (!showCompactTooltip) {
      hideSidebarTooltip();
      return;
    }
    const dismiss = () => hideSidebarTooltip();
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [hideSidebarTooltip, showCompactTooltip]);

  useEffect(() => {
    const handleGlobalSearchShortcut = (event: KeyboardEvent) => {
      const pressedK = event.key.toLowerCase() === 'k';
      if (!pressedK || !(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener('keydown', handleGlobalSearchShortcut);
    return () => {
      window.removeEventListener('keydown', handleGlobalSearchShortcut);
    };
  }, []);

  useEffect(() => {
    const element = listContainerRef.current;
    if (!element) {
      return undefined;
    }
    const measureWidth = (entry?: ResizeObserverEntry): number => {
      if (entry?.borderBoxSize) {
        const borderBox = Array.isArray(entry.borderBoxSize)
          ? entry.borderBoxSize[0]
          : entry.borderBoxSize;
        if (borderBox) {
          return borderBox.inlineSize;
        }
      }
      return element.getBoundingClientRect().width;
    };
    const measureHeight = (entry?: ResizeObserverEntry): number => {
      if (entry?.borderBoxSize) {
        const borderBox = Array.isArray(entry.borderBoxSize)
          ? entry.borderBoxSize[0]
          : entry.borderBoxSize;
        if (borderBox) {
          return borderBox.blockSize;
        }
      }
      return element.getBoundingClientRect().height;
    };
    setListWidth(measureWidth());
    setListHeight(measureHeight());
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      if (!entries.length) {
        return;
      }
      setListWidth(measureWidth(entries[0]));
      setListHeight(measureHeight(entries[0]));
    });
    observer.observe(element);
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
    const snapshot = parseInitialRoute();
    initialRouteRef.current = snapshot;
    setSearchQuery(snapshot.search);
    setActiveBoardId(snapshot.boardId);
    if (snapshot.sortMode) {
      setBookmarkSortMode(snapshot.sortMode);
    }
    setActiveTagFilters({
      include: snapshot.includeTags,
      exclude: snapshot.excludeTags,
    });
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
      if (nextSnapshot.sortMode) {
        setBookmarkSortMode(nextSnapshot.sortMode);
      }
      setActiveTagFilters({
        include: nextSnapshot.includeTags,
        exclude: nextSnapshot.excludeTags,
      });
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
      sortMode: bookmarkSortMode,
      includeTags: activeTagFilters.include,
      excludeTags: activeTagFilters.exclude,
      isNew: draft !== null,
      newTitle: draft?.title ?? '',
      newUrl: draft?.url ?? '',
      newTags: draft?.tags ?? '',
    };
    hashSyncRef.current = true;
    updateRouteHash(snapshot);
  }, [searchQuery, activeBoardId, bookmarkSortMode, activeTagFilters, draft?.title, draft?.url, draft?.tags]);

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
          setActiveTagFilters(EMPTY_TAG_FILTER_STATE);
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
          setActiveTagFilters(EMPTY_TAG_FILTER_STATE);
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

  const refreshTags = useCallback(async () => {
    try {
      const updatedTags = await listTags();
      setTags(updatedTags);
    } catch (error) {
      console.error('Failed to refresh tags', error);
    }
  }, []);

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
        setBookmarkSortMode(initialRouteRef.current?.sortMode ?? settings.bookmarkSortMode);
        setBookmarkViewMode(resolveBookmarkViewMode(settings));
        document.documentElement.dataset.theme = settings.theme;
        if (searchWorkerRef.current) {
          try {
            await searchWorkerRef.current.rebuildIndex(loadedBookmarks);
          } catch (error) {
            console.error('Search index rebuild failed during initialization', error);
            if (!cancelled) {
              setSearchError('Suche eventuell eingeschränkt.');
            }
          }
          const initialRoute = initialRouteRef.current ?? parseInitialRoute();
          const initialSearch = initialRoute.search.trim();
          if (initialSearch) {
            try {
              const initialHits = await searchWorkerRef.current.query(
                initialSearch,
                initialRoute.includeTags.length > 0 || initialRoute.excludeTags.length > 0
                  ? { tags: initialRoute.includeTags, excludeTags: initialRoute.excludeTags }
                  : undefined,
                MAX_QUERY_RESULTS,
              );
              if (!cancelled) {
                setSearchHits(initialHits);
              }
            } catch (error) {
              console.error('Initial search failed', error);
            }
          }
          setSearchGeneration((value) => value + 1);
        }
          if (!cancelled) {
            window.__LINKOSAURUS_DASHBOARD_READY = true;
            window.__LINKOSAURUS_DASHBOARD_READY_TIME = capE2EReadyTimestamp(performance.now());
          }
      } catch (error) {
        console.error('Failed to initialize dashboard data', error);
        setStatusMessage('Initialdaten konnten nicht geladen werden.');
          if (!cancelled) {
            window.__LINKOSAURUS_DASHBOARD_READY = true;
            window.__LINKOSAURUS_DASHBOARD_READY_TIME = capE2EReadyTimestamp(performance.now());
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
        setSearchError(null);
        return;
      }
      setIsSearching(true);
      try {
        const hits = await searchWorkerRef.current!.query(
          trimmed,
          activeTagFilters.include.length > 0 || activeTagFilters.exclude.length > 0
            ? { tags: activeTagFilters.include, excludeTags: activeTagFilters.exclude }
            : undefined,
          MAX_QUERY_RESULTS,
        );
        if (!cancelled) {
          setSearchHits(hits);
          setSearchError(null);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Search failed', error);
          setSearchError('Suche fehlgeschlagen.');
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
  }, [searchQuery, activeTagFilters, searchGeneration]);

  const bookmarkEntries = useMemo(() => {
    const map = new Map<string, BookmarkListEntry>();
    bookmarks.forEach((bookmark) => {
      const category = bookmark.categoryId ? categoryById.get(bookmark.categoryId) : undefined;
      const board = category ? boardById.get(category.boardId) : undefined;
      map.set(bookmark.id, { id: bookmark.id, bookmark, category, board });
    });
    return map;
  }, [bookmarks, categoryById, boardById]);

  const activeTagFilterState = useMemo(() => normalizeTagFilterState(activeTagFilters), [activeTagFilters]);

  const filteredIds = useMemo(() => {
    const matchesFilters = (entry: BookmarkListEntry): boolean => {
      if (entry.bookmark.archived) {
        return false;
      }
      if (!matchesTagFilter(entry.bookmark.tags, activeTagFilterState)) {
        return false;
      }
      return true;
    };

    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery) {
      const ordered: BookmarkListEntry[] = [];
      for (const hit of searchHits) {
        const entry = bookmarkEntries.get(hit.id);
        if (!entry || !matchesFilters(entry)) {
          continue;
        }
        ordered.push(entry);
      }
      if (ordered.length > 0) {
        return sortBookmarks(
          ordered.map((entry) => entry.bookmark),
          bookmarkSortMode,
        ).map((bookmark) => bookmark.id);
      }

      const normalizedQuery = trimmedQuery.toLowerCase();
      const fallback: BookmarkListEntry[] = [];
      for (const entry of bookmarkEntries.values()) {
        if (!matchesFilters(entry)) {
          continue;
        }
        const { bookmark } = entry;
        const titleMatch = bookmark.title?.toLowerCase().includes(normalizedQuery) ?? false;
        const urlMatch = bookmark.url?.toLowerCase().includes(normalizedQuery) ?? false;
        const notesMatch = bookmark.notes?.toLowerCase().includes(normalizedQuery) ?? false;
        const tagMatch = bookmark.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));
        if (titleMatch || urlMatch || notesMatch || tagMatch) {
          fallback.push(entry);
        }
      }
      return sortBookmarks(
        fallback.map((entry) => entry.bookmark),
        bookmarkSortMode,
      ).map((bookmark) => bookmark.id);
    }

    return sortBookmarks(
      Array.from(bookmarkEntries.values())
        .filter(matchesFilters)
        .map((entry) => entry.bookmark),
      bookmarkSortMode,
    ).map((bookmark) => bookmark.id);
  }, [searchQuery, searchHits, bookmarkEntries, bookmarkSortMode, activeTagFilterState]);

  const filteredBookmarksById = useMemo(
    () =>
      new Map(
        filteredIds
          .map((id) => [id, bookmarkEntries.get(id)?.bookmark] as const)
          .filter((entry): entry is readonly [string, Bookmark] => Boolean(entry[1])),
      ),
    [filteredIds, bookmarkEntries],
  );

  const shouldAutoExpandFilteredFolders =
    searchQuery.trim().length > 0 ||
    activeTagFilterState.include.length > 0 ||
    activeTagFilterState.exclude.length > 0;

  const effectiveExpandedFolderIds = useMemo(
    () =>
      shouldAutoExpandFilteredFolders
        ? getExpandedFolderIdsForBookmarks({
            bookmarksById: filteredBookmarksById,
            bookmarkIds: filteredIds,
            categories,
          })
        : expandedFolderIds,
    [shouldAutoExpandFilteredFolders, filteredBookmarksById, filteredIds, categories, expandedFolderIds],
  );

  const treeRows = useMemo<readonly VisibleRow[]>(() => {
    return buildBookmarkTreeRows({
      bookmarksById: filteredBookmarksById,
      filteredBookmarkIds: filteredIds,
      boards,
      categories,
      expandedFolderIds: effectiveExpandedFolderIds,
    });
  }, [filteredIds, filteredBookmarksById, boards, categories, effectiveExpandedFolderIds]);

  const visibleBookmarkIds = useMemo(
    () => treeRows.filter((row) => row.kind === 'bookmark').map((row) => row.bookmarkId),
    [treeRows],
  );

  const tileBookmarkIds = useMemo(
    () =>
      sortBookmarks(
        bookmarks.filter(
          (bookmark) =>
            !bookmark.archived && matchesTagFilter(bookmark.tags, activeTagFilterState),
        ),
        bookmarkSortMode,
      ).map((bookmark) => bookmark.id),
    [bookmarks, activeTagFilterState, bookmarkSortMode],
  );

  const activeViewBookmarkIds =
    bookmarkViewMode === 'tiles' ? tileBookmarkIds : visibleBookmarkIds;

  const totalBookmarkCount = bookmarks.length;
  const visibleBookmarkCount = activeViewBookmarkIds.length;
  const bookmarkCountLabel =
    visibleBookmarkCount === totalBookmarkCount
      ? `Bookmarks (${totalBookmarkCount})`
      : `Bookmarks (${totalBookmarkCount} / ${visibleBookmarkCount})`;

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
      const currentIndex = activeViewBookmarkIds.indexOf(id);
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
            const rangeId = activeViewBookmarkIds[index];
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
    [activeViewBookmarkIds],
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

  const getDefaultListRowHeight = useCallback(
    (index: number) => (treeRows[index]?.kind === 'folder' ? DEFAULT_FOLDER_ROW_HEIGHT : DEFAULT_BOOKMARK_ROW_HEIGHT),
    [treeRows],
  );

  const getRowHeight = useCallback(
    (index: number) => listRowHeightsRef.current.get(index) ?? getDefaultListRowHeight(index),
    [getDefaultListRowHeight],
  );

  const setListRowHeight = useCallback((rowIndex: number, size: number) => {
    const minHeight = treeRows[rowIndex]?.kind === 'folder' ? DEFAULT_FOLDER_ROW_HEIGHT : DEFAULT_BOOKMARK_ROW_HEIGHT;
    const height = Math.max(minHeight, Math.ceil(size));
    const current = listRowHeightsRef.current.get(rowIndex);
    if (typeof current === 'number' && Math.abs(current - height) <= ROW_HEIGHT_UPDATE_THRESHOLD) {
      return;
    }
    listRowHeightsRef.current.set(rowIndex, height);
    pendingListResetIndexRef.current =
      pendingListResetIndexRef.current === null
        ? rowIndex
        : Math.min(pendingListResetIndexRef.current, rowIndex);
    if (pendingListResetFrameRef.current !== null) {
      return;
    }
    pendingListResetFrameRef.current = window.requestAnimationFrame(() => {
      pendingListResetFrameRef.current = null;
      const resetIndex = pendingListResetIndexRef.current;
      pendingListResetIndexRef.current = null;
      if (resetIndex === null) {
        return;
      }
      listRef.current?.resetAfterIndex(resetIndex, false);
    });
  }, [treeRows]);

  useEffect(
    () => () => {
      if (pendingListResetFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingListResetFrameRef.current);
        pendingListResetFrameRef.current = null;
      }
      pendingListResetIndexRef.current = null;
      if (pendingTileResetFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingTileResetFrameRef.current);
        pendingTileResetFrameRef.current = null;
      }
      pendingTileResetIndexRef.current = null;
    },
    [],
  );

  const handleOpenBookmark = useCallback((bookmark: Bookmark) => {
    void (async () => {
      const latestFaviconUrl = await openBookmarkLink(bookmark);
      try {
        const visited = await recordBookmarkVisit(bookmark.id);
        updateBookmarksState([visited]);
      } catch (error) {
        console.warn('Failed to track bookmark visit', error);
      }
      if (latestFaviconUrl && latestFaviconUrl !== bookmark.faviconUrl) {
        try {
          const updated = await updateBookmark(bookmark.id, { faviconUrl: latestFaviconUrl });
          updateBookmarksState([updated]);
        } catch (error) {
          console.warn('Failed to persist refreshed favicon', error);
        }
      }
    })();
  }, [updateBookmarksState]);

  const handleSortModeChange = useCallback((event: Event) => {
    const nextMode = (event.currentTarget as HTMLSelectElement).value as BookmarkSortMode;
    setBookmarkSortMode(nextMode);
    void saveUserSettings({ bookmarkSortMode: nextMode }).catch((error) => {
      console.error('Failed to persist bookmark sort mode', error);
      setStatusMessage('Sortierung konnte nicht gespeichert werden.');
    });
  }, []);

  const handleRefreshFavicon = useCallback(async (bookmark: Bookmark) => {
    setRefreshingFavicon(true);
    try {
      const refreshedFavicon = await refreshBookmarkFavicon(bookmark);
      if (!refreshedFavicon) {
        setStatusMessage('Kein Favicon gefunden.');
        return;
      }
      if (refreshedFavicon === bookmark.faviconUrl) {
        setStatusMessage('Favicon ist bereits aktuell.');
        return;
      }
      const updated = await updateBookmark(bookmark.id, { faviconUrl: refreshedFavicon });
      updateBookmarksState([updated]);
      setStatusMessage('Favicon aktualisiert.');
    } catch (error) {
      console.error('Failed to refresh favicon', error);
      setStatusMessage('Favicon konnte nicht aktualisiert werden.');
    } finally {
      setRefreshingFavicon(false);
    }
  }, [updateBookmarksState]);

  const handleManualIconUpload = useCallback(async (bookmark: Bookmark, file: File) => {
    if (!file.type.startsWith('image/')) {
      setStatusMessage('Bitte eine Bilddatei für das Icon auswählen.');
      return;
    }

    setUploadingIcon(true);
    try {
      const iconDataUrl = await readFileAsDataUrl(file);
      const updated = await updateBookmark(bookmark.id, { faviconUrl: iconDataUrl });
      updateBookmarksState([updated]);
      setStatusMessage('Icon wurde manuell gesetzt.');
    } catch (error) {
      console.error('Failed to upload manual icon', error);
      setStatusMessage('Icon konnte nicht hochgeladen werden.');
    } finally {
      setUploadingIcon(false);
      setIconDropActive(false);
    }
  }, [updateBookmarksState]);

  const handleManualIconInputChange = useCallback((event: Event, bookmark: Bookmark | undefined) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !bookmark) {
      return;
    }
    void handleManualIconUpload(bookmark, file);
    input.value = '';
  }, [handleManualIconUpload]);

  const handleIconDrop = useCallback((event: DragEvent, bookmark: Bookmark | undefined) => {
    event.preventDefault();
    setIconDropActive(false);
    const file = event.dataTransfer?.files?.[0];
    if (!file || !bookmark) {
      return;
    }
    void handleManualIconUpload(bookmark, file);
  }, [handleManualIconUpload]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    lastSelectionRef.current = { ids: [], anchorIndex: null };
  }, []);

  const handleSelectTag = useCallback((tag: string, mode: TagFilterMode) => {
    setActiveTagFilters((previous) => toggleTagFilter(previous, tag, mode));
    clearSelection();
  }, [clearSelection]);

  const handleTagFilterAction = useCallback((event: MouseEvent | KeyboardEvent, tag: string, mode: TagFilterMode) => {
    event.preventDefault();
    event.stopPropagation();
    handleSelectTag(tag, mode);
  }, [handleSelectTag]);

  const focusTreeRow = useCallback((rowIndex: number) => {
    const bounded = Math.max(0, Math.min(rowIndex, treeRows.length - 1));
    setActiveRowIndex(bounded);
    listRef.current?.scrollToItem(bounded, 'smart');
    window.requestAnimationFrame(() => {
      const element = treeItemRefs.current.get(bounded);
      element?.focus();
    });
  }, [treeRows.length]);

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      localStorage.setItem('dashboard.expandedFolders', JSON.stringify(Array.from(next)));
      return next;
    });
  }, []);

  const handleTreeRowKeyDown = useCallback((event: KeyboardEvent, rowIndex: number) => {
    const row = treeRows[rowIndex];
    if (!row) return;
    const action = getTreeKeyAction(event.key, row);
    if (action === 'none') return;
    event.preventDefault();
    if (action === 'focus-prev') focusTreeRow(rowIndex - 1);
    if (action === 'focus-next') focusTreeRow(rowIndex + 1);
    if (action === 'expand' && row.kind === 'folder') {
      if (!row.expanded) toggleFolder(row.id);
      else focusTreeRow(rowIndex + 1);
    }
    if (action === 'collapse' && row.kind === 'folder') {
      if (row.expanded) toggleFolder(row.id);
      else focusTreeRow(getParentIndex(treeRows, rowIndex));
    }
    if (action === 'activate' && row.kind === 'bookmark') {
      const entry = bookmarkEntries.get(row.bookmarkId);
      if (entry) handleOpenBookmark(entry.bookmark);
    }
  }, [treeRows, focusTreeRow, toggleFolder, bookmarkEntries, handleOpenBookmark]);

  const listData = useMemo<BookmarkListData>(() => ({
    rows: treeRows,
    bookmarkById: bookmarkEntries,
    setRowHeight: setListRowHeight,
    selected: selectedSet,
    onRowClick: handleRowSelection,
    onOpenBookmark: handleOpenBookmark,
    onRowContextMenu: handleRowContextMenu,
    onDragStart: handleRowDragStart,
    activeTagFilters: activeTagFilterState,
    onTagFilterAction: handleTagFilterAction,
    onToggleFolder: toggleFolder,
    activeRowIndex,
    onRowFocus: setActiveRowIndex,
    onRowKeyDown: handleTreeRowKeyDown,
    onRowRef: (rowIndex, node) => {
      if (node) treeItemRefs.current.set(rowIndex, node);
      else treeItemRefs.current.delete(rowIndex);
    },
  }), [
    treeRows,
    bookmarkEntries,
    setListRowHeight,
    selectedSet,
    handleRowSelection,
    handleOpenBookmark,
    handleRowContextMenu,
    handleRowDragStart,
    activeTagFilterState,
    handleTagFilterAction,
    toggleFolder,
    activeRowIndex,
    handleTreeRowKeyDown,
  ]);

  const tileColumnCount = useMemo(() => getGridColumnCount(listWidth), [listWidth]);
  const tileRows = useMemo(
    () => toGridRows(tileBookmarkIds, tileColumnCount),
    [tileBookmarkIds, tileColumnCount],
  );

  const getTileRowHeight = useCallback(
    (index: number) => tileRowHeightsRef.current.get(index) ?? DEFAULT_TILE_ROW_HEIGHT,
    [],
  );

  const setTileRowHeight = useCallback((rowIndex: number, size: number) => {
    const height = Math.max(DEFAULT_TILE_ROW_HEIGHT, Math.ceil(size));
    const current = tileRowHeightsRef.current.get(rowIndex);
    if (typeof current === 'number' && Math.abs(current - height) <= ROW_HEIGHT_UPDATE_THRESHOLD) {
      return;
    }
    tileRowHeightsRef.current.set(rowIndex, height);
    pendingTileResetIndexRef.current =
      pendingTileResetIndexRef.current === null
        ? rowIndex
        : Math.min(pendingTileResetIndexRef.current, rowIndex);
    if (pendingTileResetFrameRef.current !== null) {
      return;
    }
    pendingTileResetFrameRef.current = window.requestAnimationFrame(() => {
      pendingTileResetFrameRef.current = null;
      const resetIndex = pendingTileResetIndexRef.current;
      pendingTileResetIndexRef.current = null;
      if (resetIndex === null) {
        return;
      }
      tileListRef.current?.resetAfterIndex(resetIndex, false);
    });
  }, []);

  useEffect(() => {
    listRowHeightsRef.current.clear();
    listRef.current?.resetAfterIndex(0, true);
  }, [treeRows]);

  useEffect(() => {
    if (bookmarkViewMode !== 'list') {
      return;
    }
    listRowHeightsRef.current.clear();
    listRef.current?.resetAfterIndex(0, true);
  }, [bookmarkViewMode]);

  useEffect(() => {
    tileRowHeightsRef.current.clear();
    tileListRef.current?.resetAfterIndex(0, true);
  }, [tileColumnCount, tileBookmarkIds]);

  useEffect(() => {
    if (bookmarkViewMode !== 'tiles') {
      return;
    }
    tileRowHeightsRef.current.clear();
    tileListRef.current?.resetAfterIndex(0, true);
  }, [bookmarkViewMode]);

  const tileListData = useMemo<BookmarkTileListData>(() => ({
    rows: tileRows,
    columnCount: tileColumnCount,
    bookmarkById: bookmarkEntries,
    selected: selectedSet,
    onRowClick: handleRowSelection,
    onOpenBookmark: handleOpenBookmark,
    onRowContextMenu: handleRowContextMenu,
    onDragStart: handleRowDragStart,
    activeTagFilters: activeTagFilterState,
    onTagFilterAction: handleTagFilterAction,
    setRowHeight: setTileRowHeight,
  }), [
    tileRows,
    tileColumnCount,
    bookmarkEntries,
    selectedSet,
    handleRowSelection,
    handleOpenBookmark,
    handleRowContextMenu,
    handleRowDragStart,
    activeTagFilterState,
    handleTagFilterAction,
    setTileRowHeight,
  ]);

  const handleSearchChange = useCallback((event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    setSearchQuery(input.value);
    setSearchError(null);
  }, []);

  const handleResetAllFilters = useCallback(() => {
    setSearchQuery('');
    setActiveBoardId('');
    setActiveCategoryId('');
    setActiveTagFilters(EMPTY_TAG_FILTER_STATE);
    clearSelection();
    setStatusMessage('Alle Filter zurückgesetzt.');
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
          faviconUrl: getFaviconUrl(normalizedUrl) ?? undefined,
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
        await refreshTags();
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
      await refreshTags();
    } catch (error) {
      console.error('Failed to update bookmark', error);
      setStatusMessage('Aktualisierung fehlgeschlagen.');
    }
  }, [detailState, selectedIds, draft, updateBookmarksState, applySearchWorkerUpdate, refreshTags]);

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
        void refreshTags();
      } catch (error) {
        console.error('Failed to add tags', error);
        setStatusMessage('Tags konnten nicht hinzugefügt werden.');
      }
    },
    [detailState, selectedIds, bookmarkEntries, applySearchWorkerUpdate, updateBookmarksState, refreshTags],
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
        void refreshTags();
      } catch (error) {
        console.error('Failed to remove tags', error);
        setStatusMessage('Tags konnten nicht entfernt werden.');
      }
    },
    [detailState, selectedIds, bookmarkEntries, applySearchWorkerUpdate, updateBookmarksState, refreshTags],
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
      void refreshTags();
    } catch (error) {
      console.error('Failed to delete bookmarks', error);
      setStatusMessage('Löschen fehlgeschlagen.');
    }
  }, [selectedIds, selectedSet, applySearchWorkerRemoval, clearSelection, refreshTags]);

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

  const handleThemeChange = useCallback(async (theme: ThemeChoice) => {
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

  const handleOpenSettings = useCallback(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage(() => {
        const error = chrome.runtime?.lastError;
        if (error) {
          console.error('Failed to open options page', error);
          setStatusMessage('Einstellungen konnten nicht geöffnet werden.');
        }
      });
      return;
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL && typeof window !== 'undefined') {
      window.open(chrome.runtime.getURL('options.html'), '_blank', 'noopener,noreferrer');
      return;
    }

    setStatusMessage('Einstellungen konnten nicht geöffnet werden.');
  }, []);

  const handleViewModeChange = useCallback(async (mode: BookmarkViewMode) => {
    setBookmarkViewMode(mode);
    try {
      await saveUserSettings({ dashboardViewMode: mode });
      setStatusMessage(`Ansicht auf ${mode === 'list' ? 'Liste' : 'Kacheln'} gestellt.`);
    } catch (error) {
      console.error('Failed to save view mode', error);
      setStatusMessage('Ansicht konnte nicht gespeichert werden.');
    }
  }, []);

  const hasActiveDetailContext = draft !== null || selectedIds.length > 0;

  useEffect(() => {
    if (!isDetailAutoOpenEnabled) {
      return;
    }
    if (hasActiveDetailContext) {
      setDetailPanelOpen(true);
      return;
    }
    setDetailPanelOpen(false);
  }, [hasActiveDetailContext, isDetailAutoOpenEnabled]);

  const handleManualCloseDetailPanel = useCallback(() => {
    setDetailPanelOpen(false);
    setDetailAutoOpenEnabled(false);
  }, []);

  const handleManualOpenDetailPanel = useCallback(() => {
    setDetailAutoOpenEnabled(true);
    setDetailPanelOpen(true);
  }, []);

  useEffect(() => {
    if (!isDetailPanelOpen) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      handleManualCloseDetailPanel();
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isDetailPanelOpen, handleManualCloseDetailPanel]);

  const selectedEntries = useMemo(() => selectedIds.map((id) => bookmarkEntries.get(id)).filter(Boolean) as BookmarkListEntry[], [selectedIds, bookmarkEntries]);

  const activeBoardCategories = useMemo(
    () => categories.filter((category) => !activeBoardId || category.boardId === activeBoardId),
    [categories, activeBoardId],
  );

  const activeFilterChips = useMemo<readonly ActiveFilterChip[]>(() => {
    const chips: ActiveFilterChip[] = [];
    const trimmedSearch = searchQuery.trim();
    if (trimmedSearch) {
      chips.push({
        id: `search-${trimmedSearch.toLowerCase()}`,
        label: `Suche: "${trimmedSearch}"`,
        remove: () => setSearchQuery(''),
      });
    }
    if (activeBoardId) {
      chips.push({
        id: `board-${activeBoardId}`,
        label: `Board: ${boardById.get(activeBoardId)?.title ?? 'Unbekannt'}`,
        remove: () => {
          setActiveBoardId('');
          setActiveCategoryId('');
        },
      });
    }
    if (activeCategoryId) {
      chips.push({
        id: `category-${activeCategoryId}`,
        label: `Kategorie: ${categoryById.get(activeCategoryId)?.title ?? 'Unbekannt'}`,
        remove: () => setActiveCategoryId(''),
      });
    }
    activeTagFilterState.include.forEach((tag) => {
      chips.push({
        id: `tag-include-${tag}`,
        label: `Tag + ${tag}`,
        tone: 'include',
        remove: () => setActiveTagFilters((previous) => toggleTagFilter(previous, tag, 'include')),
      });
    });
    activeTagFilterState.exclude.forEach((tag) => {
      chips.push({
        id: `tag-exclude-${tag}`,
        label: `Tag − ${tag}`,
        tone: 'exclude',
        remove: () => setActiveTagFilters((previous) => toggleTagFilter(previous, tag, 'exclude')),
      });
    });
    return chips;
  }, [searchQuery, activeBoardId, activeCategoryId, activeTagFilterState, boardById, categoryById]);

  const hasActiveFilters = activeFilterChips.length > 0;
  const searchResultLabel = `${visibleBookmarkCount} ${visibleBookmarkCount === 1 ? 'Ergebnis' : 'Ergebnisse'}`;
  const selectedCountLabel =
    selectedIds.length === 0 ? 'Keine Auswahl' : `${selectedIds.length} ausgewählt`;
  const liveStatusMessage = isSearching ? 'Suche…' : statusMessage || searchError || '';

  useEffect(() => {
    if (hasActiveFilters) {
      setShowFilterDetails(true);
    }
  }, [hasActiveFilters]);

  const detailPanel = () => {
    if (draft) {
      return (
        <div className="detail-panel" aria-live="polite">
          <header className="detail-panel-head">
            <h2>Neues Lesezeichen</h2>
            <p className="detail-panel-subtitle">Füge Kerninformationen hinzu. Weitere Angaben sind optional.</p>
          </header>
          <section className="detail-section" aria-label="Allgemeine Informationen">
            <h3>Allgemeine Informationen</h3>
            <label>
              <span>Titel</span>
              <input type="text" value={detailState?.title ?? ''} onInput={handleDetailChange('title')} />
            </label>
            <label>
              <span>URL</span>
              <input type="url" value={detailState?.url ?? ''} onInput={handleDetailChange('url')} />
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
          </section>
          <section className="detail-section" aria-label="Tags und Notizen">
            <h3>Tags</h3>
            <label>
              <span>Tags (Kommagetrennt)</span>
              <input type="text" value={detailState?.tags ?? ''} onInput={handleDetailChange('tags')} />
            </label>
            <label>
              <span>Notizen</span>
              <textarea value={detailState?.notes ?? ''} onInput={handleDetailChange('notes')} />
            </label>
          </section>
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
          <header className="detail-panel-head">
            <h2>{detailState.title.trim() || 'Unbenanntes Lesezeichen'}</h2>
            <p className="detail-meta">Zuletzt aktualisiert {formatTimestamp(entry?.bookmark.updatedAt)}</p>
          </header>
          <section className="detail-section" aria-label="Allgemeine Informationen">
            <h3>Allgemeine Informationen</h3>
            <label>
              <span>Titel</span>
              <input type="text" value={detailState.title} onInput={handleDetailChange('title')} />
            </label>
            <label>
              <span>URL</span>
              <input type="url" value={detailState.url} onInput={handleDetailChange('url')} />
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
              <button
                type="button"
                onClick={() => entry?.bookmark && handleOpenBookmark(entry.bookmark)}
                disabled={!entry?.bookmark?.url}
              >
                Link im neuen Tab öffnen
              </button>
            </div>
          </section>
          <section className="detail-section" aria-label="Tags und Notizen">
            <h3>Tags</h3>
            <label>
              <span>Tags (Kommagetrennt)</span>
              <input type="text" value={detailState.tags} onInput={handleDetailChange('tags')} />
            </label>
            <h3>Notizen</h3>
            <label>
              <span>Notizen</span>
              <textarea value={detailState.notes} onInput={handleDetailChange('notes')} />
            </label>
          </section>
          <details className="detail-section detail-section-collapsible">
            <summary>Metadaten &amp; Icon</summary>
            <div className="detail-meta-grid">
              <p>
                <span>Erstellt</span>
                <strong>{formatTimestamp(entry.bookmark.createdAt)}</strong>
              </p>
              <p>
                <span>Besuche</span>
                <strong>{entry.bookmark.visitCount}</strong>
              </p>
            </div>
            <section className="detail-icon-section" aria-label="Icon">
              <div className="detail-actions">
                <button
                  type="button"
                  onClick={() => entry?.bookmark && void handleRefreshFavicon(entry.bookmark)}
                  disabled={!entry?.bookmark?.url || isRefreshingFavicon || isUploadingIcon}
                >
                  {isRefreshingFavicon ? 'Favicon wird aktualisiert…' : 'Favicon aktualisieren'}
                </button>
              </div>
              <input
                ref={manualIconInputRef}
                className="visually-hidden"
                type="file"
                accept="image/*"
                onChange={(event) => handleManualIconInputChange(event, entry?.bookmark)}
              />
              <div
                className={`icon-upload-dropzone${isIconDropActive ? ' is-active' : ''}`}
                role="button"
                tabIndex={0}
                aria-label="Icon hochladen"
                onClick={() => manualIconInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    manualIconInputRef.current?.click();
                  }
                }}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIconDropActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer!.dropEffect = 'copy';
                  setIconDropActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  const relatedTarget = event.relatedTarget as Node | null;
                  if (!relatedTarget || !(event.currentTarget as HTMLElement).contains(relatedTarget)) {
                    setIconDropActive(false);
                  }
                }}
                onDrop={(event) => handleIconDrop(event, entry?.bookmark)}
              >
                <strong>{isUploadingIcon ? 'Icon wird hochgeladen…' : 'Icon hier ablegen'}</strong>
                <span>oder klicken, um eine Bilddatei auszuwählen.</span>
              </div>
            </section>
          </details>
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
          <header className="detail-panel-head">
            <h2>{selectedIds.length} Lesezeichen ausgewählt</h2>
            <p className="detail-panel-subtitle">Batch-Aktionen werden auf die gesamte Auswahl angewendet.</p>
          </header>
          <section className="detail-section" aria-label="Tags">
            <h3>Tags</h3>
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
          </section>
          <details className="detail-section detail-section-collapsible">
            <summary>Mehr Aktionen</summary>
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
          </details>
        </div>
      );
    }

    return (
      <div className="detail-panel" aria-live="polite">
        <h2>Aktionen</h2>
        <p>Wähle ein Lesezeichen aus, um Details zu bearbeiten oder Batch-Aktionen auszuführen.</p>
        <div className="detail-actions">
          <button type="button" onClick={() => setDraft({ title: '', url: '', tags: '', notes: '' })}>
            Neues Lesezeichen
          </button>
          <button type="button" onClick={clearSelection}>
            Auswahl löschen
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      className={combineClassNames(
        'dashboard-shell',
        `layout-${layoutMode}`,
        sidebarOpen && 'sidebar-open',
        isSidebarCompact && canUseCompactSidebar && 'sidebar-compact-mode',
      )}
    >
      <header className="dashboard-header" role="banner">
        <div className="header-brand" aria-hidden="true">
          <img src={linkOSaurusIcon} alt="" />
        </div>
        <div className="header-titles">
          <h1>Link-O-Saurus</h1>
        </div>
        <div className="header-actions">
          <label
            className={combineClassNames(
              'search-field',
              'prominent-search',
              isSearchFocused && 'is-focused',
              searchQuery.trim().length > 0 && 'is-typing',
              isSearchActive && 'is-active',
            )}
          >
            <br></br>
            <span className="search-field-label">Dashboard durchsuchen</span>
            <span className="search-input-shell">
              <span className="search-input-icon" aria-hidden="true">
                <SearchIcon />
              </span>
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onInput={handleSearchChange}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                placeholder="Suche nach Titeln, URLs, Tags oder Notizen…"
                aria-label="Dashboard durchsuchen"
              />
              <kbd className="search-shortcut-hint" aria-hidden="true">
                {shortcutHint}
              </kbd>
            </span>
          </label>
        </div>
        <div className="header-utility-actions" role="group" aria-label="Darstellung und Einstellungen">
          <div className="header-theme-toggle-group" role="group" aria-label="Theme auswählen">
            <button
              type="button"
              className={combineClassNames('header-icon-button', themeChoice === 'light' && 'active')}
              onClick={() => {
                void handleThemeChange('light');
              }}
              aria-label="Light-Mode aktivieren"
              title="Light-Mode"
            >
              <FontAwesomeIcon name="fa-sun" style="regular" />
            </button>
            <button
              type="button"
              className={combineClassNames('header-icon-button', themeChoice === 'dark' && 'active')}
              onClick={() => {
                void handleThemeChange('dark');
              }}
              aria-label="Dark-Mode aktivieren"
              title="Dark-Mode"
            >
              <FontAwesomeIcon name="fa-moon" />
            </button>
          </div>
          <button
            type="button"
            className="header-icon-button"
            onClick={handleOpenSettings}
            aria-label="Einstellungen öffnen"
            title="Einstellungen"
          >
            <FontAwesomeIcon name="fa-gear" />
          </button>
        </div>
      </header>
      <br></br>
      <div className="status sr-only" aria-live="polite">
        {liveStatusMessage}
      </div>
      <div className={combineClassNames('dashboard-main', isDetailPanelOpen && 'detail-panel-open')}>
        <aside
          className={combineClassNames(
            'dashboard-sidebar',
            sidebarOpen && 'open',
            isSidebarCompact && canUseCompactSidebar && 'compact',
          )}
        >
          <section>
            <div className="filter-reset">
              {canUseCompactSidebar ? (
                <button
                  type="button"
                  className={combineClassNames('sidebar-compact-toggle', 'sidebar-nav-toggle', isSidebarCompact && 'is-compact')}
                  aria-pressed={isSidebarCompact}
                  aria-label={isSidebarCompact ? 'Sidebar erweitern' : 'Sidebar einklappen'}
                  title={isSidebarCompact ? 'Sidebar erweitern' : 'Sidebar einklappen'}
                  onClick={() => setSidebarCompact((value) => !value)}
                >
                  {isSidebarCompact ? (
                    <>
                      <span aria-hidden="true" className="nav-toggle-icon">☰</span>
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true" className="nav-toggle-icon">☰</span>
                      <span className="nav-toggle-label">Navigation</span>
                    </>
                  )}
                  <span className="sr-only">{isSidebarCompact ? 'Sidebar erweitern' : 'Sidebar einklappen'}</span>
                </button>
              ) : null}
            </div>
          </section>
          {!isSidebarCompact || !canUseCompactSidebar ? (
          <section>
            <header className="sidebar-section-header">
              <h2>Tags</h2>
              <button
                type="button"
                className="icon-button"
                aria-expanded={areTagsExpanded}
                aria-controls="tag-list"
                aria-label={areTagsExpanded ? 'Tags einklappen' : 'Tags anzeigen'}
                title={areTagsExpanded ? 'Tags einklappen' : 'Tags anzeigen'}
                onClick={() => setTagsExpanded((value) => !value)}
              >
                <span aria-hidden="true" className="chevron">
                  {areTagsExpanded ? '▴' : '▾'}
                </span>
                <span className="sr-only">
                  {areTagsExpanded ? 'Tags einklappen' : 'Tags anzeigen'}
                </span>
              </button>
            </header>
            {areTagsExpanded ? (
              <ul id="tag-list" className="sidebar-tag-list">
                {tags.map((tag) => {
                  const mode = getTagFilterMode(activeTagFilterState, tag.path);
                  return (
                  <li key={tag.id}>
                    <button
                      type="button"
                      className={combineClassNames(
                        'tag-item',
                        mode === 'include' && 'active',
                        mode === 'exclude' && 'active-negative',
                      )}
                      aria-pressed={mode !== null}
                      title={isSidebarCompact && canUseCompactSidebar ? tag.path : undefined}
                      aria-label={`${tag.path} filtern (${mode === 'exclude' ? 'negativ' : mode === 'include' ? 'positiv' : 'inaktiv'})`}
                      onClick={() => handleSelectTag(tag.path, 'include')}
                      onContextMenu={(event) => {
                        applyNegativeTagContextAction(event, () => {
                          handleSelectTag(tag.path, 'exclude');
                        });
                      }}
                      onKeyDown={(event) => {
                        if (event.key.toLowerCase() === 'n') {
                          event.preventDefault();
                          handleSelectTag(tag.path, 'exclude');
                        }
                      }}
                    >
                      <span className="tag-item-label">
                        <span className="tag-state-indicator" aria-hidden="true">
                          {mode === 'exclude' ? '−' : mode === 'include' ? '+' : '#'}
                        </span>
                        <span>{tag.path}</span>
                      </span>
                      <span className="usage">{tag.usageCount}</span>
                    </button>
                  </li>
                  );
                })}
              </ul>
            ) : (
              <p id="tag-list" className="sidebar-hint" role="status">
                Tags eingeklappt
              </p>
            )}
          </section>
          ) : null}
          {!isSidebarCompact || !canUseCompactSidebar ? (
          <section className="sidebar-actions">
            <button type="button" onClick={handleOpenSettings} title={SIDEBAR_ACTIONS.importExport.description}>
              {SIDEBAR_ACTIONS.importExport.label}
            </button>
            <button type="button" onClick={() => setSessionDialogOpen(true)}>
              Sessions
            </button>
          </section>
          ) : null}
        </aside>
        <section className="bookmark-list" role="tree" aria-multiselectable="true" aria-label="Bookmark-Hierarchie">
          <div className="list-header">
            <h2>{bookmarkCountLabel}</h2>
            <div className="list-actions">
              <label className="toolbar-select">
                <span>Sortierung</span>
                <select value={bookmarkSortMode} onChange={handleSortModeChange}>
                  <option value="relevance">Relevanz</option>
                  <option value="alphabetical">Alphabetisch</option>
                  <option value="newest">Neueste</option>
                </select>
              </label>
              <fieldset className="view-mode-group compact">
                <legend className="sr-only">Darstellung der Bookmark-Liste</legend>
                {VIEW_MODE_OPTIONS.map((option) => {
                  const isActive = bookmarkViewMode === option.value;
                  return (
                    <label
                      key={option.value}
                      className={combineClassNames('view-toggle-option', isActive && 'active')}
                      title={option.description}
                    >
                      <input
                        type="radio"
                        name="bookmark-view-mode"
                        value={option.value}
                        checked={isActive}
                        onChange={() => {
                          void handleViewModeChange(option.value);
                        }}
                      />
                      <span className="view-toggle-icon">{option.icon}</span>
                      <span className="view-toggle-copy">
                        <strong>{option.label}</strong>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              <div className={combineClassNames('selection-indicator', selectedIds.length === 0 && 'is-empty')}>
                <span>{selectedCountLabel}</span>
                <button
                  type="button"
                  className="selection-indicator-clear"
                  onClick={clearSelection}
                  disabled={selectedIds.length === 0}
                  aria-label="Auswahl entfernen"
                  title="Auswahl entfernen"
                >
                  ×
                </button>
              </div>
              <button type="button" onClick={() => setDraft({ title: '', url: '', tags: '', notes: '' })}>
                Neu
              </button>
            </div>
          </div>
          <div className="active-tag-filters" role="status" aria-live="polite">
            <div className="active-tag-filters-header">
              <p className="active-tag-filters-title">Aktive Filter</p>
              <div className="active-filter-summary">{searchResultLabel}</div>
              <button
                type="button"
                className="active-filter-disclosure"
                aria-expanded={showFilterDetails}
                onClick={() => setShowFilterDetails((value) => !value)}
              >
                {showFilterDetails ? 'Details ausblenden' : 'Details anzeigen'}
              </button>
            </div>
            {showFilterDetails ? (
              <>
                {hasActiveFilters ? (
                  <ul className="active-tag-chip-list" aria-label="Aktive Filter">
                    {activeFilterChips.map((chip) => (
                      <li key={chip.id}>
                        <button
                          type="button"
                          className={combineClassNames('active-tag-chip', chip.tone === 'include' && 'include', chip.tone === 'exclude' && 'exclude')}
                          onClick={chip.remove}
                          title={`${chip.label} entfernen`}
                        >
                          {chip.label} <span aria-hidden="true">×</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="active-filter-empty">Keine aktiven Filter – alle Bookmarks sichtbar.</p>
                )}
                <button
                  type="button"
                  className="active-filter-reset"
                  onClick={handleResetAllFilters}
                  disabled={!hasActiveFilters}
                >
                  Alle Filter entfernen
                </button>
              </>
            ) : null}
          </div>
          <div
            ref={listContainerRef}
            className="list-viewport"
            role="group"
            aria-busy={isSearching}
          >
            {(bookmarkViewMode === 'tiles' ? tileRows.length === 0 : treeRows.length === 0) ? (
              <div className="empty-state">
                {bookmarkViewMode === 'list' && isSearching
                  ? 'Suche…'
                  : 'Keine Einträge gefunden.'}
              </div>
            ) : listHeight > 0 ? (
              <div className={combineClassNames('view-mode-stage', bookmarkViewMode === 'tiles' && 'is-tiles')}>
                {bookmarkViewMode === 'list' ? (
                  <VirtualList
                    key="bookmark-list-view"
                    height={listHeight}
                    width="100%"
                    itemCount={treeRows.length}
                    itemSize={getRowHeight}
                    estimatedItemSize={DEFAULT_BOOKMARK_ROW_HEIGHT}
                    overscanCount={6}
                    itemData={listData}
                    ref={(instance) => {
                      listRef.current = instance as VariableSizeListHandle<BookmarkListData> | null;
                    }}
                  >
                    {BookmarkRowRenderer}
                  </VirtualList>
                ) : (
                  <div className="tile-mode-offset">
                    <TileVirtualList
                      key="bookmark-tile-view"
                      height={Math.max(0, listHeight - TILE_VIEW_TOP_GAP)}
                      width="100%"
                      itemCount={tileRows.length}
                      itemSize={getTileRowHeight}
                      estimatedItemSize={DEFAULT_TILE_ROW_HEIGHT}
                      overscanCount={4}
                      itemData={tileListData}
                      className="bookmark-tiles-list"
                      ref={(instance) => {
                        tileListRef.current = instance as VariableSizeListHandle<BookmarkTileListData> | null;
                      }}
                    >
                      {BookmarkTileRowRenderer}
                    </TileVirtualList>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </section>
        {isDetailPanelOpen ? (
          <aside
            className={combineClassNames(
              'detail-column',
              'is-open',
              !hasActiveDetailContext && 'is-muted',
            )}
            aria-label="Detailbereich"
          >
            <div className="detail-column-header">
              <div className="detail-column-heading">
                <p className="detail-column-title">Detailbereich</p>
                <span className="detail-column-mode">
                  {isDetailAutoOpenEnabled ? 'Auto-Modus aktiv' : 'Manueller Modus aktiv'}
                </span>
              </div>
            </div>
            {detailPanel()}
          </aside>
        ) : null}
        <button
          type="button"
          className={combineClassNames('detail-toggle-button', isDetailPanelOpen && 'is-open')}
          aria-expanded={isDetailPanelOpen}
          aria-label={isDetailPanelOpen ? 'Detailbereich einklappen' : 'Detailbereich öffnen'}
          title={isDetailPanelOpen ? 'Detailbereich einklappen' : 'Detailbereich öffnen'}
          onClick={isDetailPanelOpen ? handleManualCloseDetailPanel : handleManualOpenDetailPanel}
        >
          {isDetailPanelOpen ? (
            <>
              Details <span aria-hidden="true">→</span>
            </>
          ) : (
            <>
              <span aria-hidden="true">←</span> Details
            </>
          )}
        </button>
      </div>
      <div
        className={combineClassNames('sidebar-floating-tooltip', sidebarTooltip.visible && 'visible')}
        style={
          {
            '--tooltip-x': `${Math.round(sidebarTooltip.x)}px`,
            '--tooltip-y': `${Math.round(sidebarTooltip.y)}px`,
          } as CSSProperties
        }
        role="tooltip"
        aria-hidden={!sidebarTooltip.visible}
      >
        {sidebarTooltip.label}
      </div>


      {isSessionDialogOpen ? (
        <SessionDialog
          sessions={sessions}
          state={sessionState}
          onClose={() => setSessionDialogOpen(false)}
          onSave={handleSessionSave}
          onOpen={handleSessionOpen}
          onDelete={handleSessionDelete}
        />
      ) : null}
    </div>
  );
};

export default DashboardApp;
