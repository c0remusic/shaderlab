import { cloneElement, useId, useRef, useState, type ReactElement } from "react";

export interface TooltipProps {
  content: string;
  children: ReactElement;
}

const FALLBACK_DELAY_MS = 500;
let cachedDelayMs: number | null = null;

function getTooltipDelayMs(): number {
  if (cachedDelayMs !== null) return cachedDelayMs;
  if (typeof document === "undefined") return FALLBACK_DELAY_MS;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--tooltip-delay");
  const parsed = parseFloat(raw);
  cachedDelayMs = Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_DELAY_MS;
  return cachedDelayMs;
}

/**
 * Purely descriptive hover/focus tooltip. Never intercepts pointer or
 * keyboard events aimed at its child — it only reads them to schedule
 * show/hide, then forwards them unchanged.
 */
export function Tooltip({ content, children }: TooltipProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<number | undefined>(undefined);

  const show = () => {
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setVisible(true), getTooltipDelayMs());
  };

  const hide = () => {
    window.clearTimeout(timeoutRef.current);
    setVisible(false);
  };

  const child = children as ReactElement<Record<string, unknown>>;
  const childProps = child.props ?? {};

  const trigger = cloneElement(child, {
    "aria-describedby": visible ? id : undefined,
    onMouseEnter: (event: React.MouseEvent) => {
      (childProps.onMouseEnter as ((e: React.MouseEvent) => void) | undefined)?.(event);
      show();
    },
    onMouseLeave: (event: React.MouseEvent) => {
      (childProps.onMouseLeave as ((e: React.MouseEvent) => void) | undefined)?.(event);
      hide();
    },
    onFocus: (event: React.FocusEvent) => {
      (childProps.onFocus as ((e: React.FocusEvent) => void) | undefined)?.(event);
      show();
    },
    onBlur: (event: React.FocusEvent) => {
      (childProps.onBlur as ((e: React.FocusEvent) => void) | undefined)?.(event);
      hide();
    },
  } as Record<string, unknown>);

  return (
    <span className="ui-tooltip-anchor">
      {trigger}
      {visible && (
        <span role="tooltip" id={id} className="ui-tooltip">
          {content}
        </span>
      )}
    </span>
  );
}
