import { describe, expect, it } from "vitest";
import { withPhotoLayersPreserved } from "../../src/presets/preservePhotoLayers";
import { LayerStack } from "../../src/layers/layerStack";
import type { LayerState } from "../../src/layers/types";

const IDENTITY = { x: 0, y: 0, scale: 1, rotation: 0 };

/** Pile « document ouvert » : le fond, puis deux effets posés dessus. */
function documentWithBackground(): LayerState[] {
  const stack = new LayerStack();
  stack.addPhotoLayer("src-fond", IDENTITY, "DSC_0042.jpg");
  stack.addLayer("glow");
  stack.addLayer("grain");
  return stack.layers;
}

/** Ce qu'un preset restitue : des calques d'EFFET, jamais de photo
 *  (`presetDocument.ts` les exclut à la capture). */
function presetLayers(): LayerState[] {
  const stack = new LayerStack();
  stack.addLayer("chromaticBleed");
  stack.addLayer("warp");
  return stack.layers;
}

describe("withPhotoLayersPreserved — §2.3, appliquer un preset ne détruit pas les photos", () => {
  // LE défaut que ce module empêche : `applyPreset` remplace la pile ENTIÈRE.
  // Depuis que la photo de fond est un calque, ce remplacement la faisait
  // disparaître — l'écran serait tombé sur le damier de la toile vide, en un
  // clic, sans avertissement.
  it("garde la photo de fond quand un preset remplace la pile", () => {
    const current = documentWithBackground();
    const merged = withPhotoLayersPreserved(current, presetLayers());

    expect(merged[0]).toBe(current[0]);
    expect(merged[0].imageSource).toEqual({ sourceId: "src-fond" });
  });

  it("garde TOUTES les photos, dans leur ordre relatif, et les place sous les calques du preset", () => {
    const stack = new LayerStack();
    stack.addPhotoLayer("src-fond", IDENTITY, "fond.jpg");
    stack.addLayer("glow");
    stack.addPhotoLayer("src-import", IDENTITY, "import.jpg");
    const preset = presetLayers();

    const merged = withPhotoLayersPreserved(stack.layers, preset);

    expect(merged.map((l) => l.imageSource?.sourceId ?? l.effectId)).toEqual([
      "src-fond",
      "src-import",
      "chromaticBleed",
      "warp",
    ]);
  });

  // La moitié « négative » du contrat : le preset doit rester intégralement
  // appliqué. Préserver les photos ne doit pas se payer d'un effet perdu.
  it("n'écarte aucun calque du preset et n'y ajoute rien", () => {
    const preset = presetLayers();
    const merged = withPhotoLayersPreserved(documentWithBackground(), preset);

    expect(merged.slice(-preset.length)).toEqual(preset);
    expect(merged).toHaveLength(1 + preset.length);
  });

  // Les EFFETS du document, eux, sont bien remplacés : c'est tout l'intérêt
  // d'appliquer un preset. Sans cette assertion, préserver la pile entière
  // passerait au vert.
  it("remplace les calques d'effet du document", () => {
    const current = documentWithBackground();
    const merged = withPhotoLayersPreserved(current, presetLayers());

    const keptEffectIds = new Set(merged.filter((l) => l.imageSource === undefined).map((l) => l.id));
    for (const previous of current.filter((l) => l.imageSource === undefined)) {
      expect(keptEffectIds.has(previous.id)).toBe(false);
    }
  });

  it("sur un document sans photo, rend le preset tel quel", () => {
    const preset = presetLayers();
    expect(withPhotoLayersPreserved([], preset)).toEqual(preset);
  });
});
