import type { FunctionalComponent } from 'preact';
import { useState } from 'preact/hooks';
import type { Bookmark } from '../../shared/types';
import { getBookmarkInitial } from '../utils/bookmark-display';

export const BookmarkAvatar: FunctionalComponent<{ readonly bookmark: Bookmark }> = ({ bookmark }) => {
  const [hasImageError, setHasImageError] = useState(false);
  const favicon = bookmark.faviconUrl?.trim();
  const showFavicon = Boolean(favicon) && !hasImageError;
  return (
    <div className="bookmark-avatar" aria-hidden="true">
      {showFavicon ? (
        <img
          src={favicon}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setHasImageError(true)}
        />
      ) : (
        <span className="bookmark-avatar-fallback">{getBookmarkInitial(bookmark)}</span>
      )}
    </div>
  );
};
