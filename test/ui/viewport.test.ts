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
  it("NE recentre PLUS une image qui tient dans la vue", () => {
    // Régime retiré le 2026-08-01. C'est lui qui rendait le geste de
    // déplacement inopérant au zoom d'ajustement — donc au zoom par défaut,
    // donc à peu près toujours — sans que rien ne le signale.
    const scale = fitScale(PHOTO, VIEW);
    const pousse: ViewportState = { scale, offsetX: 0, offsetY: 0 };
    const clamped = clampOffset(pousse, PHOTO, VIEW);
    expect(clamped.offsetX).toBe(0);
    expect(clamped.offsetY).toBe(0);
    // Et le centre n'est PAS un point fixe imposé : on peut s'en écarter.
    const ecarte = clampOffset({ scale, offsetX: 12, offsetY: 34 }, PHOTO, VIEW);
    expect(ecarte.offsetX).toBe(12);
    expect(ecarte.offsetY).toBe(34);
  });

  it("laisse pousser l'image bien au-delà des bords, dans les deux sens", () => {
    const state: ViewportState = { scale: 1, offsetX: 5000, offsetY: 5000 };
    const clamped = clampOffset(state, PHOTO, VIEW);
    // L'ancien clamp ramenait à 0 (bord collé au bord). Le nouveau autorise un
    // décalage positif : c'est exactement le geste « pousser l'image de côté
    // pour travailler contre le dock ».
    expect(clamped.offsetX).toBeGreaterThan(0);
    expect(clamped.offsetY).toBeGreaterThan(0);
  });

  it("garde TOUJOURS une prise visible — le MUST du PRD, et rien de plus", () => {
    // « Impossible de faire sortir l'image entièrement de la vue » : la borne
    // se calcule sur l'intersection réelle image ∩ vue, pas sur une croyance.
    const visible = (state: ViewportState, taille: Size, vue: Size) => {
      const c = clampOffset(state, taille, vue);
      const largeur = Math.min(vue.width, c.offsetX + taille.width * c.scale) - Math.max(0, c.offsetX);
      const hauteur = Math.min(vue.height, c.offsetY + taille.height * c.scale) - Math.max(0, c.offsetY);
      return { largeur, hauteur };
    };
    for (const scale of [fitScale(PHOTO, VIEW) / 4, fitScale(PHOTO, VIEW), 1, MAX_ZOOM]) {
      for (const signe of [-1, 1]) {
        const { largeur, hauteur } = visible({ scale, offsetX: signe * 1e6, offsetY: signe * 1e6 }, PHOTO, VIEW);
        expect(largeur).toBeGreaterThan(0);
        expect(hauteur).toBeGreaterThan(0);
      }
    }
  });

  it("immobilise une image plus petite que la prise minimale au lieu de l'exiger", () => {
    // Cas dégénéré réel : au dézoom maximal l'image peut être plus petite que
    // `FIT_MARGIN`. Exiger d'en garder autant visible qu'elle ne mesure serait
    // une contrainte insatisfiable — le clamp la garde alors entièrement dans
    // la vue plutôt que de produire des bornes croisées.
    const minuscule = { width: 20, height: 16 };
    const c = clampOffset({ scale: 1, offsetX: -1e6, offsetY: -1e6 }, minuscule, VIEW);
    expect(c.offsetX).toBe(0);
    expect(c.offsetY).toBe(0);
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

  it("tient l'ancrage JUSQU'AU PLANCHER de dézoom", () => {
    // Ce témoin disait l'inverse jusqu'au 2026-08-01 : sous l'ajustement,
    // `clampOffset` recentrait, donc aucun point hors du centre ne pouvait
    // rester sous le curseur, et le test l'avait acté comme une propriété
    // voulue. Le régime de centrage retiré, l'ancrage vaut maintenant à TOUTES
    // les échelles — le dézoom molette sur un coin y reste.
    const before = fitViewport(PHOTO, VIEW);
    const anchorHorsCentre = { x: 120, y: 90 };
    const imageBefore = viewToImage(before, anchorHorsCentre);
    const after = zoomAt(before, anchorHorsCentre, 0.000001, PHOTO, VIEW);
    expect(after.scale).toBeCloseTo(fitScale(PHOTO, VIEW) / ZOOM_OUT_HEADROOM, 10);
    const viewAfter = imageToView(after, imageBefore);
    expect(viewAfter.x).toBeCloseTo(anchorHorsCentre.x, 6);
    expect(viewAfter.y).toBeCloseTo(anchorHorsCentre.y, 6);
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
  it("suit le geste au pixel tant que la prise minimale est respectée", () => {
    const zoomed = zoomToActualSize(fitViewport(PHOTO, VIEW), PHOTO, VIEW);
    const moved = panBy(zoomed, 40, 0, PHOTO, VIEW);
    expect(moved.offsetX).toBeCloseTo(zoomed.offsetX + 40, 6);
  });

  it("bouge AUSSI sur un axe où le contenu tient dans la vue", () => {
    // Ce témoin affirmait l'inverse jusqu'au 2026-08-01 (« ne bouge pas »), et
    // il verrouillait donc précisément le défaut signalé à l'usage : au zoom
    // d'ajustement, l'axe non débordant était figé. Un test peut protéger un
    // bug quand il décrit le code au lieu de décrire l'intention.
    const fitted = fitViewport(PHOTO, VIEW);
    const moved = panBy(fitted, 0, 200, PHOTO, VIEW);
    expect(moved.offsetY).toBeCloseTo(fitted.offsetY + 200, 6);
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

describe("déplacement au zoom d'ajustement", () => {
  it("répond, alors que c'est précisément là qu'il ne faisait rien", () => {
    // LE témoin du défaut signalé le 2026-07-31 : « ça ne marche que quand on
    // est zoomé ». Au zoom d'ajustement l'image tient dans la vue, et l'ancien
    // régime de centrage écrasait tout déplacement.
    const ajuste = fitViewport(PHOTO, VIEW);
    const deplace = panBy(ajuste, -60, -30, PHOTO, VIEW);
    expect(deplace.offsetX).toBeCloseTo(ajuste.offsetX - 60, 6);
    expect(deplace.offsetY).toBeCloseTo(ajuste.offsetY - 30, 6);
  });

  it("un déplacement puis son inverse revient au point de départ", () => {
    // Propriété de RÉVERSIBILITÉ : sans elle, un geste tâtonnant dérive petit
    // à petit et l'image ne retrouve jamais sa place à la main.
    const ajuste = fitViewport(PHOTO, VIEW);
    const retour = panBy(panBy(ajuste, 120, 80, PHOTO, VIEW), -120, -80, PHOTO, VIEW);
    expect(retour.offsetX).toBeCloseTo(ajuste.offsetX, 6);
    expect(retour.offsetY).toBeCloseTo(ajuste.offsetY, 6);
  });
});
