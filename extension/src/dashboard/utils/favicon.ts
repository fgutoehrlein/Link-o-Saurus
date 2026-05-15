export const getFaviconUrl = (url: string): string | null => {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return new URL('/favicon.ico', parsed.origin).toString();
  } catch {
    return null;
  }
};
