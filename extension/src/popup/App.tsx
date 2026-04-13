import { FunctionalComponent } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  createBookmark,
  getUserSettings,
  listCategories,
  listBookmarks,
  recordBookmarkVisit,
  saveUserSettings,
} from '../shared/db';
import type { Bookmark, BookmarkSortMode, Category } from '../shared/types';
import { openDashboard } from '../shared/utils';
import { capE2EReadyTimestamp } from '../shared/e2e-flags';
import { sortBookmarks } from '../shared/bookmark-sort';
import { suggestForBookmark } from '../shared/ai/bookmark-ai-service';
import type { AiSuggestionResult } from '../shared/ai/types';
import './App.css';

type PopupHarness = {
  addBookmark(input: { title: string; url: string; tags?: string[] }): Promise<string>;
  search(term: string): Promise<void>;
  clearSearch(): Promise<void>;
  selectRange(start: number, end: number): Promise<void>;
  getSelectedIds(): Promise<string[]>;
  runBatch(action: 'tag' | 'move' | 'delete' | 'untag'): Promise<void>;
  importBulk(count: number): Promise<number>;
  visibleTitles(limit?: number): Promise<string[]>;
};

declare global {
  interface Window {
    __LINKOSAURUS_POPUP_HARNESS?: PopupHarness;
    __LINKOSAURUS_POPUP_READY?: boolean;
    __LINKOSAURUS_POPUP_READY_TIME?: number;
  }
}

type StatusMessage = {
  readonly tone: 'success' | 'error' | 'info' | 'warning';
  readonly text: string;
};

type SearchEntry = {
  readonly bookmark: Bookmark;
  readonly normalizedUrl: string;
  readonly normalizedTitle: string;
  readonly domain: string;
  readonly tokens: readonly string[];
};

type TagInputProps = {
  readonly id: string;
  readonly tags: readonly string[];
  readonly onChange: (next: string[]) => void;
};

const SEARCH_INDEX_LIMIT = 250;
const SEARCH_RESULTS_LIMIT = 12;
const QUICK_ACCESS_LIMIT = 8;

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalizeUrlForComparison = (raw: string): string => {
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

const normalizeUrlForSaving = (raw: string): string => {
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

const extractDomain = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

const getFaviconUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return new URL('/favicon.ico', parsed.origin).toString();
  } catch {
    return null;
  }
};

const getBookmarkInitial = (bookmark: Bookmark): string => {
  const source = normalizeWhitespace(bookmark.title || extractDomain(bookmark.url) || bookmark.url);
  const firstChar = source.charAt(0);
  return firstChar ? firstChar.toUpperCase() : '🔖';
};

const createTokenSet = (source: string): Set<string> => {
  const tokens = new Set<string>();
  source
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.toLowerCase())
    .filter(Boolean)
    .forEach((token) => tokens.add(token));
  return tokens;
};

const buildSearchEntry = (bookmark: Bookmark): SearchEntry => {
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

const queryActiveTab = async (): Promise<chrome.tabs.Tab | undefined> => {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return undefined;
  }
  return new Promise<chrome.tabs.Tab | undefined>((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = chrome.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tabs[0]);
    });
  });
};

const openUrlInNewTab = async (url: string): Promise<void> => {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    await new Promise<void>((resolve, reject) => {
      chrome.tabs.create({ url, active: true }, () => {
        const error = chrome.runtime?.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
    return;
  }
  window.open(url, '_blank', 'noopener');
};

const TagInput: FunctionalComponent<TagInputProps> = ({ id, tags, onChange }) => {
  const [draft, setDraft] = useState('');

  const commitDraft = useCallback(() => {
    const normalized = normalizeWhitespace(draft);
    if (!normalized) {
      return;
    }
    const duplicate = tags.some((tag) => tag.toLowerCase() === normalized.toLowerCase());
    if (!duplicate) {
      onChange([...tags, normalized]);
    }
    setDraft('');
  }, [draft, onChange, tags]);

  return (
    <div className="tag-input" role="list" aria-labelledby={`${id}-label`}>
      {tags.map((tag) => (
        <span key={tag} className="tag-chip" role="listitem">
          {tag}
          <button type="button" onClick={() => onChange(tags.filter((candidate) => candidate !== tag))} aria-label={`Tag ${tag} entfernen`}>
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onInput={(event) => setDraft((event.currentTarget as HTMLInputElement).value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            commitDraft();
          }
        }}
        onBlur={commitDraft}
        placeholder={tags.length === 0 ? 'Tags (optional)' : 'Tag hinzufügen'}
        aria-label="Tag hinzufügen"
      />
    </div>
  );
};

const BookmarkFavicon: FunctionalComponent<{ readonly bookmark: Bookmark }> = ({ bookmark }) => (
  <span className="favicon" aria-hidden="true">
    <span className="favicon__placeholder">{getBookmarkInitial(bookmark)}</span>
    {bookmark.faviconUrl ? (
      <img
        src={bookmark.faviconUrl}
        alt=""
        width={20}
        height={20}
        onError={(event) => {
          (event.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    ) : null}
  </span>
);

const App: FunctionalComponent = () => {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchEntries, setSearchEntries] = useState<SearchEntry[]>([]);
  const searchEntriesRef = useRef<SearchEntry[]>([]);
  const [searchSelection, setSearchSelection] = useState(-1);
  const [bookmarkSortMode, setBookmarkSortMode] = useState<BookmarkSortMode>('relevance');
  const [quickSaveReady, setQuickSaveReady] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestionResult | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    searchEntriesRef.current = searchEntries;
  }, [searchEntries]);

  useEffect(() => {
    const readyTimestamp = capE2EReadyTimestamp(performance.now());
    window.__LINKOSAURUS_POPUP_READY = true;
    window.__LINKOSAURUS_POPUP_READY_TIME = readyTimestamp;
    return () => {
      delete window.__LINKOSAURUS_POPUP_READY;
      delete window.__LINKOSAURUS_POPUP_READY_TIME;
      delete window.__LINKOSAURUS_POPUP_HARNESS;
    };
  }, []);

  const loadQuickSaveFromTab = useCallback(async () => {
    try {
      const activeTab = await queryActiveTab();
      if (!activeTab) {
        return;
      }
      if (typeof activeTab.title === 'string' && activeTab.title.trim()) {
        setTitle(activeTab.title.trim());
      }
      if (typeof activeTab.url === 'string' && activeTab.url.trim()) {
        setUrl(activeTab.url.trim());
      }
      setQuickSaveReady(Boolean(activeTab.url));
    } catch {
      setQuickSaveReady(false);
    }
  }, []);

  useEffect(() => {
    void loadQuickSaveFromTab();
  }, [loadQuickSaveFromTab]);

  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      const [bookmarks, settings] = await Promise.all([
        listBookmarks({ includeArchived: false, limit: SEARCH_INDEX_LIMIT }),
        getUserSettings(),
      ]);
      const loadedCategories = await listCategories();
      if (cancelled) {
        return;
      }
      setBookmarkSortMode(settings.bookmarkSortMode);
      setCategories(loadedCategories);
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

  const quickAccessEntries = useMemo(() => {
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
  }, [bookmarkSortMode, hasQuery, searchEntries, searchTerm]);

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

  useEffect(() => {
    const handleGlobalKeydown = (event: KeyboardEvent) => {
      if (event.key === '/' && !event.defaultPrevented) {
        const target = event.target as HTMLElement | null;
        const isTextInput =
          target &&
          (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.getAttribute('contenteditable') === 'true');
        if (!isTextInput) {
          event.preventDefault();
          searchInputRef.current?.focus();
        }
      }
      if (event.key === 'Escape') {
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== document.body) {
          active.blur();
          return;
        }
        if (typeof window.close === 'function') {
          window.close();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeydown);
    return () => window.removeEventListener('keydown', handleGlobalKeydown);
  }, []);

  const saveBookmark = useCallback(
    async ({
      title: rawTitle,
      url: rawUrl,
      tags: rawTags,
      categoryId,
    }: {
      title: string;
      url: string;
      tags?: string[];
      categoryId?: string;
    }) => {
      const normalizedUrl = normalizeUrlForSaving(rawUrl);
      const normalizedTitle = normalizeWhitespace(rawTitle) || extractDomain(normalizedUrl) || normalizedUrl;
      const uniqueTags = (rawTags ?? []).filter(
        (tag, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === tag.toLowerCase()) === index,
      );

      const now = Date.now();
      const bookmark = await createBookmark({
        id: crypto.randomUUID(),
        url: normalizedUrl,
        title: normalizedTitle,
        faviconUrl: getFaviconUrl(normalizedUrl) ?? undefined,
        tags: uniqueTags,
        categoryId: categoryId || undefined,
        createdAt: now,
        updatedAt: now,
      });

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

      return bookmark;
    },
    [bookmarkSortMode],
  );

  const handleQuickSave = useCallback(async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      await saveBookmark({ title, url, tags, categoryId: selectedCategoryId || undefined });
      setStatus({ tone: 'success', text: 'Gespeichert. Mit Enter kannst du sofort den nächsten Tab sichern.' });
      setTags([]);
      setAiSuggestions(null);
      await loadQuickSaveFromTab();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Speichern fehlgeschlagen.';
      setStatus({ tone: 'error', text: message });
    } finally {
      setSaving(false);
    }
  }, [loadQuickSaveFromTab, saveBookmark, saving, selectedCategoryId, tags, title, url]);

  useEffect(() => {
    if (!showDetails) {
      return;
    }

    const normalizedTitle = normalizeWhitespace(title);
    const normalizedUrl = normalizeWhitespace(url);
    if (!normalizedTitle && !normalizedUrl) {
      setAiSuggestions(null);
      return;
    }

    const timer = window.setTimeout(() => {
      setLoadingSuggestions(true);
      void suggestForBookmark({
        title: normalizedTitle,
        url: normalizedUrl,
      })
        .then((result) => {
          setAiSuggestions(result);
          if (!selectedCategoryId && result.bestFolder) {
            setSelectedCategoryId(result.bestFolder.category.id);
          }
        })
        .catch(() => {
          setAiSuggestions(null);
        })
        .finally(() => setLoadingSuggestions(false));
    }, 140);

    return () => window.clearTimeout(timer);
  }, [selectedCategoryId, showDetails, title, url]);

  const handleOpenUrl = useCallback(
    async (bookmark: Bookmark) => {
      try {
        await openUrlInNewTab(bookmark.url);
        const visitedBookmark = await recordBookmarkVisit(bookmark.id);
        setSearchEntries((previous) =>
          sortBookmarks(
            previous.map((entry) => (entry.bookmark.id === visitedBookmark.id ? visitedBookmark : entry.bookmark)),
            bookmarkSortMode,
          ).map((item) => buildSearchEntry(item)),
        );
      } catch {
        setStatus({ tone: 'error', text: 'Tab konnte nicht geöffnet werden.' });
      }
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

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSearchSelection((current) => Math.min(current + 1, quickAccessEntries.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSearchSelection((current) => Math.max(current - 1, 0));
      } else if (event.key === 'Enter') {
        if (searchSelection >= 0 && quickAccessEntries[searchSelection]) {
          event.preventDefault();
          void handleOpenUrl(quickAccessEntries[searchSelection].bookmark);
        }
      }
    },
    [handleOpenUrl, quickAccessEntries, searchSelection],
  );

  useEffect(() => {
    const harness: PopupHarness = {
      addBookmark: async (input) => {
        const bookmark = await saveBookmark({ title: input.title, url: input.url, tags: input.tags });
        return bookmark.id;
      },
      search: async (term: string) => setSearchTerm(term),
      clearSearch: async () => setSearchTerm(''),
      selectRange: async () => {},
      getSelectedIds: async () => [],
      runBatch: async () => {},
      importBulk: async () => 0,
      visibleTitles: async (limit = 10) => {
        const normalizedLimit = Math.max(0, Math.trunc(limit));
        return searchEntriesRef.current
          .slice(0, normalizedLimit > 0 ? normalizedLimit : searchEntriesRef.current.length)
          .map((entry) => entry.bookmark.title);
      },
    };

    window.__LINKOSAURUS_POPUP_HARNESS = harness;
    return () => {
      if (window.__LINKOSAURUS_POPUP_HARNESS === harness) {
        delete window.__LINKOSAURUS_POPUP_HARNESS;
      }
    };
  }, [saveBookmark]);

  const handleOpenSettings = useCallback(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
      return;
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL && typeof window !== 'undefined') {
      window.open(chrome.runtime.getURL('options.html'), '_blank', 'noopener,noreferrer');
    }
  }, []);

  return (
    <div className="popup-app" role="application" aria-label="Link-O-Saurus Popup">
      <header className="popup-header">
        <h1>Link-O-Saurus</h1>
        <div className="popup-header-actions">
          <button type="button" className="ghost-button" onClick={() => void openDashboard()}>
            Dashboard
          </button>
          <button
            type="button"
            className="ghost-button icon-only-button"
            onClick={handleOpenSettings}
            aria-label="Einstellungen öffnen"
            title="Einstellungen"
          >
            <i className="fa-solid fa-gear" aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="popup-main">
        <section className="quick-save" aria-labelledby="quick-save-title">
          <div className="quick-save__top">
            <p id="quick-save-title">Aktuellen Tab speichern</p>
            <button type="button" className="inline-link" onClick={() => void loadQuickSaveFromTab()}>
              Neu laden
            </button>
          </div>

          <div className="quick-save__preview" title={title || url || 'Kein aktiver Tab erkannt'}>
            <strong>{title || 'Titel wird geladen…'}</strong>
            <span>{url || 'URL wird geladen…'}</span>
          </div>

          <div className="quick-save__actions">
            <button
              type="button"
              className="primary-button"
              disabled={saving || !quickSaveReady || Boolean(duplicateEntry)}
              onClick={() => void handleQuickSave()}
            >
              {saving ? 'Speichert…' : duplicateEntry ? 'Bereits gespeichert' : 'Bookmark speichern'}
            </button>
            <button type="button" className="subtle-button" onClick={() => setShowDetails((value) => !value)}>
              {showDetails ? 'Weniger' : 'Details'}
            </button>
          </div>

          {showDetails ? (
            <div className="quick-save__details">
              <label>
                <span>Titel</span>
                <input type="text" value={title} onInput={(event) => setTitle((event.currentTarget as HTMLInputElement).value)} />
              </label>
              <label>
                <span>URL</span>
                <input type="url" value={url} onInput={(event) => setUrl((event.currentTarget as HTMLInputElement).value)} />
              </label>
              <label>
                <span id="quick-tags-label">Tags</span>
                <TagInput id="quick-tags" tags={tags} onChange={setTags} />
              </label>
              {showDetails ? (
                <div className="ai-suggestions" aria-live="polite">
                  <div className="ai-suggestions__head">
                    <span>KI-Vorschläge</span>
                    {loadingSuggestions ? <small>berechne…</small> : null}
                  </div>
                  {aiSuggestions?.tags?.length ? (
                    <div className="ai-suggestions__tags">
                      {aiSuggestions.tags.map((suggestion) => (
                        <button
                          type="button"
                          key={suggestion.tag}
                          className="ai-tag"
                          onClick={() =>
                            setTags((current) =>
                              current.some((tag) => tag.toLowerCase() === suggestion.tag.toLowerCase())
                                ? current
                                : [...current, suggestion.tag],
                            )
                          }
                        >
                          +{suggestion.tag}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <small>Keine sicheren Tag-Vorschläge.</small>
                  )}
                </div>
              ) : null}
              <label>
                <span>Folder (Vorschlag)</span>
                <select value={selectedCategoryId} onChange={(event) => setSelectedCategoryId((event.currentTarget as HTMLSelectElement).value)}>
                  <option value="">Kein Folder</option>
                  {aiSuggestions?.bestFolder ? (
                    <option value={aiSuggestions.bestFolder.category.id}>
                      🤖 {aiSuggestions.bestFolder.category.title}
                    </option>
                  ) : null}
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.title}
                    </option>
                  ))}
                </select>
              </label>
              {aiSuggestions?.alternativeFolders.length ? (
                <small className="folder-alternatives">
                  Alternativen: {aiSuggestions.alternativeFolders.map((item) => item.category.title).join(', ')}
                </small>
              ) : null}
              <button type="button" className="inline-link" onClick={() => void openDashboard({ new: '1', url, title, tags })}>
                Im Dashboard weiter bearbeiten
              </button>
            </div>
          ) : null}

          {status ? <p className={`status status--${status.tone}`}>{status.text}</p> : null}
        </section>

        {showDetails ? null : (
          <section className="quick-access" aria-labelledby="quick-access-title">
            <div className="quick-access__top">
              <p id="quick-access-title">Suchen & öffnen</p>
              <select value={bookmarkSortMode} onChange={handleSortModeChange} aria-label="Sortierung">
                <option value="relevance">Relevanz</option>
                <option value="newest">Neueste</option>
                <option value="alphabetical">A–Z</option>
              </select>
            </div>

            <label className="search">
              <span className="sr-only">Bookmarks durchsuchen</span>
              <input
                ref={searchInputRef}
                type="search"
                value={searchTerm}
                onInput={(event) => setSearchTerm((event.currentTarget as HTMLInputElement).value)}
                onKeyDown={(event) => handleSearchKeyDown(event as unknown as KeyboardEvent)}
                placeholder="Bookmarks durchsuchen (/)"
              />
            </label>

            <ul className="access-list" role="listbox" aria-live="polite">
              {quickAccessEntries.map((entry, index) => (
                <li key={entry.bookmark.id}>
                  <button
                    type="button"
                    className={`access-item${index === searchSelection ? ' is-active' : ''}`}
                    role="option"
                    aria-selected={index === searchSelection}
                    onClick={() => void handleOpenUrl(entry.bookmark)}
                    onMouseEnter={() => setSearchSelection(index)}
                  >
                    <BookmarkFavicon bookmark={entry.bookmark} />
                    <span className="access-item__text">
                      <strong>{entry.bookmark.title || entry.bookmark.url}</strong>
                      <small>{entry.domain || entry.bookmark.url}</small>
                    </span>
                  </button>
                </li>
              ))}
              {quickAccessEntries.length === 0 ? (
                <li className="empty-state">{hasQuery ? 'Keine Treffer gefunden.' : 'Noch keine Bookmarks gespeichert.'}</li>
              ) : null}
            </ul>
          </section>
        )}
      </main>

    </div>
  );
};

export default App;
