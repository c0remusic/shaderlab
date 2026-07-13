import type { CSSProperties } from "react";

export interface ProgressProps {
  label: string;
  value?: number;
  max?: number;
}

/**
 * Determinate or indeterminate progress bar. `role="progressbar"` always;
 * `aria-valuenow` is omitted (not set to a fake value) when `value` is
 * undefined, per the ARIA contract for indeterminate progress.
 */
export function Progress({ label, value, max = 100 }: ProgressProps) {
  const indeterminate = value === undefined;
  const clamped = indeterminate ? undefined : Math.min(max, Math.max(0, value));
  const percent = indeterminate ? undefined : (clamped! / max) * 100;

  return (
    <div className="ui-progress">
      <span className="ui-progress__label">{label}</span>
      <div
        className={`ui-progress__track ${indeterminate ? "ui-progress__track--indeterminate" : ""}`.trim()}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={indeterminate ? undefined : clamped}
      >
        {!indeterminate && (
          <div className="ui-progress__fill" style={{ "--progress-value": percent } as CSSProperties} />
        )}
      </div>
    </div>
  );
}
