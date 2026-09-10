import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";

/**
 * RENOMMER UN CALQUE — ticket 31. Le contrat : nommer et dénommer par un seul
 * chemin, sans consulter les verrous (renommer n'est pas structurel), avec la
 * discipline no-op du reste du fichier (pas d'entrée d'historique vide).
 */

function effectStack(): { stack: LayerStack; id: string } {
  const stack = new LayerStack();
  const id = stack.addLayer("glow");
  return { stack, id };
}

describe("renameLayer", () => {
  it("pose un nom explicite sur un calque d'effet", () => {
    const { stack, id } = effectStack();
    expect(stack.renameLayer(id, "Ciel")).toBe(true);
    expect(stack.layers[0].name).toBe("Ciel");
  });

  it("rogne les espaces de bord", () => {
    const { stack, id } = effectStack();
    expect(stack.renameLayer(id, "  Premier plan  ")).toBe(true);
    expect(stack.layers[0].name).toBe("Premier plan");
  });

  it("un nom vidé (chaîne vide) retire le nom — retour au nom d'effet", () => {
    const { stack, id } = effectStack();
    stack.renameLayer(id, "Ciel");
    expect(stack.renameLayer(id, "")).toBe(true);
    expect(stack.layers[0].name).toBeUndefined();
  });

  it("un nom d'espaces seuls est traité comme vide", () => {
    const { stack, id } = effectStack();
    stack.renameLayer(id, "Ciel");
    expect(stack.renameLayer(id, "   ")).toBe(true);
    expect(stack.layers[0].name).toBeUndefined();
  });

  it("rend false quand le nom ne change pas — pas d'entrée d'historique vide", () => {
    const { stack, id } = effectStack();
    stack.renameLayer(id, "Ciel");
    expect(stack.renameLayer(id, "Ciel")).toBe(false);
    // Rogné : « Ciel » et «  Ciel  » sont le même nom, donc no-op aussi.
    expect(stack.renameLayer(id, "  Ciel  ")).toBe(false);
  });

  it("vider un calque DÉJÀ sans nom est un no-op", () => {
    const { stack, id } = effectStack();
    expect(stack.layers[0].name).toBeUndefined();
    expect(stack.renameLayer(id, "")).toBe(false);
    expect(stack.renameLayer(id, "   ")).toBe(false);
  });

  it("rend false sur un id absent", () => {
    const { stack } = effectStack();
    expect(stack.renameLayer("fantome", "Ciel")).toBe(false);
  });

  it("renomme un calque VERROUILLÉ — renommer n'est pas structurel", () => {
    const { stack, id } = effectStack();
    stack.setLayerLock(id, "all", true);
    expect(stack.renameLayer(id, "Verrouillé mais nommé")).toBe(true);
    expect(stack.layers[0].name).toBe("Verrouillé mais nommé");
  });

  it("renomme aussi un calque photo (le nom prime sur le basename importé)", () => {
    const stack = new LayerStack();
    const id = stack.addPhotoLayer("photo-1", { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, "plage.jpg");
    expect(stack.renameLayer(id, "Fond")).toBe(true);
    expect(stack.layers[0].name).toBe("Fond");
    // Vidé : retour à `undefined` (et NON au basename — le basename n'était que la
    // valeur initiale, pas une valeur de repli mémorisée).
    expect(stack.renameLayer(id, "")).toBe(true);
    expect(stack.layers[0].name).toBeUndefined();
  });

  it("le renommage voyage dans l'historique sans réécrire les snapshots", () => {
    // Mutation scalaire en place : chaque `clone()` porte sa propre valeur de
    // `name`, donc renommer maintenant ne réécrit pas un snapshot pris avant.
    const { stack, id } = effectStack();
    stack.renameLayer(id, "Avant");
    const snapshot = stack.clone();
    stack.renameLayer(id, "Après");
    expect(snapshot.layers[0].name).toBe("Avant");
    expect(stack.layers[0].name).toBe("Après");
  });
});
