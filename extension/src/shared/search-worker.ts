import { expose } from 'comlink';
import { Document } from 'flexsearch';
import type { EnrichedDocumentSearchResultSetUnit, Id } from 'flexsearch';
import type { Bookmark } from './types';

type BookmarkDocument = Pick<
  Bookmark,
  'id' | 'title' | 'url' | 'notes' | 'tags' | 'pinned' | 'archived' | 'createdAt' | 'updatedAt'
> & {
  readonly normalizedTags: string[];
};

export type SearchFilters = {
  readonly tags?: string[];
  readonly archived?: boolean;
  readonly pinned?: boolean;
};

export type SearchHit = {
  readonly id: string;
  readonly bookmark: BookmarkDocument;
  readonly score: number;
};

type SearchSource = Iterable<Bookmark> | AsyncIterable<Bookmark>;

const DEFAULT_LIMIT = 50;
const STREAM_BATCH_SIZE = 250;

const FIELD_WEIGHTS: Record<string, number> = {
  title: 4,
  tags: 3,
  url: 2,
  notes: 1,
};

let index = createDocumentIndex();
const documents = new Map<string, BookmarkDocument>();

function createDocumentIndex() {
  return new Document<BookmarkDocument, true>({
    tokenize: 'forward',
    cache: 100,
    document: {
      id: 'id',
      store: true,
      index: [
        { field: 'title', tokenize: 'forward', encode: 'simple' },
        { field: 'url', tokenize: 'forward', encode: 'simple' },
        { field: 'notes', tokenize: 'forward', encode: 'simple' },
        { field: 'tags', tokenize: 'forward', encode: 'simple' },
      ],
    },
  });
}

const toDocument = (bookmark: Bookmark): BookmarkDocument => ({
  id: bookmark.id,
  title: bookmark.title ?? '',
  url: bookmark.url ?? '',
  notes: bookmark.notes ?? '',
  tags: [...(bookmark.tags ?? [])],
  pinned: bookmark.pinned ?? false,
  archived: bookmark.archived ?? false,
  createdAt: bookmark.createdAt,
  updatedAt: bookmark.updatedAt,
  normalizedTags: (bookmark.tags ?? []).map((tag) => tag.toLowerCase()),
});

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const addToIndex = (bookmark: Bookmark) => {
  const doc = toDocument(bookmark);
  documents.set(doc.id, doc);
  index.remove(doc.id);
  index.add(doc);
};

const isAsyncIterable = (value: SearchSource): value is AsyncIterable<Bookmark> => {
  return typeof (value as AsyncIterable<Bookmark>)[Symbol.asyncIterator] === 'function';
};

const rebuildIndex = async (source: SearchSource): Promise<void> => {
  index = createDocumentIndex();
  documents.clear();

  let processed = 0;

  if (isAsyncIterable(source)) {
    for await (const bookmark of source) {
      addToIndex(bookmark);
      processed += 1;
      if (processed % STREAM_BATCH_SIZE === 0) {
        await yieldToEventLoop();
      }
    }
  } else {
    for (const bookmark of source) {
      addToIndex(bookmark);
      processed += 1;
      if (processed % STREAM_BATCH_SIZE === 0) {
        await yieldToEventLoop();
      }
    }
  }
};

const updateDoc = async (bookmark: Bookmark): Promise<void> => {
  addToIndex(bookmark);
};

const removeDoc = async (id: string): Promise<void> => {
  documents.delete(id);
  index.remove(id);
};

const matchesFilters = (doc: BookmarkDocument, filters?: SearchFilters): boolean => {
  if (!filters) {
    return true;
  }

  if (typeof filters.archived === 'boolean' && doc.archived !== filters.archived) {
    return false;
  }

  if (typeof filters.pinned === 'boolean' && doc.pinned !== filters.pinned) {
    return false;
  }

  if (filters.tags && filters.tags.length > 0) {
    const normalized = doc.normalizedTags;
    const required = filters.tags.map((tag) => tag.toLowerCase());
    for (const tag of required) {
      if (!normalized.includes(tag)) {
        return false;
      }
    }
  }

  return true;
};

const query = async (
  rawQuery: string,
  filters?: SearchFilters,
  limit: number = DEFAULT_LIMIT,
): Promise<SearchHit[]> => {
  const queryText = rawQuery.trim();
  const effectiveLimit = Math.max(limit, DEFAULT_LIMIT);

  if (!queryText) {
    const results: SearchHit[] = [];
    for (const doc of documents.values()) {
      if (!matchesFilters(doc, filters)) {
        continue;
      }

      results.push({ id: doc.id, bookmark: doc, score: 0 });
      if (results.length >= effectiveLimit) {
        break;
      }
    }
    return results;
  }

  const aggregated = new Map<string, SearchHit>();
  const rawResults = index.search<true>(queryText, undefined, {
    enrich: true,
    limit: effectiveLimit * 2,
  }) as EnrichedDocumentSearchResultSetUnit<BookmarkDocument>[];

  for (const fieldResult of rawResults) {
    const weight = FIELD_WEIGHTS[fieldResult.field] ?? 1;
    fieldResult.result.forEach((entry, resultIndex) => {
      const identifierList = entry.id as Id[];
      const primaryId = identifierList[0];
      if (typeof primaryId === 'undefined') {
        return;
      }
      const docId = String(primaryId);
      const bookmarkDoc = documents.get(docId) ?? entry.doc;
      if (!bookmarkDoc || !matchesFilters(bookmarkDoc, filters)) {
        return;
      }

      const incrementalScore = weight - resultIndex * 0.01;
      const existing = aggregated.get(docId);
      if (!existing || existing.score < incrementalScore) {
        aggregated.set(docId, {
          id: docId,
          bookmark: bookmarkDoc,
          score: incrementalScore,
        });
      }
    });
  }

  return Array.from(aggregated.values())
    .sort((a, b) => b.score - a.score || b.bookmark.updatedAt - a.bookmark.updatedAt)
    .slice(0, effectiveLimit);
};

const api = {
  rebuildIndex,
  updateDoc,
  removeDoc,
  query,
};

export type SearchWorker = typeof api;

expose(api);

