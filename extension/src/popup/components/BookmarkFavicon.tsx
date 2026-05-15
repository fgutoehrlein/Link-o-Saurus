import { FunctionalComponent } from 'preact';
import type { Bookmark } from '../../shared/types';
import { getBookmarkInitial } from '../utils/popup-url';

export const BookmarkFavicon: FunctionalComponent<{ readonly bookmark: Bookmark }> = ({ bookmark }) => (
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
