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

export const formatCompactTimestamp = (timestamp: number | undefined): string => {
  if (!timestamp) {
    return '';
  }

  try {
    const formatter = new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return formatter.format(timestamp).replace(',', '');
  } catch {
    const date = new Date(timestamp);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
};

export const combineClassNames = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');
