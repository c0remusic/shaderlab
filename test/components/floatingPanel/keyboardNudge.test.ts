import { describe, it, expect } from "vitest";
import {
  computeNudgedPosition,
  KEYBOARD_NUDGE_STEP,
  KEYBOARD_NUDGE_STEP_LARGE,
} from "../../../src/components/floatingPanel/keyboardNudge";
import type { Rect } from "../../../src/components/floatingPanel/snapping";

const CANVAS = { width: 1000, height: 800 };

function rect(x: number, y: number): Rect {
  return { x, y, width: 200, height: 150 };
}

describe("computeNudgedPosition", () => {
  it("ArrowRight déplace de KEYBOARD_NUDGE_STEP sur x", () => {
    const result = computeNudgedPosition(rect(100, 100), "ArrowRight", false, CANVAS);
    expect(result).toEqual({ x: 100 + KEYBOARD_NUDGE_STEP, y: 100 });
  });

  it("ArrowLeft déplace de -KEYBOARD_NUDGE_STEP sur x", () => {
    const result = computeNudgedPosition(rect(100, 100), "ArrowLeft", false, CANVAS);
    expect(result).toEqual({ x: 100 - KEYBOARD_NUDGE_STEP, y: 100 });
  });

  it("ArrowDown déplace de KEYBOARD_NUDGE_STEP sur y", () => {
    const result = computeNudgedPosition(rect(100, 100), "ArrowDown", false, CANVAS);
    expect(result).toEqual({ x: 100, y: 100 + KEYBOARD_NUDGE_STEP });
  });

  it("ArrowUp déplace de -KEYBOARD_NUDGE_STEP sur y", () => {
    const result = computeNudgedPosition(rect(100, 100), "ArrowUp", false, CANVAS);
    expect(result).toEqual({ x: 100, y: 100 - KEYBOARD_NUDGE_STEP });
  });

  it("Shift+flèche utilise KEYBOARD_NUDGE_STEP_LARGE", () => {
    const result = computeNudgedPosition(rect(100, 100), "ArrowRight", true, CANVAS);
    expect(result).toEqual({ x: 100 + KEYBOARD_NUDGE_STEP_LARGE, y: 100 });
  });

  it("reste contraint dans les limites du canvas (bord gauche)", () => {
    const result = computeNudgedPosition(rect(5, 100), "ArrowLeft", false, CANVAS);
    expect(result.x).toBe(0);
  });

  it("reste contraint dans les limites du canvas (bord droit)", () => {
    const result = computeNudgedPosition(rect(CANVAS.width - 200 - 5, 100), "ArrowRight", false, CANVAS);
    expect(result.x).toBe(CANVAS.width - 200);
  });
});
