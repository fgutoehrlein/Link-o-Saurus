import { useCallback } from 'preact/hooks';
import { saveUserSettings } from '../../shared/db';
import type { UserSettings } from '../../shared/types';
import type { BookmarkViewMode } from '../view-mode';

type ThemeChoice = UserSettings['theme'];

type UseDashboardPreferencesOptions = {
  readonly setThemeChoice: (theme: ThemeChoice) => void;
  readonly setBookmarkViewMode: (mode: BookmarkViewMode) => void;
  readonly setStatusMessage: (message: string) => void;
};

export const useDashboardPreferences = ({
  setBookmarkViewMode,
  setStatusMessage,
  setThemeChoice,
}: UseDashboardPreferencesOptions) => {
  const handleThemeChange = useCallback(async (theme: ThemeChoice) => {
    setThemeChoice(theme);
    document.documentElement.dataset.theme = theme;
    try {
      await saveUserSettings({ theme });
      setStatusMessage('Theme gespeichert.');
    } catch (error) {
      console.error('Failed to save theme', error);
      setStatusMessage('Theme konnte nicht gespeichert werden.');
    }
  }, [setStatusMessage, setThemeChoice]);

  const handleOpenSettings = useCallback(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage(() => {
        const error = chrome.runtime?.lastError;
        if (error) {
          console.error('Failed to open options page', error);
          setStatusMessage('Einstellungen konnten nicht geöffnet werden.');
        }
      });
      return;
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL && typeof window !== 'undefined') {
      window.open(chrome.runtime.getURL('options.html'), '_blank', 'noopener,noreferrer');
      return;
    }

    setStatusMessage('Einstellungen konnten nicht geöffnet werden.');
  }, [setStatusMessage]);

  const handleViewModeChange = useCallback(async (mode: BookmarkViewMode) => {
    setBookmarkViewMode(mode);
    try {
      await saveUserSettings({ dashboardViewMode: mode });
      setStatusMessage(`Ansicht auf ${mode === 'list' ? 'Liste' : 'Kacheln'} gestellt.`);
    } catch (error) {
      console.error('Failed to save view mode', error);
      setStatusMessage('Ansicht konnte nicht gespeichert werden.');
    }
  }, [setBookmarkViewMode, setStatusMessage]);

  return { handleThemeChange, handleOpenSettings, handleViewModeChange };
};
