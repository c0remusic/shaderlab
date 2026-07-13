import type { ButtonHTMLAttributes } from "react";
import { Tooltip } from "./Tooltip";

export type IconButtonVariant = "quiet" | "danger";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tooltip?: string;
  size?: "compact" | "default";
  variant?: IconButtonVariant;
}

export function IconButton({
  label,
  tooltip,
  size = "default",
  variant = "quiet",
  type = "button",
  className = "",
  children,
  ...props
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      className={`ui-icon-button ui-icon-button--${size} ui-icon-button--${variant} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );

  if (!tooltip) return button;

  return <Tooltip content={tooltip}>{button}</Tooltip>;
}
