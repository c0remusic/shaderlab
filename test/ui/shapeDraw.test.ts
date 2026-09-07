import { describe, expect, it } from "vitest";
import {
  MIN_DRAW_SIZE_PX,
  aplatParamsFromRect,
  shapeBoxFromRect,
  isDrawnRectUsable,
  rectFromDrag,
} from "../../src/ui/shapeDraw";

describe("rectFromDrag — le rectangle du geste", () => {
  it("rend le rectangle attendu quand on tire vers le bas-droite", () => {
    expect(rectFromDrag({ x: 10, y: 20 }, { x: 110, y: 70 })).toEqual({
      x: 10, y: 20, width: 100, height: 50,
    });
  });

  it("NORMALISE un geste vers le haut-gauche au lieu de rendre des tailles négatives", () => {
    // C'est la moitié du travail de cette fonction. Sans elle, tirer vers le
    // haut rendrait `height: -50`, et tout ce qui suit — couverture, poignées,
    // sérialisation — devrait s'en défendre séparément.
    expect(rectFromDrag({ x: 110, y: 70 }, { x: 10, y: 20 })).toEqual({
      x: 10, y: 20, width: 100, height: 50,
    });
  });

  it("contraint au CARRÉ sur le plus GRAND côté, pas le plus petit", () => {
    // Convention de Photoshop, Figma et Illustrator : le carré ENGLOBE le
    // geste. Prendre le plus petit côté ferait rétrécir la forme sous le
    // curseur pendant qu'on l'agrandit.
    const r = rectFromDrag({ x: 0, y: 0 }, { x: 100, y: 30 }, true);
    expect(r).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("fait grandir le carré DANS LA DIRECTION du geste, pas vers le bas-droite", () => {
    // Le signe est préservé : tirer vers le haut-gauche depuis l'origine doit
    // poser le carré en haut à gauche. Un `Math.abs` appliqué trop tôt le
    // collerait en bas à droite, et la forme sauterait sous le curseur au
    // moment où Maj est pressée.
    const r = rectFromDrag({ x: 200, y: 200 }, { x: 100, y: 170 }, true);
    expect(r).toEqual({ x: 100, y: 100, width: 100, height: 100 });
  });

  it("rend un rectangle vide pour un clic sans mouvement", () => {
    expect(rectFromDrag({ x: 50, y: 50 }, { x: 50, y: 50 })).toEqual({
      x: 50, y: 50, width: 0, height: 0,
    });
  });
});

describe("isDrawnRectUsable — le seuil qui empêche un clic de créer un calque", () => {
  it("refuse un clic simple", () => {
    expect(isDrawnRectUsable({ x: 0, y: 0, width: 0, height: 0 })).toBe(false);
  });

  it("refuse un geste qui n'a d'ampleur que sur UN axe", () => {
    // Un trait horizontal de 200 px mais haut de 2 px n'est pas un rectangle
    // qu'on voulait — c'est un tremblement pendant un clic. Les deux côtés
    // doivent passer le seuil, pas leur aire ni leur diagonale.
    expect(isDrawnRectUsable({ x: 0, y: 0, width: 200, height: 2 })).toBe(false);
  });

  it("accepte tout juste au seuil", () => {
    expect(
      isDrawnRectUsable({ x: 0, y: 0, width: MIN_DRAW_SIZE_PX, height: MIN_DRAW_SIZE_PX }),
    ).toBe(true);
  });
});

describe("aplatParamsFromRect — la traduction en paramètres d'effet", () => {
  const TOILE = { width: 1000, height: 500 };

  it("rend le centre en UV et les tailles en FRACTION du côté correspondant", () => {
    // ⚠️ Les deux unités diffèrent, et c'est le piège que ce test verrouille :
    // le centre est en UV du cadre, la largeur en fraction de la LARGEUR. Un
    // rectangle qui couvre la moitié de la largeur donne `largeur: 0.5`, pas
    // `0.25` — le shader d'`aplat` redivise par deux de son côté.
    expect(aplatParamsFromRect({ x: 250, y: 125, width: 500, height: 250 }, TOILE)).toEqual({
      centreX: 0.5,
      centreY: 0.5,
      largeur: 0.5,
      hauteur: 0.5,
    });
  });

  it("place le centre au MILIEU du rectangle, pas à son coin", () => {
    expect(aplatParamsFromRect({ x: 0, y: 0, width: 200, height: 100 }, TOILE)).toEqual({
      centreX: 0.1,
      centreY: 0.1,
      largeur: 0.2,
      hauteur: 0.2,
    });
  });

  it("rend null sur une toile dégénérée au lieu de paramètres NaN", () => {
    // Sans cette garde, la division produirait des NaN que `updateParams`
    // écrirait tels quels : un calque dont la forme n'est plus exprimable et
    // qui ne se répare qu'en le supprimant.
    expect(aplatParamsFromRect({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 500 })).toBeNull();
    expect(aplatParamsFromRect({ x: 0, y: 0, width: 10, height: 10 }, { width: 1000, height: 0 })).toBeNull();
  });
});

describe("shapeBoxFromRect — la boîte d'une source de masque shape", () => {
  const TOILE = { width: 1000, height: 500 };

  it("rend les DEUX COINS en coordonnées image [0,1], pas un centre + demi-dimensions", () => {
    // ⚠️ Unité différente d'`aplatParamsFromRect` : `shape` sérialise x0,y0,x1,y1
    // (les coins), le shader en prend min/max. C'est ce que la boîte à deux
    // coins de `mask/sources/shape.ts` attend, sans conversion.
    expect(shapeBoxFromRect({ x: 250, y: 125, width: 500, height: 250 }, TOILE)).toEqual({
      x0: 0.25,
      y0: 0.25,
      x1: 0.75,
      y1: 0.75,
    });
  });

  it("place les coins aux bords du rectangle tracé", () => {
    expect(shapeBoxFromRect({ x: 0, y: 0, width: 200, height: 100 }, TOILE)).toEqual({
      x0: 0,
      y0: 0,
      x1: 0.2,
      y1: 0.2,
    });
  });

  it("rend null sur une toile dégénérée au lieu de coordonnées NaN", () => {
    expect(shapeBoxFromRect({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 500 })).toBeNull();
    expect(shapeBoxFromRect({ x: 0, y: 0, width: 10, height: 10 }, { width: 1000, height: 0 })).toBeNull();
  });
});
