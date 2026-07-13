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
