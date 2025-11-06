import type { Table } from 'dexie';
import { db, LinkOSaurusDB } from './db';
import type { Board, Bookmark, Category } from './types';
import { normalizeUrl } from './url';

export type ImportFormat = 'html' | 'json';

export type ImportProgress =
  | {
      readonly stage: 'parsing';
      readonly processedBytes: number;
      readonly totalBytes?: number;
      readonly processedBookmarks: number;
      readonly createdBookmarks: number;
      readonly skippedBookmarks: number;
      readonly duplicateBookmarks: number;
    }
  | {
      readonly stage: 'saving';
      readonly processedBookmarks: number;
      readonly totalBookmarks: number;
    };

export type ImportCallbacks = {
  readonly onProgress?: (progress: ImportProgress) => void;
};

export type ImportOptions = {
  readonly dedupe?: boolean;
};

export type ImportStats = {
  readonly processedBookmarks: number;
  readonly createdBookmarks: number;
  readonly skippedBookmarks: number;
  readonly duplicateBookmarks: number;
};

export type ImportResult = {
  readonly stats: ImportStats;
};

export type ExportFormat = 'html' | 'json' | 'zip';

export type ExportOptions = {
  readonly includeFavicons?: boolean;
};

export type ExportResult = {
  readonly blob: Blob;
  readonly fileName: string;
};

const DEFAULT_BOARD_TITLE = 'Imported Bookmarks';
const DEFAULT_CATEGORY_TITLE = 'Unsorted';

const HTML_ENTITY_MAP: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
};

const decodeHtmlEntities = (input: string): string => {
  return input.replace(/(&lt;|&gt;|&amp;|&quot;|&#39;)/giu, (entity) => HTML_ENTITY_MAP[entity] ?? entity);
};

const normalizeTitle = (title: string | undefined | null): string => {
  const trimmed = title?.trim() ?? '';
  if (!trimmed) {
    return '';
  }
  return trimmed.replace(/\s+/gu, ' ');
};

const normalizeKey = (value: string): string => value.trim().toLowerCase();

type BookmarkCandidate = {
  readonly url: string;
  readonly title: string;
  readonly description?: string;
  readonly tags: string[];
  readonly addDate?: number;
  readonly lastModified?: number;
  readonly path: readonly string[];
};

type NetscapeParserState = {
  readonly stack: string[];
  pendingBookmark?: BookmarkCandidate;
};

const flushPendingBookmark = (
  state: NetscapeParserState,
  emit: (bookmark: BookmarkCandidate) => void,
) => {
  const bookmark = state.pendingBookmark;
  if (bookmark) {
    emit(bookmark);
    state.pendingBookmark = undefined;
  }
};

type NetscapeBookmarkParserConfig = {
  readonly onBookmark: (bookmark: BookmarkCandidate) => void;
};

class NetscapeBookmarkParser {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly totalBytes: number;
  private readonly config: NetscapeBookmarkParserConfig;
  private readonly state: NetscapeParserState = { stack: [] };
  private readonly decoder = new TextDecoder('utf-8');
  private buffer = '';
  private processedBytes = 0;

  constructor(stream: ReadableStream<Uint8Array>, totalBytes: number, config: NetscapeBookmarkParserConfig) {
    this.reader = stream.getReader();
    this.totalBytes = totalBytes;
    this.config = config;
  }

  async parse(onChunk?: (processedBytes: number, totalBytes: number) => void): Promise<void> {
    while (true) {
      const { done, value } = await this.reader.read();
      if (value) {
        this.processedBytes += value.byteLength;
        this.buffer += this.decoder.decode(value, { stream: !done });
        this.processBuffer();
        if (onChunk) {
          onChunk(this.processedBytes, this.totalBytes);
        }
      }

      if (done) {
        break;
      }
    }

    this.processBuffer(true);
  }

  private processBuffer(forceFlush: boolean = false) {
    let newlineIndex: number;

    while ((newlineIndex = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.processLine(line);
    }

    if (forceFlush && this.buffer.length > 0) {
      const remaining = this.buffer.trim();
      this.buffer = '';
      if (remaining) {
        this.processLine(remaining);
      }
    }

    if (forceFlush) {
      flushPendingBookmark(this.state, this.config.onBookmark);
    }
  }

  private processLine(line: string) {
    if (!line) {
      return;
    }

    if (/^<DL/iu.test(line)) {
      return;
    }

    if (/^<\/DL/iu.test(line)) {
      flushPendingBookmark(this.state, this.config.onBookmark);
      if (this.state.stack.length > 0) {
        this.state.stack.pop();
      }
      return;
    }

    if (/^<DT><H3/iu.test(line)) {
      flushPendingBookmark(this.state, this.config.onBookmark);
      const match = line.match(/^<DT><H3([^>]*)>(.*?)<\/H3>/iu);
      const title = decodeHtmlEntities(match?.[2] ?? '').trim() || DEFAULT_BOARD_TITLE;
      this.state.stack.push(title);
      return;
    }

    if (/^<DD>/iu.test(line)) {
      const description = decodeHtmlEntities(line.replace(/^<DD>/iu, '').trim());
      if (this.state.pendingBookmark) {
        this.state.pendingBookmark = {
          ...this.state.pendingBookmark,
          description,
        };
      }
      return;
    }

    if (/^<DT><A\s/iu.test(line)) {
      flushPendingBookmark(this.state, this.config.onBookmark);
      const match = line.match(/^<DT><A\s([^>]*)>(.*?)<\/A>/iu);
      if (!match) {
        return;
      }

      const attributes = parseAttributeString(match[1] ?? '');
      const url = attributes.get('HREF') ?? '';
      const title = decodeHtmlEntities(match[2] ?? '').trim();
      const tags = (attributes.get('TAGS') ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);

      const addDateRaw = attributes.get('ADD_DATE');
      const lastModifiedRaw = attributes.get('LAST_MODIFIED');

      const addDate = addDateRaw ? Number.parseInt(addDateRaw, 10) * 1000 : undefined;
      const lastModified = lastModifiedRaw ? Number.parseInt(lastModifiedRaw, 10) * 1000 : undefined;

      this.state.pendingBookmark = {
        url,
        title,
        tags,
        addDate,
        lastModified,
        path: [...this.state.stack],
      };
      return;
    }

    // No-op for other tags.
  }
}

type AttributeMap = Map<string, string>;

const ATTRIBUTE_PATTERN = /(\w+)="([^"]*)"/giu;

const parseAttributeString = (input: string): AttributeMap => {
  const attributes: AttributeMap = new Map();
  if (!input) {
    return attributes;
  }

  for (const match of input.matchAll(ATTRIBUTE_PATTERN)) {
    const key = match[1]?.toUpperCase();
    const value = match[2] ?? '';
    if (key) {
      attributes.set(key, value);
    }
  }

  return attributes;
};

const createId = () => crypto.randomUUID();

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const collectExistingBookmarks = async (
  database: LinkOSaurusDB,
  dedupe: boolean,
): Promise<Map<string, Bookmark>> => {
  if (!dedupe) {
    return new Map();
  }

  const map = new Map<string, Bookmark>();
  await database.bookmarks.each((bookmark) => {
    const normalized = normalizeUrl(bookmark.url);
    if (normalized) {
      map.set(normalized, bookmark);
    }
  });
  return map;
};

type BoardCacheEntry = {
  readonly board: Board;
  readonly existing: boolean;
};

type CategoryCacheEntry = {
  readonly category: Category;
  readonly existing: boolean;
};

type SortCounter = { value: number };

const withDatabase = (database?: LinkOSaurusDB): LinkOSaurusDB => database ?? db;

const ensureBoard = (
  title: string,
  now: number,
  boardCache: Map<string, BoardCacheEntry>,
  existingBoards: Map<string, Board>,
  boardSortCounter: SortCounter,
  categorySortCounters: Map<string, SortCounter>,
): Board => {
  const normalizedTitle = normalizeKey(title || DEFAULT_BOARD_TITLE);
  const cached = boardCache.get(normalizedTitle);
  if (cached) {
    return cached.board;
  }

  const existing = existingBoards.get(normalizedTitle);
  if (existing) {
    const board: Board = { ...existing, updatedAt: now };
    if (!categorySortCounters.has(board.id)) {
      categorySortCounters.set(board.id, { value: 0 });
    }
    boardCache.set(normalizedTitle, { board, existing: true });
    return board;
  }

  const board: Board = {
    id: createId(),
    title: normalizeTitle(title) || DEFAULT_BOARD_TITLE,
    icon: undefined,
    sortOrder: boardSortCounter.value++,
    createdAt: now,
    updatedAt: now,
  };
  boardCache.set(normalizedTitle, { board, existing: false });
  categorySortCounters.set(board.id, { value: 0 });
  return board;
};

const ensureCategory = (
  board: Board,
  title: string,
  categoryCache: Map<string, CategoryCacheEntry>,
  existingCategories: Map<string, Category>,
  categorySortCounters: Map<string, SortCounter>,
): Category | undefined => {
  const normalizedTitle = normalizeTitle(title) || DEFAULT_CATEGORY_TITLE;
  const cacheKey = `${board.id}::${normalizeKey(normalizedTitle)}`;
  const cached = categoryCache.get(cacheKey);
  if (cached) {
    return cached.category;
  }

  if (!normalizedTitle) {
    return undefined;
  }

  const existing = existingCategories.get(cacheKey);
  if (existing) {
    const category: Category = { ...existing };
    categoryCache.set(cacheKey, { category, existing: true });
    return category;
  }

  const counter = categorySortCounters.get(board.id) ?? { value: 0 };
  categorySortCounters.set(board.id, counter);

  const category: Category = {
    id: createId(),
    boardId: board.id,
    title: normalizedTitle,
    sortOrder: counter.value++,
  };
  categoryCache.set(cacheKey, { category, existing: false });
  return category;
};

const toBookmarkRecord = (
  candidate: BookmarkCandidate,
  board: Board,
  category: Category | undefined,
  normalizedUrl: string,
): Bookmark => {
  const createdAt = candidate.addDate ?? Date.now();
  const updatedAt = candidate.lastModified ?? createdAt;
  const tags = candidate.tags ?? [];

  return {
    id: createId(),
    categoryId: category?.id,
    url: normalizedUrl,
    title: normalizeTitle(candidate.title) || normalizedUrl,
    notes: candidate.description ? candidate.description : undefined,
    tags: [...tags],
    pinned: false,
    archived: false,
    createdAt,
    updatedAt,
    visitCount: 0,
    lastVisitedAt: undefined,
  };
};

const loadExistingBoards = async (
  database: LinkOSaurusDB,
): Promise<{ map: Map<string, Board>; counter: SortCounter }> => {
  const boards = await database.boards.orderBy('sortOrder').toArray();
  const map = new Map<string, Board>();
  let nextSortOrder = 0;
  for (const board of boards) {
    map.set(normalizeKey(board.title), board);
    if (board.sortOrder >= nextSortOrder) {
      nextSortOrder = board.sortOrder + 1;
    }
  }
  return { map, counter: { value: nextSortOrder } };
};

const loadExistingCategories = async (
  database: LinkOSaurusDB,
): Promise<{ map: Map<string, Category>; counters: Map<string, SortCounter> }> => {
  const categories = await database.categories.toArray();
  const map = new Map<string, Category>();
  const counters = new Map<string, SortCounter>();
  for (const category of categories) {
    const key = `${category.boardId}::${normalizeKey(category.title)}`;
    map.set(key, category);
    const counter = counters.get(category.boardId);
    if (counter) {
      if (category.sortOrder >= counter.value) {
        counter.value = category.sortOrder + 1;
      }
    } else {
      counters.set(category.boardId, { value: category.sortOrder + 1 });
    }
  }
  return { map, counters };
};

const emitProgress = (callbacks: ImportCallbacks | undefined, progress: ImportProgress) => {
  callbacks?.onProgress?.(progress);
};

const processBookmarkCandidate = (
  candidate: BookmarkCandidate,
  dedupe: boolean,
  caches: {
    boardCache: Map<string, BoardCacheEntry>;
    categoryCache: Map<string, CategoryCacheEntry>;
    existingBoards: Map<string, Board>;
    existingCategories: Map<string, Category>;
    boardSortCounter: SortCounter;
    categorySortCounters: Map<string, SortCounter>;
    seenUrls: Set<string>;
    existingUrlMap: Map<string, Bookmark>;
  },
  stats: ImportStatsMutable,
): Bookmark | undefined => {
  stats.processedBookmarks += 1;
  const normalized = normalizeUrl(candidate.url);
  if (!normalized) {
    stats.skippedBookmarks += 1;
    return undefined;
  }

  if (dedupe) {
    if (caches.existingUrlMap.has(normalized) || caches.seenUrls.has(normalized)) {
      stats.duplicateBookmarks += 1;
      return undefined;
    }
    caches.seenUrls.add(normalized);
  }

  const now = Date.now();
  const [boardTitle, ...restPath] = candidate.path;
  const board = ensureBoard(
    boardTitle ?? DEFAULT_BOARD_TITLE,
    now,
    caches.boardCache,
    caches.existingBoards,
    caches.boardSortCounter,
    caches.categorySortCounters,
  );

  const categoryTitle = restPath.length > 0 ? restPath.join(' / ') : DEFAULT_CATEGORY_TITLE;
  const category = ensureCategory(
    board,
    categoryTitle,
    caches.categoryCache,
    caches.existingCategories,
    caches.categorySortCounters,
  );

  const bookmark = toBookmarkRecord(candidate, board, category, normalized);
  stats.createdBookmarks += 1;
  return bookmark;
};

type ImportStatsMutable = {
  processedBookmarks: number;
  createdBookmarks: number;
  skippedBookmarks: number;
  duplicateBookmarks: number;
};

const commitImport = async (
  database: LinkOSaurusDB,
  boards: Iterable<BoardCacheEntry>,
  categories: Iterable<CategoryCacheEntry>,
  bookmarks: Bookmark[],
): Promise<void> => {
  const boardRecords = Array.from(boards, (entry) => entry.board);
  const categoryRecords = Array.from(categories, (entry) => entry.category);

  const tables: Table<unknown, string>[] = [database.boards, database.categories, database.bookmarks];

  await database.transaction('rw', tables, async () => {
    if (boardRecords.length > 0) {
      await database.boards.bulkPut(boardRecords);
    }
    if (categoryRecords.length > 0) {
      await database.categories.bulkPut(categoryRecords);
    }
    if (bookmarks.length > 0) {
      await database.bookmarks.bulkPut(bookmarks);
    }
  });
};

export const importFromNetscapeHtml = async (
  file: File,
  options: ImportOptions = {},
  callbacks?: ImportCallbacks,
  database?: LinkOSaurusDB,
): Promise<ImportResult> => {
  const dbInstance = withDatabase(database);
  const dedupe = options.dedupe !== false;

  const existingUrlMap = await collectExistingBookmarks(dbInstance, dedupe);
  const { map: existingBoards, counter: boardSortCounter } = await loadExistingBoards(dbInstance);
  const { map: existingCategories, counters: categorySortCounters } = await loadExistingCategories(dbInstance);

  const boardCache = new Map<string, BoardCacheEntry>();
  const categoryCache = new Map<string, CategoryCacheEntry>();
  const seenUrls = new Set<string>();

  const stats: ImportStatsMutable = {
    processedBookmarks: 0,
    createdBookmarks: 0,
    skippedBookmarks: 0,
    duplicateBookmarks: 0,
  };

  const bookmarks: Bookmark[] = [];

  const parser = new NetscapeBookmarkParser(file.stream(), file.size, {
    onBookmark: (candidate) => {
      const bookmark = processBookmarkCandidate(
        candidate,
        dedupe,
        {
          boardCache,
          categoryCache,
          existingBoards,
          existingCategories,
          boardSortCounter,
          categorySortCounters,
          seenUrls,
          existingUrlMap,
        },
        stats,
      );

      if (bookmark) {
        bookmarks.push(bookmark);
      }
    },
  });

  await parser.parse((processedBytes, totalBytes) => {
    emitProgress(callbacks, {
      stage: 'parsing',
      processedBytes,
      totalBytes,
      processedBookmarks: stats.processedBookmarks,
      createdBookmarks: stats.createdBookmarks,
      skippedBookmarks: stats.skippedBookmarks,
      duplicateBookmarks: stats.duplicateBookmarks,
    });
  });

  await yieldToEventLoop();

  emitProgress(callbacks, {
    stage: 'saving',
    processedBookmarks: 0,
    totalBookmarks: bookmarks.length,
  });

  await commitImport(dbInstance, boardCache.values(), categoryCache.values(), bookmarks);

  emitProgress(callbacks, {
    stage: 'saving',
    processedBookmarks: bookmarks.length,
    totalBookmarks: bookmarks.length,
  });

  return {
    stats: { ...stats },
  };
};

export type LinkOSaurusJsonExport = {
  readonly format: 'link-o-saurus';
  readonly version: 1;
  readonly exportedAt: string;
  readonly boards: Board[];
  readonly categories: Category[];
  readonly bookmarks: Bookmark[];
};

export const exportToJson = async (database?: LinkOSaurusDB): Promise<LinkOSaurusJsonExport> => {
  const dbInstance = withDatabase(database);
  const [boards, categories, bookmarks] = await Promise.all([
    dbInstance.boards.orderBy('sortOrder').toArray(),
    dbInstance.categories.toArray(),
    dbInstance.bookmarks.toArray(),
  ]);

  return {
    format: 'link-o-saurus',
    version: 1,
    exportedAt: new Date().toISOString(),
    boards,
    categories,
    bookmarks,
  };
};

const escapeHtml = (input: string): string => {
  return input
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
};

const formatDateAttribute = (timestamp: number | undefined): string | undefined => {
  if (!timestamp) {
    return undefined;
  }
  return Math.floor(timestamp / 1000).toString();
};

const buildBookmarkHtml = (bookmark: Bookmark): string => {
  const attributes: string[] = [];
  const addDate = formatDateAttribute(bookmark.createdAt);
  const updated = formatDateAttribute(bookmark.updatedAt);

  if (addDate) {
    attributes.push(`ADD_DATE=\"${addDate}\"`);
  }
  if (updated) {
    attributes.push(`LAST_MODIFIED=\"${updated}\"`);
  }
  if (bookmark.tags && bookmark.tags.length > 0) {
    attributes.push(`TAGS=\"${bookmark.tags.map(escapeHtml).join(',')}\"`);
  }

  const attrText = attributes.length > 0 ? ` ${attributes.join(' ')}` : '';
  let html = `    <DT><A HREF=\"${escapeHtml(bookmark.url)}\"${attrText}>${escapeHtml(bookmark.title)}</A>`;
  if (bookmark.notes) {
    html += `\n    <DD>${escapeHtml(bookmark.notes)}`;
  }
  return html;
};

const groupBookmarksByCategory = (
  bookmarks: Bookmark[],
): Map<string | undefined, Bookmark[]> => {
  const map = new Map<string | undefined, Bookmark[]>();
  for (const bookmark of bookmarks) {
    const key = bookmark.categoryId;
    const list = map.get(key) ?? [];
    list.push(bookmark);
    map.set(key, list);
  }
  return map;
};

const buildHtmlExport = async (database?: LinkOSaurusDB): Promise<string> => {
  const dbInstance = withDatabase(database);
  const [boards, categories, bookmarks] = await Promise.all([
    dbInstance.boards.orderBy('sortOrder').toArray(),
    dbInstance.categories.toArray(),
    dbInstance.bookmarks.toArray(),
  ]);

  const categoriesByBoard = new Map<string, Category[]>();
  for (const category of categories) {
    const list = categoriesByBoard.get(category.boardId) ?? [];
    list.push(category);
    categoriesByBoard.set(category.boardId, list);
  }

  const bookmarksByCategory = groupBookmarksByCategory(bookmarks);

  const lines: string[] = [];
  lines.push('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
  lines.push('<!-- This is an automatically generated file. -->');
  lines.push('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">');
  lines.push('<TITLE>Bookmarks</TITLE>');
  lines.push('<H1>Bookmarks</H1>');
  lines.push('');
  lines.push('<DL><p>');

  const uncategorized = bookmarksByCategory.get(undefined) ?? [];
  bookmarksByCategory.delete(undefined);

  for (const board of boards) {
    const boardAttrs: string[] = [];
    const boardCreated = formatDateAttribute(board.createdAt);
    const boardUpdated = formatDateAttribute(board.updatedAt);
    if (boardCreated) {
      boardAttrs.push(`ADD_DATE="${boardCreated}"`);
    }
    if (boardUpdated) {
      boardAttrs.push(`LAST_MODIFIED="${boardUpdated}"`);
    }
    const boardAttrText = boardAttrs.length > 0 ? ` ${boardAttrs.join(' ')}` : '';
    lines.push(`  <DT><H3${boardAttrText}>${escapeHtml(board.title)}</H3>`);
    lines.push('  <DL><p>');

    const boardCategories = categoriesByBoard.get(board.id) ?? [];
    boardCategories.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const category of boardCategories) {
      const categoryAttrs: string[] = [];
      const categoryUpdated = formatDateAttribute(board.updatedAt);
      if (categoryUpdated) {
        categoryAttrs.push(`LAST_MODIFIED="${categoryUpdated}"`);
      }
      const categoryAttrText = categoryAttrs.length > 0 ? ` ${categoryAttrs.join(' ')}` : '';
      lines.push(`    <DT><H3${categoryAttrText}>${escapeHtml(category.title)}</H3>`);
      lines.push('    <DL><p>');
      const categoryBookmarks = bookmarksByCategory.get(category.id) ?? [];
      categoryBookmarks.sort((a, b) => a.createdAt - b.createdAt);
      for (const bookmark of categoryBookmarks) {
        lines.push(buildBookmarkHtml(bookmark));
      }
      lines.push('    </DL><p>');
    }

    lines.push('  </DL><p>');
  }

  if (uncategorized.length > 0) {
    lines.push(`  <DT><H3>${escapeHtml(DEFAULT_CATEGORY_TITLE)}</H3>`);
    lines.push('  <DL><p>');
    uncategorized.sort((a, b) => a.createdAt - b.createdAt);
    for (const bookmark of uncategorized) {
      lines.push(buildBookmarkHtml(bookmark));
    }
    lines.push('  </DL><p>');
  }

  lines.push('</DL><p>');

  return lines.join('\n');
};

const createBlob = (content: string, mime: string): Blob => {
  return new Blob([content], { type: mime });
};

const zipExport = async (
  json: LinkOSaurusJsonExport,
  html: string,
  options: ExportOptions,
): Promise<Blob> => {
  const { zipSync, strToU8 } = await import('fflate');
  const files: Record<string, Uint8Array> = {
    'bookmarks.json': strToU8(JSON.stringify(json, null, 2)),
    'bookmarks.html': strToU8(html),
  };

  if (options.includeFavicons) {
    files['favicons.json'] = strToU8(JSON.stringify({}));
  }

  const zipped = zipSync(files, { level: 6 });
  const copy = zipped.slice();
  return new Blob([copy.buffer], { type: 'application/zip' });
};

export const exportData = async (
  format: ExportFormat,
  options: ExportOptions = {},
  database?: LinkOSaurusDB,
): Promise<ExportResult> => {
  const json = await exportToJson(database);
  const html = await buildHtmlExport(database);

  if (format === 'json') {
    return {
      blob: createBlob(JSON.stringify(json, null, 2), 'application/json'),
      fileName: `link-o-saurus-${Date.now()}.json`,
    };
  }

  if (format === 'html') {
    return {
      blob: createBlob(html, 'text/html'),
      fileName: `link-o-saurus-${Date.now()}.html`,
    };
  }

  if (format === 'zip') {
    const blob = await zipExport(json, html, options);
    return {
      blob,
      fileName: `link-o-saurus-${Date.now()}.zip`,
    };
  }

  throw new Error(`Unsupported export format: ${format}`);
};

export const importFromJson = async (
  file: File,
  options: ImportOptions = {},
  callbacks?: ImportCallbacks,
  database?: LinkOSaurusDB,
): Promise<ImportResult> => {
  const dbInstance = withDatabase(database);
  const dedupe = options.dedupe !== false;

  const text = await file.text();
  emitProgress(callbacks, {
    stage: 'parsing',
    processedBytes: file.size,
    totalBytes: file.size,
    processedBookmarks: 0,
    createdBookmarks: 0,
    skippedBookmarks: 0,
    duplicateBookmarks: 0,
  });

  const payload = JSON.parse(text) as LinkOSaurusJsonExport;
  if (payload.format !== 'link-o-saurus') {
    throw new Error('Unsupported JSON export format');
  }

  const existingUrlMap = await collectExistingBookmarks(dbInstance, dedupe);
  const seenUrls = new Set<string>();

  const boardMap = new Map<string, Board>();
  const categoryMap = new Map<string, Category>();
  const bookmarks: Bookmark[] = [];

  const stats: ImportStatsMutable = {
    processedBookmarks: 0,
    createdBookmarks: 0,
    skippedBookmarks: 0,
    duplicateBookmarks: 0,
  };

  for (const board of payload.boards) {
    const title = normalizeTitle(board.title) || DEFAULT_BOARD_TITLE;
    const record: Board = {
      ...board,
      id: createId(),
      title,
      sortOrder: board.sortOrder ?? 0,
      createdAt: board.createdAt ?? Date.now(),
      updatedAt: board.updatedAt ?? Date.now(),
    };
    boardMap.set(board.id, record);
  }

  for (const category of payload.categories) {
    const board = boardMap.get(category.boardId);
    if (!board) {
      continue;
    }
    const title = normalizeTitle(category.title) || DEFAULT_CATEGORY_TITLE;
    const record: Category = {
      ...category,
      id: createId(),
      boardId: board.id,
      title,
      sortOrder: category.sortOrder ?? 0,
    };
    categoryMap.set(category.id, record);
  }

  for (const bookmark of payload.bookmarks) {
    stats.processedBookmarks += 1;
    const normalized = normalizeUrl(bookmark.url);
    if (!normalized) {
      stats.skippedBookmarks += 1;
      continue;
    }

    if (dedupe) {
      if (existingUrlMap.has(normalized) || seenUrls.has(normalized)) {
        stats.duplicateBookmarks += 1;
        continue;
      }
      seenUrls.add(normalized);
    }

    const category = bookmark.categoryId ? categoryMap.get(bookmark.categoryId) : undefined;

    const title = normalizeTitle(bookmark.title) || normalized;
    const record: Bookmark = {
      ...bookmark,
      id: createId(),
      categoryId: category?.id,
      url: normalized,
      title,
      notes: bookmark.notes ?? undefined,
      tags: [...(bookmark.tags ?? [])],
      createdAt: bookmark.createdAt ?? Date.now(),
      updatedAt: bookmark.updatedAt ?? Date.now(),
      visitCount: bookmark.visitCount ?? 0,
      archived: bookmark.archived ?? false,
      pinned: bookmark.pinned ?? false,
    };
    bookmarks.push(record);
    stats.createdBookmarks += 1;
  }

  emitProgress(callbacks, {
    stage: 'parsing',
    processedBytes: file.size,
    totalBytes: file.size,
    processedBookmarks: stats.processedBookmarks,
    createdBookmarks: stats.createdBookmarks,
    skippedBookmarks: stats.skippedBookmarks,
    duplicateBookmarks: stats.duplicateBookmarks,
  });

  emitProgress(callbacks, {
    stage: 'saving',
    processedBookmarks: 0,
    totalBookmarks: bookmarks.length,
  });

  await dbInstance.transaction('rw', [dbInstance.boards, dbInstance.categories, dbInstance.bookmarks], async () => {
    if (boardMap.size > 0) {
      await dbInstance.boards.bulkPut(Array.from(boardMap.values()));
    }
    if (categoryMap.size > 0) {
      await dbInstance.categories.bulkPut(Array.from(categoryMap.values()));
    }
    if (bookmarks.length > 0) {
      await dbInstance.bookmarks.bulkPut(bookmarks);
    }
  });

  emitProgress(callbacks, {
    stage: 'saving',
    processedBookmarks: bookmarks.length,
    totalBookmarks: bookmarks.length,
  });

  return {
    stats: { ...stats },
  };
};
