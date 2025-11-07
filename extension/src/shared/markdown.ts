import { Marked, type Token, type Tokens } from 'marked';
import sanitizeHtml from 'sanitize-html';

type MentionToken = Tokens.Generic & {
  type: 'mention';
  username: string;
};

const escapeAttribute = (value: string): string =>
  value.replace(/["&'<>]/g, (char) => {
    switch (char) {
      case '"':
        return '&quot;';
      case '&':
        return '&amp;';
      case "'":
        return '&#39;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return char;
    }
  });

const mentionExtension = {
  extensions: [
    {
      name: 'mention',
      level: 'inline' as const,
      start(src: string) {
        const match = src.match(/@/u);
        return match ? match.index : undefined;
      },
      tokenizer(src: string) {
        const match = src.match(/^@([\p{L}\p{N}_-]{2,32})/u);
        if (!match) {
          return undefined;
        }
        const [, username] = match;
        return {
          type: 'mention',
          raw: match[0] ?? '',
          username,
        } satisfies MentionToken;
      },
      renderer(token: Token) {
        const mention = token as MentionToken;
        const username = mention.username;
        const safe = escapeAttribute(username);
        return `<span class="mention" data-mention="${safe}">@${safe}</span>`;
      },
    },
  ],
};

const marked = new Marked({
  gfm: true,
  breaks: true,
});

marked.use(mentionExtension);

const sanitizeDefaults = sanitizeHtml.defaults as sanitizeHtml.IOptions;
const defaultAllowedTags = Array.isArray(sanitizeDefaults.allowedTags)
  ? sanitizeDefaults.allowedTags
  : [];
const defaultAllowedSchemesByTag =
  sanitizeDefaults.allowedSchemesByTag && typeof sanitizeDefaults.allowedSchemesByTag === 'object'
    ? sanitizeDefaults.allowedSchemesByTag
    : {};
const defaultAllowedAttributes =
  sanitizeDefaults.allowedAttributes && typeof sanitizeDefaults.allowedAttributes === 'object'
    ? sanitizeDefaults.allowedAttributes
    : {};
const defaultAllowedClasses =
  sanitizeDefaults.allowedClasses && typeof sanitizeDefaults.allowedClasses === 'object'
    ? sanitizeDefaults.allowedClasses
    : {};
const defaultTransformTags =
  sanitizeDefaults.transformTags && typeof sanitizeDefaults.transformTags === 'object'
    ? sanitizeDefaults.transformTags
    : {};

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...defaultAllowedTags, 'span'],
  allowedClasses: {
    ...defaultAllowedClasses,
    span: ['mention'],
  },
  allowedAttributes: {
    ...defaultAllowedAttributes,
    span: ['class', 'data-mention'],
    a: ['href', 'title', 'rel', 'target'],
  },
  transformTags: {
    ...defaultTransformTags,
    a: sanitizeHtml.simpleTransform('a', {
      rel: 'noopener noreferrer nofollow',
      target: '_blank',
    }),
  },
  allowedSchemesByTag: {
    ...defaultAllowedSchemesByTag,
    a: ['http', 'https', 'mailto'],
  },
};

export const renderMarkdownToSafeHtml = (input: string): string => {
  const source = typeof input === 'string' ? input : '';
  const html = marked.parse(source, { async: false });
  return sanitizeHtml(html, SANITIZE_OPTIONS);
};
