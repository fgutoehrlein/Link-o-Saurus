import type { FunctionalComponent } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';

import { getUserSettings, listBoards, listPinnedBookmarks, saveUserSettings } from '../shared/db';
import { sendBackgroundMessage } from '../shared/messaging';
import type { Board, Bookmark } from '../shared/types';

const STYLES = `
  :root {
    color-scheme: light;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: radial-gradient(circle at top left, #f8fafc, #e2e8f0);
    color: #0f172a;
  }

  main.newtab {
    max-width: 960px;
    margin: 0 auto;
    padding: 2.5rem 1.5rem 3rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  header.hero {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1.25rem;
  }

  header.hero h1 {
    margin: 0;
    font-size: 2rem;
    letter-spacing: -0.01em;
  }

  header.hero p {
    margin: 0.35rem 0 0;
    color: #475569;
    font-size: 1rem;
    line-height: 1.5;
  }

  header.hero button {
    padding: 0.75rem 1.4rem;
    border-radius: 999px;
    border: none;
    background: linear-gradient(135deg, #ef4444, #dc2626);
    color: #ffffff;
    font-weight: 600;
    cursor: pointer;
    transition: transform 120ms ease, box-shadow 120ms ease;
  }

  header.hero button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 16px 32px rgba(220, 38, 38, 0.25);
  }

  header.hero button:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  section.block {
    background: rgba(255, 255, 255, 0.88);
    border-radius: 18px;
    padding: 1.75rem;
    box-shadow: 0 25px 60px rgba(15, 23, 42, 0.08);
    border: 1px solid rgba(148, 163, 184, 0.18);
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  section.block h2 {
    margin: 0;
    font-size: 1.3rem;
  }

  section.block p {
    margin: 0;
    color: #475569;
    font-size: 0.95rem;
    line-height: 1.5;
  }

  .grid {
    display: grid;
    gap: 1rem;
  }

  .grid.favorites {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  }

  .grid.boards {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  }

  a.tile,
  button.tile {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.4rem;
    padding: 1.1rem 1.1rem;
    border-radius: 16px;
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.95), rgba(241, 245, 249, 0.95));
    border: 1px solid rgba(203, 213, 225, 0.6);
    text-decoration: none;
    color: inherit;
    min-height: 120px;
    transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
  }

  a.tile:hover,
  button.tile:hover {
    transform: translateY(-2px);
    border-color: rgba(59, 130, 246, 0.65);
    box-shadow: 0 20px 35px rgba(148, 163, 184, 0.25);
  }

  a.tile span.title,
  button.tile span.title {
    font-weight: 600;
    font-size: 0.98rem;
    line-height: 1.35;
  }

  a.tile span.url {
    font-size: 0.8rem;
    color: #64748b;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .banner {
    margin: 0;
    padding: 0.85rem 1.2rem;
    border-radius: 14px;
    font-size: 0.92rem;
    line-height: 1.45;
    background: rgba(226, 232, 240, 0.85);
    color: #0f172a;
  }

  .banner.error {
    background: rgba(254, 226, 226, 0.9);
    color: #b91c1c;
  }

  .banner.success {
    background: rgba(209, 250, 229, 0.85);
    color: #047857;
  }

  .empty-state {
    margin: 0;
    color: #64748b;
    font-size: 0.9rem;
  }

  @media (max-width: 720px) {
    main.newtab {
      padding: 1.75rem 1.1rem 2.5rem;
      gap: 1.5rem;
    }

    header.hero {
      flex-direction: column;
      align-items: flex-start;
    }

    header.hero button {
      width: 100%;
    }
  }
`;

const formatUrl = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.replace(/^www\./, '');
  } catch (error) {
    console.warn('Failed to format URL for new tab grid', error);
    return rawUrl;
  }
};

const fallbackBoardIcon = (title: string): string => title.slice(0, 2).toUpperCase();

const App: FunctionalComponent = () => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [favorites, setFavorites] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [newTabActive, setNewTabActive] = useState(true);
  const [isDisabling, setIsDisabling] = useState(false);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = STYLES;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  const openDefaultNewTab = useCallback(async (): Promise<boolean> => {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      window.location.href = 'about:blank';
      return false;
    }

    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) {
        return false;
      }

      const fallbackUrls = [
        'chrome://newtab/',
        'chrome-search://local-ntp/local-ntp.html',
        'about:newtab',
        'about:home',
        'about:blank',
      ];

      for (const url of fallbackUrls) {
        try {
          await chrome.tabs.update(activeTab.id, { url });
          return true;
        } catch (updateError) {
          console.warn('Failed to restore default new tab with URL', url, updateError);
        }
      }
    } catch (queryError) {
      console.warn('Failed to query active tab for default redirect', queryError);
    }

    return false;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getUserSettings();
        if (cancelled) {
          return;
        }

        setNewTabActive(settings.newTabEnabled);
        if (!settings.newTabEnabled) {
          setStatus('Feathermarks ist derzeit nicht als Neuer Tab aktiv.');
          setLoading(false);
          return;
        }

        const [loadedBoards, loadedFavorites] = await Promise.all([
          listBoards(),
          listPinnedBookmarks({ limit: 12 }),
        ]);

        if (cancelled) {
          return;
        }

        setBoards(loadedBoards.slice(0, 8));
        setFavorites(loadedFavorites);
      } catch (err) {
        console.error('Failed to populate new tab data', err);
        if (!cancelled) {
          setError('New-Tab-Daten konnten nicht geladen werden.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleDisable = useCallback(async () => {
    setIsDisabling(true);
    setError(null);
    setStatus(null);
    try {
      await saveUserSettings({ newTabEnabled: false });
      const response = await sendBackgroundMessage({ type: 'settings.applyNewTab', enabled: false });
      if (response.type !== 'settings.applyNewTab.result') {
        throw new Error('Unerwartete Antwort beim Deaktivieren des neuen Tabs.');
      }
      setNewTabActive(response.enabled);
      if (response.enabled) {
        setStatus('Der Browser hat die Deaktivierung blockiert. Bitte prüfe die Tabs-Berechtigung.');
      } else {
        setStatus('Feathermarks wurde als Neuer Tab deaktiviert.');
        await openDefaultNewTab();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsDisabling(false);
    }
  }, [openDefaultNewTab]);

  const favoriteTiles = useMemo(
    () =>
      favorites.map((bookmark) => (
        <a key={bookmark.id} class="tile" href={bookmark.url} target="_self" rel="noreferrer">
          <span class="title">{bookmark.title || bookmark.url}</span>
          <span class="url">{formatUrl(bookmark.url)}</span>
        </a>
      )),
    [favorites],
  );

  const boardTiles = useMemo(
    () =>
      boards.map((board) => (
        <button
          key={board.id}
          class="tile"
          type="button"
          onClick={() => {
            void chrome?.runtime?.openOptionsPage?.();
          }}
        >
          <span class="title">{board.title}</span>
          <span class="url">{board.icon ? board.icon : fallbackBoardIcon(board.title)}</span>
        </button>
      )),
    [boards],
  );

  return (
    <main class="newtab">
      <header class="hero">
        <div>
          <h1>Feathermarks</h1>
          <p>Starte superschnell mit deinen Boards und angepinnten Favoriten.</p>
        </div>
        <button type="button" onClick={handleDisable} disabled={isDisabling || !newTabActive}>
          Neuer Tab deaktivieren
        </button>
      </header>

      {status && <p class={`banner${newTabActive ? '' : ' success'}`}>{status}</p>}
      {error && <p class="banner error" role="alert">{error}</p>}

      {loading ? (
        <section class="block" aria-busy="true">
          <h2>Lade Inhalte…</h2>
          <p class="empty-state">Deine Boards und Favoriten werden initialisiert.</p>
        </section>
      ) : !newTabActive ? (
        <section class="block">
          <h2>Neuer Tab deaktiviert</h2>
          <p class="empty-state">
            Öffne die Feathermarks-Optionen, um die Option wieder zu aktivieren. Bis dahin zeigt dein Browser den
            Standard-Startbildschirm.
          </p>
          <button
            type="button"
            class="tile"
            onClick={() => void chrome?.runtime?.openOptionsPage?.()}
          >
            <span class="title">Optionen öffnen</span>
            <span class="url">chrome://extensions</span>
          </button>
        </section>
      ) : (
        <>
          <section class="block">
            <h2>Angepinnte Favoriten</h2>
            {favorites.length === 0 ? (
              <p class="empty-state">
                Noch keine Favoriten. Pinne wichtige Links im Popup, um sie hier blitzschnell zu starten.
              </p>
            ) : (
              <div class="grid favorites">{favoriteTiles}</div>
            )}
          </section>

          <section class="block">
            <h2>Boards</h2>
            {boards.length === 0 ? (
              <p class="empty-state">Noch keine Boards angelegt. Öffne die Optionen, um ein neues Board zu erstellen.</p>
            ) : (
              <div class="grid boards">{boardTiles}</div>
            )}
          </section>
        </>
      )}
    </main>
  );
};

export default App;
