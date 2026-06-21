import { FunctionalComponent } from 'preact';
import type { Category } from '../../shared/types';
import type { AiSuggestionResult } from '../../shared/ai/types';
import type { StatusMessage } from '../hooks/useQuickSave';
import { openDashboard } from '../../shared/utils';
import { AiSuggestions } from './AiSuggestions';
import { TagInput } from './TagInput';

type QuickSaveFormProps = {
  readonly aiSuggestions: AiSuggestionResult | null;
  readonly categories: readonly Category[];
  readonly duplicateEntry: unknown;
  readonly loadingSuggestions: boolean;
  readonly quickSaveReady: boolean;
  readonly saving: boolean;
  readonly selectedCategoryId: string;
  readonly showDetails: boolean;
  readonly status: StatusMessage | null;
  readonly tags: readonly string[];
  readonly title: string;
  readonly url: string;
  readonly onAddSuggestedTag: (tag: string) => void;
  readonly onFolderChange: (categoryId: string) => void;
  readonly onQuickSave: () => void;
  readonly onReload: () => void;
  readonly onTagsChange: (tags: string[]) => void;
  readonly onTitleChange: (title: string) => void;
  readonly onToggleDetails: () => void;
  readonly onUrlChange: (url: string) => void;
};

export const QuickSaveForm: FunctionalComponent<QuickSaveFormProps> = ({
  aiSuggestions,
  categories,
  duplicateEntry,
  loadingSuggestions,
  quickSaveReady,
  saving,
  selectedCategoryId,
  showDetails,
  status,
  tags,
  title,
  url,
  onAddSuggestedTag,
  onFolderChange,
  onQuickSave,
  onReload,
  onTagsChange,
  onTitleChange,
  onToggleDetails,
  onUrlChange,
}) => (
  <section className="quick-save" aria-labelledby="quick-save-title">
    <div className="quick-save__top">
      <p id="quick-save-title">Aktuellen Tab speichern</p>
      <button type="button" className="icon-link-button" onClick={onReload} aria-label="Aktiven Tab neu laden" title="Aktiven Tab neu laden">
        <i className="fa-solid fa-rotate-right" aria-hidden="true" />
      </button>
    </div>

    <div className="quick-save__preview" title={title || url || 'Kein aktiver Tab erkannt'}>
      <strong>{title || 'Titel wird geladen…'}</strong>
      <span>{url || 'URL wird geladen…'}</span>
    </div>

    <div className="quick-save__actions">
      <button type="button" className="primary-button" disabled={saving || !quickSaveReady || Boolean(duplicateEntry)} onClick={onQuickSave}>
        {saving ? 'Speichert…' : duplicateEntry ? 'Bereits gespeichert' : 'Bookmark speichern'}
      </button>
      <button type="button" className="subtle-button" onClick={onToggleDetails}>
        {showDetails ? 'Weniger' : 'Details'}
      </button>
    </div>

    {showDetails ? (
      <div className="quick-save__details">
        <label>
          <span>Titel</span>
          <input type="text" value={title} onInput={(event) => onTitleChange((event.currentTarget as HTMLInputElement).value)} />
        </label>
        <label>
          <span>URL</span>
          <input type="url" value={url} onInput={(event) => onUrlChange((event.currentTarget as HTMLInputElement).value)} />
        </label>
        <label>
          <span id="quick-tags-label">Tags</span>
          <TagInput id="quick-tags" tags={tags} onChange={onTagsChange} />
        </label>
        <AiSuggestions suggestions={aiSuggestions} loading={loadingSuggestions} onAddTag={onAddSuggestedTag} />
        <label>
          <span>Folder (Vorschlag)</span>
          <select value={selectedCategoryId} onChange={(event) => onFolderChange((event.currentTarget as HTMLSelectElement).value)}>
            <option value="">Kein Folder</option>
            {aiSuggestions?.bestFolder ? <option value={aiSuggestions.bestFolder.category.id}>🤖 {aiSuggestions.bestFolder.category.title}</option> : null}
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.title}
              </option>
            ))}
          </select>
        </label>
        {aiSuggestions?.alternativeFolders.length ? (
          <small className="folder-alternatives">
            Alternativen: {aiSuggestions.alternativeFolders.map((item) => item.category.title).join(', ')}
          </small>
        ) : null}
        <button type="button" className="inline-link" onClick={() => void openDashboard({ new: '1', url, title, tags })}>
          Im Dashboard weiter bearbeiten
        </button>
      </div>
    ) : null}

    {status ? <p className={`status status--${status.tone}`}>{status.text}</p> : null}
  </section>
);
