import type { FunctionalComponent, RefObject } from 'preact';
import type { Bookmark, Board, Category } from '../../shared/types';
import { formatTimestamp } from '../utils/formatting';
import type { BatchMoveState, BookmarkListEntry, DraftBookmark } from '../types';
import { DetailTagInput } from './DetailTagInput';

type DashboardDetailPanelProps = {
  readonly draft: DraftBookmark | null;
  readonly detailState: DraftBookmark | null;
  readonly selectedIds: readonly string[];
  readonly selectedEntries: readonly BookmarkListEntry[];
  readonly activeBoardCategories: readonly Category[];
  readonly boards: readonly Board[];
  readonly categories: readonly Category[];
  readonly boardById: ReadonlyMap<string, Board>;
  readonly batchMove: BatchMoveState;
  readonly locale: string;
  readonly manualIconInputRef: RefObject<HTMLInputElement>;
  readonly isRefreshingFavicon: boolean;
  readonly isIconDropActive: boolean;
  readonly isUploadingIcon: boolean;
  readonly onDetailChange: (field: keyof DraftBookmark) => (event: Event) => void;
  readonly onDetailTagsChange: (nextTags: string) => void;
  readonly onDetailCategoryChange: (event: Event) => void;
  readonly onSaveDetail: () => void | Promise<void>;
  readonly onOpenBookmark: (bookmark: Bookmark) => void;
  readonly onRefreshFavicon: (bookmark: Bookmark) => void | Promise<void>;
  readonly onManualIconInputChange: (event: Event, bookmark: Bookmark | undefined) => void;
  readonly onIconDrop: (event: DragEvent, bookmark: Bookmark | undefined) => void | Promise<void>;
  readonly onIconDropActiveChange: (active: boolean) => void;
  readonly onBatchAddTags: (event: Event) => void | Promise<void>;
  readonly onBatchRemoveTags: (event: Event) => void | Promise<void>;
  readonly onBatchMove: (event: Event) => void | Promise<void>;
  readonly onBatchMoveChange: (field: keyof BatchMoveState, value: string) => void;
  readonly onBatchDelete: () => void | Promise<void>;
  readonly onCreateDraft: () => void;
  readonly onCancelDraft: () => void;
  readonly onClearSelection: () => void;
};

export const DashboardDetailPanel: FunctionalComponent<DashboardDetailPanelProps> = ({
  activeBoardCategories,
  batchMove,
  boardById,
  boards,
  categories,
  detailState,
  draft,
  isIconDropActive,
  isRefreshingFavicon,
  isUploadingIcon,
  locale,
  manualIconInputRef,
  onBatchAddTags,
  onBatchDelete,
  onBatchMove,
  onBatchMoveChange,
  onBatchRemoveTags,
  onCancelDraft,
  onClearSelection,
  onCreateDraft,
  onDetailCategoryChange,
  onDetailChange,
  onDetailTagsChange,
  onIconDrop,
  onIconDropActiveChange,
  onManualIconInputChange,
  onOpenBookmark,
  onRefreshFavicon,
  onSaveDetail,
  selectedEntries,
  selectedIds,
}) => {
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
            <input type="text" value={detailState?.title ?? ''} onInput={onDetailChange('title')} />
          </label>
          <label>
            <span>URL</span>
            <input type="url" value={detailState?.url ?? ''} onInput={onDetailChange('url')} />
          </label>
          <label>
            <span>Kategorie</span>
            <select value={detailState?.categoryId ?? ''} onChange={onDetailCategoryChange}>
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
            <span id="new-bookmark-tags-label">Tags</span>
            <DetailTagInput id="new-bookmark-tags" tagsText={detailState?.tags ?? ''} onChange={onDetailTagsChange} />
          </label>
          <label>
            <span>Notizen</span>
            <textarea value={detailState?.notes ?? ''} onInput={onDetailChange('notes')} />
          </label>
        </section>
        <div className="detail-actions">
          <button type="button" className="primary" onClick={onSaveDetail}>
            Speichern
          </button>
          <button type="button" onClick={onCancelDraft}>
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
          <p className="detail-meta">Zuletzt aktualisiert {formatTimestamp(entry?.bookmark.updatedAt, locale)}</p>
        </header>
        <section className="detail-section" aria-label="Allgemeine Informationen">
          <h3>Allgemeine Informationen</h3>
          <label>
            <span>Titel</span>
            <input type="text" value={detailState.title} onInput={onDetailChange('title')} />
          </label>
          <label>
            <span>URL</span>
            <input type="url" value={detailState.url} onInput={onDetailChange('url')} />
          </label>
          <label>
            <span>Kategorie</span>
            <select value={detailState.categoryId ?? ''} onChange={onDetailCategoryChange}>
              <option value="">Ohne Kategorie</option>
              {activeBoardCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {boardById.get(category.boardId)?.title ?? 'Board'} · {category.title}
                </option>
              ))}
            </select>
          </label>
          <div className="detail-actions">
            <button type="button" onClick={() => entry?.bookmark && onOpenBookmark(entry.bookmark)} disabled={!entry?.bookmark?.url}>
              Link im neuen Tab öffnen
            </button>
          </div>
        </section>
        <section className="detail-section" aria-label="Tags und Notizen">
          <h3>Tags</h3>
          <label>
            <span id="bookmark-detail-tags-label">Tags</span>
            <DetailTagInput id="bookmark-detail-tags" tagsText={detailState.tags} onChange={onDetailTagsChange} />
          </label>
          <h3>Notizen</h3>
          <label>
            <span>Notizen</span>
            <textarea value={detailState.notes} onInput={onDetailChange('notes')} />
          </label>
        </section>
        <details className="detail-section detail-section-collapsible">
          <summary>Metadaten &amp; Icon</summary>
          <div className="detail-meta-grid">
            <p>
              <span>Erstellt</span>
              <strong>{formatTimestamp(entry.bookmark.createdAt, locale)}</strong>
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
                onClick={() => entry?.bookmark && void onRefreshFavicon(entry.bookmark)}
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
              onChange={(event) => onManualIconInputChange(event, entry?.bookmark)}
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
                onIconDropActiveChange(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer!.dropEffect = 'copy';
                onIconDropActiveChange(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                const relatedTarget = event.relatedTarget as Node | null;
                if (!relatedTarget || !(event.currentTarget as HTMLElement).contains(relatedTarget)) {
                  onIconDropActiveChange(false);
                }
              }}
              onDrop={(event) => onIconDrop(event, entry?.bookmark)}
            >
              <strong>{isUploadingIcon ? 'Icon wird hochgeladen…' : 'Icon hier ablegen'}</strong>
              <span>oder klicken, um eine Bilddatei auszuwählen.</span>
            </div>
          </section>
        </details>
        <div className="detail-actions">
          <button type="button" className="primary" onClick={onSaveDetail}>
            Speichern
          </button>
          <button type="button" onClick={onBatchDelete}>
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
            <input type="text" value={detailState?.tags ?? ''} onInput={onDetailChange('tags')} placeholder="tag-a, tag-b" />
          </label>
          <div className="detail-actions">
            <button type="button" onClick={onBatchAddTags}>
              Tags hinzufügen
            </button>
            <button type="button" onClick={onBatchRemoveTags}>
              Tags entfernen
            </button>
          </div>
        </section>
        <details className="detail-section detail-section-collapsible">
          <summary>Mehr Aktionen</summary>
          <form className="batch-move" onSubmit={onBatchMove}>
            <label>
              <span>Board</span>
              <select value={batchMove.boardId} onChange={(event) => onBatchMoveChange('boardId', (event.currentTarget as HTMLSelectElement).value)}>
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
              <select value={batchMove.categoryId} onChange={(event) => onBatchMoveChange('categoryId', (event.currentTarget as HTMLSelectElement).value)}>
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
          <button type="button" className="danger" onClick={onBatchDelete}>
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
        <button type="button" onClick={onCreateDraft}>
          Neues Lesezeichen
        </button>
        <button type="button" onClick={onClearSelection}>
          Auswahl löschen
        </button>
      </div>
    </div>
  );
};
