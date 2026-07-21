import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ReactElement } from "react";

export interface TooltipProps {
  content: string;
  children: ReactElement;
}

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <TooltipPrimitive.Root disableHoverablePopup>
      <TooltipPrimitive.Trigger render={children} delay={500} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side="top" sideOffset={4} className="z-[var(--z-tooltip)]">
          <TooltipPrimitive.Popup className="max-w-[var(--tooltip-max-width)] rounded-[var(--radius-control)] border border-border bg-popover px-1.5 py-1 text-xs leading-tight text-popover-foreground shadow-[var(--shadow-popover)]">
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
