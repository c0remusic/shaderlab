export interface CurvePoint { x: number; y: number }

export const MAX_CURVE_POINTS = 5;
const POINT_GAP = 0.001;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function identityCurve(): CurvePoint[] {
  return [{ x: 0, y: 0 }, { x: 1, y: 1 }];
}

export function insertCurvePoint(points: readonly CurvePoint[], point: CurvePoint): CurvePoint[] {
  if (points.length >= MAX_CURVE_POINTS) return [...points];
  const inserted = { x: clamp01(point.x), y: clamp01(point.y) };
  const next = [...points, inserted].sort((a, b) => a.x - b.x);
  return constrainCurvePoint(next, next.indexOf(inserted), inserted);
}

/**
 * L'ORDRE EN X EST UNE CONTRAINTE, L'ORDRE EN Y N'EN EST PLUS UNE.
 *
 * Les deux étaient imposés jusqu'au 2026-08-18, et seul le premier a une raison :
 * `curve_eval` (`render/effects/curves.ts`) cherche son segment en balayant
 * `xs` de gauche à droite et s'arrête au premier `x <= xs[i+1]`. Des abscisses
 * désordonnées lui feraient lire le mauvais segment. Le `POINT_GAP` est la même
 * contrainte : une largeur de segment nulle divise par zéro.
 *
 * L'ordre en Y, lui, ne servait rien — il INTERDISAIT la solarisation, c'est
 * tout. Le shader évalue déjà une courbe descendante : sa cubique de Hermite
 * est celle de Fritsch-Carlson, qui annule ses tangentes à chaque extremum et
 * préserve la monotonie PAR SEGMENT, pas sur toute la courbe. Rien n'était à
 * écrire côté rendu ; l'interface interdisait de produire ce qu'il savait déjà
 * faire (ticket 12, tranche 2).
 *
 * L'abscisse des extrémités reste clouée à 0 et 1 : ce sont les bornes du
 * domaine, pas des points de contrôle. Leur ORDONNÉE est libre depuis toujours,
 * et c'est elle qui fait le point noir et le point blanc.
 */
export function constrainCurvePoint(points: readonly CurvePoint[], index: number, point: CurvePoint): CurvePoint[] {
  if (index < 0 || index >= points.length) return [...points];
  const next = points.map((candidate) => ({ ...candidate }));
  const endpoint = index === 0 || index === next.length - 1;
  const minX = index === 0 ? 0 : next[index - 1].x + POINT_GAP;
  const maxX = index === next.length - 1 ? 1 : next[index + 1].x - POINT_GAP;
  next[index] = {
    x: endpoint ? (index === 0 ? 0 : 1) : Math.min(maxX, Math.max(minX, clamp01(point.x))),
    y: clamp01(point.y),
  };
  return next;
}

export function removeCurvePoint(points: readonly CurvePoint[], index: number): CurvePoint[] {
  if (index <= 0 || index >= points.length - 1) return [...points];
  return points.filter((_, pointIndex) => pointIndex !== index).map((point) => ({ ...point }));
}

function monotoneTangents(points: readonly CurvePoint[]): number[] {
  if (points.length === 2) {
    const slope = (points[1].y - points[0].y) / (points[1].x - points[0].x);
    return [slope, slope];
  }
  const slopes = points.slice(0, -1).map((point, index) =>
    (points[index + 1].y - point.y) / (points[index + 1].x - point.x));
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === points.length - 1) return slopes[slopes.length - 1];
    return slopes[index - 1] * slopes[index] <= 0 ? 0 : (slopes[index - 1] + slopes[index]) / 2;
  });
  for (let index = 0; index < slopes.length; index += 1) {
    const slope = slopes[index];
    if (slope === 0) { tangents[index] = 0; tangents[index + 1] = 0; continue; }
    const alpha = tangents[index] / slope;
    const beta = tangents[index + 1] / slope;
    const magnitude = alpha * alpha + beta * beta;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[index] = scale * alpha * slope;
      tangents[index + 1] = scale * beta * slope;
    }
  }
  return tangents;
}

export function evaluateMonotoneCurve(points: readonly CurvePoint[], input: number): number {
  if (points.length < 2) return clamp01(input);
  const x = clamp01(input);
  let segment = points.length - 2;
  for (let index = 0; index < points.length - 1; index += 1) {
    if (x <= points[index + 1].x) { segment = index; break; }
  }
  const a = points[segment];
  const b = points[segment + 1];
  const width = b.x - a.x;
  if (width <= 0) return clamp01(a.y);
  const t = (x - a.x) / width;
  const t2 = t * t;
  const t3 = t2 * t;
  const tangents = monotoneTangents(points);
  return clamp01(
    (2 * t3 - 3 * t2 + 1) * a.y +
    (t3 - 2 * t2 + t) * width * tangents[segment] +
    (-2 * t3 + 3 * t2) * b.y +
    (t3 - t2) * width * tangents[segment + 1],
  );
}
