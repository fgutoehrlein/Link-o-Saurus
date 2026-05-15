import { FunctionalComponent } from 'preact';
import type { AiSuggestionResult } from '../../shared/ai/types';

type AiSuggestionsProps = {
  readonly suggestions: AiSuggestionResult | null;
  readonly loading: boolean;
  readonly onAddTag: (tag: string) => void;
};

export const AiSuggestions: FunctionalComponent<AiSuggestionsProps> = ({ suggestions, loading, onAddTag }) => (
  <div className="ai-suggestions" aria-live="polite">
    <div className="ai-suggestions__head">
      <span>KI-Vorschläge</span>
      {loading ? <small>berechne…</small> : null}
    </div>
    {suggestions?.tags?.length ? (
      <div className="ai-suggestions__tags">
        {suggestions.tags.map((suggestion) => (
          <button type="button" key={suggestion.tag} className="ai-tag" onClick={() => onAddTag(suggestion.tag)}>
            +{suggestion.tag}
          </button>
        ))}
      </div>
    ) : (
      <small>Keine sicheren Tag-Vorschläge.</small>
    )}
  </div>
);
