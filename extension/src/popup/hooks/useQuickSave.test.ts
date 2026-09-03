import { describe, expect, it } from 'vitest';
import type { AiSuggestionResult } from '../../shared/ai/types';
import { resolveAutomaticSaveValues } from './useQuickSave';

const suggestions: AiSuggestionResult = {
  tags: [{ tag: 'accessibility', score: 1, confidence: 1, reasons: [], source: 'generated' }],
  bestFolder: { category: { id: 'research', boardId: 'board', title: 'Research', sortOrder: 0 }, score: 1, confidence: 1, reasons: [] },
  alternativeFolders: [],
  diagnostics: { model: 'test', fallbackUsed: false, processingMs: 0 },
};

describe('resolveAutomaticSaveValues', () => {
  it('uses AI values for untouched empty fields', () => {
    expect(resolveAutomaticSaveValues({ suggestions, tags: [], selectedCategoryId: '', manualTagEdits: false, manualFolderEdits: false }))
      .toEqual({ tags: ['accessibility'], categoryId: 'research' });
  });

  it('keeps explicit tags and empty-folder choice', () => {
    expect(resolveAutomaticSaveValues({ suggestions, tags: ['manual'], selectedCategoryId: '', manualTagEdits: true, manualFolderEdits: true }))
      .toEqual({ tags: ['manual'], categoryId: undefined });
  });
});
