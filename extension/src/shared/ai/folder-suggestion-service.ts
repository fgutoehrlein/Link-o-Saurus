import type { Bookmark, Category } from '../types';
import { cosineSimilarity } from './embedding-service';
import { detectDomainRule } from './domain-rules';
import { parseDomain } from './normalization';
import { embedText } from './model-service';
import type { FolderCandidate, FolderProfile, TagSuggestion, BookmarkSignalInput } from './types';

type Inputs = {
  input: BookmarkSignalInput;
  categories: Category[];
  bookmarks: Bookmark[];
  tagSuggestions: TagSuggestion[];
};

const buildFolderProfiles = async (categories: Category[], bookmarks: Bookmark[]): Promise<FolderProfile[]> => {
  const byCategory = new Map<string, Bookmark[]>();
  for (const bookmark of bookmarks) {
    if (!bookmark.categoryId) {
      continue;
    }
    const bucket = byCategory.get(bookmark.categoryId) ?? [];
    bucket.push(bookmark);
    byCategory.set(bookmark.categoryId, bucket);
  }

  const profiles: FolderProfile[] = [];
  for (const category of categories) {
    const items = byCategory.get(category.id) ?? [];
    const tagFrequency = new Map<string, number>();
    const domainFrequency = new Map<string, number>();
    let bookmarkSummary = category.title;
    for (const item of items.slice(-80)) {
      bookmarkSummary += ` | ${item.title} ${item.tags.join(' ')}`;
      for (const tag of item.tags) {
        tagFrequency.set(tag, (tagFrequency.get(tag) ?? 0) + 1);
      }
      const domain = parseDomain(item.url);
      if (domain) {
        domainFrequency.set(domain, (domainFrequency.get(domain) ?? 0) + 1);
      }
    }

    const topTags = Array.from(tagFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag);

    const topDomains = Array.from(domainFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([domain]) => domain);

    const embedding = await embedText(`${category.title} | ${topTags.join(' ')} | ${topDomains.join(' ')}`);
    profiles.push({
      category,
      embedding,
      topTags,
      topDomains,
      bookmarkCount: items.length,
    });
  }

  return profiles;
};

export const suggestFolder = async ({ input, categories, bookmarks, tagSuggestions }: Inputs): Promise<{ best?: FolderCandidate; alternatives: FolderCandidate[] }> => {
  if (categories.length === 0) {
    return { best: undefined, alternatives: [] };
  }

  const profiles = await buildFolderProfiles(categories, bookmarks);
  const inputEmbedding = await embedText([input.title, input.url, input.metaDescription ?? ''].join(' | '));
  const inputDomain = parseDomain(input.url);
  const domainRule = detectDomainRule(input.url);
  const suggestedTagSet = new Set(tagSuggestions.map((tag) => tag.tag));

  const ranked: FolderCandidate[] = profiles.map((profile) => {
    const semanticScore = cosineSimilarity(inputEmbedding, profile.embedding);

    const overlapCount = profile.topTags.filter((tag) => suggestedTagSet.has(tag)).length;
    const tagOverlapScore = overlapCount > 0 ? Math.min(0.32, overlapCount * 0.08) : 0;

    const sameDomainScore = inputDomain && profile.topDomains.includes(inputDomain) ? 0.3 : 0;
    const ruleScore = domainRule?.folderHints?.some((hint) => profile.category.title.toLowerCase().includes(hint.toLowerCase())) ? 0.22 : 0;

    const score = semanticScore * 0.56 + tagOverlapScore + sameDomainScore + ruleScore;
    const confidence = Math.max(0, Math.min(1, score / 1.1));

    const reasons = [
      `semantic ${(semanticScore * 100).toFixed(0)}%`,
      tagOverlapScore > 0 ? `tag overlap ${overlapCount}` : '',
      sameDomainScore > 0 ? `domain ${inputDomain}` : '',
      ruleScore > 0 ? 'domain-folder rule hit' : '',
    ].filter(Boolean);

    return {
      category: profile.category,
      score,
      confidence,
      reasons,
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 0.34) {
    return { best: undefined, alternatives: ranked.slice(0, 2) };
  }
  return {
    best,
    alternatives: ranked.slice(1, 3),
  };
};
