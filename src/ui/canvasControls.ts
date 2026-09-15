import type { OverlayRect } from "./transform";
import {
  centerFromOverlayPoint,
  clampRegionCenter,
  isotropicToScreen,
  regionToOverlay,
  type RegionCenter,
  type RegionOverlayCircle,
} from "./regionHandles";

export interface OverlayPoint { x: number; y: number }
export interface OverlayAxis { cx: number; cy: number; x: number; y: number }
export interface NumericRange { min: number; max: number }

export function pointToOverlay(point: RegionCenter, rect: OverlayRect): OverlayPoint {
  return { x: rect.left + point.x * rect.width, y: rect.top + point.y * rect.height };
}

export function pointFromOverlay(x: number, y: number, rect: OverlayRect): RegionCenter {
  return clampRegionCenter(centerFromOverlayPoint(x, y, rect));
}

export function pointFromOverlayWithinRanges(
  x: number,
  y: number,
  rect: OverlayRect,
  xRange: NumericRange,
  yRange: NumericRange,
): RegionCenter {
  const point = centerFromOverlayPoint(x, y, rect);
  return {
    x: Math.min(xRange.max, Math.max(xRange.min, point.x)),
    y: Math.min(yRange.max, Math.max(yRange.min, point.y)),
  };
}

/** Alias générique conservant bit pour bit la convention isotrope historique. */
export function diskToOverlay(
  center: RegionCenter,
  radius: number,
  imageSize: { width: number; height: number },
  rect: OverlayRect,
): RegionOverlayCircle {
  return regionToOverlay(center, radius, imageSize, rect);
}

function imagePixelToScreen(imageSize: { width: number; height: number }, rect: OverlayRect): number {
  return rect.width / imageSize.width;
}

export function normalizeDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function axisToOverlay(
  angleDegrees: number,
  lengthPixels: number,
  imageSize: { width: number; height: number },
  rect: OverlayRect,
  center: RegionCenter = { x: 0.5, y: 0.5 },
): OverlayAxis {
  const origin = pointToOverlay(center, rect);
  const radians = normalizeDegrees(angleDegrees) * Math.PI / 180;
  const length = lengthPixels * imagePixelToScreen(imageSize, rect);
  return {
    cx: origin.x,
    cy: origin.y,
    x: origin.x + Math.cos(radians) * length,
    y: origin.y + Math.sin(radians) * length,
  };
}

export function axisFromOverlay(
  x: number,
  y: number,
  imageSize: { width: number; height: number },
  rect: OverlayRect,
  lengthMin: number,
  lengthMax: number,
  center: RegionCenter = { x: 0.5, y: 0.5 },
): { angle: number; length: number } {
  const origin = pointToOverlay(center, rect);
  const dx = x - origin.x;
  const dy = y - origin.y;
  return {
    angle: dx === 0 && dy === 0 ? 0 : normalizeDegrees(Math.atan2(dy, dx) * 180 / Math.PI),
    length: Math.min(lengthMax, Math.max(lengthMin, Math.hypot(dx, dy) / imagePixelToScreen(imageSize, rect))),
  };
}

export { isotropicToScreen };
