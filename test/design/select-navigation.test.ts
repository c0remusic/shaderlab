import { describe, expect, it } from "vitest";
import { nextEnabledIndex, type SelectOption } from "../../src/ui/selectNavigation";

const options: SelectOption[] = [
  { value: "a", label: "A" },
  { value: "b", label: "B", disabled: true },
  { value: "c", label: "C" },
];

describe("nextEnabledIndex", () => {
  it("skips a disabled option moving forward", () => {
    expect(nextEnabledIndex(options, 0, 1)).toBe(2);
  });

  it("skips a disabled option moving backward", () => {
    expect(nextEnabledIndex(options, 2, -1)).toBe(0);
  });

  it("wraps from the last option to the first moving forward", () => {
    expect(nextEnabledIndex(options, 2, 1)).toBe(0);
  });

  it("wraps from the first option to the last moving backward", () => {
    expect(nextEnabledIndex(options, 0, -1)).toBe(2);
  });

  it("resolves Home as direction 1 from index -1", () => {
    expect(nextEnabledIndex(options, -1, 1)).toBe(0);
  });

  it("resolves End as direction -1 from options.length", () => {
    expect(nextEnabledIndex(options, options.length, -1)).toBe(2);
  });

  it("returns -1 when every option is disabled", () => {
    const allDisabled: SelectOption[] = [
      { value: "a", label: "A", disabled: true },
      { value: "b", label: "B", disabled: true },
    ];
    expect(nextEnabledIndex(allDisabled, 0, 1)).toBe(-1);
  });

  it("returns -1 for an empty option list", () => {
    expect(nextEnabledIndex([], -1, 1)).toBe(-1);
  });
});
