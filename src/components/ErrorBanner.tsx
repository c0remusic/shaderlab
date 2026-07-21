import { CircleAlert, X } from "lucide-react";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";

interface Props {
  message: string;
  onDismiss: () => void;
}

export function ErrorBanner({ message, onDismiss }: Props) {
  return (
    <Alert variant="destructive" role="alert" className="rounded-none border-x-0 border-t-0">
      <CircleAlert className="icon-md icon-stroke" aria-hidden="true" />
      <AlertDescription className="flex items-center justify-between gap-4 pr-0">
        <span>{message}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Fermer"
          onClick={onDismiss}
          className="size-6 shrink-0"
        >
          <X className="icon-sm icon-stroke" aria-hidden="true" />
        </Button>
      </AlertDescription>
    </Alert>
  );
}
