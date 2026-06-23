import type { BackgroundRequest, BackgroundResponse } from '../shared/messaging';
import { applyNewTabOverride } from './newtab-controller';
import { updateReadLaterBadge } from './badge-controller';
import {
  openAllSessionTabs,
  openSelectedSessionTabs,
  removeSession,
  saveCurrentWindowAsSession,
} from './session-controller';
import { closeSidePanelForWindow, openSidePanelForWindow, resolveQuickSaveTab } from './side-panel-controller';

export const handleBackgroundRequest = async (
  message: BackgroundRequest,
): Promise<BackgroundResponse> => {
  switch (message.type) {
    case 'quickSave.getActiveTab': {
      const tab = await resolveQuickSaveTab();
      return { type: 'quickSave.getActiveTab.result', ...(tab ? { tab } : {}) };
    }
    case 'session.saveCurrentWindow': {
      const session = await saveCurrentWindowAsSession(message.title);
      return { type: 'session.saveCurrentWindow.result', session };
    }
    case 'session.openAll': {
      const opened = await openAllSessionTabs(message.sessionId);
      return { type: 'session.openAll.result', opened };
    }
    case 'session.openSelected': {
      const opened = await openSelectedSessionTabs(message.sessionId, message.tabIndexes);
      return { type: 'session.openSelected.result', opened };
    }
    case 'session.delete': {
      await removeSession(message.sessionId);
      return { type: 'session.delete.result', sessionId: message.sessionId };
    }
    case 'settings.applyNewTab': {
      const applied = await applyNewTabOverride(message.enabled);
      return { type: 'settings.applyNewTab.result', enabled: applied };
    }
    case 'readLater.refreshBadge': {
      const count = await updateReadLaterBadge();
      return { type: 'readLater.refreshBadge.result', count };
    }
    case 'sidePanel.open': {
      const opened = await openSidePanelForWindow(message.windowId);
      return { type: 'sidePanel.open.result', opened };
    }
    case 'sidePanel.close': {
      const closed = await closeSidePanelForWindow(message.windowId);
      return { type: 'sidePanel.close.result', closed };
    }
    default:
      throw new Error(`Unhandled message type: ${(message as BackgroundRequest).type}`);
  }
};
