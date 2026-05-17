import { FunctionalComponent } from 'preact';
import { useCallback } from 'preact/hooks';
import { openDashboard, openSidePanel } from '../../shared/utils';

export const PopupHeader: FunctionalComponent = () => {
  const handleOpenSettings = useCallback(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
      return;
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL && typeof window !== 'undefined') {
      window.open(chrome.runtime.getURL('options.html'), '_blank', 'noopener,noreferrer');
    }
  }, []);

  return (
    <header className="popup-header">
      <h1>Link-O-Saurus</h1>
      <div className="popup-header-actions">
        <button type="button" className="ghost-button" onClick={() => void openSidePanel()}>
          Side Panel
        </button>
        <button type="button" className="ghost-button" onClick={() => void openDashboard()}>
          Dashboard
        </button>
        <button
          type="button"
          className="ghost-button icon-only-button"
          onClick={handleOpenSettings}
          aria-label="Einstellungen öffnen"
          title="Einstellungen"
        >
          <i className="fa-solid fa-gear" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
};
