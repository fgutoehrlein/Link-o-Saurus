import { initializeInboundSync } from './inbound';
import { ensureMirrorRoot } from './native';
export { initialImport, mirrorRootId } from './initial-import';
import type { SyncSettings } from './types';

let initializationPromise: Promise<void> | null = null;

export const initializeBookmarkSync = (settings: SyncSettings): Promise<void> => {
  if (!settings.enableBidirectional) {
    return Promise.resolve();
  }
  if (!initializationPromise) {
    initializationPromise = (async () => {
      await ensureMirrorRoot(settings.mirrorRootName);
      await initializeInboundSync(settings);
    })().finally(() => {
      initializationPromise = null;
    });
  }
  return initializationPromise;
};
