import type { CSSProperties, JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ComponentType as ReactComponentType } from 'react';
import type { ListChildComponentProps } from 'react-window';
import { applyNegativeTagContextAction, getTagFilterMode } from '../../shared/tag-filter';
import type { BookmarkTileListData } from '../types';
import { formatTimestamp, combineClassNames } from '../utils/formatting';
import { getBookmarkDomain } from '../utils/bookmark-display';
import { BookmarkAvatar } from './BookmarkAvatar';

const MAX_VISIBLE_BOOKMARK_TAGS = 3;
const MAX_VISIBLE_TILE_TITLE_LINES = 3;
const MAX_VISIBLE_TILE_DETAIL_LINES = 1;

type BookmarkTileRowProps = ListChildComponentProps<BookmarkTileListData>;

export const BookmarkTileRow = ({ index, style, data }: BookmarkTileRowProps): JSX.Element => {
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
        const tileHeight = Math.max(tile.scrollHeight, tile.offsetHeight);
        maxTileHeight = Math.max(maxTileHeight, tileHeight);
      });
      return Math.ceil(maxTileHeight + paddingTop + paddingBottom);
    };
    const measureHeight = (entry?: ResizeObserverEntry): number => {
      const natural = measureTilesHeight();
      if (entry?.borderBoxSize) {
        const borderBox = Array.isArray(entry.borderBoxSize)
          ? entry.borderBoxSize[0]
          : entry.borderBoxSize;
        if (borderBox) {
          return natural;
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
        const updatedLabel = formatTimestamp(bookmark.updatedAt);
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
            <div className="bookmark-tile-meta">
              <span className="bookmark-domain" title={bookmark.url}>
                {domain}
              </span>
              {secondaryMeta ? <span className="bookmark-secondary-meta">{secondaryMeta}</span> : null}
              <span className="bookmark-updated" title={`Zuletzt aktualisiert ${updatedLabel}`}>
                {updatedLabel}
              </span>
            </div>
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

export const BookmarkTileRowRenderer = BookmarkTileRow as unknown as ReactComponentType<
  ListChildComponentProps<BookmarkTileListData>
>;
