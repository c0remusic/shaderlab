import { describe, expect, it } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";
import { DocumentSession } from "../../src/application/documentSession";
import { MaskPainter } from "../../src/mask/maskPainter";
import {
  hasAnyLock,
  isFullyLocked,
  isMaskLocked,
  isPartiallyLocked,
  isPositionLocked,
  isStructureLocked,
  isTransparencyLocked,
  withLock,
} from "../../src/layers/layerLocks";

/**
 * LES QUATRE VERROUS (2026-08-19, modèle Photoshop).
 *
 * Ce que ces cas gardent, et que rien d'autre ne peut voir : **un verrou
 * partiel qui ne verrouille pas ressemble exactement à un verrou**. Le défaut
 * du 2026-08-18 — quatorze gardes posées sur des mutateurs qu'aucun geste vivant
 * n'emprunte — n'a été trouvé qu'en cherchant la PORTE, pas en relisant les
 * gardes. Chaque verrou est donc éprouvé sur les DEUX chemins : le mutateur, et
 * `replaceLiveLayers`.
 *
 * Témoin de discrimination présent partout : chaque cas vérifie AUSSI ce que le
 * verrou doit LAISSER passer. Un verrou qui bloque tout passerait tous les tests
 * de refus tout en détruisant le geste qu'il existe pour permettre.
 */

/** Les paramètres spatiaux d'un aplat, tels qu'un `canvasControls` les cite. */
const GEOMETRIE = ["centreX", "centreY", "largeur", "hauteur", "rotation"] as const;

function pileAvecAplat() {
  const stack = new LayerStack();
  const id = stack.addLayer("aplat");
  stack.updateParams(id, { centreX: 0.5, largeur: 0.4, teinte: 200 });
  return { stack, id };
}

describe("layerLocks — la lecture d'état", () => {
  it("« Tout » implique les trois autres", () => {
    const layer = { locks: { all: true } };
    expect(isFullyLocked(layer)).toBe(true);
    expect(isPositionLocked(layer)).toBe(true);
    expect(isMaskLocked(layer)).toBe(true);
    expect(isTransparencyLocked(layer)).toBe(true);
  });

  it("un verrou partiel n'implique PAS les autres", () => {
    const layer = { locks: { position: true } };
    expect(isPositionLocked(layer)).toBe(true);
    // Témoin : c'est CE qui rend un verrou partiel utile. S'il impliquait les
    // autres, quatre boutons ne vaudraient qu'un seul.
    expect(isMaskLocked(layer)).toBe(false);
    expect(isFullyLocked(layer)).toBe(false);
  });

  it("le verrou du MASQUE implique celui de la transparence, jamais l'inverse", () => {
    // Ne plus pouvoir toucher au masque du tout couvre a fortiori ne plus
    // pouvoir l'étendre.
    expect(isTransparencyLocked({ locks: { mask: true } })).toBe(true);
    expect(isMaskLocked({ locks: { transparency: true } })).toBe(false);
  });

  it("distingue « partiellement » de « entièrement » — c'est ce que la ligne rend", () => {
    expect(isPartiallyLocked({ locks: { position: true } })).toBe(true);
    expect(isPartiallyLocked({ locks: { all: true } })).toBe(false);
    expect(isPartiallyLocked({ locks: {} })).toBe(false);
    expect(hasAnyLock({ locks: {} })).toBe(false);
  });

  it("`withLock` rend null sur un no-op, pour que l'historique ne se remplisse pas de rien", () => {
    expect(withLock({ position: true }, "position", true)).toBeNull();
    expect(withLock(undefined, "position", false)).toBeNull();
    expect(withLock(undefined, "position", true)).toEqual({ position: true });
  });

  it("poser « Tout » n'écrase PAS les verrous partiels déjà là", () => {
    // Comportement d'Adobe : relâcher « Lock All » rend au calque ce qu'il
    // avait avant. Les écraser les perdrait sans que rien ne le dise.
    const avec = withLock({ position: true }, "all", true);
    expect(avec).toEqual({ position: true, all: true });
    expect(withLock(avec!, "all", false)).toEqual({ position: true });
  });
});

describe("verrou POSITION — la géométrie gelée, le reste vivant", () => {
  it("refuse les paramètres spatiaux et LAISSE PASSER les autres", () => {
    const { stack, id } = pileAvecAplat();
    stack.setLayerLock(id, "position", true);

    stack.updateParams(id, { centreX: 0.9, teinte: 42 }, GEOMETRIE);
    const layer = stack.layers.find((l) => l.id === id)!;
    expect(layer.params.centreX).toBe(0.5);
    // LE TÉMOIN, et c'est tout l'enjeu du verrou : « je tiens le placement, je
    // cherche encore la couleur ».
    expect(layer.params.teinte).toBe(42);
  });

  it("refuse TOUT quand l'appelant ne déclare pas ses paramètres spatiaux", () => {
    // Un no-op visible vaut mieux qu'un verrou qui laisse passer parce que
    // personne n'a rien déclaré.
    const { stack, id } = pileAvecAplat();
    stack.setLayerLock(id, "position", true);
    expect(stack.updateParams(id, { teinte: 42 })).toBe(false);
  });

  it("ne refuse RIEN sur un calque libre", () => {
    const { stack, id } = pileAvecAplat();
    expect(stack.updateParams(id, { centreX: 0.9 }, GEOMETRIE)).toBe(true);
    expect(stack.layers.find((l) => l.id === id)!.params.centreX).toBe(0.9);
  });

  it("tient AUSSI sur le chemin vivant, la porte que les gardes ne couvraient pas", () => {
    const { stack, id } = pileAvecAplat();
    stack.setLayerLock(id, "position", true);
    const session = new DocumentSession(stack);

    session.replaceLiveLayers(
      session.layers().map((l) => ({ ...l, params: { ...l.params, centreX: 0.9, teinte: 42 } })),
      new Map([[id, GEOMETRIE]]),
    );

    const layer = session.layers().find((l) => l.id === id)!;
    expect(layer.params.centreX).toBe(0.5);
    expect(layer.params.teinte).toBe(42);
  });

  it("gèle le TRANSFORM d'un calque photo sur le chemin vivant", () => {
    const stack = new LayerStack();
    const id = stack.addPhotoLayer("src-1", { x: 10, y: 10, scaleX: 1, scaleY: 1, rotation: 0 });
    stack.setLayerLock(id, "position", true);
    const session = new DocumentSession(stack);

    session.replaceLiveLayers(
      session.layers().map((l) => ({ ...l, transform: { x: 999, y: 999, scaleX: 2, scaleY: 2, rotation: 1 } })),
    );

    expect(session.layers().find((l) => l.id === id)!.transform!.x).toBe(10);
  });
});

describe("verrou MASQUE — ce que le calque couvre", () => {
  it("refuse le pinceau et la famille masque, et laisse passer les paramètres", () => {
    const { stack, id } = pileAvecAplat();
    stack.setLayerLock(id, "mask", true);

    expect(stack.updateBrushMask(id, new Uint8Array(4))).toBe(false);
    expect(stack.setMaskEnabled(id, false)).toBe(false);
    // Témoin : le masque est gelé, l'effet reste réglable.
    expect(stack.updateParams(id, { teinte: 42 }, GEOMETRIE)).toBe(true);
  });

  it("ne gèle PAS la géométrie", () => {
    const { stack, id } = pileAvecAplat();
    stack.setLayerLock(id, "mask", true);
    expect(stack.updateParams(id, { centreX: 0.9 }, GEOMETRIE)).toBe(true);
    expect(stack.layers.find((l) => l.id === id)!.params.centreX).toBe(0.9);
  });
});

describe("verrou TRANSPARENCE — il ÉCRÊTE, il ne refuse pas", () => {
  /** Un masque 4×1 dont seul le texel 1 est couvert. */
  function peintreAvecTrou(): MaskPainter {
    const painter = new MaskPainter(4, 1);
    const donnees = new Uint8Array([0, 255, 0, 0]);
    painter.loadFrom(donnees);
    return painter;
  }

  const PINCEAU = { radius: 4, hardness: 1, erase: false, opacity: 1, flow: 1 };

  it("laisse peindre DEDANS et refuse d'ÉTENDRE", () => {
    const painter = peintreAvecTrou();
    painter.setTransparencyLocked(true);
    painter.beginStroke();
    painter.paintStroke(2, 0, PINCEAU);

    const apres = painter.getMaskData();
    // Le texel déjà couvert reste couvert — affiner est autorisé.
    expect(apres[1]).toBe(255);
    // Les texels à zéro le restent : c'est le verrou.
    expect([apres[0], apres[2], apres[3]]).toEqual([0, 0, 0]);
  });

  it("TÉMOIN — sans le verrou, le même trait étend le masque", () => {
    // Sans ce cas, un écrêtage de valeur qui ne marcherait pas et un pinceau
    // qui n'atteint pas la zone auraient exactement la même tête.
    const painter = peintreAvecTrou();
    painter.setTransparencyLocked(false);
    painter.beginStroke();
    painter.paintStroke(2, 0, PINCEAU);

    const apres = painter.getMaskData();
    expect(apres[0]).toBeGreaterThan(0);
    expect(apres[2]).toBeGreaterThan(0);
  });

  it("le texel de référence est celui d'AVANT le trait, pas l'état courant", () => {
    // Sinon le premier tampon élargirait le masque d'un cheveu et le suivant
    // prendrait ce cheveu pour de la matière : le masque déborderait de proche
    // en proche. Deux tampons successifs dans le même trait ne doivent rien
    // gagner.
    const painter = peintreAvecTrou();
    painter.setTransparencyLocked(true);
    painter.beginStroke();
    painter.paintStroke(1, 0, PINCEAU);
    painter.paintStroke(2, 0, PINCEAU);
    expect([...painter.getMaskData()]).toEqual([0, 255, 0, 0]);
  });
});

describe("verrou TOUT — la structure", () => {
  it("refuse effet, ordre et suppression", () => {
    const stack = new LayerStack();
    const a = stack.addLayer("glow");
    const b = stack.addLayer("grain");
    stack.setLayerLock(b, "all", true);

    expect(stack.setLayerEffect(b, "warp")).toBe(false);
    expect(stack.removeLayer(b)).toBe(false);
    expect(stack.reorderLayer(b, 0)).toBe(false);
    // Témoin : le calque libre, lui, accepte tout.
    expect(stack.setLayerEffect(a, "warp")).toBe(true);
  });

  it("un verrou PARTIEL ne refuse AUCUNE opération de structure", () => {
    // Le point qui distingue quatre verrous d'un seul : `isStructureLocked`
    // n'est vrai que pour « Tout ».
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.setLayerLock(id, "position", true);
    expect(isStructureLocked(stack.layers[0])).toBe(false);
    expect(stack.setLayerEffect(id, "warp")).toBe(true);
  });

  it("le DÉVERROUILLAGE reste possible — un verrou irréversible est hostile", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.setLayerLock(id, "all", true);
    expect(stack.setLayerLock(id, "all", false)).toBe(true);
    expect(hasAnyLock(stack.layers[0])).toBe(false);
  });

  it("la VISIBILITÉ reste possible — masquer n'est pas modifier", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.setLayerLock(id, "all", true);
    expect(stack.toggleLayer(id)).toBe(true);
  });
});
