import { FunctionalComponent } from 'preact';
import { useCallback, useMemo, useState } from 'preact/hooks';
import { normalizeTagList } from '../../shared/tag-utils';

type DetailTagInputProps = {
  readonly id: string;
  readonly tagsText: string;
  readonly onChange: (next: string) => void;
};

const parseTagsText = (tagsText: string): string[] =>
  normalizeTagList(tagsText.split(',').map((tag) => tag.trim()));

export const DetailTagInput: FunctionalComponent<DetailTagInputProps> = ({ id, tagsText, onChange }) => {
  const [draft, setDraft] = useState('');
  const tags = useMemo(() => parseTagsText(tagsText), [tagsText]);

  const commitDraft = useCallback(() => {
    const [normalized] = normalizeTagList([draft]);
    if (!normalized) {
      return;
    }
    const nextTags = normalizeTagList([...tags, normalized]);
    onChange(nextTags.join(', '));
    setDraft('');
  }, [draft, onChange, tags]);

  const removeTag = useCallback(
    (tagToRemove: string) => {
      onChange(tags.filter((tag) => tag !== tagToRemove).join(', '));
    },
    [onChange, tags],
  );

  return (
    <div className="detail-tag-input" role="list" aria-labelledby={`${id}-label`}>
      {tags.map((tag) => (
        <span key={tag} className="detail-tag-chip" role="listitem">
          {tag}
          <button type="button" onClick={() => removeTag(tag)} aria-label={`Tag ${tag} entfernen`}>
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        type="text"
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
