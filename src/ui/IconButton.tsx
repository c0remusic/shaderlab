import type { ButtonHTMLAttributes } from "react";
import { Tooltip } from "./Tooltip";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tooltip?: string;
  size?: "compact" | "default";
}

export function IconButton({
  label,
  tooltip,
  size = "default",
  type = "button",
  className = "",
  children,
  ...props
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      className={`ui-icon-button ui-icon-button--${size} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );

  if (!tooltip) return button;

  return <Tooltip content={tooltip}>{button}</Tooltip>;
}
