console.log('[Feathermarks] background service worker initialized');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Feathermarks] extension installed');
});
