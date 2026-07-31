import { describe, it, expect } from "vitest";
import {
  MIN_TRANSFORM_SCALE,
  CORNER_INDICES,
  clampTransformScale,
  compositeUvToPhotoUv,
  computeHandleGeometry,
  overlayRectFromClientRects,
  sameOverlayRect,
  transformFromCornerDrag,
  rotationFromPointer,
  snapAngle,
  ANGLE_SNAP_DEGREES,
  resetTransform,
  centerTransform,
  fitToCanvas,
  type CornerIndex,
} from "../../src/ui/transform";
import type { LayerTransform } from "../../src/layers/types";

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

describe("overlayRectFromClientRects", () => {
  it("rend le rectangle du CANVAS, pas celui du conteneur qui porte l'overlay", () => {
    // Conteneur 1200x800 ; canvas lettreboxé à 600x400 et décalé vers la
    // gauche par la compensation du dock — c'est le cas réel de `.workspace`
    // vs `.canvas-stage__canvas`. L'overlay doit valoir le canvas.
    const parentRect = { left: 100, top: 50, width: 1200, height: 800 };
    const canvasRect = { left: 250, top: 250, width: 600, height: 400 };
    expect(overlayRectFromClientRects(canvasRect, parentRect)).toEqual({
      left: 150,
      top: 200,
      width: 600,
      height: 400,
    });
  });

  it("un canvas qui remplit exactement son conteneur donne un overlay à l'origine", () => {
    const rect = { left: 100, top: 50, width: 1200, height: 800 };
    expect(overlayRectFromClientRects(rect, rect)).toEqual({ left: 0, top: 0, width: 1200, height: 800 });
  });

  it("suit un zoom : un canvas agrandi et débordant du conteneur garde ses vraies mesures", () => {
    // `getBoundingClientRect()` reflète déjà les transforms CSS — un zoom 2x
    // avec déplacement se lit tel quel, y compris en coordonnées négatives.
    const parentRect = { left: 100, top: 50, width: 1200, height: 800 };
    const zoomedCanvas = { left: -140, top: -30, width: 2400, height: 1600 };
    expect(overlayRectFromClientRects(zoomedCanvas, parentRect)).toEqual({
      left: -240,
      top: -80,
      width: 2400,
      height: 1600,
    });
  });
});

describe("sameOverlayRect", () => {
  const rect = { left: 1, top: 2, width: 3, height: 4 };

  it("deux mesures identiques sont égales (pas de reprise d'état, pas de boucle de rendu)", () => {
    expect(sameOverlayRect(rect, { ...rect })).toBe(true);
  });

  it("un seul champ qui bouge suffit à les distinguer", () => {
    expect(sameOverlayRect(rect, { ...rect, left: 1.5 })).toBe(false);
    expect(sameOverlayRect(rect, { ...rect, height: 5 })).toBe(false);
  });
});

describe("transformFromCornerDrag", () => {
  const photoSize = { width: 200, height: 100 };
  const OPPOSITE: Record<CornerIndex, CornerIndex> = { 0: 2, 1: 3, 2: 0, 3: 1 };

  const cornerAt = (transform: LayerTransform, index: CornerIndex) =>
    computeHandleGeometry(transform, photoSize).corners[index];

  /** Point sur la demi-droite centre→coin, `factor` fois plus loin que le coin. */
  function alongDiagonal(transform: LayerTransform, index: CornerIndex, factor: number) {
    const corner = cornerAt(transform, index);
    return {
      x: transform.x + (corner.x - transform.x) * factor,
      y: transform.y + (corner.y - transform.y) * factor,
    };
  }

  for (const index of CORNER_INDICES) {
    it(`le coin opposé au coin ${index} tiré reste immobile — sans rotation`, () => {
      const transform: LayerTransform = { x: 500, y: 500, scale: 1, rotation: 0 };
      const before = cornerAt(transform, OPPOSITE[index]);
      const next = transformFromCornerDrag(transform, photoSize, alongDiagonal(transform, index, 1.4), index);
      const after = cornerAt(next, OPPOSITE[index]);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    });

    it(`le coin opposé au coin ${index} tiré reste immobile — avec rotation`, () => {
      const transform: LayerTransform = { x: 420, y: 380, scale: 1.7, rotation: 0.63 };
      const before = cornerAt(transform, OPPOSITE[index]);
      const next = transformFromCornerDrag(transform, photoSize, alongDiagonal(transform, index, 1.4), index);
      const after = cornerAt(next, OPPOSITE[index]);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    });

    it(`le coin ${index} tiré suit le pointeur (le drag n'ancre pas le centre)`, () => {
      const transform: LayerTransform = { x: 420, y: 380, scale: 1.7, rotation: 0.63 };
      const pointer = alongDiagonal(transform, index, 1.4);
      const next = transformFromCornerDrag(transform, photoSize, pointer, index);
      const dragged = cornerAt(next, index);
      expect(dragged.x).toBeCloseTo(pointer.x, 6);
      expect(dragged.y).toBeCloseTo(pointer.y, 6);
      // Ancre au coin opposé : éloigner le pointeur de 40 % du centre
      // n'agrandit que de 20 %, la moitié du gain d'un ancrage central.
      expect(next.scale).toBeCloseTo(transform.scale * 1.2, 6);
    });
  }

  it("un pointeur posé exactement sur le coin tiré ne bouge rien (pas de saut au début du drag)", () => {
    const transform: LayerTransform = { x: 420, y: 380, scale: 1.7, rotation: 0.63 };
    const next = transformFromCornerDrag(transform, photoSize, cornerAt(transform, 2), 2);
    expect(next.scale).toBeCloseTo(transform.scale, 6);
    expect(next.x).toBeCloseTo(transform.x, 6);
    expect(next.y).toBeCloseTo(transform.y, 6);
    expect(next.rotation).toBe(transform.rotation);
  });

  it("réappliquer le même pointeur au résultat est stable (l'ancre ne dérive pas pendant le drag)", () => {
    const transform: LayerTransform = { x: 420, y: 380, scale: 1.7, rotation: 0.63 };
    const pointer = alongDiagonal(transform, 2, 1.4);
    const once = transformFromCornerDrag(transform, photoSize, pointer, 2);
    const twice = transformFromCornerDrag(once, photoSize, pointer, 2);
    expect(twice.scale).toBeCloseTo(once.scale, 6);
    expect(twice.x).toBeCloseTo(once.x, 6);
    expect(twice.y).toBeCloseTo(once.y, 6);
  });

  it("traverser l'ancre n'inverse pas la box : deux pointeurs symétriques rendent la même échelle", () => {
    const transform: LayerTransform = { x: 500, y: 500, scale: 1, rotation: 0 };
    const anchor = cornerAt(transform, 0); // opposé du coin 2 (BR)
    const outside = { x: anchor.x + 60, y: anchor.y + 30 };
    const crossed = { x: anchor.x - 60, y: anchor.y - 30 };
    const a = transformFromCornerDrag(transform, photoSize, outside, 2);
    const b = transformFromCornerDrag(transform, photoSize, crossed, 2);
    expect(b.scale).toBeCloseTo(a.scale, 6);
    expect(a.scale).toBeGreaterThan(0);
  });

  it("un pointeur posé sur l'ancre clampe à MIN_TRANSFORM_SCALE sans déplacer l'ancre", () => {
    const transform: LayerTransform = { x: 500, y: 500, scale: 1, rotation: 0.3 };
    const anchor = cornerAt(transform, 0);
    const next = transformFromCornerDrag(transform, photoSize, anchor, 2);
    expect(next.scale).toBe(MIN_TRANSFORM_SCALE);
    const after = cornerAt(next, 0);
    expect(after.x).toBeCloseTo(anchor.x, 6);
    expect(after.y).toBeCloseTo(anchor.y, 6);
  });

  it("l'ancrage « centre » (Alt) garde le centre fixe et grandit dans les 4 directions", () => {
    const transform: LayerTransform = { x: 500, y: 500, scale: 1, rotation: 0 };
    const next = transformFromCornerDrag(transform, photoSize, { x: 600, y: 550 }, 2, "center");
    expect(next.scale).toBeCloseTo(1, 5);
    expect(next.x).toBe(500);
    expect(next.y).toBe(500);
    const doubled = transformFromCornerDrag(transform, photoSize, { x: 700, y: 600 }, 2, "center");
    expect(doubled.scale).toBeCloseTo(2, 5);
    expect(doubled.x).toBe(500);
  });

  it("l'ancrage « centre » est clampé par MIN_TRANSFORM_SCALE quand le pointeur est sur le centre", () => {
    const transform: LayerTransform = { x: 500, y: 500, scale: 1, rotation: 0 };
    expect(transformFromCornerDrag(transform, photoSize, { x: 500, y: 500 }, 2, "center").scale).toBe(
      MIN_TRANSFORM_SCALE,
    );
  });

  it("une photo de taille dégénérée laisse la transform inchangée (jamais de NaN)", () => {
    const transform: LayerTransform = { x: 500, y: 500, scale: 1, rotation: 0.2 };
    expect(transformFromCornerDrag(transform, { width: 0, height: 0 }, { x: 700, y: 700 }, 2)).toEqual(transform);
  });

  it("la rotation n'est jamais touchée par un drag de coin", () => {
    const transform: LayerTransform = { x: 420, y: 380, scale: 1.7, rotation: 0.63 };
    expect(transformFromCornerDrag(transform, photoSize, { x: 800, y: 900 }, 1).rotation).toBe(0.63);
  });
});

describe("rotationFromPointer", () => {
  it("rotationFromPointer retourne 0 quand le pointeur est directement au-dessus du centre", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    expect(rotationFromPointer(transform, { x: 500, y: 300 })).toBeCloseTo(0, 5);
  });

  it("rotationFromPointer retourne PI/2 quand le pointeur est directement à droite du centre", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    expect(rotationFromPointer(transform, { x: 700, y: 500 })).toBeCloseTo(Math.PI / 2, 5);
  });
});
