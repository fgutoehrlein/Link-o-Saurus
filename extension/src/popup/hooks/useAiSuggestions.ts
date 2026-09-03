import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { suggestForBookmark } from '../../shared/ai/bookmark-ai-service';
import type { AiSuggestionResult } from '../../shared/ai/types';
import { normalizeWhitespace } from '../utils/popup-url';
import { extractPageSnapshot } from '../page-content';

export type PageSignals = {
  readonly pageTitle?: string;
  readonly pageUrl?: string;
  readonly metaDescription?: string;
  readonly pageContent?: string;
  readonly selectedText?: string;
};

type UseAiSuggestionsOptions = {
  readonly pageSignals: PageSignals | null;
  readonly selectedCategoryId: string;
  readonly showDetails: boolean;
  readonly title: string;
  readonly url: string;
  readonly onBestFolder: (categoryId: string) => void;
};

type UseAiSuggestionsResult = {
  readonly aiSuggestions: AiSuggestionResult | null;
  readonly loadingSuggestions: boolean;
  readonly setAiSuggestions: (suggestions: AiSuggestionResult | null) => void;
  readonly requestSuggestions: () => Promise<AiSuggestionResult | null>;
  readonly refreshSuggestions: () => void;
};

const getActiveTabId = async (): Promise<number | undefined> => {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return undefined;
  }
  const tabs = await new Promise<chrome.tabs.Tab[]>((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (result) => {
      const error = chrome.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result ?? []);
    });
  });
  return tabs[0]?.id;
};

const capturePageSignals = async (): Promise<PageSignals> => {
  if (typeof chrome === 'undefined' || !chrome.scripting?.executeScript) {
    return {};
  }
  const tabId = await getActiveTabId();
  if (!tabId) {
    return {};
  }
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: extractPageSnapshot });
  return injection?.result ?? {};
};

export const useAiSuggestions = ({
  pageSignals,
  selectedCategoryId,
  showDetails,
  title,
  url,
  onBestFolder,
}: UseAiSuggestionsOptions): UseAiSuggestionsResult => {
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestionResult | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestId = useRef(0);
  const activeRequest = useRef<{ key: string; promise: Promise<AiSuggestionResult | null> } | null>(null);
  const cachedResult = useRef<{ key: string; result: AiSuggestionResult } | null>(null);

  const requestSuggestions = useCallback(async (): Promise<AiSuggestionResult | null> => {
    const normalizedTitle = normalizeWhitespace(title);
    const normalizedUrl = normalizeWhitespace(url);
    if (!normalizedTitle && !normalizedUrl) {
      setAiSuggestions(null);
      return null;
    }
    const key = [normalizedTitle, normalizedUrl, pageSignals?.pageUrl ?? '', pageSignals?.selectedText ?? ''].join('\n');
    if (cachedResult.current?.key === key) {
      return cachedResult.current.result;
    }
    if (activeRequest.current?.key === key) {
      return activeRequest.current.promise;
    }

    const currentRequest = ++requestId.current;
    setLoadingSuggestions(true);
    const request = capturePageSignals()
      .catch((): PageSignals => ({}))
      .then((snapshot) =>
        suggestForBookmark({
          title: normalizedTitle,
          url: normalizedUrl,
          metaDescription: snapshot.metaDescription ?? pageSignals?.metaDescription,
          pageContent: snapshot.pageContent ?? pageSignals?.pageContent,
          pageTitle: snapshot.pageTitle ?? pageSignals?.pageTitle,
          selectedText: pageSignals?.selectedText,
        }),
      )
      .then((result) => {
        if (requestId.current === currentRequest) {
          cachedResult.current = { key, result };
          setAiSuggestions(result);
          if (!selectedCategoryId && result.bestFolder) {
            onBestFolder(result.bestFolder.category.id);
          }
        }
        return result;
      })
      .catch(() => {
        if (requestId.current === currentRequest) setAiSuggestions(null);
        return null;
      })
      .finally(() => {
        if (requestId.current === currentRequest) setLoadingSuggestions(false);
      });
    activeRequest.current = { key, promise: request };
    void request.finally(() => {
      if (activeRequest.current?.promise === request) activeRequest.current = null;
    });
    return request;
  }, [onBestFolder, pageSignals?.pageUrl, pageSignals?.selectedText, selectedCategoryId, title, url]);

  useEffect(() => {
    if (showDetails) {
      void requestSuggestions();
    }
  }, [pageSignals?.pageUrl, refreshKey, requestSuggestions, showDetails]);

  return {
    aiSuggestions,
    loadingSuggestions,
    setAiSuggestions,
    requestSuggestions,
    refreshSuggestions: () => {
      cachedResult.current = null;
      setRefreshKey((value) => value + 1);
    },
  };
};
