import { CircleAlert, X } from "lucide-react";
import { IconButton } from "../ui/IconButton";

interface Props {
  message: string;
  onDismiss: () => void;
}

export function ErrorBanner({ message, onDismiss }: Props) {
  return (
    <div className="error-banner" role="alert">
      <span className="error-banner__content">
        <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" className="error-banner__icon" />
        <span>{message}</span>
      </span>
      <IconButton label="Fermer" variant="danger" size="compact" onClick={onDismiss}>
        <X size={14} strokeWidth={1.5} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
