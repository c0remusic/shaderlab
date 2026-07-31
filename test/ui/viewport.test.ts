import { describe, expect, it } from "vitest";
import {
  FIT_MARGIN,
  MAX_ZOOM,
  ZOOM_OUT_HEADROOM,
  ZOOM_STEP_FACTOR,
  clampOffset,
  clampScale,
  fitScale,
  fitViewport,
  imageToView,
  isPannable,
  panBy,
  reconcileViewport,
  scaleBounds,
  viewToImage,
  zoomAt,
  zoomByFactor,
  zoomByWheel,
  zoomPercent,
  zoomToActualSize,
  type ViewportState,
} from "../../src/ui/viewport";

/** Document 3:2 nettement plus grand que la vue — le cas nominal d'une photo. */
const PHOTO = { width: 6000, height: 4000 };
/** Vue 4:3 : les deux ratios diffèrent, donc l'ajustement laisse des bandes. */
const VIEW = { width: 800, height: 600 };
/** L'ajustement réserve `FIT_MARGIN` de chaque côté — la photo ne colle jamais
 *  aux bords. Les attendus se calculent donc sur la zone UTILE, pas sur la vue. */
const USABLE = { width: VIEW.width - FIT_MARGIN * 2, height: VIEW.height - FIT_MARGIN * 2 };

describe("fitScale — ajustement contain", () => {
  it("prend l'axe le plus contraignant, jamais le plus permissif", () => {
    // Sur la zone utile : 752/6000 = 0.1253 ; 552/4000 = 0.138. Le contain
    // retient le plus petit, sinon l'image déborderait en largeur.
    expect(fitScale(PHOTO, VIEW)).toBeCloseTo(USABLE.width / PHOTO.width, 10);
    expect(fitScale(PHOTO, VIEW)).toBeLessThan(VIEW.width / PHOTO.width);
  });

  it("rend 1 sur une taille dégénérée plutôt qu'un Infinity", () => {
    expect(fitScale({ width: 0, height: 0 }, VIEW)).toBe(1);
    expect(fitScale(PHOTO, { width: 0, height: 600 })).toBe(1);
  });
});

describe("scaleBounds — les deux valeurs remarquables restent atteignables", () => {
  it("photo plus grande que la vue : l'ajustement et 100 % sont TOUS DEUX dans les bornes", () => {
    const { min, max } = scaleBounds(PHOTO, VIEW);
    const fit = USABLE.width / PHOTO.width;
    // Ce qui compte n'est pas que les bornes VALENT ces deux valeurs (elles ne
    // les valent plus depuis que le zoom a de la marge des deux côtés), c'est
    // qu'aucune des deux ne soit hors d'atteinte.
    expect(clampScale(fit, PHOTO, VIEW)).toBeCloseTo(fit, 10);
    expect(clampScale(1, PHOTO, VIEW)).toBe(1);
    expect(min).toBeLessThan(fit);
    expect(max).toBeGreaterThan(1);
  });

  it("image plus petite que la vue : l'ajustement dépasse 100 % et reste atteignable", () => {
    const tiny = { width: 200, height: 100 };
    const fit = USABLE.width / tiny.width;
    expect(clampScale(fit, tiny, VIEW)).toBeCloseTo(fit, 10);
    // Le zoom 100 % d'une petite image est un DÉZOOM par rapport à l'ajustement.
    expect(clampScale(1, tiny, VIEW)).toBe(1);
  });

  it("laisse reculer SOUS l'ajustement — sans quoi une photo à cheval sur le bord de la toile n'est pas visable", () => {
    const { min } = scaleBounds(PHOTO, VIEW);
    const fit = USABLE.width / PHOTO.width;
    expect(min).toBeCloseTo(fit / ZOOM_OUT_HEADROOM, 10);
    expect(clampScale(fit / 4, PHOTO, VIEW)).toBeCloseTo(fit / 4, 10);
  });

  it("laisse dépasser le pixel natif jusqu'au plafond — un bord de masque ne se juge pas à 100 %", () => {
    const { max } = scaleBounds(PHOTO, VIEW);
    expect(max).toBe(MAX_ZOOM);
    expect(clampScale(8, PHOTO, VIEW)).toBe(8);
    // Le plafond reste un plafond : au-delà, on est ramené dessus.
    expect(clampScale(1000, PHOTO, VIEW)).toBe(MAX_ZOOM);
  });
});

describe("clampOffset — bornes de déplacement", () => {
  it("centre l'axe sur lequel le contenu ne déborde pas", () => {
    const state: ViewportState = { scale: fitScale(PHOTO, VIEW), offsetX: 0, offsetY: 0 };
    const clamped = clampOffset(state, PHOTO, VIEW);
    // À l'ajustement le contenu ne déborde sur AUCUN axe (la marge le garantit) :
    // les deux sont donc centrés, et le décalage horizontal vaut la marge.
    expect(clamped.offsetX).toBeCloseTo(FIT_MARGIN, 6);
    const displayedHeight = PHOTO.height * state.scale;
    expect(clamped.offsetY).toBeCloseTo((VIEW.height - displayedHeight) / 2, 6);
  });

  it("empêche de faire sortir l'image de la vue quand elle déborde", () => {
    const state: ViewportState = { scale: 1, offsetX: 5000, offsetY: 5000 };
    const clamped = clampOffset(state, PHOTO, VIEW);
    // Un décalage positif laisserait un vide à gauche : le bord gauche du
    // contenu ne peut pas dépasser le bord gauche de la vue.
    expect(clamped.offsetX).toBe(0);
    expect(clamped.offsetY).toBe(0);
  });

  it("empêche symétriquement de dépasser par le bord opposé", () => {
    const state: ViewportState = { scale: 1, offsetX: -99999, offsetY: -99999 };
    const clamped = clampOffset(state, PHOTO, VIEW);
    expect(clamped.offsetX).toBe(VIEW.width - PHOTO.width);
    expect(clamped.offsetY).toBe(VIEW.height - PHOTO.height);
  });
});

describe("fitViewport — état au repos", () => {
  it("ajuste et centre", () => {
    const vp = fitViewport(PHOTO, VIEW);
    expect(vp.scale).toBeCloseTo(USABLE.width / PHOTO.width, 10);
    expect(vp.offsetX).toBeCloseTo(FIT_MARGIN, 6);
    expect(vp.offsetY).toBeCloseTo((VIEW.height - PHOTO.height * vp.scale) / 2, 6);
  });

  it("laisse toute l'image dans la vue (contain, jamais cover)", () => {
    const vp = fitViewport(PHOTO, VIEW);
    expect(PHOTO.width * vp.scale).toBeLessThanOrEqual(VIEW.width + 1e-6);
    expect(PHOTO.height * vp.scale).toBeLessThanOrEqual(VIEW.height + 1e-6);
  });

  it("laisse une marge de respiration sur l'axe contraignant", () => {
    // Régression : sans marge, « ajuster » collait la photo aux bords haut et
    // bas en plein écran — une image entière qui se lit comme une image coupée.
    const vp = fitViewport(PHOTO, VIEW);
    expect(VIEW.width - PHOTO.width * vp.scale).toBeGreaterThanOrEqual(FIT_MARGIN * 2 - 1e-6);
  });
});

describe("viewToImage / imageToView — aller-retour", () => {
  it("sont réciproques", () => {
    const vp: ViewportState = { scale: 0.37, offsetX: -120, offsetY: 45 };
    const image = { x: 1234, y: 987 };
    const roundTrip = viewToImage(vp, imageToView(vp, image));
    expect(roundTrip.x).toBeCloseTo(image.x, 6);
    expect(roundTrip.y).toBeCloseTo(image.y, 6);
  });
});

describe("zoomAt — le point sous le curseur reste sous le curseur", () => {
  it("tient l'ancrage sur un zoom avant", () => {
    const before = fitViewport(PHOTO, VIEW);
    const anchor = { x: 640, y: 200 };
    const imageBefore = viewToImage(before, anchor);
    const after = zoomAt(before, anchor, before.scale * 3, PHOTO, VIEW);
    const viewAfter = imageToView(after, imageBefore);
    expect(viewAfter.x).toBeCloseTo(anchor.x, 6);
    expect(viewAfter.y).toBeCloseTo(anchor.y, 6);
  });

  it("tient l'ancrage même quand l'échelle demandée dépasse le plafond", () => {
    // Régression : reprojeter avec l'échelle DEMANDÉE au lieu de l'échelle
    // clampée faisait dériver l'image sous un curseur immobile dès qu'on
    // continuait à pousser la molette au plafond de zoom.
    const before = fitViewport(PHOTO, VIEW);
    const anchor = { x: 400, y: 300 };
    const imageBefore = viewToImage(before, anchor);
    const after = zoomAt(before, anchor, 1000, PHOTO, VIEW);
    expect(after.scale).toBe(MAX_ZOOM);
    const viewAfter = imageToView(after, imageBefore);
    expect(viewAfter.x).toBeCloseTo(anchor.x, 6);
    expect(viewAfter.y).toBeCloseTo(anchor.y, 6);
  });

  it("descend jusqu'au plancher, et l'image y est CENTRÉE et non ancrée", () => {
    // Ce témoin ne vérifie PAS l'ancrage, et c'est délibéré : sous
    // l'ajustement la photo est plus petite que la vue, régime dans lequel
    // `clampOffset` centre au lieu de borner (voir sa doc). Aucun point hors du
    // centre ne peut donc rester sous le curseur — l'exiger décrirait un
    // comportement que le module refuse par conception.
    const before = fitViewport(PHOTO, VIEW);
    const anchorHorsCentre = { x: 120, y: 90 };
    const after = zoomAt(before, anchorHorsCentre, 0.000001, PHOTO, VIEW);
    expect(after.scale).toBeCloseTo(fitScale(PHOTO, VIEW) / ZOOM_OUT_HEADROOM, 10);
    const centre = imageToView(after, { x: PHOTO.width / 2, y: PHOTO.height / 2 });
    expect(centre.x).toBeCloseTo(VIEW.width / 2, 6);
    expect(centre.y).toBeCloseTo(VIEW.height / 2, 6);
  });
});

describe("zoomByWheel — indépendance au découpage des évènements", () => {
  it("dix petits crans valent un gros cran", () => {
    const start = fitViewport(PHOTO, VIEW);
    const anchor = { x: 400, y: 300 };
    const oneBig = zoomByWheel(start, anchor, -500, PHOTO, VIEW);
    let stepwise = start;
    for (let i = 0; i < 10; i += 1) stepwise = zoomByWheel(stepwise, anchor, -50, PHOTO, VIEW);
    expect(stepwise.scale).toBeCloseTo(oneBig.scale, 6);
  });

  it("un deltaY positif dézoome (convention DOM)", () => {
    const start = zoomAt(fitViewport(PHOTO, VIEW), { x: 400, y: 300 }, 0.5, PHOTO, VIEW);
    const after = zoomByWheel(start, { x: 400, y: 300 }, 100, PHOTO, VIEW);
    expect(after.scale).toBeLessThan(start.scale);
  });
});

describe("zoomByFactor / zoomToActualSize", () => {
  it("le pas des boutons applique le facteur documenté", () => {
    const start = zoomAt(fitViewport(PHOTO, VIEW), { x: 400, y: 300 }, 0.4, PHOTO, VIEW);
    const after = zoomByFactor(start, { x: 400, y: 300 }, ZOOM_STEP_FACTOR, PHOTO, VIEW);
    expect(after.scale).toBeCloseTo(0.4 * ZOOM_STEP_FACTOR, 6);
  });

  it("zoomToActualSize atteint exactement 100 %", () => {
    const after = zoomToActualSize(fitViewport(PHOTO, VIEW), PHOTO, VIEW);
    expect(after.scale).toBe(1);
    expect(zoomPercent(after)).toBe(100);
  });
});

describe("panBy", () => {
  it("déplace puis reborne", () => {
    const zoomed = zoomToActualSize(fitViewport(PHOTO, VIEW), PHOTO, VIEW);
    const moved = panBy(zoomed, 40, 0, PHOTO, VIEW);
    // Le contenu débordait à droite et à gauche : un déplacement vers la
    // droite est absorbé jusqu'à ce que le bord gauche touche la vue.
    expect(moved.offsetX).toBeLessThanOrEqual(0);
    expect(moved.offsetX).toBeGreaterThanOrEqual(VIEW.width - PHOTO.width);
  });

  it("ne bouge pas sur un axe où le contenu tient dans la vue", () => {
    const fitted = fitViewport(PHOTO, VIEW);
    const moved = panBy(fitted, 0, 200, PHOTO, VIEW);
    expect(moved.offsetY).toBeCloseTo(fitted.offsetY, 6);
  });
});

describe("reconcileViewport — redimensionnement de la vue", () => {
  const WIDER = { width: 1000, height: 600 };

  it("conserve l'échelle quand elle reste dans les bornes", () => {
    const zoomed = zoomAt(fitViewport(PHOTO, VIEW), { x: 400, y: 300 }, 0.5, PHOTO, VIEW);
    const after = reconcileViewport(zoomed, PHOTO, VIEW, WIDER);
    expect(after.scale).toBeCloseTo(0.5, 10);
  });

  it("conserve le point regardé au centre, pas le coin haut-gauche", () => {
    const zoomed = zoomAt(fitViewport(PHOTO, VIEW), { x: 400, y: 300 }, 0.5, PHOTO, VIEW);
    const centerBefore = viewToImage(zoomed, { x: VIEW.width / 2, y: VIEW.height / 2 });
    const after = reconcileViewport(zoomed, PHOTO, VIEW, WIDER);
    const centerAfter = viewToImage(after, { x: WIDER.width / 2, y: WIDER.height / 2 });
    expect(centerAfter.x).toBeCloseTo(centerBefore.x, 4);
    expect(centerAfter.y).toBeCloseTo(centerBefore.y, 4);
  });

  it("remonte l'échelle au plancher quand la vue grandit au point de le dépasser", () => {
    // Vue devenue si grande que l'ancien ajustement est sous le nouveau
    // plancher : l'échelle doit suivre au lieu de rester hors bornes.
    const small = { width: 200, height: 150 };
    const big = { width: 3000, height: 2000 };
    const fitted = fitViewport(PHOTO, small);
    const after = reconcileViewport(fitted, PHOTO, small, big);
    expect(after.scale).toBeGreaterThan(fitted.scale);
    expect(after.scale).toBeCloseTo(clampScale(after.scale, PHOTO, big), 10);
  });

  it("retombe sur l'ajustement quand une taille est dégénérée", () => {
    const zoomed = zoomToActualSize(fitViewport(PHOTO, VIEW), PHOTO, VIEW);
    expect(reconcileViewport(zoomed, { width: 0, height: 0 }, VIEW, VIEW)).toEqual(
      fitViewport({ width: 0, height: 0 }, VIEW),
    );
    // Vue précédente dégénérée (premier montage, conteneur pas encore mesuré) :
    // il n'y a aucun « avant » à conserver, l'ajustement est le seul état sensé.
    expect(reconcileViewport(zoomed, PHOTO, { width: 0, height: 0 }, VIEW)).toEqual(fitViewport(PHOTO, VIEW));
  });
});

describe("isPannable", () => {
  it("est faux à l'ajustement (rien à explorer)", () => {
    expect(isPannable(fitViewport(PHOTO, VIEW), PHOTO, VIEW)).toBe(false);
  });

  it("est vrai dès que le contenu déborde", () => {
    expect(isPannable(zoomToActualSize(fitViewport(PHOTO, VIEW), PHOTO, VIEW), PHOTO, VIEW)).toBe(true);
  });
});
