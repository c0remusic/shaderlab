export type ColorRampStopRole = "shadowPosition" | "midPosition" | "highPosition";
export type ColorRampHandleRole = ColorRampStopRole | "blackPoint" | "whitePoint";

export interface ColorRampPositions {
  shadowPosition: number;
  midPosition: number;
  highPosition: number;
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
  if (role === "shadowPosition") return { ...positions, shadowPosition: clamp(value, 0, positions.midPosition - MIN_GAP) };
  if (role === "midPosition") return { ...positions, midPosition: clamp(value, positions.shadowPosition + MIN_GAP, positions.highPosition - MIN_GAP) };
  if (role === "highPosition") return { ...positions, highPosition: clamp(value, positions.midPosition + MIN_GAP, 1) };
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
