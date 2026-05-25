import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ComponentType as ReactComponentType } from 'react';
import type { ListChildComponentProps } from 'react-window';
import { applyNegativeTagContextAction, getTagFilterMode } from '../../shared/tag-filter';
import type { BookmarkListData } from '../types';
import { formatTimestamp, combineClassNames } from '../utils/formatting';
import { getBookmarkDomain } from '../utils/bookmark-display';
import { BookmarkAvatar } from './BookmarkAvatar';

const MAX_VISIBLE_BOOKMARK_TAGS = 3;

type BookmarkRowProps = ListChildComponentProps<BookmarkListData>;

export const BookmarkRow = ({ index, style, data }: BookmarkRowProps): JSX.Element => {
  const row = data.rows[index];
  const id = row?.kind === 'bookmark' ? row.bookmarkId : row?.id;
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

  if (!row) {
    return <div style={style as JSX.CSSProperties} className="bookmark-row placeholder" />;
  }
  if (row.kind === 'folder') {
    const isActive = data.activeRowIndex === index;
    return (
      <div
        role="treeitem"
        aria-level={row.depth + 1}
        aria-expanded={row.expanded}
        tabIndex={isActive ? 0 : -1}
        className="bookmark-row bookmark-folder-row"
        ref={(node) => {
          rowRef.current = node;
          data.onRowRef(index, node);
        }}
        style={{ ...(style as JSX.CSSProperties), paddingInlineStart: `${12 + row.depth * 16}px` }}
        onFocus={() => data.onRowFocus(index)}
        onKeyDown={(event) => data.onRowKeyDown(event as unknown as KeyboardEvent, index)}
      >
        <button type="button" tabIndex={-1} className="folder-toggle" onClick={() => data.onToggleFolder(row.id)} aria-expanded={row.expanded}>
          <span aria-hidden="true">{row.expanded ? '▾' : '▸'}</span> {row.title}
        </button>
      </div>
    );
  }
  const entry = data.bookmarkById.get(row.bookmarkId);
  if (!entry) {
    return <div style={style as JSX.CSSProperties} className="bookmark-row placeholder" />;
  }
  const { bookmark, board, category } = entry;
  const isSelected = data.selected.has(id);
  const domain = getBookmarkDomain(bookmark.url);
  const secondaryMeta = [category?.title, board?.title].filter(Boolean).join(' · ');
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
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={isSelected}
      tabIndex={data.activeRowIndex === index ? 0 : -1}
      className={combineClassNames('bookmark-row', isSelected && 'selected')}
      ref={(node) => {
        rowRef.current = node;
        data.onRowRef(index, node);
      }}
      style={{ ...(style as JSX.CSSProperties), paddingInlineStart: `${12 + row.depth * 16}px` }}
      onClick={handleClick}
      onFocus={() => data.onRowFocus(index)}
      onDblClick={handleDoubleClick}
      onKeyDown={(event) => {
        data.onRowKeyDown(event as unknown as KeyboardEvent, index);
        handleKeyDown(event as unknown as KeyboardEvent);
      }}
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
          <span className="bookmark-domain" title={bookmark.url}>
            {domain}
          </span>
          {secondaryMeta ? <span className="bookmark-secondary-meta">{secondaryMeta}</span> : null}
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
        <span className="bookmark-updated-label">Aktualisiert</span>
        <span>{formatTimestamp(bookmark.updatedAt)}</span>
      </div>
    </div>
  );
};

export const BookmarkRowRenderer = BookmarkRow as unknown as ReactComponentType<
  ListChildComponentProps<BookmarkListData>
>;
