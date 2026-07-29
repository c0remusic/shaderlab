import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";
import { MAX_PHOTO_LAYERS, bottomPhotoSourceId, countPhotoLayers, canAddPhotoLayer, hasImportedPhotoLayer, photoGuideKey } from "../../src/layers/photoLayer";
import { defaultLayerMask } from "../../src/mask/types";
import type { LayerState } from "../../src/layers/types";

describe("photoLayer guards", () => {
  // Arbitrage n°3 du design 2026-07-28 (§7) : 5 = 4 imports + le FOND, qui est
  // désormais un calque photo compté comme les autres. Laisser 4 aurait
  // silencieusement ramené l'utilisateur de 4 imports à 3.
  it("MAX_PHOTO_LAYERS vaut 5 (4 imports + la photo de fond, devenue un calque)", () => {
    expect(MAX_PHOTO_LAYERS).toBe(5);
  });

  it("countPhotoLayers compte les calques avec imageSource, ignore les calques d'effet", () => {
    const stack = new LayerStack();
    stack.addLayer("glow");
    expect(countPhotoLayers(stack.layers)).toBe(0);
    stack.addPhotoLayer("photo-1", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(countPhotoLayers(stack.layers)).toBe(1);
  });

  it("canAddPhotoLayer accepte jusqu'à MAX_PHOTO_LAYERS puis refuse", () => {
    const stack = new LayerStack();
    for (let i = 0; i < MAX_PHOTO_LAYERS; i++) {
      expect(canAddPhotoLayer(stack.layers)).toBe(true);
      stack.addPhotoLayer(`photo-${i + 1}`, { x: 0, y: 0, scale: 1, rotation: 0 });
    }
    expect(countPhotoLayers(stack.layers)).toBe(MAX_PHOTO_LAYERS);
    expect(canAddPhotoLayer(stack.layers)).toBe(false);
  });

  it("countPhotoLayers ignore les calques d'effet intercalés entre les calques photo", () => {
    const stack = new LayerStack();
    stack.addPhotoLayer("photo-1", { x: 0, y: 0, scale: 1, rotation: 0 });
    stack.addLayer("glow");
    stack.addPhotoLayer("photo-2", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(stack.layers).toHaveLength(3);
    expect(countPhotoLayers(stack.layers)).toBe(2);
  });

  // `hasImportedPhotoLayer` (ex-`hasPhotoLayer`) gouverne le round-trip
  // Lightroom : écraser le fichier exporté par Lightroom n'est légitime que si
  // le document est encore une retouche de CETTE photo-là. Depuis la tranche
  // T1, « aucun calque photo » ne veut plus rien dire — la photo d'ouverture en
  // est un — d'où la redéfinition « exactement une photo, et c'est layers[0] ».
  it("est FAUX sur le document nominal : la seule photo est celle d'ouverture, en bas de pile", () => {
    const stack = new LayerStack();
    stack.addPhotoLayer("photo-fond", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(hasImportedPhotoLayer(stack.layers)).toBe(false);
    // Empiler des EFFETS par-dessus le fond ne change rien : le document reste
    // une retouche de la photo d'ouverture.
    stack.addLayer("glow");
    stack.addLayer("grain");
    expect(hasImportedPhotoLayer(stack.layers)).toBe(false);
  });

  it("devient VRAI dès qu'une seconde photo est importée", () => {
    const stack = new LayerStack();
    stack.addPhotoLayer("photo-fond", { x: 0, y: 0, scale: 1, rotation: 0 });
    stack.addPhotoLayer("photo-2", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(hasImportedPhotoLayer(stack.layers)).toBe(true);
  });

  // Le fond est supprimable et déplaçable depuis T1 : les deux gestes sortent
  // du round-trip, et c'est voulu — l'export n'est plus une retouche de la
  // photo que Lightroom a fournie.
  it("devient VRAI si le fond est supprimé, ou s'il n'est plus en bas de pile", () => {
    const removed = new LayerStack();
    removed.addPhotoLayer("photo-fond", { x: 0, y: 0, scale: 1, rotation: 0 });
    removed.addLayer("glow");
    removed.removeLayer(removed.layers[0].id);
    expect(hasImportedPhotoLayer(removed.layers)).toBe(true);

    const moved = new LayerStack();
    moved.addLayer("glow");
    moved.addPhotoLayer("photo-fond", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(moved.layers[0].imageSource).toBeUndefined();
    expect(hasImportedPhotoLayer(moved.layers)).toBe(true);
  });

  // Pile entièrement vidée : plus de photo d'ouverture identifiable, donc plus
  // de round-trip. Rendre `false` ici autoriserait un écrasement sur un
  // document qui ne contient plus rien de la photo de départ.
  it("est VRAI sur une pile vide", () => {
    expect(hasImportedPhotoLayer([])).toBe(true);
  });
});

/**
 * §2.1 du design 2026-07-28, CRITIQUE. Les masques paramétriques (luminosité,
 * plage de couleur, dégradé) échantillonnaient la texture d'entrée du
 * pipeline ; celle-ci est devenue la toile VIDE en tranche T1. Sans ce
 * repointage, un masque de luminosité lirait du noir partout et deviendrait
 * aveugle — sans erreur, sans message, juste un masque qui ne sélectionne plus
 * rien. C'est le point de la tranche où une faute ne se voit pas.
 */
describe("bottomPhotoSourceId — l'image que les masques paramétriques échantillonnent", () => {
  it("rend la photo de FOND sur le document nominal, effets empilés compris", () => {
    const stack = new LayerStack();
    stack.addPhotoLayer("src-fond", { x: 0, y: 0, scale: 1, rotation: 0 });
    stack.addLayer("glow");
    stack.addLayer("grain");
    expect(bottomPhotoSourceId(stack.layers)).toBe("src-fond");
  });

  it("rend la photo la PLUS BASSE, pas la dernière importée", () => {
    const stack = new LayerStack();
    stack.addPhotoLayer("src-fond", { x: 0, y: 0, scale: 1, rotation: 0 });
    stack.addPhotoLayer("src-import", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(bottomPhotoSourceId(stack.layers)).toBe("src-fond");
  });

  it("ignore les calques d'effet placés SOUS la première photo", () => {
    // Configuration rendue possible par T1 : le fond se déplace, un effet peut
    // passer dessous. Il ne porte aucune image — le masque doit continuer de
    // descendre jusqu'à la première vraie photo.
    const stack = new LayerStack();
    stack.addLayer("glow");
    stack.addPhotoLayer("src-fond", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(bottomPhotoSourceId(stack.layers)).toBe("src-fond");
  });

  it("rend null quand la pile ne contient aucune photo", () => {
    const stack = new LayerStack();
    stack.addLayer("glow");
    expect(bottomPhotoSourceId(stack.layers)).toBeNull();
    expect(bottomPhotoSourceId([])).toBeNull();
  });
});

/**
 * `photoGuideKey` — la clé d'invalidation du guide edge-aware d'un calque
 * photo. Ce qu'elle doit garantir tient en une phrase : deux clés égales
 * signifient que la pré-passe photo rendra les MÊMES pixels. Une clé trop
 * large invaliderait un cache coûteux pour rien ; une clé trop étroite
 * servirait un guide périmé — c'est ce second défaut qui ne se voit pas.
 */
describe("photoGuideKey — ce dont le guide d'un calque photo dépend", () => {
  const photo = (over: Partial<LayerState> = {}): LayerState => ({
    id: "P",
    effectId: "passthrough",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
    imageSource: { sourceId: "s1" },
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    ...over,
  });

  it("rend null pour un calque sans photo, et pour l'absence de calque", () => {
    expect(photoGuideKey(photo({ imageSource: undefined, transform: undefined }))).toBeNull();
    expect(photoGuideKey(undefined)).toBeNull();
  });

  it("est stable quand rien de ce que la pré-passe lit ne change", () => {
    // Opacité, fusion, masque : rien de tout cela n'entre dans la pré-passe.
    // Une clé qui bougerait ici reconstruirait la SAT du guide à chaque
    // glissement de curseur d'opacité.
    expect(photoGuideKey(photo({ opacity: 0.3, blendMode: "screen" }))).toBe(photoGuideKey(photo()));
  });

  it("change dès que la source change", () => {
    expect(photoGuideKey(photo({ imageSource: { sourceId: "s2" } }))).not.toBe(photoGuideKey(photo()));
  });

  it("change sur CHACUN des quatre champs de transformation", () => {
    const base = photoGuideKey(photo());
    for (const t of [
      { x: 1, y: 0, scale: 1, rotation: 0 },
      { x: 0, y: 1, scale: 1, rotation: 0 },
      { x: 0, y: 0, scale: 1.5, rotation: 0 },
      { x: 0, y: 0, scale: 1, rotation: 0.2 },
    ]) {
      expect(photoGuideKey(photo({ transform: t }))).not.toBe(base);
    }
  });
});
