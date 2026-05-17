import { FunctionalComponent } from 'preact';
import { useCallback, useState } from 'preact/hooks';
import { normalizeWhitespace } from '../utils/popup-url';

type TagInputProps = {
  readonly id: string;
  readonly tags: readonly string[];
  readonly onChange: (next: string[]) => void;
};

export const TagInput: FunctionalComponent<TagInputProps> = ({ id, tags, onChange }) => {
  const [draft, setDraft] = useState('');

  const commitDraft = useCallback(() => {
    const normalized = normalizeWhitespace(draft);
    if (!normalized) {
      return;
    }
    const duplicate = tags.some((tag) => tag.toLowerCase() === normalized.toLowerCase());
    if (!duplicate) {
      onChange([...tags, normalized]);
    }
    setDraft('');
  }, [draft, onChange, tags]);

  return (
    <div className="tag-input" role="list" aria-labelledby={`${id}-label`}>
      {tags.map((tag) => (
        <span key={tag} className="tag-chip" role="listitem">
          {tag}
          <button type="button" onClick={() => onChange(tags.filter((candidate) => candidate !== tag))} aria-label={`Tag ${tag} entfernen`}>
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onInput={(event) => setDraft((event.currentTarget as HTMLInputElement).value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            commitDraft();
          }
        }}
        onBlur={commitDraft}
        placeholder={tags.length === 0 ? 'Tags (optional)' : 'Tag hinzufügen'}
        aria-label="Tag hinzufügen"
      />
    </div>
  );
};
