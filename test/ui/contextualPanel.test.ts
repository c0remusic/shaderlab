import { describe, expect, it } from "vitest";
import { computeVisible, toggleRail, type ContextualPanelState } from "../../src/ui/contextualPanel";

const NO_OVERRIDE: ContextualPanelState = { key: null, override: null };

describe("computeVisible", () => {
  it("follows conditionMet when no override has been set for this triggerKey", () => {
    expect(computeVisible(NO_OVERRIDE, true, "layer-a")).toBe(true);
    expect(computeVisible(NO_OVERRIDE, false, "layer-a")).toBe(false);
  });

  it("an override for the current triggerKey wins over conditionMet", () => {
    const closed: ContextualPanelState = { key: "layer-a", override: "closed" };
    expect(computeVisible(closed, true, "layer-a")).toBe(false);
    const open: ContextualPanelState = { key: "layer-a", override: "open" };
    expect(computeVisible(open, false, "layer-a")).toBe(true);
  });

  it("an override for a DIFFERENT triggerKey is ignored — conditionMet decides again", () => {
    const closedForA: ContextualPanelState = { key: "layer-a", override: "closed" };
    expect(computeVisible(closedForA, true, "layer-b")).toBe(true);
    expect(computeVisible(closedForA, false, "layer-b")).toBe(false);
  });

  it("a null triggerKey with no prior override follows conditionMet", () => {
    expect(computeVisible(NO_OVERRIDE, true, null)).toBe(true);
  });
});


describe("toggleRail", () => {
  it("forces the panel open when conditionMet is false (empty state shown on demand)", () => {
    const next = toggleRail(NO_OVERRIDE, false, "layer-a");
    expect(computeVisible(next, false, "layer-a")).toBe(true);
    expect(next).toEqual({ key: "layer-a", override: "open" });
  });

  it("closes a panel that is currently visible via conditionMet alone", () => {
    const next = toggleRail(NO_OVERRIDE, true, "layer-a");
    expect(computeVisible(next, true, "layer-a")).toBe(false);
    expect(next).toEqual({ key: "layer-a", override: "closed" });
  });

  it("closes a panel currently visible via a stale open override for a different triggerKey (falls back to conditionMet-for-current-key computation before toggling)", () => {
    const openForA: ContextualPanelState = { key: "layer-a", override: "open" };
    // Switched to layer-b; conditionMet true for layer-b too, so it's visible via conditionMet, not override.
    const next = toggleRail(openForA, true, "layer-b");
    expect(computeVisible(next, true, "layer-b")).toBe(false);
    expect(next).toEqual({ key: "layer-b", override: "closed" });
  });

  it("re-opens a panel it just closed (idempotent double toggle returns to visible)", () => {
    const closed = toggleRail(NO_OVERRIDE, true, "layer-a");
    const reopened = toggleRail(closed, true, "layer-a");
    expect(computeVisible(reopened, true, "layer-a")).toBe(true);
  });
});
