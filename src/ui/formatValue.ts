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

/** Extracts the number a user typed, in whatever unit the field displays:
 * tolerates a decimal comma, surrounding whitespace and a unit suffix ("1500
 * px", "50 %"). Returns `null` when the input holds no finite number.
 *
 * Split out of `parseControlValue` so that a field displaying ANOTHER unit than
 * its control — a spatial parameter shown in pixels while its slider stays in
 * fractions — can reuse the extraction, convert, then bound with the same
 * `snapToControlRange` instead of copying either half. */
export function parseTypedNumber(rawValue: string): number | null {
  const match = rawValue.trim().replace(",", ".").match(/[-+]?\d*\.?\d+/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Brings a value into a control's contract: clamped to `min`..`max`, snapped
 * to `step`, then normalised to the step's own decimal precision. That last
 * rounding is what keeps binary dust (`0.30000000000000004`) out of the model —
 * every typed-entry path goes through it. */
export function snapToControlRange(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  const stepped = min + Math.round((clamped - min) / step) * step;
  const decimals = Math.min(3, Math.max(0, Math.ceil(-Math.log10(step))));
  return Number(stepped.toFixed(decimals));
}

/** Parses a value typed into a slider field, retaining the control's range
 * and precision contract even when its displayed value includes a unit. */
export function parseControlValue(rawValue: string, min: number, max: number, step: number): number | null {
  const parsed = parseTypedNumber(rawValue);
  return parsed === null ? null : snapToControlRange(parsed, min, max, step);
}
