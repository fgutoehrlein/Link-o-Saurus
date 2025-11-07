import type { FunctionalComponent, JSX } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';

import {
  createComment,
  deleteComment,
  listComments,
  updateComment,
} from '../shared/db';
import { renderMarkdownToSafeHtml } from '../shared/markdown';
import type { Comment } from '../shared/types';

const sortComments = (items: Comment[]): Comment[] =>
  [...items].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

const formatTimestamp = (value: number): string => {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '';
  }
};

type CommentsSectionProps = {
  readonly bookmarkId: string;
  readonly bookmarkTitle: string;
};

const CommentsSection: FunctionalComponent<CommentsSectionProps> = ({
  bookmarkId,
  bookmarkTitle,
}) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [author, setAuthor] = useState('');
  const [body, setBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAuthor('');
    setBody('');
    setEditingId(null);
    setError(null);
    setLoading(true);

    listComments(bookmarkId)
      .then((items) => {
        if (!cancelled) {
          setComments(sortComments(items));
          setLoading(false);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          console.error('[Link-O-Saurus] Failed to load comments', cause);
          setComments([]);
          setError('Kommentare konnten nicht geladen werden.');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bookmarkId]);

  const handleSubmit: JSX.EventHandler<JSX.TargetedEvent<HTMLFormElement, Event>> = async (
    event,
  ) => {
    event.preventDefault();
    const trimmedAuthor = author.trim();
    const trimmedBody = body.trim();

    if (!trimmedAuthor || !trimmedBody) {
      setError('Name und Kommentar sind erforderlich.');
      return;
    }

    setPending(true);
    setError(null);
    try {
      if (editingId) {
        const updated = await updateComment(editingId, {
          author: trimmedAuthor,
          body: trimmedBody,
        });
        setComments((prev) =>
          prev.map((comment) => (comment.id === updated.id ? updated : comment)),
        );
      } else {
        const created = await createComment({
          bookmarkId,
          author: trimmedAuthor,
          body: trimmedBody,
        });
        setComments((prev) => sortComments([...prev, created]));
      }
      setAuthor('');
      setBody('');
      setEditingId(null);
    } catch (cause) {
      console.error('[Link-O-Saurus] Failed to save comment', cause);
      setError('Kommentar konnte nicht gespeichert werden.');
    } finally {
      setPending(false);
    }
  };

  const handleEdit = useCallback((comment: Comment) => {
    setEditingId(comment.id);
    setAuthor(comment.author);
    setBody(comment.body);
    setError(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setAuthor('');
    setBody('');
    setError(null);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      setPending(true);
      setError(null);
      try {
        await deleteComment(id);
        setComments((prev) => prev.filter((comment) => comment.id !== id));
        if (editingId === id) {
          setEditingId(null);
          setAuthor('');
          setBody('');
        }
      } catch (cause) {
        console.error('[Link-O-Saurus] Failed to delete comment', cause);
        setError('Kommentar konnte nicht gelöscht werden.');
      } finally {
        setPending(false);
      }
    },
    [editingId],
  );

  const commentCountLabel = useMemo(() => {
    const count = comments.length;
    if (count === 0) {
      return 'Keine Kommentare';
    }
    return `${count} Kommentar${count === 1 ? '' : 'e'}`;
  }, [comments.length]);

  return (
    <section
      class="comment-section"
      aria-label={`Kommentare zu ${bookmarkTitle}`}
    >
      <header class="comment-section__header">
        <h3>Kommentare</h3>
        <span class="comment-count" aria-live="polite">
          {commentCountLabel}
        </span>
      </header>
      {error ? (
        <p role="alert" class="comment-error">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p class="comment-placeholder">Kommentare werden geladen …</p>
      ) : comments.length ? (
        <ul class="comment-list">
          {comments.map((comment) => (
            <li key={comment.id} class="comment-item">
              <div class="comment-meta">
                <span class="comment-author">{comment.author}</span>
                <time dateTime={new Date(comment.createdAt).toISOString()}>
                  {formatTimestamp(comment.createdAt)}
                </time>
              </div>
              <div
                class="comment-body"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdownToSafeHtml(comment.body),
                }}
              />
              <div class="comment-actions">
                <button
                  type="button"
                  onClick={() => handleEdit(comment)}
                  disabled={pending}
                >
                  Bearbeiten
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(comment.id)}
                  disabled={pending}
                >
                  Löschen
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p class="comment-placeholder">Noch keine Kommentare.</p>
      )}
      <form class="comment-form" onSubmit={handleSubmit}>
        <label class="comment-field">
          <span class="comment-field__label">Name</span>
          <input
            type="text"
            value={author}
            onInput={(event) => setAuthor(event.currentTarget.value)}
            placeholder="Dein Name"
            disabled={pending}
            required
          />
        </label>
        <label class="comment-field">
          <span class="comment-field__label">Kommentar</span>
          <textarea
            value={body}
            onInput={(event) => setBody(event.currentTarget.value)}
            placeholder="Markdown erlaubt. @Name für lokale Mentions."
            rows={4}
            disabled={pending}
            required
          />
        </label>
        <div class="comment-form__actions">
          {editingId ? (
            <button
              type="button"
              class="comment-button comment-button--ghost"
              onClick={handleCancelEdit}
              disabled={pending}
            >
              Abbrechen
            </button>
          ) : null}
          <button
            type="submit"
            class="comment-button"
            disabled={pending}
          >
            {editingId ? 'Speichern' : 'Kommentar hinzufügen'}
          </button>
        </div>
      </form>
    </section>
  );
};

export default CommentsSection;
