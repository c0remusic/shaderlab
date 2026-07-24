import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "../components/ui/icon-button";

export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  closeLabel?: string;
}

/**
 * Modal built on the native <dialog> element: showModal()/close() give us a
 * real top-layer, native focus trap and native Escape ("cancel" event) for
 * free instead of reimplementing them. `aria-describedby` only references
 * the description while it is rendered (same conditional-aria pattern as
 * Tooltip/Select/Disclosure). Focus returns to whatever was focused before
 * the dialog opened, restored from the native "close" event so it fires
 * whether the dialog closed via Escape, the close button, or `open`
 * becoming false from the caller.
 *
 * Initial focus: the native <dialog> autofocuses the first element carrying
 * an `autofocus` attribute, falling back to the close button otherwise. Per
 * the design system, focus should land on "the safest useful action" (e.g.
 * Cancel for destructive confirmations) — callers MUST put `autoFocus` on
 * that button within `actions`, or the close (X) button receives focus
 * by default instead.
 */
export function Dialog({
  open,
  title,
  description,
  children,
  actions,
  onClose,
  closeLabel = "Fermer",
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    const handleClose = () => {
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
    };

    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="ui-dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      <header className="ui-dialog__header">
        <h2 id={titleId} className="ui-dialog__title">
          {title}
        </h2>
        <IconButton label={closeLabel} tooltip={closeLabel} onClick={onClose}>
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      </header>
      {description && (
        <p id={descriptionId} className="ui-dialog__description">
          {description}
        </p>
      )}
      <div className="ui-dialog__content">{children}</div>
      {actions && <div className="ui-dialog__actions">{actions}</div>}
    </dialog>
  );
}
