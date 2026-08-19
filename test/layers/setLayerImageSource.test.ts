import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";
import type { LayerTransform } from "../../src/layers/types";

/**
 * REMPLACER L'IMAGE D'UN CALQUE PHOTO — tranche T2 du design
 * `docs/superpowers/specs/2026-07-28-shaderlab-fond-comme-calque-design.md`.
 *
 * Le contrat tenu ici : remplacer l'image ne détruit RIEN d'autre. La pile,
 * le masque, l'effet et ses params, l'opacité, le mode de fusion, le nom, la
 * position dans la pile et le placement (`transform`) survivent tous — seul
 * le `sourceId` change. Et le remplacement est ANNULABLE : le snapshot
 * d'historique pris avant garde l'ancienne source.
 */

const TRANSFORM: LayerTransform = { x: 100, y: 80, scaleX: 0.5, scaleY: 0.5, rotation: 0.25 };

function photoStack(): { stack: LayerStack; id: string } {
  const stack = new LayerStack();
  const id = stack.addPhotoLayer("photo-1", { ...TRANSFORM }, "plage.jpg");
  return { stack, id };
}

describe("setLayerImageSource", () => {
  it("remplace le sourceId d'un calque photo", () => {
    const { stack, id } = photoStack();
    expect(stack.setLayerImageSource(id, "photo-2")).toBe(true);
    expect(stack.layers[0].imageSource).toEqual({ sourceId: "photo-2" });
  });

  it("rend false sur un no-op (même source) — pas d'entrée d'historique vide", () => {
    const { stack, id } = photoStack();
    expect(stack.setLayerImageSource(id, "photo-1")).toBe(false);
  });

  it("rend false sur un id absent", () => {
    const { stack } = photoStack();
    expect(stack.setLayerImageSource("fantome", "photo-2")).toBe(false);
  });

  it("REFUSE un calque qui ne porte pas d'image (un effet n'a pas de source à remplacer)", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    expect(stack.setLayerImageSource(id, "photo-2")).toBe(false);
    expect(stack.layers[0].imageSource).toBeUndefined();
  });

  it("REFUSE un calque VERROUILLÉ, sans muter la source", () => {
    const { stack, id } = photoStack();
    expect(stack.setLayerLock(id, "all", true)).toBe(true);
    expect(stack.setLayerImageSource(id, "photo-2")).toBe(false);
    expect(stack.layers[0].imageSource).toEqual({ sourceId: "photo-1" });
  });

  it("conserve le placement TEL QUEL — la toile ne bouge pas, la nouvelle image s'y place", () => {
    const { stack, id } = photoStack();
    stack.setLayerImageSource(id, "photo-2");
    expect(stack.layers[0].transform).toEqual(TRANSFORM);
  });

  it("conserve effet, params, opacité, mode de fusion, nom et position dans la pile", () => {
    const stack = new LayerStack();
    const below = stack.addLayer("glow");
    const id = stack.addPhotoLayer("photo-1", { ...TRANSFORM }, "plage.jpg", below);
    stack.addLayer("grain", id);
    // Pas de `setLayerEffect` ici : un calque photo est TOUJOURS `passthrough`
    // depuis la décision du 2026-07-31 (un effet est un calque à part, écrêté),
    // et le mutateur le refuse désormais. C'est donc `passthrough` que le
    // remplacement d'image doit préserver.
    stack.updateParams(id, { amount: 0.7 });
    stack.layers[1].opacity = 0.4;
    stack.layers[1].blendMode = "multiply";

    expect(stack.setLayerImageSource(id, "photo-2")).toBe(true);

    const layer = stack.layers[1];
    expect(stack.layers.map((l) => l.id)).toEqual([below, id, stack.layers[2].id]);
    expect(layer.effectId).toBe("passthrough");
    expect(layer.params).toEqual({ amount: 0.7 });
    expect(layer.opacity).toBe(0.4);
    expect(layer.blendMode).toBe("multiply");
    expect(layer.name).toBe("plage.jpg");
  });

  it("le MASQUE survit intact — même raster, par référence (coordonnées document, la toile ne bouge pas)", () => {
    const { stack, id } = photoStack();
    stack.updateBrushMask(id, new Uint8Array([1, 2, 3, 4]));
    const maskBefore = stack.layers[0].mask;
    const rasterBefore = maskBefore.sources[0].raster;

    expect(stack.setLayerImageSource(id, "photo-2")).toBe(true);

    expect(stack.layers[0].mask.sources).toHaveLength(1);
    expect(stack.layers[0].mask.sources[0].raster).toBe(rasterBefore);
    expect(Array.from(stack.layers[0].mask.sources[0].raster!)).toEqual([1, 2, 3, 4]);
  });

  /**
   * TÉMOIN de la tranche. `LayerStack.clone()` copie chaque calque par
   * spread SHALLOW : `imageSource` est partagé PAR RÉFÉRENCE entre le calque
   * vivant et tous les snapshots d'historique (`layerStack.ts:505-519`,
   * contrairement à `duplicateLayer` qui, lui, le recopie). Écrire
   * `layer.imageSource.sourceId = …` au lieu de poser un OBJET FRAIS
   * réécrirait donc rétroactivement toutes les entrées d'historique : annuler
   * rendrait un calque parfaitement intact — masque, effets, nom, tout — mais
   * affichant la NOUVELLE image. Aucune exception, aucun test de structure ne
   * tomberait. C'est le seul point de cette tranche où une erreur ne produit
   * aucun symptôme visible.
   */
  it("TÉMOIN — un snapshot pris AVANT garde l'ancienne source (annuler restaure l'image précédente)", () => {
    const { stack, id } = photoStack();
    const snapshot = stack.clone();

    expect(stack.setLayerImageSource(id, "photo-2")).toBe(true);

    expect(snapshot.layers[0].imageSource).toEqual({ sourceId: "photo-1" });
    expect(stack.layers[0].imageSource).toEqual({ sourceId: "photo-2" });
  });
});
