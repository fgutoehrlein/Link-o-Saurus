import { wrap, releaseProxy } from 'comlink';
import type { Remote } from 'comlink';
import type { CSSProperties, FunctionalComponent, JSX } from 'preact';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
} from 'preact/hooks';
import {
  VariableSizeList,
  type VariableSizeListProps,
  type ListChildComponentProps,
} from 'react-window';
import type { VariableSizeList as VariableSizeListHandle } from 'react-window';
import type { ComponentType as ReactComponentType } from 'react';
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
import type { ImportExportWorkerApi } from '../shared/import-export-worker';
import type { ExportFormat, ImportProgress } from '../shared/import-export';
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
  parseTagFilterFromParams,
  toggleTagFilter,
  type TagFilterMode,
  type TagFilterState,
  writeTagFilterToParams,
} from '../shared/tag-filter';
import './App.css';
import { capE2EReadyTimestamp } from '../shared/e2e-flags';
import { sortBookmarks } from '../shared/bookmark-sort';
import {
  getGridColumnCount,
  resolveBookmarkViewMode,
  toGridRows,
  type BookmarkViewMode,
} from './view-mode';
import linkOSaurusIcon from '../../assets/link-o-saurus-icon.png';

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
  readonly setRowHeight: (rowIndex: number, height: number) => void;
  readonly selected: Set<string>;
  readonly onRowClick: (event: MouseEvent | KeyboardEvent, id: string) => void;
  readonly onOpenBookmark: (bookmark: Bookmark) => void;
  readonly onRowContextMenu: (event: MouseEvent, id: string) => void;
  readonly onDragStart: (event: DragEvent, id: string) => void;
  readonly activeTagFilters: TagFilterState;
  readonly onTagFilterAction: (event: MouseEvent | KeyboardEvent, tag: string, mode: TagFilterMode) => void;
};

type BookmarkTileListData = Omit<BookmarkListData, 'ids' | 'setRowHeight'> & {
  readonly rows: readonly (readonly string[])[];
  readonly columnCount: number;
  readonly setRowHeight: (rowIndex: number, height: number) => void;
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

type ActiveFilterChip = {
  readonly id: string;
  readonly label: string;
  readonly tone?: 'default' | 'include' | 'exclude';
  readonly remove: () => void;
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
  readonly sortMode?: BookmarkSortMode;
  readonly includeTags: string[];
  readonly excludeTags: string[];
  readonly isNew: boolean;
  readonly newTitle: string;
  readonly newUrl: string;
  readonly newTags: string;
};

const DEFAULT_ITEM_HEIGHT = 90;
const DEFAULT_TILE_ROW_HEIGHT = 248;
const MAX_QUERY_RESULTS = 600;
const ROW_HEIGHT_UPDATE_THRESHOLD = 1;
const MAX_VISIBLE_BOOKMARK_TAGS = 3;
const MAX_VISIBLE_TILE_TITLE_LINES = 3;
const MAX_VISIBLE_TILE_DETAIL_LINES = 1;

type ThemeOption = {
  readonly value: ThemeChoice;
  readonly title: string;
  readonly description: string;
  readonly icon: string;
};

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

const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    value: 'system',
    title: 'System',
    description: 'Passt sich automatisch deinem Gerät an.',
    icon: '🖥️',
  },
  {
    value: 'light',
    title: 'Light mode',
    description: 'Helles Interface für maximale Klarheit.',
    icon: '🌤️',
  },
  {
    value: 'dark',
    title: 'Default mode',
    description: 'Unser fokussierter Standard-Look.',
    icon: '🌙',
  },
];

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
const BOARD_ICON_SET = ['🗂️', '📁', '📌', '📚', '🧭', '🧩', '⭐'] as const;
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
  const sortParam = (params.get('sort') ?? '').toLowerCase();
  const sortMode: BookmarkSortMode | undefined =
    sortParam === 'relevance' || sortParam === 'alphabetical' || sortParam === 'newest'
      ? sortParam
      : undefined;
  const parsedTagFilters = parseTagFilterFromParams(params);
  const includeTags = sanitizeRouteTagsParam(parsedTagFilters.include);
  const excludeTags = sanitizeRouteTagsParam(parsedTagFilters.exclude);
  const isNew = params.get('new') === '1';
  const newTitle = sanitizeRouteText(params.get('title') ?? '', ROUTE_MAX_TITLE_LENGTH);
  const newUrl = sanitizeRouteUrl(params.get('url') ?? '');
  const tags = sanitizeRouteTagsParam(params.getAll('tags'));
  const newTags = tags.join(', ');

  const normalizedFilters = normalizeTagFilterState({
    include: includeTags,
    exclude: excludeTags,
  });

  return {
    search,
    boardId,
    sortMode,
    includeTags: normalizedFilters.include,
    excludeTags: normalizedFilters.exclude,
    isNew,
    newTitle,
    newUrl,
    newTags,
  };
};

const updateRouteHash = (snapshot: RouteSnapshot): void => {
  const params = new URLSearchParams();
  if (snapshot.search) {
    params.set('q', snapshot.search);
  }
  if (snapshot.boardId) {
    params.set('board', snapshot.boardId);
  }
  if (snapshot.sortMode) {
    params.set('sort', snapshot.sortMode);
  }
  writeTagFilterToParams(params, {
    include: snapshot.includeTags,
    exclude: snapshot.excludeTags,
  });
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

const getBookmarkInitial = (bookmark: Bookmark): string => {
  const source = bookmark.title?.trim() || bookmark.url;
  return source ? source.charAt(0).toUpperCase() : '🔖';
};

const getBookmarkDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return url;
  }
};

const BookmarkAvatar: FunctionalComponent<{ readonly bookmark: Bookmark }> = ({ bookmark }) => {
  const [hasImageError, setHasImageError] = useState(false);
  const favicon = bookmark.faviconUrl?.trim();
  const showFavicon = Boolean(favicon) && !hasImageError;
  return (
    <div className="bookmark-avatar" aria-hidden="true">
      {showFavicon ? (
        <img
          src={favicon}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setHasImageError(true)}
        />
      ) : (
        <span className="bookmark-avatar-fallback">{getBookmarkInitial(bookmark)}</span>
      )}
    </div>
  );
};

type BookmarkRowProps = ListChildComponentProps<BookmarkListData>;

const VirtualList = VariableSizeList as unknown as FunctionalComponent<
  VariableSizeListProps<BookmarkListData>
>;
const TileVirtualList = VariableSizeList as unknown as FunctionalComponent<
  VariableSizeListProps<BookmarkTileListData>
>;

const BookmarkRow = ({ index, style, data }: BookmarkRowProps): JSX.Element => {
  const id = data.ids[index];
  const rowRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = rowRef.current;
    if (!element) {
      return undefined;
    }
    const measureHeight = (entry?: ResizeObserverEntry): number => {
      const natural = Math.max(
        element.scrollHeight,
        element.offsetHeight,
        element.getBoundingClientRect().height,
      );
      if (entry?.borderBoxSize) {
        const borderBox = Array.isArray(entry.borderBoxSize)
          ? entry.borderBoxSize[0]
          : entry.borderBoxSize;
        if (borderBox) {
          return Math.max(borderBox.blockSize, natural);
        }
      }
      return natural;
    };
    data.setRowHeight(index, measureHeight());
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      if (!entries.length) {
        return;
      }
      data.setRowHeight(index, measureHeight(entries[0]));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [data, index, id]);

  const entry = data.bookmarkById.get(id);
  if (!entry) {
    return <div style={style as JSX.CSSProperties} className="bookmark-row placeholder" />;
  }
  const { bookmark, board, category } = entry;
  const isSelected = data.selected.has(id);
  const handleClick = (event: MouseEvent) => {
    data.onRowClick(event, id);
  };

  const handleDoubleClick = (event: MouseEvent) => {
    event.preventDefault();
    data.onOpenBookmark(bookmark);
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
      ref={rowRef}
      style={style as JSX.CSSProperties}
      onClick={handleClick}
      onDblClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
      draggable
      onDragStart={handleDragStart}
    >
      <BookmarkAvatar bookmark={bookmark} />
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
            {bookmark.tags.slice(0, MAX_VISIBLE_BOOKMARK_TAGS).map((tag) => {
              const mode = getTagFilterMode(data.activeTagFilters, tag);
              return (
                <li key={`${bookmark.id}-${tag}`}>
                  <button
                    type="button"
                    className={combineClassNames(
                      'bookmark-tag-chip',
                      mode === 'include' && 'is-include',
                      mode === 'exclude' && 'is-exclude',
                    )}
                    aria-label={`${tag} ${mode === 'exclude' ? 'ausgeschlossen' : mode === 'include' ? 'eingeschlossen' : 'filtern'}`}
                    title="Klick: einschließen · Rechtsklick oder Taste N: ausschließen"
                    onClick={(event) => data.onTagFilterAction(event, tag, 'include')}
                    onContextMenu={(event) => {
                      applyNegativeTagContextAction(event, () => {
                        data.onTagFilterAction(event, tag, 'exclude');
                      });
                    }}
                    onKeyDown={(event) => {
                      if (event.key.toLowerCase() === 'n') {
                        data.onTagFilterAction(event, tag, 'exclude');
                      }
                    }}
                  >
                    {tag}
                  </button>
                </li>
              );
            })}
            {bookmark.tags.length > MAX_VISIBLE_BOOKMARK_TAGS ? (
              <li
                className="bookmark-tag-overflow"
                aria-label={`${bookmark.tags.length - MAX_VISIBLE_BOOKMARK_TAGS} weitere Tags`}
              >
                +{bookmark.tags.length - MAX_VISIBLE_BOOKMARK_TAGS}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
      <div className="bookmark-updated" title={`Zuletzt aktualisiert ${formatTimestamp(bookmark.updatedAt)}`}>
        {formatTimestamp(bookmark.updatedAt)}
      </div>
    </div>
  );
};

const BookmarkRowRenderer = BookmarkRow as unknown as ReactComponentType<
  ListChildComponentProps<BookmarkListData>
>;

type BookmarkTileRowProps = ListChildComponentProps<BookmarkTileListData>;

const BookmarkTileRow = ({ index, style, data }: BookmarkTileRowProps): JSX.Element => {
  const row = data.rows[index] ?? [];
  const rowRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = rowRef.current;
    if (!element) {
      return undefined;
    }
    const measureTilesHeight = (): number => {
      const computed = window.getComputedStyle(element);
      const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
      let maxTileHeight = 0;
      element.querySelectorAll<HTMLElement>('.bookmark-tile').forEach((tile) => {
        const tileHeight = Math.max(
          tile.scrollHeight,
          tile.offsetHeight,
          tile.getBoundingClientRect().height,
        );
        maxTileHeight = Math.max(maxTileHeight, tileHeight);
      });
      return Math.ceil(maxTileHeight + paddingTop + paddingBottom);
    };
    const measureHeight = (entry?: ResizeObserverEntry): number => {
      const natural = Math.max(
        measureTilesHeight(),
        element.scrollHeight,
        element.offsetHeight,
        element.getBoundingClientRect().height,
      );
      if (entry?.borderBoxSize) {
        const borderBox = Array.isArray(entry.borderBoxSize)
          ? entry.borderBoxSize[0]
          : entry.borderBoxSize;
        if (borderBox) {
          return Math.max(borderBox.blockSize, natural);
        }
      }
      return natural;
    };
    data.setRowHeight(index, measureHeight());
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      if (!entries.length) {
        return;
      }
      data.setRowHeight(index, measureHeight(entries[0]));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [data, index, row]);

  return (
    <div
      className="bookmark-tile-row"
      ref={rowRef}
      style={
        {
          ...(style as JSX.CSSProperties),
          '--tile-columns': String(data.columnCount),
        } as JSX.CSSProperties
      }
    >
      {row.map((id) => {
        const entry = data.bookmarkById.get(id);
        if (!entry) {
          return null;
        }
        const { bookmark, board, category } = entry;
        const isSelected = data.selected.has(id);
        const domain = getBookmarkDomain(bookmark.url);
        const detailText = bookmark.notes?.trim() || domain;
        const visibleTags = bookmark.tags.slice(0, MAX_VISIBLE_BOOKMARK_TAGS);
        const hiddenTagCount = Math.max(0, bookmark.tags.length - visibleTags.length);
        const tileTitleStyle = {
          '--tile-title-line-clamp': String(MAX_VISIBLE_TILE_TITLE_LINES),
        } as CSSProperties;
        const tileDetailStyle = {
          '--tile-detail-line-clamp': String(MAX_VISIBLE_TILE_DETAIL_LINES),
        } as CSSProperties;
        const secondaryMeta = [category?.title, board?.title].filter(Boolean).join(' · ');
        return (
          <article
            key={id}
            role="option"
            aria-selected={isSelected}
            tabIndex={0}
            className={combineClassNames('bookmark-tile', isSelected && 'selected')}
            onClick={(event) => data.onRowClick(event, id)}
            onDblClick={(event) => {
              event.preventDefault();
              data.onOpenBookmark(bookmark);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                data.onRowClick(event, id);
              }
            }}
            onContextMenu={(event) => data.onRowContextMenu(event, id)}
            draggable
            onDragStart={(event) => data.onDragStart(event, id)}
            title={secondaryMeta || undefined}
          >
            <div className="bookmark-tile-head">
              <BookmarkAvatar bookmark={bookmark} />
              <div className="bookmark-tile-main">
                <h3 className="bookmark-title" style={tileTitleStyle} title={bookmark.title || bookmark.url}>
                  {bookmark.title || bookmark.url}
                </h3>
              </div>
            </div>
            <p
              className="bookmark-detail-text"
              style={tileDetailStyle}
              title={bookmark.notes?.trim() ? bookmark.notes : bookmark.url}
            >
              {detailText}
            </p>
            {bookmark.tags.length > 0 ? (
              <ul className="bookmark-tags" aria-label="Tags">
                {visibleTags.map((tag) => {
                  const mode = getTagFilterMode(data.activeTagFilters, tag);
                  return (
                    <li key={`${bookmark.id}-${tag}`}>
                      <button
                        type="button"
                        className={combineClassNames(
                          'bookmark-tag-chip',
                          mode === 'include' && 'is-include',
                          mode === 'exclude' && 'is-exclude',
                        )}
                        aria-label={`${tag} ${mode === 'exclude' ? 'ausgeschlossen' : mode === 'include' ? 'eingeschlossen' : 'filtern'}`}
                        title="Klick: einschließen · Rechtsklick oder Taste N: ausschließen"
                        onClick={(event) => data.onTagFilterAction(event, tag, 'include')}
                        onContextMenu={(event) => {
                          applyNegativeTagContextAction(event, () => {
                            data.onTagFilterAction(event, tag, 'exclude');
                          });
                        }}
                        onKeyDown={(event) => {
                          if (event.key.toLowerCase() === 'n') {
                            data.onTagFilterAction(event, tag, 'exclude');
                          }
                        }}
                      >
                        {tag}
                      </button>
                    </li>
                  );
                })}
                {hiddenTagCount > 0 ? (
                  <li className="bookmark-tag-overflow" aria-label={`${hiddenTagCount} weitere Tags`}>
                    +{hiddenTagCount}
                  </li>
                ) : null}
              </ul>
            ) : (
              <div className="bookmark-tags bookmark-tags-empty">Keine Tags</div>
            )}
          </article>
        );
      })}
    </div>
  );
};

const BookmarkTileRowRenderer = BookmarkTileRow as unknown as ReactComponentType<
  ListChildComponentProps<BookmarkTileListData>
>;

const DashboardApp: FunctionalComponent = () => {
  const [boards, setBoards] = useState<readonly Board[]>([]);
  const [categories, setCategories] = useState<readonly Category[]>([]);
  const [bookmarks, setBookmarks] = useState<readonly Bookmark[]>([]);
  const [tags, setTags] = useState<readonly Tag[]>([]);
  const [sessions, setSessions] = useState<readonly SessionPack[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeBoardId, setActiveBoardId] = useState<string>('');
  const [activeCategoryId, setActiveCategoryId] = useState<string>('');
  const [activeTagFilters, setActiveTagFilters] = useState<TagFilterState>(EMPTY_TAG_FILTER_STATE);
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
  const [bookmarkViewMode, setBookmarkViewMode] = useState<BookmarkViewMode>('list');
  const [bookmarkSortMode, setBookmarkSortMode] = useState<BookmarkSortMode>('relevance');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [areBoardsExpanded, setBoardsExpanded] = useState<boolean>(true);
  const [areTagsExpanded, setTagsExpanded] = useState<boolean>(true);
  const [isSidebarCompact, setSidebarCompact] = useState<boolean>(false);
  const [isRefreshingFavicon, setRefreshingFavicon] = useState<boolean>(false);
  const [isIconDropActive, setIconDropActive] = useState<boolean>(false);
  const [isUploadingIcon, setUploadingIcon] = useState<boolean>(false);
  const [isDetailPanelCollapsed, setDetailPanelCollapsed] = useState<boolean>(true);
  const [showAdvancedControls, setShowAdvancedControls] = useState<boolean>(true);
  const [showFilterDetails, setShowFilterDetails] = useState<boolean>(false);
  const [areUtilitiesExpanded, setUtilitiesExpanded] = useState<boolean>(false);

  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const [listHeight, setListHeight] = useState<number>(320);
  const [listWidth, setListWidth] = useState<number>(MIN_RESIZE_WIDTH);
  const listRef = useRef<VariableSizeListHandle<BookmarkListData> | null>(null);
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
  const canUseCompactSidebar = layoutMode !== 'single';

  useEffect(() => {
    if (layoutMode === 'triple') {
      setSidebarOpen(true);
    } else if (layoutMode === 'single') {
      setSidebarOpen(false);
      setSidebarCompact(false);
    }
  }, [layoutMode]);

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
  }, [searchQuery, searchHits, bookmarkEntries, bookmarkSortMode, activeBoardId, activeCategoryId, activeTagFilterState, showArchived]);

  const totalBookmarkCount = bookmarks.length;
  const visibleBookmarkCount = filteredIds.length;
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

  const getRowHeight = useCallback(
    (index: number) => listRowHeightsRef.current.get(index) ?? DEFAULT_ITEM_HEIGHT,
    [],
  );

  const setListRowHeight = useCallback((rowIndex: number, size: number) => {
    const height = Math.max(DEFAULT_ITEM_HEIGHT, Math.ceil(size));
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
  }, []);

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

  const listData = useMemo<BookmarkListData>(() => ({
    ids: filteredIds,
    bookmarkById: bookmarkEntries,
    setRowHeight: setListRowHeight,
    selected: selectedSet,
    onRowClick: handleRowSelection,
    onOpenBookmark: handleOpenBookmark,
    onRowContextMenu: handleRowContextMenu,
    onDragStart: handleRowDragStart,
    activeTagFilters: activeTagFilterState,
    onTagFilterAction: handleTagFilterAction,
  }), [
    filteredIds,
    bookmarkEntries,
    setListRowHeight,
    selectedSet,
    handleRowSelection,
    handleOpenBookmark,
    handleRowContextMenu,
    handleRowDragStart,
    activeTagFilterState,
    handleTagFilterAction,
  ]);

  const tileColumnCount = useMemo(() => getGridColumnCount(listWidth), [listWidth]);
  const tileRows = useMemo(
    () => toGridRows(filteredIds, tileColumnCount),
    [filteredIds, tileColumnCount],
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
  }, [filteredIds]);

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
  }, [tileColumnCount, filteredIds]);

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


  const handleClearFilters = useCallback(() => {
    setActiveBoardId('');
    setActiveCategoryId('');
    setActiveTagFilters(EMPTY_TAG_FILTER_STATE);
    clearSelection();
  }, [clearSelection]);

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
        try {
          const result =
            format === 'html'
              ? await importWorkerRef.current.importHtml(file, { dedupe: true })
              : await importWorkerRef.current.importJson(file, { dedupe: true });
        setImportState({ busy: false, progress: null, error: null });
        setStatusMessage(`Import abgeschlossen (${result.stats.createdBookmarks} neue Einträge).`);
        const [updatedBookmarks, updatedTags] = await Promise.all([
          listBookmarks({ includeArchived: true }),
          listTags(),
        ]);
        setBookmarks(updatedBookmarks);
        setTags(updatedTags);
          if (searchWorkerRef.current) {
            try {
              await searchWorkerRef.current.rebuildIndex(updatedBookmarks);
              setSearchGeneration((value) => value + 1);
            } catch (error) {
              console.error('Search index rebuild failed after import', error);
              setSearchError('Suche eventuell eingeschränkt.');
            }
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
    if (hasActiveDetailContext) {
      setDetailPanelCollapsed(false);
      return;
    }
    setDetailPanelCollapsed(true);
  }, [hasActiveDetailContext]);

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
    <div className={combineClassNames('dashboard-shell', `layout-${layoutMode}`, sidebarOpen && 'sidebar-open')}>
      <header className="dashboard-header" role="banner">
        <div className="header-brand" aria-hidden="true">
          <img src={linkOSaurusIcon} alt="" />
        </div>
        <div className="header-titles">
          <h1>Link-O-Saurus</h1>
        </div>
        <div className="header-actions">
          <label className="search-field prominent-search">
            <span className="search-field-label">Dashboard durchsuchen</span>
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onInput={handleSearchChange}
              placeholder="Suche…"
              aria-label="Dashboard durchsuchen"
            />
          </label>
        </div>
      </header>
      <div className="dashboard-toolbar">
        <div className="toolbar-primary">
          <span className="status-chip">{searchResultLabel}</span>
          <span className="status-chip muted">{selectedCountLabel}</span>
          <button
            type="button"
            className={combineClassNames('toolbar-disclosure', showAdvancedControls && 'active')}
            aria-expanded={showAdvancedControls}
            onClick={() => setShowAdvancedControls((value) => !value)}
          >
            <span aria-hidden="true">{showAdvancedControls ? '●' : '○'}</span> Mehr Optionen
            {showAdvancedControls ? <span className="toolbar-disclosure-state">Aktiv</span> : null}
          </button>
        </div>
        <div className="status" aria-live="polite">
          {isSearching ? 'Suche…' : `${searchResultLabel}${statusMessage || searchError ? ` · ${statusMessage || searchError}` : ''}`}
        </div>
        {showAdvancedControls ? (
          <div className="toolbar-advanced" role="group" aria-label="Erweiterte Ansichtsoptionen">
            <label className="toggle">
              <input type="checkbox" checked={showArchived} onChange={handleToggleArchived} />
              Archivierte anzeigen
            </label>
          </div>
        ) : null}
      </div>
      <div className="dashboard-main">
        <aside
          className={combineClassNames(
            'dashboard-sidebar',
            sidebarOpen && 'open',
            isSidebarCompact && canUseCompactSidebar && 'compact',
          )}
        >
          <section>
            <div className="filter-reset">
              <button type="button" onClick={handleClearFilters}>
                Filter zurücksetzen
              </button>
              {canUseCompactSidebar ? (
                <button
                  type="button"
                  className="sidebar-compact-toggle"
                  aria-pressed={isSidebarCompact}
                  aria-label={isSidebarCompact ? 'Sidebar erweitern' : 'Sidebar einklappen'}
                  title={isSidebarCompact ? 'Sidebar erweitern' : 'Sidebar einklappen'}
                  onClick={() => setSidebarCompact((value) => !value)}
                >
                  <span aria-hidden="true">{isSidebarCompact ? '⟩⟩' : '⟨⟨'}</span>
                  <span className="sr-only">{isSidebarCompact ? 'Sidebar erweitern' : 'Sidebar einklappen'}</span>
                </button>
              ) : null}
            </div>
            <header className="sidebar-section-header">
              <h2>Boards</h2>
              <div className="section-buttons">
                <button
                  type="button"
                  className="icon-button"
                  aria-expanded={areBoardsExpanded}
                  aria-controls="board-list"
                  aria-label={areBoardsExpanded ? 'Boards einklappen' : 'Boards ausklappen'}
                  title={areBoardsExpanded ? 'Boards einklappen' : 'Boards ausklappen'}
                  onClick={() => setBoardsExpanded((value) => !value)}
                >
                  <span aria-hidden="true" className="chevron">
                    {areBoardsExpanded ? '▴' : '▾'}
                  </span>
                  <span className="sr-only">
                    {areBoardsExpanded ? 'Boards einklappen' : 'Boards ausklappen'}
                  </span>
                </button>
              </div>
            </header>
            {areBoardsExpanded ? (
              <ul id="board-list" className="sidebar-list">
                {boards.map((board, boardIndex) => {
                  const boardCategories = categories.filter((category) => category.boardId === board.id);
                  const boardIcon = BOARD_ICON_SET[boardIndex % BOARD_ICON_SET.length];
                  return (
                  <li key={board.id}>
                    <button
                      type="button"
                      className={combineClassNames('sidebar-item', activeBoardId === board.id && 'active')}
                      aria-current={activeBoardId === board.id ? 'page' : undefined}
                      title={isSidebarCompact && canUseCompactSidebar ? board.title : undefined}
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
                      <span className="sidebar-item-label">
                        <span className="sidebar-item-icon" aria-hidden="true">
                          {boardIcon}
                        </span>
                        <span className="sidebar-item-text">{board.title}</span>
                      </span>
                      <span className="usage">{boardCategories.length}</span>
                    </button>
                    <ul className="sidebar-sublist">
                      {boardCategories.map((category) => (
                          <li key={category.id}>
                            <button
                              type="button"
                              className={combineClassNames(
                                'sidebar-subitem',
                                activeCategoryId === category.id && 'active',
                              )}
                              title={isSidebarCompact && canUseCompactSidebar ? category.title : undefined}
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
                              <span className="sidebar-item-label">
                                <span className="sidebar-item-icon" aria-hidden="true">
                                  •
                                </span>
                                <span className="sidebar-item-text">{category.title}</span>
                              </span>
                            </button>
                          </li>
                        ))}
                    </ul>
                  </li>
                  );
                })}
              </ul>
            ) : (
              <p className="sidebar-hint" id="board-list" role="status">
                Boards eingeklappt
              </p>
            )}
          </section>
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
          <section className="sidebar-actions">
            <button type="button" onClick={() => setImportDialogOpen(true)}>
              Import / Export
            </button>
            <button type="button" onClick={() => setSessionDialogOpen(true)}>
              Sessions
            </button>
            <button
              type="button"
              className="toolbar-disclosure"
              aria-expanded={areUtilitiesExpanded}
              onClick={() => setUtilitiesExpanded((value) => !value)}
            >
              {areUtilitiesExpanded ? 'Darstellung ausblenden' : 'Darstellung anzeigen'}
            </button>
            {areUtilitiesExpanded ? (
              <div className="theme-card" role="group" aria-label="Theme selection">
                <div className="theme-card-header">
                  <p className="theme-card-label">Theme</p>
                  <p className="theme-card-hint">Wähle den Look, der zu dir passt.</p>
                </div>
                <div className="theme-options">
                  {THEME_OPTIONS.map((option) => {
                    const isActive = themeChoice === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={combineClassNames('theme-option', isActive && 'selected')}
                        aria-pressed={isActive}
                        onClick={() => handleThemeChange(option.value)}
                      >
                        <span className="theme-option-icon" aria-hidden="true">
                          {option.icon}
                        </span>
                        <span className="theme-option-copy">
                          <strong>{option.title}</strong>
                          <small>{option.description}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>
        </aside>
        <section className="bookmark-list" role="listbox" aria-multiselectable="true">
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
              <div className="view-toggle compact" role="radiogroup" aria-label="Darstellung der Bookmark-Liste">
                {VIEW_MODE_OPTIONS.map((option) => {
                  const isActive = bookmarkViewMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      className={combineClassNames('view-toggle-option', isActive && 'active')}
                      aria-checked={isActive}
                      title={option.description}
                      onClick={() => {
                        void handleViewModeChange(option.value);
                      }}
                    >
                      <span className="view-toggle-icon">{option.icon}</span>
                      <span className="view-toggle-copy">
                        <strong>{option.label}</strong>
                      </span>
                    </button>
                  );
                })}
              </div>
              <button type="button" onClick={clearSelection}>
                Auswahl leeren
              </button>
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
            aria-busy={isSearching}
          >
            {filteredIds.length === 0 ? (
              <div className="empty-state">
                {isSearching ? 'Suche…' : 'Keine Einträge gefunden.'}
              </div>
            ) : listHeight > 0 ? (
              <div className={combineClassNames('view-mode-stage', bookmarkViewMode === 'tiles' && 'is-tiles')}>
                {bookmarkViewMode === 'list' ? (
                  <VirtualList
                    key="bookmark-list-view"
                    height={listHeight}
                    width="100%"
                    itemCount={filteredIds.length}
                    itemSize={getRowHeight}
                    estimatedItemSize={DEFAULT_ITEM_HEIGHT}
                    overscanCount={6}
                    itemData={listData}
                    ref={(instance) => {
                      listRef.current = instance as VariableSizeListHandle<BookmarkListData> | null;
                    }}
                  >
                    {BookmarkRowRenderer}
                  </VirtualList>
                ) : (
                  <TileVirtualList
                    key="bookmark-tile-view"
                    height={listHeight}
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
                )}
              </div>
            ) : null}
          </div>
        </section>
        <aside
          className={combineClassNames(
            'detail-column',
            !hasActiveDetailContext && 'is-muted',
            isDetailPanelCollapsed && 'is-collapsed',
          )}
        >
          <div className="detail-column-header">
            <p className="detail-column-title">Detailbereich</p>
            <button
              type="button"
              className="detail-collapse-toggle"
              aria-expanded={!isDetailPanelCollapsed}
              onClick={() => setDetailPanelCollapsed((value) => !value)}
            >
              {isDetailPanelCollapsed ? 'Einblenden' : 'Einklappen'}
            </button>
          </div>
          {isDetailPanelCollapsed ? (
            <p className="detail-column-placeholder">
              {hasActiveDetailContext
                ? 'Ein Lesezeichen ist ausgewählt. Öffne den Bereich für Bearbeitungen.'
                : 'Wähle ein Lesezeichen aus, um Details und Aktionen anzuzeigen.'}
            </p>
          ) : (
            detailPanel()
          )}
        </aside>
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
