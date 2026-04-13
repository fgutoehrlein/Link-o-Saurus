import { parseDomain } from './normalization';

type DomainRule = {
  domainSuffix: string;
  tags: string[];
  formatTags?: string[];
  folderHints?: string[];
};

const RULES: DomainRule[] = [
  { domainSuffix: 'youtube.com', tags: ['youtube', 'video'], formatTags: ['tutorial', 'video'], folderHints: ['Video', 'Learning'] },
  { domainSuffix: 'github.com', tags: ['github', 'repository', 'code'], formatTags: ['docs'], folderHints: ['Development', 'Code'] },
  { domainSuffix: 'reddit.com', tags: ['reddit', 'community'], folderHints: ['Community'] },
  { domainSuffix: 'stackoverflow.com', tags: ['stackoverflow', 'programming', 'qa'], folderHints: ['Development'] },
  { domainSuffix: 'medium.com', tags: ['medium', 'article'], formatTags: ['artikel'], folderHints: ['Reading', 'Articles'] },
  { domainSuffix: 'developer.mozilla.org', tags: ['mdn', 'docs', 'web'], folderHints: ['Docs', 'Development'] },
];

const KEYWORD_TO_TAG: Record<string, string> = {
  tutorial: 'tutorial',
  guide: 'guide',
  docs: 'docs',
  documentation: 'docs',
  react: 'react',
  nextjs: 'nextjs',
  next: 'nextjs',
  vue: 'vue',
  design: 'design',
  ai: 'ai',
  productivity: 'produktivität',
  workflow: 'workflow',
  article: 'artikel',
  video: 'video',
};

export const detectDomainRule = (url: string): DomainRule | undefined => {
  const domain = parseDomain(url);
  if (!domain) {
    return undefined;
  }
  return RULES.find((rule) => domain === rule.domainSuffix || domain.endsWith(`.${rule.domainSuffix}`));
};

export const deriveKeywordTags = (tokens: string[]): string[] => {
  const tags = new Set<string>();
  for (const token of tokens) {
    const mapped = KEYWORD_TO_TAG[token];
    if (mapped) {
      tags.add(mapped);
    }
  }
  return Array.from(tags);
};
