import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Tooltip } from "./tooltip";

export type IconButtonVariant = "quiet" | "danger";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tooltip?: string;
  size?: "compact" | "default";
  variant?: IconButtonVariant;
  children: ReactNode;
}

export function IconButton({ label, tooltip, size = "default", variant = "quiet", type = "button", className, children, ...props }: IconButtonProps) {
  const button = (
    <ButtonPrimitive
      type={type}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-transparent bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-[var(--surface-active)] focus-visible:outline-[var(--focus-width)] focus-visible:outline-[var(--focus-color)] focus-visible:outline-offset-[var(--focus-offset)] disabled:cursor-not-allowed disabled:text-[var(--text-disabled)]",
        size === "compact" ? "size-[var(--control-height-sm)]" : "size-[var(--control-height-md)]",
        variant === "danger" && "text-[var(--status-danger-text)] hover:bg-[var(--status-danger-bg)] hover:text-destructive",
        className
      )}
      {...props}
    >
      {children}
    </ButtonPrimitive>
  );

  return tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button;
}
