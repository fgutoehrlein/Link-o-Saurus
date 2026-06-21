import { FunctionalComponent } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { listCategories } from '../shared/db';
import type { Bookmark, Category } from '../shared/types';
import { capE2EReadyTimestamp } from '../shared/e2e-flags';
import { PopupHeader } from './components/PopupHeader';
import { PopupFooter } from './components/PopupFooter';
import { QuickAccessList } from './components/QuickAccessList';
import { QuickSaveForm } from './components/QuickSaveForm';
import { openUrlInNewTab } from './hooks/useActiveTab';
import { useAiSuggestions } from './hooks/useAiSuggestions';
import { usePopupSearch } from './hooks/usePopupSearch';
import { useQuickSave } from './hooks/useQuickSave';
import './App.css';

type PopupHarness = {
  addBookmark(input: { title: string; url: string; tags?: string[] }): Promise<string>;
  search(term: string): Promise<void>;
  clearSearch(): Promise<void>;
  selectRange(start: number, end: number): Promise<void>;
  getSelectedIds(): Promise<string[]>;
  runBatch(action: 'tag' | 'move' | 'delete' | 'untag'): Promise<void>;
  importBulk(count: number): Promise<number>;
  visibleTitles(limit?: number): Promise<string[]>;
};

declare global {
  interface Window {
    __LINKOSAURUS_POPUP_HARNESS?: PopupHarness;
    __LINKOSAURUS_POPUP_READY?: boolean;
    __LINKOSAURUS_POPUP_READY_TIME?: number;
  }
}

type PopupAppProps = {
  readonly layout?: 'popup' | 'sidepanel';
};

const App: FunctionalComponent<PopupAppProps> = ({ layout = 'popup' }) => {
  const [showDetails, setShowDetails] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');

  const quickSave = useQuickSave();

  const { aiSuggestions, loadingSuggestions, setAiSuggestions } = useAiSuggestions({
    pageSignals: quickSave.pageSignals,
    selectedCategoryId,
    showDetails,
    title: quickSave.title,
    url: quickSave.url,
    onBestFolder: setSelectedCategoryId,
  });

  const popupSearch = usePopupSearch(quickSave.url);

  useEffect(() => {
    const readyTimestamp = capE2EReadyTimestamp(performance.now());
    window.__LINKOSAURUS_POPUP_READY = true;
    window.__LINKOSAURUS_POPUP_READY_TIME = readyTimestamp;
    return () => {
      delete window.__LINKOSAURUS_POPUP_READY;
      delete window.__LINKOSAURUS_POPUP_READY_TIME;
      delete window.__LINKOSAURUS_POPUP_HARNESS;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadCategories = async () => {
      const loadedCategories = await listCategories();
      if (!cancelled) {
        setCategories(loadedCategories);
      }
    };
    void loadCategories();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleGlobalKeydown = (event: KeyboardEvent) => {
      if (event.key === '/' && !event.defaultPrevented) {
        const target = event.target as HTMLElement | null;
        const isTextInput =
          target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.getAttribute('contenteditable') === 'true');
        if (!isTextInput) {
          event.preventDefault();
          popupSearch.searchInputRef.current?.focus();
        }
      }
      if (event.key === 'Escape') {
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== document.body) {
          active.blur();
          return;
        }
        if (typeof window.close === 'function') {
          window.close();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeydown);
    return () => window.removeEventListener('keydown', handleGlobalKeydown);
  }, [popupSearch.searchInputRef]);

  const handleOpenUrl = useCallback(
    async (bookmark: Bookmark) => {
      try {
        await openUrlInNewTab(bookmark.url);
        await popupSearch.recordOpenedBookmark(bookmark);
      } catch {
        quickSave.setStatus({ tone: 'error', text: 'Tab konnte nicht geöffnet werden.' });
      }
    },
    [popupSearch, quickSave],
  );

  const handleReloadQuickSave = useCallback(async () => {
    try {
      await Promise.all([quickSave.loadQuickSaveFromTab(), popupSearch.refreshSearchIndex()]);
      quickSave.setStatus({ tone: 'info', text: 'Aktiver Tab und Bookmark-Liste wurden aktualisiert.' });
    } catch {
      quickSave.setStatus({ tone: 'error', text: 'Aktualisieren fehlgeschlagen.' });
    }
  }, [popupSearch, quickSave]);

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        popupSearch.setSearchSelection((current) => Math.min(current + 1, popupSearch.quickAccessEntries.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        popupSearch.setSearchSelection((current) => Math.max(current - 1, 0));
      } else if (event.key === 'Enter') {
        if (popupSearch.searchSelection >= 0 && popupSearch.quickAccessEntries[popupSearch.searchSelection]) {
          event.preventDefault();
          void handleOpenUrl(popupSearch.quickAccessEntries[popupSearch.searchSelection].bookmark);
        }
      }
    },
    [handleOpenUrl, popupSearch],
  );

  useEffect(() => {
    const harness: PopupHarness = {
      addBookmark: async (input) => {
        const bookmark = await quickSave.saveBookmark({ title: input.title, url: input.url, tags: input.tags });
        popupSearch.addBookmarkToIndex(bookmark);
        return bookmark.id;
      },
      search: async (term: string) => popupSearch.setSearchTerm(term),
      clearSearch: async () => popupSearch.setSearchTerm(''),
      selectRange: async () => {},
      getSelectedIds: async () => [],
      runBatch: async () => {},
      importBulk: async () => 0,
      visibleTitles: async (limit = 10) => {
        const normalizedLimit = Math.max(0, Math.trunc(limit));
        const entries = popupSearch.searchEntriesRef.current ?? [];
        return entries.slice(0, normalizedLimit > 0 ? normalizedLimit : entries.length).map((entry) => entry.bookmark.title);
      },
    };

    window.__LINKOSAURUS_POPUP_HARNESS = harness;
    return () => {
      if (window.__LINKOSAURUS_POPUP_HARNESS === harness) {
        delete window.__LINKOSAURUS_POPUP_HARNESS;
      }
    };
  }, [popupSearch, quickSave]);

  return (
    <div
      className={`popup-app${layout === 'sidepanel' ? ' popup-app--sidepanel' : ''}`}
      role="application"
      aria-label="Link-O-Saurus Popup"
    >
      <PopupHeader />

      <main className="popup-main">
        <QuickSaveForm
          aiSuggestions={aiSuggestions}
          categories={categories}
          duplicateEntry={popupSearch.duplicateEntry}
          loadingSuggestions={loadingSuggestions}
          quickSaveReady={quickSave.quickSaveReady}
          saving={quickSave.saving}
          selectedCategoryId={selectedCategoryId}
          showDetails={showDetails}
          status={quickSave.status}
          tags={quickSave.tags}
          title={quickSave.title}
          url={quickSave.url}
          onAddSuggestedTag={(tag) => {
            quickSave.setTags((current) => {
              quickSave.setManualTagEdits(true);
              return current.some((existingTag) => existingTag.toLowerCase() === tag.toLowerCase()) ? current : [...current, tag];
            });
          }}
          onFolderChange={(categoryId) => {
            quickSave.setManualFolderEdits(true);
            setSelectedCategoryId(categoryId);
          }}
          onQuickSave={() => {
            void quickSave.handleQuickSave({ aiSuggestions, selectedCategoryId }).then((bookmark) => {
              if (bookmark) {
                popupSearch.addBookmarkToIndex(bookmark);
                setAiSuggestions(null);
              }
            });
          }}
          onReload={() => void handleReloadQuickSave()}
          onTagsChange={(next) => {
            quickSave.setManualTagEdits(true);
            quickSave.setTags(next);
          }}
          onTitleChange={quickSave.setTitle}
          onToggleDetails={() => setShowDetails((value) => !value)}
          onUrlChange={quickSave.setUrl}
        />

        {showDetails ? null : (
          <QuickAccessList
            bookmarkSortMode={popupSearch.bookmarkSortMode}
            entries={popupSearch.quickAccessEntries}
            hasQuery={popupSearch.hasQuery}
            searchInputRef={popupSearch.searchInputRef}
            searchSelection={popupSearch.searchSelection}
            searchTerm={popupSearch.searchTerm}
            onOpenBookmark={(bookmark) => void handleOpenUrl(bookmark)}
            onSearchKeyDown={handleSearchKeyDown}
            onSearchSelectionChange={popupSearch.setSearchSelection}
            onSearchTermChange={popupSearch.setSearchTerm}
            onSortModeChange={popupSearch.handleSortModeChange}
          />
        )}
      </main>

      <PopupFooter />
    </div>
  );
};

export default App;
