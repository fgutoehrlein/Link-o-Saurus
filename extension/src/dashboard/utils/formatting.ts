export const formatTimestamp = (timestamp: number | undefined): string => {
  if (!timestamp) {
    return '';
  }
  try {
    const formatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    return formatter.format(timestamp);
  } catch {
    return new Date(timestamp).toLocaleString();
  }
};

export const combineClassNames = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');
