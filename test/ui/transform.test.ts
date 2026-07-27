import { describe, it, expect } from "vitest";
import {
  MIN_TRANSFORM_SCALE,
  clampTransformScale,
  compositeUvToPhotoUv,
  computeHandleGeometry,
  scaleFromCornerDrag,
  rotationFromPointer,
  snapAngle,
  ANGLE_SNAP_DEGREES,
  resetTransform,
  centerTransform,
  fitToCanvas,
} from "../../src/ui/transform";

describe("clampTransformScale", () => {
  it("laisse passer une échelle strictement positive", () => {
    expect(clampTransformScale(1.5)).toBe(1.5);
  });

  it("clampe à MIN_TRANSFORM_SCALE une échelle nulle ou négative", () => {
    expect(clampTransformScale(0)).toBe(MIN_TRANSFORM_SCALE);
    expect(clampTransformScale(-3)).toBe(MIN_TRANSFORM_SCALE);
  });
});

describe("compositeUvToPhotoUv", () => {
  const bgSize = { width: 1000, height: 1000 };
  const photoSize = { width: 200, height: 100 };

  it("identité (scale=1, rotation=0) : le centre composite tombe au centre photo", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    const uv = compositeUvToPhotoUv({ u: 0.5, v: 0.5 }, bgSize, transform, photoSize);
    expect(uv).toEqual({ u: 0.5, v: 0.5 });
  });

  it("un point hors des bornes de la photo transformée retourne null (transparent)", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    const uv = compositeUvToPhotoUv({ u: 0.0, v: 0.0 }, bgSize, transform, photoSize);
    expect(uv).toBeNull();
  });

  it("un point juste à l'intérieur du bord de la photo (scale=1) reste dans [0,1)", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    // Photo 200x100 centrée en (500,500) -> bornes X [400,600), Y [450,550).
    const uv = compositeUvToPhotoUv({ u: 0.4005, v: 0.5 }, bgSize, transform, photoSize);
    expect(uv).not.toBeNull();
    expect(uv!.u).toBeCloseTo(0.0025, 3);
  });

  it("une échelle 2 double la taille apparente de la photo dans l'espace composite", () => {
    const transform = { x: 500, y: 500, scale: 2, rotation: 0 };
    // À scale=1 le bord droit est à x=600 (u=0.6, hors bornes). À scale=2 il est à x=700.
    const insideAt2x = compositeUvToPhotoUv({ u: 0.65, v: 0.5 }, bgSize, transform, photoSize);
    expect(insideAt2x).not.toBeNull();
    const outsideAt2x = compositeUvToPhotoUv({ u: 0.71, v: 0.5 }, bgSize, transform, photoSize);
    expect(outsideAt2x).toBeNull();
  });

  it("une rotation de 90° échange les axes locaux", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: Math.PI / 2 };
    // Après rotation 90°, un point à droite du centre composite tombe dans
    // l'axe Y local de la photo (200x100 -> bornes locales x in [-100,100], y in [-50,50]).
    // Un point à distance 40px "au-dessus" du centre composite (v plus petit) doit
    // tomber à l'intérieur des bornes après rotation, un point à distance 120 doit tomber dehors.
    const inside = compositeUvToPhotoUv({ u: 0.5, v: 0.496 }, bgSize, transform, photoSize);
    expect(inside).not.toBeNull();
    const outside = compositeUvToPhotoUv({ u: 0.5, v: 0.35 }, bgSize, transform, photoSize);
    expect(outside).toBeNull();
  });
});

describe("computeHandleGeometry", () => {
  it("place les 4 coins symétriquement autour du centre à scale=1, rotation=0", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    const photoSize = { width: 200, height: 100 };
    const { corners } = computeHandleGeometry(transform, photoSize);
    expect(corners[0]).toEqual({ x: 400, y: 450 }); // TL
    expect(corners[2]).toEqual({ x: 600, y: 550 }); // BR
  });

  it("la poignée de rotation est au-dessus du centre de la box, hors de la box elle-même", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    const photoSize = { width: 200, height: 100 };
    const { rotationHandle, corners } = computeHandleGeometry(transform, photoSize);
    expect(rotationHandle.x).toBeCloseTo(500);
    expect(rotationHandle.y).toBeLessThan(corners[0].y);
  });
});

describe("snapAngle", () => {
  const deg = (d: number) => (d * Math.PI) / 180;

  it("le pas par défaut est 15°", () => {
    expect(ANGLE_SNAP_DEGREES).toBe(15);
  });

  it("cale sur le multiple de 15° le plus proche, vers le bas", () => {
    expect(snapAngle(deg(20))).toBeCloseTo(deg(15), 6);
  });

  it("cale sur le multiple de 15° le plus proche, vers le haut", () => {
    expect(snapAngle(deg(38))).toBeCloseTo(deg(45), 6);
  });

  it("laisse un angle déjà multiple de 15° inchangé", () => {
    expect(snapAngle(deg(90))).toBeCloseTo(deg(90), 6);
  });

  it("fonctionne sur les angles négatifs", () => {
    expect(snapAngle(deg(-22))).toBeCloseTo(deg(-15), 6);
  });

  it("un pas nul ou négatif ne réécrit pas l'angle (pas de division par zéro)", () => {
    expect(snapAngle(deg(37), 0)).toBeCloseTo(deg(37), 6);
  });
});

describe("resetTransform / centerTransform / fitToCanvas", () => {
  const bgSize = { width: 1000, height: 800 };

  it("resetTransform centre sur le fond, échelle 1, rotation 0", () => {
    expect(resetTransform(bgSize)).toEqual({ x: 500, y: 400, scale: 1, rotation: 0 });
  });

  it("centerTransform recentre sans toucher à l'échelle ni à la rotation", () => {
    const transform = { x: 10, y: 20, scale: 2.5, rotation: 1.1 };
    expect(centerTransform(transform, bgSize)).toEqual({ x: 500, y: 400, scale: 2.5, rotation: 1.1 });
  });

  it("fitToCanvas fait tenir une photo PLUS GRANDE que le fond (contain, pas cover)", () => {
    const transform = { x: 0, y: 0, scale: 3, rotation: 0 };
    // Photo 2000x1000, fond 1000x800 -> min(0.5, 0.8) = 0.5 (contain).
    const fitted = fitToCanvas(transform, bgSize, { width: 2000, height: 1000 });
    expect(fitted.scale).toBeCloseTo(0.5, 6);
    expect(fitted).toMatchObject({ x: 500, y: 400, rotation: 0 });
  });

  it("fitToCanvas agrandit une photo plus petite que le fond", () => {
    const transform = { x: 0, y: 0, scale: 1, rotation: 0 };
    // Photo 500x200, fond 1000x800 -> min(2, 4) = 2.
    expect(fitToCanvas(transform, bgSize, { width: 500, height: 200 }).scale).toBeCloseTo(2, 6);
  });

  it("fitToCanvas conserve la rotation", () => {
    const transform = { x: 0, y: 0, scale: 1, rotation: 0.7 };
    expect(fitToCanvas(transform, bgSize, { width: 500, height: 200 }).rotation).toBe(0.7);
  });

  it("fitToCanvas laisse l'échelle inchangée sur une photo de taille dégénérée", () => {
    const transform = { x: 3, y: 4, scale: 1.75, rotation: 0 };
    expect(fitToCanvas(transform, bgSize, { width: 0, height: 0 })).toEqual(transform);
  });
});

describe("scaleFromCornerDrag / rotationFromPointer", () => {
  const photoSize = { width: 200, height: 100 };

  it("scaleFromCornerDrag retourne 1 quand le pointeur est exactement au coin de scale=1", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    const scale = scaleFromCornerDrag(transform, photoSize, { x: 600, y: 550 });
    expect(scale).toBeCloseTo(1, 5);
  });

  it("scaleFromCornerDrag est clampé par MIN_TRANSFORM_SCALE quand le pointeur est sur le centre", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    const scale = scaleFromCornerDrag(transform, photoSize, { x: 500, y: 500 });
    expect(scale).toBe(MIN_TRANSFORM_SCALE);
  });

  it("rotationFromPointer retourne 0 quand le pointeur est directement au-dessus du centre", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    expect(rotationFromPointer(transform, { x: 500, y: 300 })).toBeCloseTo(0, 5);
  });

  it("rotationFromPointer retourne PI/2 quand le pointeur est directement à droite du centre", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    expect(rotationFromPointer(transform, { x: 700, y: 500 })).toBeCloseTo(Math.PI / 2, 5);
  });
});
