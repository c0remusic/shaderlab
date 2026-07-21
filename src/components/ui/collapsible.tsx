import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export interface DisclosureProps {
  title: string;
  defaultOpen?: boolean;
  open?: boolean;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}

export function Disclosure({ title, defaultOpen = false, open, disabled = false, onOpenChange, children, className }: DisclosureProps) {
  return (
    <CollapsiblePrimitive.Root defaultOpen={defaultOpen} open={open} disabled={disabled} onOpenChange={(nextOpen) => onOpenChange?.(nextOpen)} className={className}>
      <CollapsiblePrimitive.Trigger className="flex h-[var(--section-header-height)] w-full items-center gap-1.5 px-1.5 text-left text-2xs font-semibold tracking-[var(--tracking-label)] uppercase text-foreground transition-colors hover:bg-muted focus-visible:outline-[var(--focus-width)] focus-visible:outline-[var(--focus-color)] focus-visible:outline-offset-[var(--focus-offset)] data-disabled:cursor-not-allowed data-disabled:text-[var(--text-disabled)]">
        <ChevronRight className="icon-sm icon-stroke shrink-0 text-muted-foreground transition-transform data-panel-open:rotate-90" aria-hidden="true" />
        <span>{title}</span>
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Panel className="px-1.5 py-2">{children}</CollapsiblePrimitive.Panel>
    </CollapsiblePrimitive.Root>
  );
}
