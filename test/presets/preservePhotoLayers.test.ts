import { describe, expect, it } from "vitest";
import { withPhotoLayersPreserved } from "../../src/presets/preservePhotoLayers";
import { LayerStack } from "../../src/layers/layerStack";
import { MAX_PHOTO_LAYERS, canAddPhotoLayer, countPhotoLayers } from "../../src/layers/photoLayer";
import type { LayerState } from "../../src/layers/types";

const IDENTITY = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };

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
  stack.addLayer("lensDistortion");
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
      "lensDistortion",
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

// Contrôles sur pièce demandés à la reprise de T5 : le design date d'avant T1
// et ne dit rien de ces cas. Ils vérifient ce que la concaténation « devant »
// produit RÉELLEMENT, pas ce que la doc suppose.
describe("withPhotoLayersPreserved — cas que le design ne couvrait pas", () => {
  it("préserve un calque photo VERROUILLÉ tel quel, verrou compris", () => {
    // Le verrou (arbitrage n°2 du 2026-07-28) est un champ scalaire de
    // LayerState : préserver le calque par référence le préserve par
    // construction. Sans cette assertion, une future copie/reconstruction du
    // calque photo pourrait perdre le verrou sans qu'aucun test ne bronche.
    const stack = new LayerStack();
    const id = stack.addPhotoLayer("src-fond", IDENTITY, "fond.jpg");
    stack.setLayerLocked(id, true);
    const photoBefore = stack.layers[0];

    const merged = withPhotoLayersPreserved(stack.layers, presetLayers());

    expect(merged[0]).toBe(photoBefore);
    expect(merged[0].locked).toBe(true);
  });

  it("regroupe en bas une photo qui était AU MILIEU de la pile", () => {
    // Conséquence assumée et visible : la photo passe SOUS les effets du
    // preset. C'est le sens causal (ADR-0004) — le preset se pose sur la
    // matière, comme au moment où il a été capturé.
    const stack = new LayerStack();
    stack.addLayer("glow");
    stack.addPhotoLayer("src-milieu", IDENTITY, "milieu.jpg");
    stack.addLayer("grain");

    const merged = withPhotoLayersPreserved(stack.layers, presetLayers());

    expect(merged.map((l) => l.imageSource?.sourceId ?? l.effectId)).toEqual([
      "src-milieu",
      "lensDistortion",
      "warp",
    ]);
  });

  it("ne peut pas franchir MAX_PHOTO_LAYERS, même au plafond", () => {
    const stack = new LayerStack();
    for (let i = 0; i < MAX_PHOTO_LAYERS; i += 1) {
      stack.addPhotoLayer(`src-${i}`, IDENTITY, `photo-${i}.jpg`);
    }
    expect(countPhotoLayers(stack.layers)).toBe(MAX_PHOTO_LAYERS);

    const merged = withPhotoLayersPreserved(stack.layers, presetLayers());

    // Le compte ne peut que rester constant ou diminuer : un preset ne porte
    // aucun calque photo (garanti par `apply`, voir presetDocument.test.ts).
    expect(countPhotoLayers(merged)).toBe(MAX_PHOTO_LAYERS);
    expect(canAddPhotoLayer(merged)).toBe(false);
  });

  it("conserve le masque peint de la photo préservée", () => {
    // La photo est préservée PAR RÉFÉRENCE : son masque survit à l'application
    // du preset, contrairement à ceux des calques d'effet remplacés.
    const stack = new LayerStack();
    stack.addPhotoLayer("src-fond", IDENTITY, "fond.jpg");
    const maskBefore = stack.layers[0].mask;

    const merged = withPhotoLayersPreserved(stack.layers, presetLayers());

    expect(merged[0].mask).toBe(maskBefore);
  });
});
