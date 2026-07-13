export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * Pure keyboard-navigation helper for the Select listbox. Starting from
 * `currentIndex`, steps by `direction` (wrapping at the ends) until it finds
 * an enabled option, or returns -1 if every option is disabled/absent.
 *
 * Home is `nextEnabledIndex(options, -1, 1)` (starts just before the first
 * option, moving forward). End is `nextEnabledIndex(options, options.length,
 * -1)` (starts just after the last option, moving backward) — both reuse
 * this same helper instead of separate first/last implementations.
 */
export function nextEnabledIndex(
  options: SelectOption[],
  currentIndex: number,
  direction: 1 | -1
): number {
  const count = options.length;
  if (count === 0) return -1;

  for (let step = 1; step <= count; step += 1) {
    const index = (((currentIndex + step * direction) % count) + count) % count;
    if (!options[index].disabled) return index;
  }

  return -1;
}
