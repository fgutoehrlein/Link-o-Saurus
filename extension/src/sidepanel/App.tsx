import type { ComponentType, FunctionalComponent } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { listBookmarks } from '../shared/db';
import { openDashboard } from '../shared/utils';
import { sendBackgroundMessage, type SidePanelState } from '../shared/messaging';
import './App.css';

const DASHBOARD_ROUTE_STATE_KEY = 'link-o-saurus:sidepanel:route';

type DashboardModule = {
  default: ComponentType;
};

const normalizeRouteState = (state: SidePanelState | null): SidePanelState => {
  if (!state) {
    return {};
  }
  return {
    ...(state.search ? { search: state.search } : {}),
    ...(state.boardId ? { boardId: state.boardId } : {}),
    ...(state.hash ? { hash: state.hash } : {}),
  };
};

const serializeState = (state: SidePanelState): string => JSON.stringify(normalizeRouteState(state));

const readCurrentState = (): SidePanelState => {
  const searchParams = new URLSearchParams(window.location.search);
  return {
    ...(searchParams.get('q') ? { search: searchParams.get('q') ?? undefined } : {}),
    ...(searchParams.get('boardId') ? { boardId: searchParams.get('boardId') ?? undefined } : {}),
    ...(window.location.hash ? { hash: window.location.hash.replace(/^#/, '') } : {}),
  };
};

const applyRouteState = (state: SidePanelState): void => {
  const normalized = normalizeRouteState(state);
  const params = new URLSearchParams(window.location.search);

  if (normalized.search) {
    params.set('q', normalized.search);
  } else {
    params.delete('q');
  }

  if (normalized.boardId) {
    params.set('boardId', normalized.boardId);
  } else {
    params.delete('boardId');
  }

  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${normalized.hash ? `#${normalized.hash}` : ''}`;
  window.history.replaceState(window.history.state, '', nextUrl);
};

const WelcomeHint: FunctionalComponent = () => (
  <aside className="sidepanel-welcome" role="status" aria-live="polite">
    <h2>Willkommen bei Link-O-Saurus</h2>
    <p>
      Noch keine Bookmarks gefunden. Starte mit „Aktuellen Tab speichern“ im Popup oder öffne das vollständige Dashboard.
    </p>
    <button type="button" className="welcome-button" onClick={() => void openDashboard()}>
      Dashboard öffnen
    </button>
  </aside>
);

const App: FunctionalComponent = () => {
  const [dashboardComponent, setDashboardComponent] = useState<ComponentType | null>(null);
  const [bookmarkCount, setBookmarkCount] = useState<number>(0);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let active = true;

    const bootstrap = async (): Promise<void> => {
      try {
        const response = await sendBackgroundMessage({ type: 'sidePanel.state.get' });
        if (response.type === 'sidePanel.state.get.result' && response.state) {
          applyRouteState(response.state);
        }
      } catch (error) {
        console.warn('[Link-o-Saurus] Konnte Side Panel Zustand nicht wiederherstellen.', error);
      }

      try {
        const allBookmarks = await listBookmarks();
        if (active) {
          setBookmarkCount(allBookmarks.length);
        }
      } catch (error) {
        console.warn('[Link-o-Saurus] Konnte Bookmarks für Side Panel Hinweis nicht laden.', error);
      }

      if (active) {
        const module = (await import('../dashboard/App')) as DashboardModule;
        setDashboardComponent(() => module.default);
        setRestoring(false);
      }
    };

    void bootstrap();

    return () => {
      active = false;
    };
  }, []);

  // Future extensibility hooks (AI tagging, DnD, quick-add integration).
  useEffect(() => {
    const detail = {
      onQuickAddFromActiveTab: () => void sendBackgroundMessage({ type: 'sidePanel.open' }),
      onRequestAiTagging: (bookmarkId: string) => bookmarkId,
      onDragDropReorder: (sourceId: string, targetId: string) => ({ sourceId, targetId }),
    };
    window.dispatchEvent(new CustomEvent('link-o-saurus:sidepanel:ready', { detail }));
  }, []);

  const renderedDashboard = useMemo(() => {
    if (!dashboardComponent) {
      return null;
    }
    const DashboardApp = dashboardComponent;
    return <DashboardApp />;
  }, [dashboardComponent]);

  useEffect(() => {
    let previousSerialized = serializeState(readCurrentState());

    const persistCurrentState = (): void => {
      const nextState = readCurrentState();
      const nextSerialized = serializeState(nextState);
      if (nextSerialized === previousSerialized) {
        return;
      }
      previousSerialized = nextSerialized;
      void sendBackgroundMessage({ type: 'sidePanel.state.set', state: nextState }).catch((error) => {
        console.warn('[Link-o-Saurus] Konnte Side Panel Zustand nicht speichern.', error);
      });
    };

    const interval = window.setInterval(persistCurrentState, 700);
    window.addEventListener('hashchange', persistCurrentState);
    window.addEventListener('beforeunload', persistCurrentState);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('hashchange', persistCurrentState);
      window.removeEventListener('beforeunload', persistCurrentState);
      persistCurrentState();
    };
  }, []);

  return (
    <div className="sidepanel-shell" data-storage-key={DASHBOARD_ROUTE_STATE_KEY}>
      {bookmarkCount === 0 ? <WelcomeHint /> : null}
      {restoring ? <div className="sidepanel-loading">Link-O-Saurus wird geladen…</div> : renderedDashboard}
    </div>
  );
};

export default App;
