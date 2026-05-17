import { useCallback, useEffect, useState } from 'preact/hooks';
import { createBookmark } from '../../shared/db';
import type { AiSuggestionResult } from '../../shared/ai/types';
import { extractDomain, getFaviconUrl, normalizeUrlForSaving, normalizeWhitespace } from '../utils/popup-url';
import { useActiveTab } from './useActiveTab';
import type { PageSignals } from './useAiSuggestions';

export type StatusMessage = {
  readonly tone: 'success' | 'error' | 'info' | 'warning';
  readonly text: string;
};

type SaveBookmarkInput = {
  readonly title: string;
  readonly url: string;
  readonly tags?: string[];
  readonly categoryId?: string;
};

type QuickSaveContext = {
  readonly aiSuggestions: AiSuggestionResult | null;
  readonly selectedCategoryId: string;
};

export const useQuickSave = () => {
  const resolveActiveTab = useActiveTab();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [saving, setSaving] = useState(false);
  const [quickSaveReady, setQuickSaveReady] = useState(false);
  const [pageSignals, setPageSignals] = useState<PageSignals | null>(null);
  const [manualTagEdits, setManualTagEdits] = useState(false);
  const [manualFolderEdits, setManualFolderEdits] = useState(false);

  const loadQuickSaveFromTab = useCallback(async () => {
    try {
      const activeTab = await resolveActiveTab();
      if (!activeTab) {
        return;
      }
      const resolvedUrl = activeTab.url?.trim() ?? '';
      const resolvedTitle = activeTab.title?.trim() ?? '';

      setPageSignals({
        pageTitle: resolvedTitle,
        pageUrl: resolvedUrl,
      });
      if (resolvedTitle) {
        setTitle(resolvedTitle);
      }
      if (resolvedUrl) {
        setUrl(resolvedUrl);
      }
      setQuickSaveReady(Boolean(resolvedUrl));
    } catch {
      setQuickSaveReady(false);
    }
  }, [resolveActiveTab]);

  useEffect(() => {
    void loadQuickSaveFromTab();
  }, [loadQuickSaveFromTab]);

  const saveBookmark = useCallback(async ({ title: rawTitle, url: rawUrl, tags: rawTags, categoryId }: SaveBookmarkInput) => {
    const normalizedUrl = normalizeUrlForSaving(rawUrl);
    const normalizedTitle = normalizeWhitespace(rawTitle) || extractDomain(normalizedUrl) || normalizedUrl;
    const uniqueTags = (rawTags ?? []).filter(
      (tag, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === tag.toLowerCase()) === index,
    );

    const now = Date.now();
    return createBookmark({
      id: crypto.randomUUID(),
      url: normalizedUrl,
      title: normalizedTitle,
      faviconUrl: getFaviconUrl(normalizedUrl) ?? undefined,
      tags: uniqueTags,
      categoryId: categoryId || undefined,
      createdAt: now,
      updatedAt: now,
    });
  }, []);

  const handleQuickSave = useCallback(async ({ aiSuggestions, selectedCategoryId }: QuickSaveContext) => {
    if (saving) {
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const suggestedTags = aiSuggestions?.tags.slice(0, 6).map((entry) => entry.tag) ?? [];
      const effectiveTags = !manualTagEdits && tags.length === 0 ? suggestedTags : tags;
      const effectiveCategoryId = !manualFolderEdits && !selectedCategoryId ? aiSuggestions?.bestFolder?.category.id : selectedCategoryId;
      const bookmark = await saveBookmark({ title, url, tags: effectiveTags, categoryId: effectiveCategoryId || undefined });
      setStatus({ tone: 'success', text: 'Gespeichert. Mit Enter kannst du sofort den nächsten Tab sichern.' });
      setTags([]);
      setManualTagEdits(false);
      setManualFolderEdits(false);
      await loadQuickSaveFromTab();
      return bookmark;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Speichern fehlgeschlagen.';
      setStatus({ tone: 'error', text: message });
    } finally {
      setSaving(false);
    }
  }, [
    loadQuickSaveFromTab,
    manualFolderEdits,
    manualTagEdits,
    saveBookmark,
    saving,
    tags,
    title,
    url,
  ]);

  return {
    title,
    url,
    tags,
    status,
    saving,
    quickSaveReady,
    pageSignals,
    setTitle,
    setUrl,
    setTags,
    setStatus,
    setManualTagEdits,
    setManualFolderEdits,
    loadQuickSaveFromTab,
    handleQuickSave,
    saveBookmark,
  };
};
