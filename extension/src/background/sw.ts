import { validateBackgroundRequest } from '../shared/messaging';
import { ensureReadLaterAlarm, registerBadgeController, updateReadLaterBadge } from './badge-controller';
import { registerContextMenu, registerContextMenuController } from './context-menu-controller';
import { handleBackgroundRequest } from './message-router';
import { initializeNewTabController } from './newtab-controller';
import {
  openSidePanelForWindow,
  registerSidePanelStateTracking,
  rememberQuickSaveTab,
  setSidePanelActionBehavior,
  toggleSidePanelForWindow,
} from './side-panel-controller';

console.log('[Link-o-Saurus] background service worker initialized');

void initializeNewTabController();
registerSidePanelStateTracking();

const initializeBackgroundSurface = (): void => {
  registerContextMenu();
  void setSidePanelActionBehavior();
  void ensureReadLaterAlarm();
  void updateReadLaterBadge();
};

chrome.runtime.onInstalled.addListener(() => {
  initializeBackgroundSurface();
  console.log('[Link-o-Saurus] extension installed');
});

chrome.runtime.onStartup?.addListener(() => {
  initializeBackgroundSurface();
});

initializeBackgroundSurface();
registerBadgeController();
registerContextMenuController();

chrome.action?.onClicked?.addListener((tab) => {
  rememberQuickSaveTab(tab);
  void toggleSidePanelForWindow(tab.windowId).catch((error) => {
    console.error('[Link-o-Saurus] Extension action failed to toggle side panel.', error);
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'open-side-panel') {
    return;
  }
  void openSidePanelForWindow().catch((error) => {
    console.error('[Link-o-Saurus] Shortcut failed to open side panel.', error);
  });
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const validation = validateBackgroundRequest(message);
  if (!validation.ok) {
    sendResponse({
      type: 'session.error',
      error: validation.error,
      code: validation.code,
      details: validation.details,
    });
    return false;
  }

  (async () => {
    try {
      const response = await handleBackgroundRequest(validation.value);
      sendResponse(response);
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'Unbekannter Fehler beim Session-Handling.';
      sendResponse({ type: 'session.error', error: messageText, code: 'INTERNAL_ERROR' });
    }
  })();

  return true;
});
