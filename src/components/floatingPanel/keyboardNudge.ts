/**
 * Alternative clavier au drag (finding revue adverse codex-crosscheck sur le
 * design.md §4 — drag-and-drop DOIT avoir une alternative clavier, convention
 * du projet). La poignée de titre focusable reçoit les flèches directionnelles ;
 * ce module traduit une pression de touche en nouvelle position, bornée aux
 * limites du canvas comme le magnétisme (snapping.ts). Le magnétisme lui-même
 * s'applique APRÈS ce nudge, côté appelant (voir Task 4) — ce module ne fait
 * que le déplacement brut + la contrainte de limites.
 */
import type { Rect } from "./snapping";

export const KEYBOARD_NUDGE_STEP = 16;
export const KEYBOARD_NUDGE_STEP_LARGE = 64;

export type NudgeDirection = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

function clamp(value: number, size: number, extent: number): number {
  const max = Math.max(0, extent - size);
  return Math.min(Math.max(value, 0), max);
}

export function computeNudgedPosition(
  current: Rect,
  direction: NudgeDirection,
  large: boolean,
  canvasSize: { width: number; height: number }
): { x: number; y: number } {
  const step = large ? KEYBOARD_NUDGE_STEP_LARGE : KEYBOARD_NUDGE_STEP;
  let { x, y } = current;
  if (direction === "ArrowLeft") x -= step;
  if (direction === "ArrowRight") x += step;
  if (direction === "ArrowUp") y -= step;
  if (direction === "ArrowDown") y += step;
  return {
    x: clamp(x, current.width, canvasSize.width),
    y: clamp(y, current.height, canvasSize.height),
  };
}
