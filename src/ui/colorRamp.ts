export type ColorRampHandleRole = "midPosition" | "blackPoint" | "whitePoint";

export interface ColorRampPositions {
  midPosition: number;
  blackPoint: number;
  whitePoint: number;
}

const MIN_GAP = 0.05;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function moveColorRampHandle(
  positions: ColorRampPositions,
  role: ColorRampHandleRole,
  value: number,
): ColorRampPositions {
  if (role === "midPosition") return { ...positions, midPosition: clamp(value, MIN_GAP, 1 - MIN_GAP) };
  if (role === "blackPoint") return { ...positions, blackPoint: clamp(value, 0, positions.whitePoint - MIN_GAP) };
  return { ...positions, whitePoint: clamp(value, positions.blackPoint + MIN_GAP, 1) };
}

export function nudgeColorRampHandle(
  positions: ColorRampPositions,
  role: ColorRampHandleRole,
  direction: -1 | 1,
  coarse: boolean,
): ColorRampPositions {
  return moveColorRampHandle(positions, role, positions[role] + direction * (coarse ? 0.1 : 0.01));
}
