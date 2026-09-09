import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";
import { defaultLayerMask } from "../../src/mask/types";
import type { LayerState } from "../../src/layers/types";
import { MAX_PHOTO_LAYERS } from "../../src/layers/photoLayer";
import {
  flattenComposite,
  stampVerdict,
  mergeDownVerdict,
  mergeDownPlan,
  photoCapMessage,
} from "../../src/layers/flatten";

const TRANSFORM = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };

/** Pile réaliste : un fond photo en bas (`layers[0]`), puis des effets. */
function documentStack(): LayerStack {
  const stack = new LayerStack();
  stack.addPhotoLayer("photo-fond", TRANSFORM, "IMG.jpg"); // layers[0] = fond
  stack.addLayer("glow"); // layers[1]
  stack.addLayer("grain"); // layers[2]
  return stack;
}

function photoLayer(id: string, sourceId: string): LayerState {
  return {
    id,
    effectId: "passthrough",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
    imageSource: { sourceId },
    transform: TRANSFORM,
  };
}

describe("flattenComposite", () => {
  it("rend le fond jusqu'au sélectionné INCLUS (sens de pile ADR-0004)", () => {
    const stack = documentStack();
    const [fond, glow, grain] = stack.layers;
    // Sélection au milieu : fond + glow, pas grain (au-dessus).
    expect(flattenComposite(stack.layers, glow.id)?.map((l) => l.id)).toEqual([fond.id, glow.id]);
    // Sélection en haut : toute la pile.
    expect(flattenComposite(stack.layers, grain.id)?.map((l) => l.id)).toEqual([fond.id, glow.id, grain.id]);
    // Sélection au fond : le fond seul (Tampon d'une photo = elle-même).
    expect(flattenComposite(stack.layers, fond.id)?.map((l) => l.id)).toEqual([fond.id]);
  });

  it("null sur une sélection absente, périmée ou nulle — jamais une exception", () => {
    const stack = documentStack();
    expect(flattenComposite(stack.layers, null)).toBeNull();
    expect(flattenComposite(stack.layers, "layer-inexistant")).toBeNull();
    expect(flattenComposite([], "x")).toBeNull();
  });
});

describe("stampVerdict", () => {
  it("permis sur un calque sélectionné, photo comprise", () => {
    const stack = documentStack();
    expect(stampVerdict(stack.layers, stack.layers[1].id)).toEqual({ ok: true });
    // Sur le calque PHOTO de fond : permis (composite jusqu'à lui = lui-même).
    expect(stampVerdict(stack.layers, stack.layers[0].id)).toEqual({ ok: true });
  });

  it("refusé sans sélection", () => {
    const stack = documentStack();
    expect(stampVerdict(stack.layers, null)).toEqual({ ok: false, reason: "Sélectionne un calque à aplatir." });
  });

  it("refusé au plafond de calques photo, avec la raison exacte", () => {
    const stack = new LayerStack();
    for (let i = 0; i < MAX_PHOTO_LAYERS; i += 1) stack.addPhotoLayer(`photo-${i}`, TRANSFORM);
    const verdict = stampVerdict(stack.layers, stack.layers[0].id);
    expect(verdict).toEqual({ ok: false, reason: photoCapMessage("le Tampon") });
  });

  it("un calque VERROUILLÉ reste tamponnable (il est lu, pas muté)", () => {
    const stack = documentStack();
    stack.setLayerLock(stack.layers[1].id, "all", true);
    expect(stampVerdict(stack.layers, stack.layers[1].id)).toEqual({ ok: true });
  });
});

describe("mergeDownVerdict", () => {
  it("permis quand il y a un dessous et aucun verrou dans le lot", () => {
    const stack = documentStack();
    expect(mergeDownVerdict(stack.layers, stack.layers[1].id)).toEqual({ ok: true });
    expect(mergeDownVerdict(stack.layers, stack.layers[2].id)).toEqual({ ok: true });
  });

  it("refusé sans sélection", () => {
    const stack = documentStack();
    expect(mergeDownVerdict(stack.layers, null)).toEqual({ ok: false, reason: "Sélectionne un calque à fusionner." });
  });

  it("refusé sur le calque du fond (rien en dessous)", () => {
    const stack = documentStack();
    expect(mergeDownVerdict(stack.layers, stack.layers[0].id)).toEqual({
      ok: false,
      reason: "Rien en dessous : ce calque est déjà au bas de la pile.",
    });
  });

  it("refusé si un calque du lot est entièrement verrouillé", () => {
    const stack = documentStack();
    // Verrou « Tout » sur le fond, sélection au-dessus : le fond est DANS le lot.
    stack.setLayerLock(stack.layers[0].id, "all", true);
    expect(mergeDownVerdict(stack.layers, stack.layers[2].id)).toEqual({
      ok: false,
      reason: "Un calque du lot est verrouillé (Tout) : déverrouille-le pour fusionner.",
    });
  });

  it("un verrou PARTIEL (position/masque) n'empêche pas la fusion — seul « Tout » supprime", () => {
    const stack = documentStack();
    stack.setLayerLock(stack.layers[0].id, "position", true);
    expect(mergeDownVerdict(stack.layers, stack.layers[2].id)).toEqual({ ok: true });
  });

  it("refusé si le plafond photo serait dépassé APRÈS retrait", () => {
    // Cas construit à la main : MAX photos AU-DESSUS du sélectionné, plus le lot.
    const above: LayerState[] = [];
    for (let i = 0; i < MAX_PHOTO_LAYERS; i += 1) above.push(photoLayer(`haut-${i}`, `s-${i}`));
    const layers: LayerState[] = [
      { id: "bas", effectId: "glow", params: {}, enabled: true, opacity: 1, blendMode: "normal", mask: defaultLayerMask() },
      { id: "sel", effectId: "grain", params: {}, enabled: true, opacity: 1, blendMode: "normal", mask: defaultLayerMask() },
      ...above,
    ];
    expect(mergeDownVerdict(layers, "sel")).toEqual({ ok: false, reason: photoCapMessage("la fusion") });
  });
});

describe("mergeDownPlan", () => {
  it("rend le composite (fond → sélectionné) et les ids à retirer = le lot", () => {
    const stack = documentStack();
    const [fond, glow, grain] = stack.layers;
    const plan = mergeDownPlan(stack.layers, glow.id);
    expect(plan?.composite.map((l) => l.id)).toEqual([fond.id, glow.id]);
    expect(plan?.removedIds).toEqual([fond.id, glow.id]);
    // grain (au-dessus) n'est ni composité ni retiré.
    expect(plan?.removedIds).not.toContain(grain.id);
  });

  it("null quand la fusion n'est pas permise (même verdict)", () => {
    const stack = documentStack();
    expect(mergeDownPlan(stack.layers, stack.layers[0].id)).toBeNull(); // fond : rien en dessous
    expect(mergeDownPlan(stack.layers, null)).toBeNull();
  });
});
