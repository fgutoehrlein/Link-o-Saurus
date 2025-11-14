import { ensureMirrorRoot } from './native';
import type { SyncSettings } from './types';

let initializationPromise: Promise<void> | null = null;

export const initializeBookmarkSync = (settings: SyncSettings): Promise<void> => {
  if (!settings.enableBidirectional) {
    return Promise.resolve();
  }
  if (!initializationPromise) {
    initializationPromise = (async () => {
      await ensureMirrorRoot(settings.mirrorRootName);
    })().finally(() => {
      initializationPromise = null;
    });
  }
  return initializationPromise;
};
