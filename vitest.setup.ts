import 'fake-indexeddb/auto';

// Vitest runs in Node where requestAnimationFrame may not exist; Dexie occasionally
// checks for it when scheduling microtasks. Provide a minimal shim to avoid warnings
// in tests.
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  let rafHandle = 0;
  const rafTimers = new Map<number, NodeJS.Timeout>();

  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    rafHandle += 1;
    const handle = rafHandle;
    const timer = setTimeout(() => {
      rafTimers.delete(handle);
      cb(Date.now());
    }, 16);
    rafTimers.set(handle, timer);
    return handle;
  };

  if (typeof globalThis.cancelAnimationFrame === 'undefined') {
    globalThis.cancelAnimationFrame = (handle: number) => {
      const timer = rafTimers.get(handle);
      if (timer) {
        clearTimeout(timer);
        rafTimers.delete(handle);
      }
    };
  }
}
