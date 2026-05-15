import { FunctionalComponent } from 'preact';
import type { RefObject, Ref } from 'preact';
import type { Bookmark, BookmarkSortMode } from '../../shared/types';
import type { SearchEntry } from '../utils/popup-search';
import { BookmarkFavicon } from './BookmarkFavicon';

type QuickAccessListProps = {
  readonly bookmarkSortMode: BookmarkSortMode;
  readonly entries: readonly SearchEntry[];
  readonly hasQuery: boolean;
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly searchSelection: number;
  readonly searchTerm: string;
  readonly onOpenBookmark: (bookmark: Bookmark) => void;
  readonly onSearchKeyDown: (event: KeyboardEvent) => void;
  readonly onSearchSelectionChange: (index: number) => void;
  readonly onSearchTermChange: (term: string) => void;
  readonly onSortModeChange: (event: Event) => void;
};

export const QuickAccessList: FunctionalComponent<QuickAccessListProps> = ({
  bookmarkSortMode,
  entries,
  hasQuery,
  searchInputRef,
  searchSelection,
  searchTerm,
  onOpenBookmark,
  onSearchKeyDown,
  onSearchSelectionChange,
  onSearchTermChange,
  onSortModeChange,
}) => (
  <section className="quick-access" aria-labelledby="quick-access-title">
    <div className="quick-access__top">
      <p id="quick-access-title">Suchen & öffnen</p>
      <select value={bookmarkSortMode} onChange={onSortModeChange} aria-label="Sortierung">
        <option value="relevance">Relevanz</option>
        <option value="newest">Neueste</option>
        <option value="alphabetical">A–Z</option>
      </select>
    </div>

    <label className="search">
      <span className="sr-only">Bookmarks durchsuchen</span>
      <input
        ref={searchInputRef as Ref<HTMLInputElement>}
        type="search"
        value={searchTerm}
        onInput={(event) => onSearchTermChange((event.currentTarget as HTMLInputElement).value)}
        onKeyDown={(event) => onSearchKeyDown(event as unknown as KeyboardEvent)}
        placeholder="Bookmarks durchsuchen (/)"
      />
    </label>

    <ul className="access-list" role="listbox" aria-live="polite">
      {entries.map((entry, index) => (
        <li key={entry.bookmark.id}>
          <button
            type="button"
            className={`access-item${index === searchSelection ? ' is-active' : ''}`}
            role="option"
            aria-selected={index === searchSelection}
            onClick={() => onOpenBookmark(entry.bookmark)}
            onMouseEnter={() => onSearchSelectionChange(index)}
          >
            <BookmarkFavicon bookmark={entry.bookmark} />
            <span className="access-item__text">
              <strong>{entry.bookmark.title || entry.bookmark.url}</strong>
              <small>{entry.domain || entry.bookmark.url}</small>
            </span>
          </button>
        </li>
      ))}
      {entries.length === 0 ? <li className="empty-state">{hasQuery ? 'Keine Treffer gefunden.' : 'Noch keine Bookmarks gespeichert.'}</li> : null}
    </ul>
  </section>
);
