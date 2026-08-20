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

/** Parses a value typed into a field that DISPLAYS percent ("50 %") while its
 * slider stays in FRACTIONS: the typed number is read as a percentage, divided
 * by 100, then bounded and snapped in fraction space — the same contract as
 * `parsePixelInput` for spatial fields shown in pixels.
 *
 * Without it such a field fell back to `parseControlValue` with the slider's
 * fraction bounds, so typing "60" into a field showing "50 %" clamped to 1
 * (= 100 %) instead of giving 0.6 — and a mere focus+blur re-parsed the shown
 * "50 %" as 50 and silently pushed the value to its max. Percent is the only
 * unit whose display differs from the slider's own scale; pixels and degrees
 * fields display the slider's unit and keep the standard parse. */
export function parsePercentValue(rawValue: string, min: number, max: number, step: number): number | null {
  const percent = parseTypedNumber(rawValue);
  return percent === null ? null : snapToControlRange(percent / 100, min, max, step);
}
