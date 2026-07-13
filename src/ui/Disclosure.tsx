import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export interface DisclosureProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Collapsible section trigger for inspector groups. The chevron rotates via
 * a motion token instead of swapping icons, and the content is unmounted
 * while collapsed (no domain state lives in the trigger).
 */
export function Disclosure({ title, defaultOpen = false, children }: DisclosureProps) {
  const id = useId();
  const contentId = `${id}-content`;
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="ui-disclosure">
      <button
        type="button"
        className="ui-disclosure__trigger"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight
          className={`ui-disclosure__chevron ${open ? "ui-disclosure__chevron--open" : ""}`.trim()}
          size={14}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <span className="ui-disclosure__title">{title}</span>
      </button>
      {open && (
        <div id={contentId} className="ui-disclosure__content">
          {children}
        </div>
      )}
    </div>
  );
}
