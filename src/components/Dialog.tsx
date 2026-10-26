import { useEffect, useId, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog: labelled, focus moves in on open and back on close, Tab is trapped,
 * Escape closes when `onClose` is provided (cancelable dialogs only).
 */
export function Dialog({
  title,
  children,
  onClose,
  className = '',
  initialFocus,
}: {
  title: ReactNode;
  children: ReactNode;
  onClose?: () => void;
  className?: string;
  /** CSS selector inside the dialog to focus first. */
  initialFocus?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    // Focus the dialog itself (announces its title and keeps long content scrolled to the top)
    // unless a specific element is requested.
    const first = (initialFocus ? root?.querySelector<HTMLElement>(initialFocus) : null) ?? root;
    first?.focus();
    return () => previous?.focus?.();
  }, [initialFocus]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && onCloseRef.current) {
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`mine-panel max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border-2 p-5 shadow-2xl ${className}`}
      >
        <h2 id={`${id}-title`} className="mb-3 text-2xl font-bold text-gold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
