import { FunctionalComponent } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { getBookmark, listDueReadLater, updateReadLater } from '../shared/db';
import type { Bookmark, ReadLater } from '../shared/types';
import { sendBackgroundMessage } from '../shared/messaging';

const SNOOZE_PRESETS = [
  { label: '15 Min', minutes: 15 },
  { label: '1 Stunde', minutes: 60 },
  { label: 'Morgen', minutes: 60 * 24 },
  { label: 'Nächste Woche', minutes: 60 * 24 * 7 },
] as const;

const relativeTimeFormatter =
  typeof Intl !== 'undefined'
    ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    : undefined;

const formatRelativeTime = (timestamp: number): string => {
  if (!relativeTimeFormatter) {
    return new Date(timestamp).toLocaleString();
  }

  const now = Date.now();
  const diffMs = timestamp - now;
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (Math.abs(diffMs) < hourMs) {
    const minutes = Math.round(diffMs / minuteMs);
    return relativeTimeFormatter.format(minutes, 'minute');
  }
  if (Math.abs(diffMs) < dayMs * 2) {
    const hours = Math.round(diffMs / hourMs);
    return relativeTimeFormatter.format(hours, 'hour');
  }
  const days = Math.round(diffMs / dayMs);
  return relativeTimeFormatter.format(days, 'day');
};

const activationTime = (entry: ReadLater): number => {
  if (typeof entry.snoozedUntil === 'number') {
    return Math.max(entry.dueAt, entry.snoozedUntil);
  }
  return entry.dueAt;
};

type ReadLaterRow = {
  entry: ReadLater;
  bookmark?: Bookmark | null;
  effectiveDueAt: number;
};

const loadDueEntries = async (): Promise<ReadLaterRow[]> => {
  const entries = await listDueReadLater();
  const bookmarks = await Promise.all(entries.map((entry) => getBookmark(entry.bookmarkId)));
  return entries.map((entry, index) => ({
    entry,
    bookmark: bookmarks[index] ?? null,
    effectiveDueAt: activationTime(entry),
  }));
};

const ReadLaterList: FunctionalComponent = () => {
  const [rows, setRows] = useState<ReadLaterRow[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setPending(true);
    try {
      const items = await loadDueEntries();
      setRows(items);
      setError(null);
    } catch (refreshError) {
      const message =
        refreshError instanceof Error
          ? refreshError.message
          : 'Konnte Wiedervorlagen nicht laden';
      setError(message);
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSnooze = useCallback(
    async (bookmarkId: string, minutes: number) => {
      try {
        const snoozedUntil = Date.now() + minutes * 60_000;
        await updateReadLater(bookmarkId, { snoozedUntil });
        await refresh();
        await sendBackgroundMessage({ type: 'readLater.refreshBadge' });
      } catch (snoozeError) {
        const message =
          snoozeError instanceof Error
            ? snoozeError.message
            : 'Snooze konnte nicht gespeichert werden';
        setError(message);
      }
    },
    [refresh],
  );

  const effectiveRows = useMemo(
    () =>
      [...rows].sort(
        (a, b) => a.effectiveDueAt - b.effectiveDueAt || a.entry.bookmarkId.localeCompare(b.entry.bookmarkId),
      ),
    [rows],
  );

  return (
    <section class="detail-card read-later-card" aria-label="Später lesen Wiedervorlagen">
      <header class="read-later-card__header">
        <h2 class="read-later-card__title">Später lesen</h2>
        <div class="read-later-card__actions">
          {pending ? (
            <span class="read-later-status" aria-live="polite">
              Aktualisiere …
            </span>
          ) : null}
          <button type="button" class="read-later-refresh" onClick={() => void refresh()}>
            Aktualisieren
          </button>
        </div>
      </header>
      {error ? (
        <p class="read-later-error" role="alert">
          {error}
        </p>
      ) : null}
      {effectiveRows.length === 0 && !error ? (
        <p class="read-later-empty">Keine Wiedervorlagen fällig.</p>
      ) : null}
      <ul class="read-later-list">
        {effectiveRows.map(({ entry, bookmark, effectiveDueAt }) => {
          const title = bookmark?.title ?? 'Unbenannter Bookmark';
          const href = bookmark?.url;
          const priority = entry.priority ?? 'med';
          return (
            <li key={entry.bookmarkId} class={`read-later-item priority-${priority}`}>
              <div class="read-later-item__title">
                <span class="read-later-item__label" title={title}>
                  {title}
                </span>
                {href ? (
                  <a
                    class="read-later-item__link"
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Öffnen
                  </a>
                ) : null}
              </div>
              <div class="read-later-item__meta">
                <span
                  class="read-later-item__due"
                  title={new Date(effectiveDueAt).toLocaleString()}
                >
                  {formatRelativeTime(effectiveDueAt)}
                </span>
                {entry.priority ? (
                  <span class={`read-later-priority read-later-priority--${entry.priority}`}>
                    {entry.priority === 'high'
                      ? 'Hoch'
                      : entry.priority === 'med'
                      ? 'Mittel'
                      : 'Niedrig'}
                  </span>
                ) : null}
              </div>
              <div class="read-later-item__actions">
                <label class="read-later-snooze-label" htmlFor={`snooze-${entry.bookmarkId}`}>
                  Snooze
                </label>
                <select
                  id={`snooze-${entry.bookmarkId}`}
                  class="read-later-snooze-select"
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    event.currentTarget.value = '';
                    if (!Number.isFinite(value) || value <= 0) {
                      return;
                    }
                    void handleSnooze(entry.bookmarkId, value);
                  }}
                >
                  <option value="">Auswählen …</option>
                  {SNOOZE_PRESETS.map((preset) => (
                    <option key={preset.minutes} value={preset.minutes}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default ReadLaterList;
