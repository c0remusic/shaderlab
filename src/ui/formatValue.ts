/**
 * Formats a control's numeric value with the decimal precision implied by
 * its step. Integer steps stay compact ("42"); fractional steps show as
 * many decimals as the step's own precision, capped at 3.
 */
export function formatControlValue(value: number, step: number): string {
  if (Number.isInteger(step)) return Math.round(value).toString();
  const decimals = Math.min(3, Math.max(0, Math.ceil(-Math.log10(step))));
  return value.toFixed(decimals);
}

/** Parses a value typed into a slider field, retaining the control's range
 * and precision contract even when its displayed value includes a unit. */
export function parseControlValue(rawValue: string, min: number, max: number, step: number): number | null {
  const match = rawValue.trim().replace(",", ".").match(/[-+]?\d*\.?\d+/);
  if (!match) return null;

  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return null;

  const clamped = Math.min(max, Math.max(min, parsed));
  const stepped = min + Math.round((clamped - min) / step) * step;
  const decimals = Math.min(3, Math.max(0, Math.ceil(-Math.log10(step))));
  return Number(stepped.toFixed(decimals));
}
