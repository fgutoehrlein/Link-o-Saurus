import { FunctionalComponent } from 'preact';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { createBookmark, listRecentBookmarks } from '../shared/db';
import type { Bookmark } from '../shared/types';
import { openDashboard } from '../shared/utils';
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

const RECENT_LIMIT = 5;
const SEARCH_INDEX_LIMIT = 200;
const SEARCH_RESULTS_LIMIT = 10;

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
    // Validate URL
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
  if (!firstChar) {
    return '🔖';
  }
  return firstChar.toUpperCase();
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
  const collect = (value: string) => {
    createTokenSet(value).forEach((token) => tokenSet.add(token));
  };

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

const containsTabsPermission = async (): Promise<boolean> => {
  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) {
    return false;
  }
  return new Promise<boolean>((resolve) => {
    chrome.permissions.contains({ permissions: ['tabs'] }, (granted) => {
      resolve(Boolean(granted));
    });
  });
};

const requestTabsPermission = async (): Promise<boolean> => {
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) {
    return false;
  }
  return new Promise<boolean>((resolve) => {
    chrome.permissions.request({ permissions: ['tabs'] }, (granted) => {
      resolve(Boolean(granted));
    });
  });
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
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  const removeTag = useCallback(
    (tag: string) => {
      onChange(tags.filter((candidate) => candidate !== tag));
      inputRef.current?.focus();
    },
    [onChange, tags],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ',') {
        if (draft.trim()) {
          event.preventDefault();
          commitDraft();
        }
      } else if (event.key === 'Backspace' && !draft && tags.length > 0) {
        event.preventDefault();
        onChange(tags.slice(0, -1));
      }
    },
    [commitDraft, draft, onChange, tags],
  );

  return (
    <div className="tag-input" role="list" aria-labelledby={`${id}-label`}>
      {tags.map((tag) => (
        <span key={tag} className="tag-pill" role="listitem">
          <span>{tag}</span>
          <button
            type="button"
            className="tag-pill__remove"
            onClick={() => removeTag(tag)}
            aria-label={`Tag ${tag} entfernen`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        value={draft}
        onInput={(event) => setDraft((event.currentTarget as HTMLInputElement).value)}
        onKeyDown={(event) => handleKeyDown(event as unknown as KeyboardEvent)}
        onBlur={() => commitDraft()}
        placeholder={tags.length === 0 ? 'Tag eingeben…' : ''}
        aria-label="Tag hinzufügen"
        autoComplete="off"
      />
    </div>
  );
};

const BookmarkFavicon: FunctionalComponent<{ readonly bookmark: Bookmark }> = ({ bookmark }) => {
  const faviconUrl = getFaviconUrl(bookmark.url);
  return (
    <span className="favicon" aria-hidden="true">
      <span className="favicon__placeholder">{getBookmarkInitial(bookmark)}</span>
      {faviconUrl ? (
        <img
          src={faviconUrl}
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
};

const App: FunctionalComponent = () => {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchEntries, setSearchEntries] = useState<SearchEntry[]>([]);
  const searchEntriesRef = useRef<SearchEntry[]>([]);
  const [searchSelection, setSearchSelection] = useState(-1);
  const [saving, setSaving] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const hadTabsPermissionRef = useRef(false);
  const requestedTabsPermissionRef = useRef(false);

  useEffect(() => {
    searchEntriesRef.current = searchEntries;
  }, [searchEntries]);

  useEffect(() => {
    const readyTimestamp = performance.now();
    window.__LINKOSAURUS_POPUP_READY = true;
    window.__LINKOSAURUS_POPUP_READY_TIME = readyTimestamp;
    return () => {
      delete window.__LINKOSAURUS_POPUP_READY;
      delete window.__LINKOSAURUS_POPUP_READY_TIME;
      delete window.__LINKOSAURUS_POPUP_HARNESS;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadIndex = async () => {
      const bookmarks = await listRecentBookmarks(SEARCH_INDEX_LIMIT);
      if (!cancelled) {
        setSearchEntries(bookmarks.map((bookmark) => buildSearchEntry(bookmark)));
      }
    };
    void loadIndex();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const checkPermissions = async () => {
      const hasPermission = await containsTabsPermission();
      if (mounted) {
        hadTabsPermissionRef.current = hasPermission;
      }
    };
    void checkPermissions();
    return () => {
      mounted = false;
      if (
        !hadTabsPermissionRef.current &&
        requestedTabsPermissionRef.current &&
        typeof chrome !== 'undefined' &&
        chrome.permissions?.remove
      ) {
        chrome.permissions.remove({ permissions: ['tabs'] }, () => {
          // Intentionally ignore result; best-effort cleanup.
        });
      }
    };
  }, []);

  const duplicateEntry = useMemo(() => {
    if (!url.trim()) {
      return undefined;
    }
    const normalizedUrl = normalizeUrlForComparison(url).toLowerCase();
    if (!normalizedUrl) {
      return undefined;
    }
    return searchEntries.find((entry) => entry.normalizedUrl === normalizedUrl);
  }, [searchEntries, url]);

  const recentBookmarks = useMemo(
    () => searchEntries.slice(0, RECENT_LIMIT).map((entry) => entry.bookmark),
    [searchEntries],
  );

  const computeSearchResults = useCallback((term: string, entries: SearchEntry[]): SearchEntry[] => {
    const tokens = term
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);
    if (tokens.length === 0) {
      return [];
    }
    return entries
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
        const strongMatch = entry.tokens.some((candidate) => candidate.startsWith(tokens[0] ?? ''))
          ? 0
          : 1;
        return { entry, score: strongMatch };
      })
      .filter((value): value is { entry: SearchEntry; score: number } => value !== null)
      .sort((a, b) => {
        if (a.score !== b.score) {
          return a.score - b.score;
        }
        return b.entry.bookmark.createdAt - a.entry.bookmark.createdAt;
      })
      .slice(0, SEARCH_RESULTS_LIMIT)
      .map((item) => item.entry);
  }, []);

  const hasQuery = searchTerm.trim().length > 0;

  const searchResults = useMemo(
    () => (hasQuery ? computeSearchResults(searchTerm, searchEntries) : []),
    [computeSearchResults, hasQuery, searchEntries, searchTerm],
  );

  useEffect(() => {
    setSearchSelection((current) => {
      if (!hasQuery) {
        return -1;
      }
      const maxIndex = searchResults.length - 1;
      if (maxIndex < 0) {
        return -1;
      }
      if (current < 0 || current > maxIndex) {
        return 0;
      }
      return current;
    });
  }, [hasQuery, searchResults]);

  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === '/' && !event.defaultPrevented) {
        const target = event.target as HTMLElement | null;
        const isTextInput =
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.getAttribute('contenteditable') === 'true');
        if (!isTextInput) {
          event.preventDefault();
          focusSearchInput();
        }
      } else if (event.key === 'Escape') {
        const active = document.activeElement as HTMLElement | null;
        if (active && typeof active.blur === 'function') {
          active.blur();
        } else if (typeof window.close === 'function') {
          window.close();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusSearchInput]);

  const handleOpenDashboard = useCallback(() => {
    void openDashboard().catch((error) => {
      console.error('Dashboard konnte nicht geöffnet werden.', error);
      setStatus({ tone: 'error', text: 'Dashboard konnte nicht geöffnet werden.' });
    });
  }, [setStatus]);

  const handleEditInDashboard = useCallback(async () => {
    setStatus(null);
    const sanitizedUrl = url.trim();
    if (!sanitizedUrl) {
      setStatus({ tone: 'error', text: 'Bitte eine gültige URL eingeben.' });
      return;
    }
    const sanitizedTitle = normalizeWhitespace(title);
    const sanitizedTags = tags.map((tag) => tag.trim()).filter(Boolean);
    try {
      await openDashboard({
        new: '1',
        url: sanitizedUrl,
        title: sanitizedTitle,
        tags: sanitizedTags,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Dashboard konnte nicht geöffnet werden.';
      setStatus({ tone: 'error', text: message });
    }
  }, [setStatus, tags, title, url]);

  const handleOpenDashboardWithSearch = useCallback(async () => {
    const trimmed = searchTerm.trim();
    try {
      if (trimmed) {
        await openDashboard({ q: trimmed });
      } else {
        await openDashboard();
      }
    } catch (error) {
      console.error('Dashboard konnte nicht geöffnet werden.', error);
    }
  }, [searchTerm]);

  const handleOpenUrl = useCallback(
    async (targetUrl: string) => {
      try {
        await openUrlInNewTab(targetUrl);
      } catch (error) {
        console.error(error);
        setStatus({ tone: 'error', text: 'Tab konnte nicht geöffnet werden.' });
      }
    },
    [],
  );

  const saveBookmark = useCallback(
    async ({ title: rawTitle, url: rawUrl, tags: rawTags }: { title: string; url: string; tags?: string[] }) => {
      const normalizedUrl = normalizeUrlForSaving(rawUrl);
      const normalizedTitle = normalizeWhitespace(rawTitle) || extractDomain(normalizedUrl) || normalizedUrl;
      const sourceTags = rawTags ?? [];
      const uniqueTags = sourceTags.filter(
        (tag, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === tag.toLowerCase()) === index,
      );
      const now = Date.now();
      const bookmark = await createBookmark({
        id: crypto.randomUUID(),
        url: normalizedUrl,
        title: normalizedTitle,
        tags: uniqueTags,
        createdAt: now,
        updatedAt: now,
      });
      setSearchEntries((previous) => {
        const filtered = previous.filter((entry) => entry.bookmark.id !== bookmark.id);
        const next = [buildSearchEntry(bookmark), ...filtered].slice(0, SEARCH_INDEX_LIMIT);
        searchEntriesRef.current = next;
        return next;
      });
      return bookmark;
    },
    [],
  );

  const handleQuickAddSubmit = useCallback(
    async (event: Event) => {
      event.preventDefault();
      if (saving) {
        return;
      }
      setStatus(null);
      setSaving(true);
      try {
        await saveBookmark({ title, url, tags });
        setStatus({ tone: 'success', text: 'Bookmark gespeichert.' });
        setTitle('');
        setUrl('');
        setTags([]);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Speichern fehlgeschlagen.';
        setStatus({ tone: 'error', text: message });
      } finally {
        setSaving(false);
      }
    },
    [saveBookmark, saving, tags, title, url],
  );

  const handlePrefillFromTab = useCallback(async () => {
    setStatus(null);
    try {
      let hasPermission = await containsTabsPermission();
      if (!hasPermission) {
        requestedTabsPermissionRef.current = true;
        hasPermission = await requestTabsPermission();
      }
      if (!hasPermission) {
        setStatus({ tone: 'info', text: 'Tab-Zugriff wurde nicht erlaubt.' });
        return;
      }
      const activeTab = await queryActiveTab();
      if (!activeTab) {
        setStatus({ tone: 'error', text: 'Aktiver Tab nicht gefunden.' });
        return;
      }
      if (typeof activeTab.title === 'string' && activeTab.title.trim()) {
        setTitle(activeTab.title.trim());
      }
      if (typeof activeTab.url === 'string') {
        setUrl(activeTab.url);
      }
    } catch (error) {
      console.error(error);
      setStatus({ tone: 'error', text: 'Aktiver Tab konnte nicht gelesen werden.' });
    }
  }, []);

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSearchSelection((current) => {
          const next = current + 1;
          return Math.min(next, searchResults.length - 1);
        });
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSearchSelection((current) => {
          const next = current - 1;
          return Math.max(next, 0);
        });
      } else if (event.key === 'Enter') {
        if (searchSelection >= 0 && searchSelection < searchResults.length) {
          event.preventDefault();
          void handleOpenUrl(searchResults[searchSelection]?.bookmark.url ?? '');
        }
      }
    },
    [handleOpenUrl, searchResults, searchSelection],
  );

  useEffect(() => {
    const harness: PopupHarness = {
      addBookmark: async (input) => {
        const bookmark = await saveBookmark({ title: input.title, url: input.url, tags: input.tags });
        return bookmark.id;
      },
      search: async (term: string) => {
        setSearchTerm(term);
      },
      clearSearch: async () => {
        setSearchTerm('');
      },
      selectRange: async () => {
        // Popup no longer exposes range selection in the simplified UI.
      },
      getSelectedIds: async () => [],
      runBatch: async () => {
        // Batch actions removed from simplified popup.
      },
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

  return (
    <div className="popup-app">
      <header className="popup-header">
        <div className="popup-header__title" aria-label="Link-O-Saurus">
          <span className="popup-header__icon" aria-hidden="true">
            🦖
          </span>
          <h1>Link-O-Saurus</h1>
        </div>
        <button type="button" className="primary" onClick={handleOpenDashboard} aria-label="Zum Dashboard">
          Zum Dashboard
        </button>
      </header>

      <main className="popup-content">
        <section className="section" aria-labelledby="quick-add-heading">
          <div className="section-header">
            <h2 id="quick-add-heading">Schnell hinzufügen</h2>
          </div>
          <form className="quick-add-form" onSubmit={(event) => void handleQuickAddSubmit(event as unknown as Event)}>
            <label className="field">
              <span id="quick-add-title-label" className="field-label">
                Titel
              </span>
              <input
                id="quick-add-title"
                name="title"
                value={title}
                onInput={(event) => setTitle((event.currentTarget as HTMLInputElement).value)}
                placeholder="Titel eingeben"
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span id="quick-add-url-label" className="field-label">
                URL
              </span>
              <div className="field-inline">
                <input
                  id="quick-add-url"
                  name="url"
                  type="url"
                  value={url}
                  onInput={(event) => setUrl((event.currentTarget as HTMLInputElement).value)}
                  placeholder="https://…"
                  required
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void handlePrefillFromTab()}
                  aria-label="Aus aktuellem Tab übernehmen"
                >
                  Tab übernehmen
                </button>
              </div>
            </label>
            <label className="field">
              <span id="quick-add-tags-label" className="field-label">
                Tags
              </span>
              <TagInput id="quick-add-tags" tags={tags} onChange={setTags} />
            </label>
            {duplicateEntry ? (
              <p className="status-message status-warning" role="status">
                Bereits vorhanden: {duplicateEntry.bookmark.title}
              </p>
            ) : null}
            {status ? (
              <p className={`status-message status-${status.tone}`} role="status" aria-live="polite">
                {status.text}
              </p>
            ) : null}
            <div className="actions">
              <button type="submit" className="primary" disabled={saving} aria-label="Bookmark speichern">
                {saving ? 'Speichern…' : 'Speichern'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void handleEditInDashboard()}
                aria-label="Im Dashboard bearbeiten"
              >
                Im Dashboard bearbeiten
              </button>
            </div>
          </form>
        </section>

        <section className="section" aria-labelledby="recent-heading">
          <div className="section-header">
            <h2 id="recent-heading">Kürzlich hinzugefügt</h2>
          </div>
          {recentBookmarks.length === 0 ? (
            <p className="empty-state">Noch keine Bookmarks gespeichert.</p>
          ) : (
            <ul className="recent-list" role="list">
              {recentBookmarks.map((bookmark) => (
                <li key={bookmark.id}>
                  <button
                    type="button"
                    className="recent-item"
                    onClick={() => void handleOpenUrl(bookmark.url)}
                    aria-label={`${bookmark.title} öffnen`}
                  >
                    <BookmarkFavicon bookmark={bookmark} />
                    <span className="recent-item__title">{bookmark.title || bookmark.url}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="section" aria-labelledby="search-heading">
          <div className="section-header">
            <h2 id="search-heading">Mini-Suche</h2>
          </div>
          <div className="search-box">
            <input
              ref={searchInputRef}
              type="search"
              value={searchTerm}
              onInput={(event) => setSearchTerm((event.currentTarget as HTMLInputElement).value)}
              onKeyDown={(event) => handleSearchKeyDown(event as unknown as KeyboardEvent)}
              placeholder="Suchen (/)"
              aria-controls="search-results"
              aria-label="Bookmarks durchsuchen"
              autoComplete="off"
            />
            <ul id="search-results" className="search-results" role="listbox" aria-live="polite">
              {searchResults.map((entry, index) => (
                <li key={entry.bookmark.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === searchSelection}
                    className={`search-result${index === searchSelection ? ' is-active' : ''}`}
                    onClick={() => void handleOpenUrl(entry.bookmark.url)}
                    onMouseEnter={() => setSearchSelection(index)}
                  >
                    <span className="search-result__title">{entry.bookmark.title}</span>
                    <span className="search-result__meta">{entry.domain}</span>
                  </button>
                </li>
              ))}
              {hasQuery && searchResults.length === 0 ? (
                <li className="search-empty" role="status">
                  Keine Treffer
                </li>
              ) : null}
            </ul>
            {hasQuery ? (
              <button
                type="button"
                className="link"
                onClick={() => void handleOpenDashboardWithSearch()}
                aria-label="Mehr Ergebnisse im Dashboard"
              >
                Mehr Ergebnisse im Dashboard
              </button>
            ) : null}
          </div>
        </section>
      </main>

      <footer className="popup-footer">
        <button type="button" className="link" onClick={handleOpenDashboard} aria-label="Mehr Funktionen im Dashboard">
          Mehr Funktionen im Dashboard
        </button>
      </footer>
    </div>
  );
};

export default App;
