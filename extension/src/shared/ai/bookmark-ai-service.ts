import { listBookmarks, listCategories, listTags } from '../db';
import type { BookmarkSignalInput } from './types';
import { suggestTags } from './tag-suggestion-service';
import { suggestFolder } from './folder-suggestion-service';
import { getModelDiagnostics } from './model-service';
import type { AiSuggestionResult } from './types';

const MAX_CONTEXT_BOOKMARKS = 600;

export const suggestForBookmark = async (input: BookmarkSignalInput): Promise<AiSuggestionResult> => {
  const startedAt = performance.now();

  const [bookmarks, categories, existingTags] = await Promise.all([
    listBookmarks({ includeArchived: false, limit: MAX_CONTEXT_BOOKMARKS }),
    listCategories(),
    listTags(),
  ]);

  const tags = await suggestTags({
    input,
    existingTags,
    bookmarks,
  });

  const folderResult = await suggestFolder({
    input,
    categories,
    bookmarks,
    tagSuggestions: tags,
  });

  const model = await getModelDiagnostics();

  return {
    tags,
    bestFolder: folderResult.best,
    alternativeFolders: folderResult.alternatives,
    diagnostics: {
      model: model.modelName,
      fallbackUsed: model.fallbackUsed,
      processingMs: Math.round((performance.now() - startedAt) * 10) / 10,
    },
  };
};
