import type { FunctionalComponent } from 'preact';
import { useEffect } from 'preact/hooks';

import './App.css';

const DashboardApp: FunctionalComponent = () => {
  useEffect(() => {
    const readyTime = performance.now();
    const globalWindow = window as typeof window & {
      __LINKOSAURUS_DASHBOARD_READY?: boolean;
      __LINKOSAURUS_DASHBOARD_READY_TIME?: number;
    };

    globalWindow.__LINKOSAURUS_DASHBOARD_READY = true;
    globalWindow.__LINKOSAURUS_DASHBOARD_READY_TIME = readyTime;

    return () => {
      delete globalWindow.__LINKOSAURUS_DASHBOARD_READY;
      delete globalWindow.__LINKOSAURUS_DASHBOARD_READY_TIME;
    };
  }, []);

  return (
    <div className="dashboard-shell" role="application">
      <header className="dashboard-header">
        <h1>Link-o-Saurus Dashboard</h1>
        <p className="dashboard-subtitle">Organize, review, and explore your saved links in a full-page workspace.</p>
      </header>
      <main className="dashboard-body" aria-live="polite">
        <section className="dashboard-placeholder" aria-label="Dashboard placeholder">
          <p>This area is reserved for upcoming dashboards, analytics, and deep-linking tools.</p>
          <p className="muted">Use the popup to capture links quickly. Open the dashboard for extended workflows.</p>
        </section>
      </main>
    </div>
  );
};

export default DashboardApp;
