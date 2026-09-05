export type PageSnapshot = {
  readonly metaDescription?: string;
  readonly pageContent?: string;
  readonly pageTitle?: string;
};

// This function is serialized by chrome.scripting.executeScript, so it must not reference module state.
export const extractPageSnapshot = (): PageSnapshot => {
  const limit = 24_000;
  const metaDescription = document
    .querySelector('meta[name="description"], meta[property="og:description"]')
    ?.getAttribute('content')
    ?.replace(/\s+/g, ' ')
    .trim();
  const root = document.querySelector('main, article, [role="main"]') ?? document.body;
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('script, style, noscript, nav, header, footer, aside, [hidden], [aria-hidden="true"]').forEach((node) => node.remove());
  const headings = Array.from(copy.querySelectorAll('h1, h2, h3'))
    .map((heading) => heading.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .filter(Boolean)
    .join(' ');
  const body = (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
  const pageContent = `${headings} ${body}`.trim().slice(0, limit);

  return {
    ...(document.title.trim() ? { pageTitle: document.title.trim() } : {}),
    ...(metaDescription ? { metaDescription } : {}),
    ...(pageContent ? { pageContent } : {}),
  };
};
