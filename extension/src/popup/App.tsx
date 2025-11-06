import { FunctionalComponent, JSX } from 'preact';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import './App.css';

type Board = {
  id: string;
  label: string;
  count: number;
};

type Tag = {
  id: string;
  label: string;
};

type Bookmark = {
  id: string;
  title: string;
  url: string;
  tags: string[];
  boardId: string;
  createdAt: string;
};

type ResourceState<T> = {
  data: T | null;
  pending: boolean;
  showSpinner: boolean;
};

type BookmarkRowData = {
  bookmarks: Bookmark[];
  selection: Set<string>;
  onItemClick: (
    bookmark: Bookmark,
    index: number,
    event: MouseEvent | KeyboardEvent,
  ) => void;
  onDragStart: (bookmark: Bookmark, index: number, event: DragEvent) => void;
  onDragOver: (index: number, event: DragEvent) => void;
  onDrop: (index: number, event: DragEvent) => void;
  onKeyToggle: (bookmark: Bookmark, index: number, event: KeyboardEvent) => void;
  onDragEnd: () => void;
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function useAsyncResource<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[] = [],
): ResourceState<T> {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const [state, setState] = useState<ResourceState<T>>({
    data: null,
    pending: true,
    showSpinner: false,
  });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, pending: true, showSpinner: false }));
    const latencyTimer = window.setTimeout(() => {
      if (!cancelled) {
        setState((prev) => ({ ...prev, showSpinner: true }));
      }
    }, 120);

    loaderRef.current()
      .then((data) => {
        if (!cancelled) {
          setState({ data, pending: false, showSpinner: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ data: null, pending: false, showSpinner: false });
        }
      })
      .finally(() => window.clearTimeout(latencyTimer));

    return () => {
      cancelled = true;
      window.clearTimeout(latencyTimer);
    };
  }, deps);

  return state;
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const box = entry.contentRect;
        setSize({ width: box.width, height: box.height });
      }
    });

    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, []);

  return [ref, size] as const;
}

const BookmarkRow: FunctionalComponent<
  ListChildComponentProps<BookmarkRowData>
> = ({ index, style, data }) => {
  const bookmark = data.bookmarks[index];
  const selected = data.selection.has(bookmark.id);

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      class={`bookmark-row${selected ? ' is-selected' : ''}`}
      style={style as unknown as JSX.CSSProperties}
      draggable
      onClick={(event) => data.onItemClick(bookmark, index, event as MouseEvent)}
      onDragStart={(event) =>
        data.onDragStart(bookmark, index, event as DragEvent)}
      onDragOver={(event) => data.onDragOver(index, event as DragEvent)}
      onDrop={(event) => data.onDrop(index, event as DragEvent)}
      onDragEnd={data.onDragEnd}
      onKeyDown={(event) =>
        data.onKeyToggle(bookmark, index, event as KeyboardEvent)}
    >
      <div class="bookmark-title" title={bookmark.title}>
        {bookmark.title}
      </div>
      <div class="bookmark-meta">
        <span class="bookmark-url" title={bookmark.url}>
          {bookmark.url.replace(/^https?:\/\//, '')}
        </span>
        <span class="bookmark-tags">
          {bookmark.tags.length ? bookmark.tags.join(', ') : 'No tags'}
        </span>
      </div>
    </div>
  );
};

const App: FunctionalComponent = () => {
  const bookmarksResource = useAsyncResource(async () => {
    const fakeData: Bookmark[] = Array.from({ length: 5000 }).map((_, index) => ({
      id: `bookmark-${index}`,
      title: `Bookmark ${index + 1}`,
      url: `https://example.com/${index + 1}`,
      tags: index % 3 === 0 ? ['inbox'] : index % 5 === 0 ? ['reading'] : [],
      boardId: index % 2 === 0 ? 'inbox' : 'read-later',
      createdAt: new Date(Date.now() - index * 60000).toISOString(),
    }));

    await wait(30);
    return fakeData;
  });

  const boardsResource = useAsyncResource(async () => {
    await wait(10);
    const bookmarks = bookmarksResource.data ?? [];
    const boardCounts = bookmarks.reduce<Record<string, number>>(
      (acc, bookmark) => {
        acc[bookmark.boardId] = (acc[bookmark.boardId] ?? 0) + 1;
        return acc;
      },
      {},
    );
    return [
      { id: 'inbox', label: 'Inbox', count: boardCounts['inbox'] ?? 0 },
      {
        id: 'read-later',
        label: 'Read Later',
        count: boardCounts['read-later'] ?? 0,
      },
      { id: 'archive', label: 'Archive', count: 0 },
    ] satisfies Board[];
  }, [bookmarksResource.data]);

  const tagsResource = useAsyncResource(async () => {
    await wait(10);
    return [
      { id: 'inbox', label: 'Inbox' },
      { id: 'reading', label: 'Reading' },
      { id: 'important', label: 'Important' },
      { id: 'inspiration', label: 'Inspiration' },
    ] satisfies Tag[];
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeBoard, setActiveBoard] = useState<string>('inbox');
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const draggingId = useRef<string | null>(null);
  const lastSelectedIndex = useRef<number | null>(null);
  const [batchPending, setBatchPending] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const handleSearchInput = useCallback(
    (event: JSX.TargetedEvent<HTMLInputElement, Event>) => {
      setSearchTerm(event.currentTarget.value);
    },
    [],
  );

  const runBatchAction = useCallback(
    async (type: 'tag' | 'move' | 'delete' | 'untag') => {
      if (!selectedIds.size) {
        return;
      }
      setBatchPending(true);
      await wait(200);
      console.log(`[Link-O-Saurus] Batch ${type} executed`, Array.from(selectedIds));
      setBatchPending(false);
    },
    [selectedIds],
  );

  const bookmarks = bookmarksResource.data ?? [];

  useEffect(() => {
    if (!bookmarks.length) {
      return;
    }
    setOrderedIds((current) =>
      current.length ? current : bookmarks.map((bookmark) => bookmark.id),
    );
  }, [bookmarks]);

  const orderedBookmarks = useMemo(() => {
    if (!orderedIds.length) {
      return bookmarks;
    }
    const lookup = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));
    return orderedIds
      .map((id) => lookup.get(id))
      .filter((bookmark): bookmark is Bookmark => Boolean(bookmark));
  }, [bookmarks, orderedIds]);

  const filteredBookmarks = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return orderedBookmarks.filter((bookmark) => {
      if (activeBoard && bookmark.boardId !== activeBoard) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      return (
        bookmark.title.toLowerCase().includes(normalizedSearch) ||
        bookmark.url.toLowerCase().includes(normalizedSearch) ||
        bookmark.tags.some((tag) => tag.toLowerCase().includes(normalizedSearch))
      );
    });
  }, [orderedBookmarks, activeBoard, searchTerm]);

  const [listRef, listSize] = useElementSize<HTMLDivElement>();

  const handleItemClick = useCallback(
    (bookmark: Bookmark, index: number, event: MouseEvent | KeyboardEvent) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (
          event instanceof MouseEvent &&
          event.shiftKey &&
          lastSelectedIndex.current !== null
        ) {
          const rangeStart = Math.min(lastSelectedIndex.current, index);
          const rangeEnd = Math.max(lastSelectedIndex.current, index);
          for (let i = rangeStart; i <= rangeEnd; i += 1) {
            const id = filteredBookmarks[i]?.id;
            if (id) {
              next.add(id);
            }
          }
        } else if (
          (event instanceof MouseEvent && (event.ctrlKey || event.metaKey)) ||
          (event instanceof KeyboardEvent && (event.ctrlKey || event.metaKey))
        ) {
          if (next.has(bookmark.id)) {
            next.delete(bookmark.id);
          } else {
            next.add(bookmark.id);
          }
          lastSelectedIndex.current = index;
          return next;
        } else {
          next.clear();
          next.add(bookmark.id);
        }
        lastSelectedIndex.current = index;
        return next;
      });
    },
    [filteredBookmarks],
  );

  const handleKeyToggle = useCallback(
    (bookmark: Bookmark, index: number, event: KeyboardEvent) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        handleItemClick(bookmark, index, event);
      }
    },
    [handleItemClick],
  );

  const handleDragStart = useCallback(
    (bookmark: Bookmark, _index: number, event: DragEvent) => {
      draggingId.current = bookmark.id;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', bookmark.id);
      }
    },
    [],
  );

  const handleDragOver = useCallback((index: number, event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((index: number, event: DragEvent) => {
    event.preventDefault();
    const sourceId = draggingId.current;
    if (!sourceId) {
      return;
    }
    setOrderedIds((prev) => {
      const withoutSource = prev.filter((id) => id !== sourceId);
      const before = withoutSource.slice(0, index);
      const after = withoutSource.slice(index);
      return [...before, sourceId, ...after];
    });
    draggingId.current = null;
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      if (event.key === 'Delete') {
        event.preventDefault();
        runBatchAction('delete');
      } else if (
        (event.key === 'n' || event.key === 'N') &&
        !event.altKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        console.log('[Link-O-Saurus] New bookmark action triggered');
      } else if (event.key === 't' || event.key === 'T') {
        event.preventDefault();
        runBatchAction('tag');
      } else if (event.key === 'm' || event.key === 'M') {
        event.preventDefault();
        runBatchAction('move');
      } else if (event.key === '/') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [runBatchAction]);

  const selectedFirstId = selectedIds.values().next().value as string | undefined;
  const selectedBookmark = useMemo(
    () => filteredBookmarks.find((bookmark) => bookmark.id === selectedFirstId),
    [filteredBookmarks, selectedFirstId],
  );

  const batchSummary = `${selectedIds.size} ausgewählt`;

  return (
    <main class="popup-root">
      <section class="pane sidebar" aria-label="Boards and tags">
        <header class="pane-header">Boards</header>
        <nav class="board-list" aria-label="Boards">
          {(boardsResource.data ?? []).map((board) => (
            <button
              type="button"
              class={`board-item${board.id === activeBoard ? ' is-active' : ''}`}
              onClick={() => setActiveBoard(board.id)}
            >
              <span>{board.label}</span>
              <span class="board-count">{board.count}</span>
            </button>
          ))}
        </nav>
        <header class="pane-header">Tags</header>
        <div class="tag-cloud" aria-label="Tags">
          {(tagsResource.data ?? []).map((tag) => (
            <button
              key={tag.id}
              type="button"
              class="tag-item"
              onClick={() => setSearchTerm(tag.label)}
            >
              #{tag.label}
            </button>
          ))}
        </div>
      </section>
      <section class="pane bookmark-pane" aria-label="Bookmarks">
        <div class="bookmark-toolbar">
          <input
            ref={searchInputRef}
            type="search"
            value={searchTerm}
            onInput={handleSearchInput}
            placeholder="Search bookmarks (/)"
          />
          <div class="toolbar-actions">
            <span>{batchSummary}</span>
            <button
              type="button"
              onClick={() => runBatchAction('tag')}
              disabled={!selectedIds.size}
            >
              Tag hinzufügen
            </button>
            <button
              type="button"
              onClick={() => runBatchAction('untag')}
              disabled={!selectedIds.size}
            >
              Tag entfernen
            </button>
            <button
              type="button"
              onClick={() => runBatchAction('move')}
              disabled={!selectedIds.size}
            >
              Verschieben
            </button>
            <button
              type="button"
              onClick={() => runBatchAction('delete')}
              disabled={!selectedIds.size}
            >
              Löschen
            </button>
          </div>
        </div>
        <div class="bookmark-list" ref={listRef} role="listbox" aria-multiselectable="true">
          {bookmarksResource.showSpinner ? (
            <div class="spinner" aria-live="polite">
              Lädt …
            </div>
          ) : (
            <FixedSizeList
              height={Math.max(1, listSize.height)}
              width={Math.max(1, listSize.width)}
              itemSize={64}
              itemCount={filteredBookmarks.length}
              itemData={{
                bookmarks: filteredBookmarks,
                selection: selectedIds,
                onItemClick: handleItemClick,
                onDragStart: handleDragStart,
                onDragOver: handleDragOver,
                onDrop: handleDrop,
                onKeyToggle: handleKeyToggle,
                onDragEnd: () => {
                  draggingId.current = null;
                },
              }}
              itemKey={(index, data) => data.bookmarks[index]?.id ?? index}
            >
              {BookmarkRow}
            </FixedSizeList>
          )}
        </div>
      </section>
      <aside class="pane detail-pane" aria-label="Details">
        <header class="pane-header">Details & Batch</header>
        {batchPending ? (
          <div class="spinner" aria-live="polite">
            Aktion läuft …
          </div>
        ) : selectedBookmark ? (
          <div class="detail-card">
            <h2>{selectedBookmark.title}</h2>
            <p class="detail-url">{selectedBookmark.url}</p>
            <p>Erstellt: {new Date(selectedBookmark.createdAt).toLocaleString()}</p>
            <div class="detail-tags">
              {selectedBookmark.tags.length ? (
                selectedBookmark.tags.map((tag) => (
                  <span key={tag} class="detail-tag">
                    #{tag}
                  </span>
                ))
              ) : (
                <span class="detail-tag detail-tag--empty">Keine Tags</span>
              )}
            </div>
          </div>
        ) : (
          <p class="detail-placeholder">Mehrfachauswahl für Batch-Aktionen verwenden.</p>
        )}
      </aside>
    </main>
  );
};

export default App;
