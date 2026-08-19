import type { ComponentChildren, FunctionalComponent } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

type AccessibleModalProps = {
  readonly title: string;
  readonly description?: string;
  readonly closeOnBackdrop?: boolean;
  readonly onClose: () => void;
  readonly children: ComponentChildren;
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const AccessibleModal: FunctionalComponent<AccessibleModalProps> = ({
  title,
  description,
  closeOnBackdrop = true,
  onClose,
  children,
}) => {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`);
  const descriptionId = useRef(`modal-description-${Math.random().toString(36).slice(2)}`);

  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    const focusFirst = () => modal?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    focusFirst();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !modal) return;
      const focusable = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId.current}
      aria-describedby={description ? descriptionId.current : undefined}
      ref={modalRef}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-content">
        <header>
          <h2 id={titleId.current}>{title}</h2>
          <button type="button" aria-label="Schließen" onClick={onClose}>
            ×
          </button>
        </header>
        {description ? <p id={descriptionId.current} className="modal-description">{description}</p> : null}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
};
