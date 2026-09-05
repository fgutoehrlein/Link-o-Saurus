import type { FunctionalComponent, RefObject } from 'preact';
import type { VariableSizeList as VariableSizeListHandle } from 'react-window';
import type { BookmarkSortMode } from '../../shared/types';
import type { BookmarkViewMode } from '../view-mode';
import type { BookmarkListData, BookmarkTileListData } from '../types';
import { combineClassNames } from '../utils/formatting';
import { BookmarkRowRenderer } from './BookmarkRow';
import { BookmarkTileRowRenderer } from './BookmarkTileRow';
import { TileVirtualList, VirtualList } from './BookmarkVirtualLists';

const DEFAULT_BOOKMARK_ROW_HEIGHT = 68;
const DEFAULT_TILE_ROW_HEIGHT = 248;
const TILE_VIEW_TOP_GAP = 24;

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

const VIEW_MODE_OPTIONS = [
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
] as const;

type ActiveFilterChip = {
  readonly id: string;
  readonly label: string;
  readonly tone?: 'default' | 'include' | 'exclude';
  readonly remove: () => void;
};

type BookmarkWorkspaceProps = {
  readonly bookmarkCountLabel: string;
  readonly bookmarkSortMode: BookmarkSortMode;
  readonly bookmarkViewMode: BookmarkViewMode;
  readonly selectedCount: number;
  readonly selectedCountLabel: string;
  readonly isSidebarCompact: boolean;
  readonly canUseCompactSidebar: boolean;
  readonly searchResultLabel: string;
  readonly showFilterDetails: boolean;
  readonly isDetailPanelOpen: boolean;
  readonly hasActiveFilters: boolean;
  readonly activeFilterChips: readonly ActiveFilterChip[];
  readonly listContainerRef: RefObject<HTMLDivElement>;
  readonly isSearching: boolean;
  readonly tileRowCount: number;
  readonly treeRowCount: number;
  readonly listHeight: number;
  readonly searchQuery: string;
  readonly getRowHeight: (index: number) => number;
  readonly getTileRowHeight: (index: number) => number;
  readonly listData: BookmarkListData;
  readonly tileListData: BookmarkTileListData;
  readonly onSortModeChange: (event: Event) => void;
  readonly onViewModeChange: (mode: BookmarkViewMode) => void | Promise<void>;
  readonly onClearSelection: () => void;
  readonly onCreateBookmark: () => void;
  readonly onUpdateSidebarCompact: (compact: boolean) => void;
  readonly onToggleFilterDetails: () => void;
  readonly onOpenDetailPanel: () => void;
  readonly onResetAllFilters: () => void;
  readonly onListRef: (instance: VariableSizeListHandle<BookmarkListData> | null) => void;
  readonly onTileListRef: (instance: VariableSizeListHandle<BookmarkTileListData> | null) => void;
};

export const BookmarkWorkspace: FunctionalComponent<BookmarkWorkspaceProps> = ({
  activeFilterChips,
  bookmarkCountLabel,
  bookmarkSortMode,
  bookmarkViewMode,
  canUseCompactSidebar,
  getRowHeight,
  getTileRowHeight,
  hasActiveFilters,
  isDetailPanelOpen,
  isSearching,
  isSidebarCompact,
  listContainerRef,
  listData,
  listHeight,
  onClearSelection,
  onCreateBookmark,
  onListRef,
  onOpenDetailPanel,
  onResetAllFilters,
  onSortModeChange,
  onTileListRef,
  onToggleFilterDetails,
  onUpdateSidebarCompact,
  onViewModeChange,
  searchQuery,
  searchResultLabel,
  selectedCount,
  selectedCountLabel,
  showFilterDetails,
  tileListData,
  tileRowCount,
  treeRowCount,
}) => (
  <section className="bookmark-list" role="tree" aria-multiselectable="true" aria-label="Bookmark-Hierarchie">
    <div className="list-header">
      <h2>{bookmarkCountLabel}</h2>
      <div className="list-actions">
        <label className="toolbar-select">
          <span>Sortierung</span>
          <select value={bookmarkSortMode} onChange={onSortModeChange}>
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
                    void onViewModeChange(option.value);
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
        <div className={combineClassNames('selection-indicator', selectedCount === 0 && 'is-empty')}>
          <span>{selectedCountLabel}</span>
          <button
            type="button"
            className="selection-indicator-clear"
            onClick={onClearSelection}
            disabled={selectedCount === 0}
            aria-label="Auswahl entfernen"
            title="Auswahl entfernen"
          >
            ×
          </button>
        </div>
        <button type="button" onClick={onCreateBookmark}>
          Neu
        </button>
      </div>
    </div>
    <div className="active-tag-filters" role="status" aria-live="polite">
      <div className="active-tag-filters-header">
        {isSidebarCompact && canUseCompactSidebar ? (
          <button
            type="button"
            className="sidebar-tags-title-toggle in-filter-row"
            aria-pressed={isSidebarCompact}
            aria-label="Tags-Leiste erweitern"
            title="Tags-Leiste erweitern"
            onClick={() => onUpdateSidebarCompact(false)}
          >
            <span className="sidebar-tags-title-text">Tags</span>
            <span aria-hidden="true" className="sidebar-tags-collapse-arrow">
              →
            </span>
          </button>
        ) : null}
        <div className="active-filter-copy">
          <p className="active-tag-filters-title">Aktive Filter</p>
          <div className="active-filter-summary">{searchResultLabel}</div>
          <button
            type="button"
            className="active-filter-disclosure"
            aria-expanded={showFilterDetails}
            onClick={onToggleFilterDetails}
          >
            {showFilterDetails ? 'Details ausblenden' : 'Details anzeigen'}
          </button>
        </div>
        {!isDetailPanelOpen ? (
          <button
            type="button"
            className="detail-toggle-button in-filter-row"
            aria-expanded={isDetailPanelOpen}
            aria-label="Detailbereich öffnen"
            title="Detailbereich öffnen"
            onClick={onOpenDetailPanel}
          >
            <span aria-hidden="true">←</span> Details
          </button>
        ) : null}
      </div>
      {showFilterDetails ? (
        <>
          {hasActiveFilters ? (
            <ul className="active-tag-chip-list" aria-label="Aktive Filter">
              {activeFilterChips.map((chip) => (
                <li key={chip.id}>
                  <button
                    type="button"
                    className={combineClassNames(
                      'active-tag-chip',
                      chip.tone === 'include' && 'include',
                      chip.tone === 'exclude' && 'exclude',
                    )}
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
            onClick={onResetAllFilters}
            disabled={!hasActiveFilters}
          >
            Alle Filter entfernen
          </button>
        </>
      ) : null}
    </div>
    <div ref={listContainerRef} className="list-viewport" role="group" aria-busy={isSearching}>
      {(bookmarkViewMode === 'tiles' ? tileRowCount === 0 : treeRowCount === 0) ? (
        <div className="empty-state">
          {bookmarkViewMode === 'list' && isSearching
            ? 'Suche…'
            : searchQuery.trim() || hasActiveFilters
              ? (
                <>
                  <strong>Keine passenden Bookmarks gefunden.</strong>
                  <span>Entferne Suchbegriffe oder Filter, oder erstelle ein neues Bookmark.</span>
                  <div className="empty-state-actions">
                    <button type="button" onClick={onResetAllFilters}>Filter zurücksetzen</button>
                    <button type="button" onClick={onCreateBookmark}>Neues Bookmark</button>
                  </div>
                </>
              )
              : (
                <>
                  <strong>Noch keine Bookmarks.</strong>
                  <span>Speichere einen Link im Popup oder lege hier dein erstes Bookmark an.</span>
                  <button type="button" onClick={onCreateBookmark}>Neues Bookmark</button>
                </>
              )}
        </div>
      ) : listHeight > 0 ? (
        <div className={combineClassNames('view-mode-stage', bookmarkViewMode === 'tiles' && 'is-tiles')}>
          {bookmarkViewMode === 'list' ? (
            <VirtualList
              key="bookmark-list-view"
              height={listHeight}
              width="100%"
              itemCount={treeRowCount}
              itemSize={getRowHeight}
              estimatedItemSize={DEFAULT_BOOKMARK_ROW_HEIGHT}
              overscanCount={6}
              itemData={listData}
              ref={onListRef}
            >
              {BookmarkRowRenderer}
            </VirtualList>
          ) : (
            <div className="tile-mode-offset">
              <TileVirtualList
                key="bookmark-tile-view"
                height={Math.max(0, listHeight - TILE_VIEW_TOP_GAP)}
                width="100%"
                itemCount={tileRowCount}
                itemSize={getTileRowHeight}
                estimatedItemSize={DEFAULT_TILE_ROW_HEIGHT}
                overscanCount={4}
                itemData={tileListData}
                className="bookmark-tiles-list"
                ref={onTileListRef}
              >
                {BookmarkTileRowRenderer}
              </TileVirtualList>
            </div>
          )}
        </div>
      ) : null}
    </div>
  </section>
);
