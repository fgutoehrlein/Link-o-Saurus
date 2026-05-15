import { useEffect, useState } from 'preact/hooks';
import { suggestForBookmark } from '../../shared/ai/bookmark-ai-service';
import type { AiSuggestionResult } from '../../shared/ai/types';
import { normalizeWhitespace } from '../utils/popup-url';

export type PageSignals = {
  readonly pageTitle?: string;
  readonly pageUrl?: string;
  readonly metaDescription?: string;
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

  useEffect(() => {
    if (!showDetails) {
      return;
    }

    const normalizedTitle = normalizeWhitespace(title);
    const normalizedUrl = normalizeWhitespace(url);
    if (!normalizedTitle && !normalizedUrl) {
      setAiSuggestions(null);
      return;
    }

    const timer = window.setTimeout(() => {
      setLoadingSuggestions(true);
      void suggestForBookmark({
        title: normalizedTitle,
        url: normalizedUrl,
        metaDescription: pageSignals?.metaDescription,
        pageTitle: pageSignals?.pageTitle,
        selectedText: pageSignals?.selectedText,
      })
        .then((result) => {
          setAiSuggestions(result);
          if (!selectedCategoryId && result.bestFolder) {
            onBestFolder(result.bestFolder.category.id);
          }
        })
        .catch(() => {
          setAiSuggestions(null);
        })
        .finally(() => setLoadingSuggestions(false));
    }, 140);

    return () => window.clearTimeout(timer);
  }, [onBestFolder, pageSignals?.metaDescription, pageSignals?.pageTitle, pageSignals?.selectedText, selectedCategoryId, showDetails, title, url]);

  return { aiSuggestions, loadingSuggestions, setAiSuggestions };
};
