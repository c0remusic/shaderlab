import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ReactElement } from "react";

import { cn } from "../../lib/utils";

export interface TooltipProps {
  content: string;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right" | "inline-start" | "inline-end";
  sideOffset?: number;
  delay?: number;
  className?: string;
}

export function Tooltip({ content, children, side = "top", sideOffset = 4, delay = 500, className }: TooltipProps) {
  return (
    <TooltipPrimitive.Root disableHoverablePopup>
      <TooltipPrimitive.Trigger render={children} delay={delay} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={sideOffset} className="z-[var(--z-tooltip)]">
          <TooltipPrimitive.Popup className={cn("max-w-[var(--tooltip-max-width)] rounded-[var(--radius-control)] border border-border bg-popover px-1.5 py-1 text-xs leading-tight text-popover-foreground shadow-[var(--shadow-popover)]", className)}>
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
