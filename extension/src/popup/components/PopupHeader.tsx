import { FunctionalComponent } from 'preact';
import { useCallback } from 'preact/hooks';
import { closeSidePanel, openDashboard } from '../../shared/utils';

type PopupHeaderProps = {
  readonly closeSidePanelOnDashboardOpen?: boolean;
};

const getCurrentWindowId = async (): Promise<number | undefined> => {
  if (typeof chrome === 'undefined' || !chrome.windows?.getCurrent) {
    return undefined;
  }

  try {
    const currentWindow = await chrome.windows.getCurrent();
    return currentWindow.id;
  } catch {
    return undefined;
  }
};

export const PopupHeader: FunctionalComponent<PopupHeaderProps> = ({ closeSidePanelOnDashboardOpen = false }) => {
  const handleOpenSettings = useCallback(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
      return;
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL && typeof window !== 'undefined') {
      window.open(chrome.runtime.getURL('options.html'), '_blank', 'noopener,noreferrer');
    }
  }, []);

  const handleOpenDashboard = useCallback(async () => {
    const currentWindowId = closeSidePanelOnDashboardOpen ? await getCurrentWindowId() : undefined;
    await openDashboard();

    if (closeSidePanelOnDashboardOpen) {
      await closeSidePanel(currentWindowId);
    }
  }, [closeSidePanelOnDashboardOpen]);

  return (
    <header className="popup-header">
      <div className="popup-header-actions">
        <button type="button" className="dashboard-button" onClick={() => void handleOpenDashboard()}>
          <i className="fa-solid fa-table-columns" aria-hidden="true" />
          <span>Dashboard öffnen</span>
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
