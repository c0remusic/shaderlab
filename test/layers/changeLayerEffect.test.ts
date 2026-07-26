import { describe, it, expect, vi } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";
import { changeLayerEffect } from "../../src/layers/changeLayerEffect";

describe("changeLayerEffect", () => {
  it("change l'effet, sévère le preset actif et pousse une entrée d'historique", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    const clearActivePreset = vi.fn();
    const commit = vi.fn();

    expect(changeLayerEffect(stack, id, "grain", { clearActivePreset, commit })).toBe(true);

    expect(stack.layers[0].effectId).toBe("grain");
    expect(clearActivePreset).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(stack);
  });

  // Régression : `Select` (Base UI) notifie à CHAQUE clic d'item, sans tester
  // l'égalité avec la valeur affichée — re-choisir l'effet déjà actif atteint
  // donc ce chemin. Tant que `clearActivePreset()` était appelé avant la garde,
  // ce clic cassait le lien au preset actif sans aucune mutation ni entrée
  // d'undo pour revenir en arrière.
  it("re-choisir l'effet courant ne touche ni le preset actif ni l'historique", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    const clearActivePreset = vi.fn();
    const commit = vi.fn();

    expect(changeLayerEffect(stack, id, "glow", { clearActivePreset, commit })).toBe(false);

    expect(clearActivePreset).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("un id absent ne touche ni le preset actif ni l'historique", () => {
    const stack = new LayerStack();
    stack.addLayer("glow");
    const clearActivePreset = vi.fn();
    const commit = vi.fn();

    expect(changeLayerEffect(stack, "no-such-id", "grain", { clearActivePreset, commit })).toBe(false);

    expect(clearActivePreset).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});
