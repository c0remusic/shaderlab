import { describe, it, expect } from "vitest";
import {
  computeEffectiveViewportWidth,
  DEFAULT_PANEL_COLUMN_WIDTH,
} from "../../../src/components/floatingPanel/effectiveViewport";

describe("computeEffectiveViewportWidth", () => {
  it("soustrait DEFAULT_PANEL_COLUMN_WIDTH de la largeur fenêtre", () => {
    expect(computeEffectiveViewportWidth(1600)).toBe(1600 - DEFAULT_PANEL_COLUMN_WIDTH);
  });

  it("ne descend jamais sous un plancher de canvas-min-width (480px)", () => {
    expect(computeEffectiveViewportWidth(900)).toBeGreaterThanOrEqual(480);
  });
});
