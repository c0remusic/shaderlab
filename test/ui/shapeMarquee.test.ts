import { describe, expect, it } from "vitest";
import { planShapeGesture, applyShapeMarquee } from "../../src/ui/shapeMarquee";
import type { ShapeBox } from "../../src/ui/shapeDraw";
import {
  createBrushSource,
  createParametricSource,
  defaultLayerMask,
  type LayerMask,
  type MaskSource,
} from "../../src/mask/types";
import type { LayerState } from "../../src/layers/types";

/**
 * OUTIL FORME → SÉLECTION GÉOMÉTRIQUE (ticket 12). Deux règles pures : ce que le
 * tracé PRODUIT selon le calque (`planShapeGesture`) et la pose de la source sur
 * le masque (`applyShapeMarquee`). Le câblage vivant vit dans `App`, se regarde à
 * l'écran ; ces deux-là se testent en Node.
 */

function layer(over: Partial<LayerState> & { mask?: LayerMask }): LayerState {
  return {
    id: "L",
    effectId: "glow",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: over.mask ?? defaultLayerMask(),
    ...over,
  };
}

function maskWith(sources: MaskSource[]): LayerMask {
  return { ...defaultLayerMask(), sources };
}

describe("planShapeGesture — ce que le tracé vise", () => {
  it("rien de sélectionné → aplat (nouveau calque, comportement d'avant)", () => {
    expect(planShapeGesture(null)).toBe("aplat");
    expect(planShapeGesture(undefined)).toBe("aplat");
  });

  it("calque d'effet sélectionné → marquee sur son masque", () => {
    expect(planShapeGesture(layer({}))).toBe("marquee");
  });

  it("calque PHOTO sélectionné → aplat, pas marquee (un effet ne s'y pose pas, ADR-0008)", () => {
    expect(planShapeGesture(layer({ imageSource: { sourceId: "s1" } }))).toBe("aplat");
  });

  it("masque VERROUILLÉ → refused (ni marquee ni aplat)", () => {
    expect(planShapeGesture(layer({ locks: { mask: true } }))).toBe("refused");
  });

  it("verrou TOUT → refused (il implique le verrou de masque)", () => {
    expect(planShapeGesture(layer({ locks: { all: true } }))).toBe("refused");
  });

  it("verrou de POSITION seul n'empêche PAS le marquee — il ne gèle que la géométrie, pas le masque", () => {
    // Le marquee écrit une source de masque ; seul `mask`/`all` la refuse. Un
    // verrou de position gèle les poignées, pas ce que le calque couvre.
    expect(planShapeGesture(layer({ locks: { position: true } }))).toBe("marquee");
  });
});

const BOX: ShapeBox = { x0: 0.2, y0: 0.3, x1: 0.7, y1: 0.8 };

describe("applyShapeMarquee — pose de la source shape", () => {
  const shapeDefaults = { x0: 0.25, y0: 0.3, x1: 0.75, y1: 0.7, feather: 0.05, invert: 0, mode: 0 };

  it("ajoute une source shape neuve quand le masque n'en a aucune, avec les défauts + la boîte", () => {
    const out = applyShapeMarquee([], BOX, shapeDefaults, "src-9");
    expect(out).toHaveLength(1);
    const src = out[0];
    expect(src.id).toBe("src-9");
    expect(src.type).toBe("shape");
    expect(src.combineMode).toBe("add");
    expect(src.enabled).toBe(true);
    // Défauts conservés (feather/invert/mode), boîte du geste écrasant les coins.
    expect(src.params).toEqual({ x0: 0.2, y0: 0.3, x1: 0.7, y1: 0.8, feather: 0.05, invert: 0, mode: 0 });
  });

  it("sérialise les clés dans l'ORDRE du contrat (x0,y0,x1,y1,feather,invert,mode)", () => {
    // L'ordre EST le contrat wgsl (maskTextureResolver sérialise Object.keys).
    const out = applyShapeMarquee([], BOX, shapeDefaults, "src-9");
    expect(Object.keys(out[0].params ?? {})).toEqual(["x0", "y0", "x1", "y1", "feather", "invert", "mode"]);
  });

  it("met à jour la PREMIÈRE source shape existante — le marquee REDESSINE, il n'empile pas", () => {
    const existing = createParametricSource("keep-me", "shape", { x0: 0, y0: 0, x1: 1, y1: 1, feather: 0.2, invert: 1, mode: 1 });
    const out = applyShapeMarquee([existing], BOX, shapeDefaults, "unused");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("keep-me"); // même source, pas une neuve
    // La boîte est remplacée, le RESTE (feather/invert/mode réglés à la main) survit.
    expect(out[0].params).toEqual({ x0: 0.2, y0: 0.3, x1: 0.7, y1: 0.8, feather: 0.2, invert: 1, mode: 1 });
  });

  it("ne touche aucune AUTRE source (pinceau, dégradé) et garde leur ordre", () => {
    const brush = createBrushSource("b", new Uint8Array([1, 2, 3]));
    const grad = createParametricSource("g", "gradient", { angle: 0 });
    const out = applyShapeMarquee([brush, grad], BOX, shapeDefaults, "src-new");
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(brush); // référence inchangée
    expect(out[1]).toBe(grad);
    expect(out[2].id).toBe("src-new");
    expect(out[2].type).toBe("shape");
  });

  it("met à jour la shape même quand elle n'est pas en tête, sans déplacer les autres", () => {
    const grad = createParametricSource("g", "gradient", { angle: 0 });
    const shape = createParametricSource("sh", "shape", { x0: 0, y0: 0, x1: 1, y1: 1, feather: 0.05, invert: 0, mode: 0 });
    const out = applyShapeMarquee([grad, shape], BOX, shapeDefaults, "unused");
    expect(out[0]).toBe(grad);
    expect(out[1].id).toBe("sh");
    expect(out[1].params).toMatchObject({ x0: 0.2, y0: 0.3, x1: 0.7, y1: 0.8 });
  });
});
