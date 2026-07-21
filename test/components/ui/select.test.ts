import { describe, expect, it } from "vitest";
import { toSelectChange } from "../../../src/components/ui/select";

describe("toSelectChange", () => {
  it("forwards a selected string value", () => {
    expect(toSelectChange("screen")).toBe("screen");
  });

  it("ignores the clear signal emitted by Base UI", () => {
    expect(toSelectChange(null)).toBeNull();
  });
});
