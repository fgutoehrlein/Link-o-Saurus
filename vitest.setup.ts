import 'fake-indexeddb/auto';

// Vitest runs in Node where requestAnimationFrame may not exist; Dexie occasionally
// checks for it when scheduling microtasks. Provide a minimal shim to avoid warnings
// in tests.
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16);
}

if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  globalThis.cancelAnimationFrame = (handle: number) => clearTimeout(handle);
}
