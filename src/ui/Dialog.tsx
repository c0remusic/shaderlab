import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./IconButton";

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
 * Modal wrapper around the native <dialog> element. `open` is the single
 * source of truth: an effect drives showModal()/close() to match it, so
 * parent state and the native dialog can never disagree about visibility.
 * Escape triggers the native `cancel` event, which is redirected through
 * onClose so the same prop update path closes the dialog either way.
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
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = description ? `${id}-description` : undefined;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    function handleCancel(event: Event) {
      // Let onClose drive the `open` prop instead of the native default,
      // so the effect above stays the only place that calls close().
      event.preventDefault();
      onClose();
    }

    function handleClose() {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    }

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
      aria-describedby={descriptionId}
    >
      <div className="ui-dialog__header">
        <h2 className="ui-dialog__title" id={titleId}>
          {title}
        </h2>
        <IconButton label={closeLabel} onClick={onClose}>
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      </div>
      {description && (
        <p className="ui-dialog__description" id={descriptionId}>
          {description}
        </p>
      )}
      <div className="ui-dialog__body">{children}</div>
      {actions && <div className="ui-dialog__actions">{actions}</div>}
    </dialog>
  );
}
