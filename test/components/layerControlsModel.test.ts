import { describe, it, expect } from "vitest";
import { layerControlsModel, opacityToPercent, parseOpacityPercent } from "../../src/components/layerControlsModel";
import type { LayerState } from "../../src/layers/types";
import { defaultLayerMask } from "../../src/mask/types";

function layer(overrides: Partial<LayerState> & { id: string }): LayerState {
  return {
    effectId: "glow",
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    params: {},
    mask: defaultLayerMask(),
    ...overrides,
  };
}

describe("layerControlsModel", () => {
  it("sans sélection, l'en-tête est désactivé et n'emprunte aucune valeur à la pile", () => {
    const model = layerControlsModel([layer({ id: "a", opacity: 0.2, blendMode: "screen" })], null);
    expect(model).toEqual({ enabled: false, locked: false, layerId: null, opacity: 1, blendMode: null, effectId: null, effectSelectable: true });
  });

  it("sur pile vide, l'en-tête est désactivé", () => {
    expect(layerControlsModel([], null).enabled).toBe(false);
  });

  it("reflète le calque sélectionné, pas le premier de la pile", () => {
    const layers = [
      layer({ id: "a", effectId: "glow", opacity: 1, blendMode: "normal" }),
      layer({ id: "b", effectId: "grain", opacity: 0.4, blendMode: "screen" }),
    ];
    expect(layerControlsModel(layers, "b")).toEqual({
      enabled: true,
      locked: false,
      layerId: "b",
      opacity: 0.4,
      blendMode: "screen",
      effectId: "grain",
      effectSelectable: true,
    });
  });

  // VERROU (2026-07-29) : l'opacité et le mode de fusion ne passent par AUCUN
  // mutateur de `LayerStack` — `App.tsx` les écrit en direct sur la projection
  // de calques. La garde du modèle ne les couvre donc pas : c'est ce `enabled:
  // false` qui empêche de modifier un calque verrouillé depuis la zone de
  // contrôles. Les VALEURS restent rendues — le verrou empêche de modifier,
  // pas de consulter.
  it("un calque VERROUILLÉ désactive la zone de contrôles tout en gardant ses valeurs lisibles", () => {
    const layers = [layer({ id: "a", effectId: "grain", opacity: 0.4, blendMode: "screen", locked: true })];
    expect(layerControlsModel(layers, "a")).toEqual({
      enabled: false,
      locked: true,
      layerId: "a",
      opacity: 0.4,
      blendMode: "screen",
      effectId: "grain",
      effectSelectable: true,
    });
  });

  // `locked` et `!enabled` ne sont pas synonymes : sans sélection, la zone est
  // inerte SANS qu'aucun calque soit verrouillé. C'est ce qui permet à l'UI de
  // dire POURQUOI elle est inerte.
  it("locked distingue « verrouillé » de « rien de sélectionné »", () => {
    expect(layerControlsModel([layer({ id: "a" })], null).locked).toBe(false);
    expect(layerControlsModel([layer({ id: "a", locked: true })], "a").locked).toBe(true);
  });

  it("un selectedId périmé (calque supprimé) retombe sur l'état désactivé", () => {
    const model = layerControlsModel([layer({ id: "a" })], "disparu");
    expect(model.enabled).toBe(false);
    expect(model.layerId).toBeNull();
  });

  // GARDE D'INTERFACE de la décision du 2026-07-31 : un effet ne se pose jamais
  // sur un calque photo. `LayerStack.setLayerEffect` refuse déjà côté modèle ;
  // sans CETTE garde-ci, le sélecteur resterait affiché et actif en ne faisant
  // plus rien — exactement l'échec silencieux que ce dépôt proscrit. Témoin :
  // sans elle, `effectSelectable` vaut `true` sur un calque photo.
  it("un calque PHOTO ne propose PAS de sélecteur d'effet", () => {
    const layers = [layer({ id: "p", effectId: "passthrough", imageSource: { sourceId: "s1" } })];
    expect(layerControlsModel(layers, "p").effectSelectable).toBe(false);
  });

  it("un calque d'effet le propose, et l'absence de sélection le garde monté", () => {
    expect(layerControlsModel([layer({ id: "a" })], "a").effectSelectable).toBe(true);
    // Sans sélection le sélecteur reste MONTÉ (désactivé, sur son placeholder) :
    // le retirer ferait sauter la zone de contrôles à chaque désélection, le
    // défaut que tout ce module évite déjà pour `enabled`.
    expect(layerControlsModel([layer({ id: "a" })], null).effectSelectable).toBe(true);
  });

  // Un calque photo VERROUILLÉ n'a pas non plus de sélecteur : la garde photo
  // ne dépend pas du verrou, et les deux se cumulent sans s'annuler.
  it("un calque photo verrouillé n'en propose pas davantage", () => {
    const layers = [layer({ id: "p", imageSource: { sourceId: "s1" }, locked: true })];
    const model = layerControlsModel(layers, "p");
    expect(model.effectSelectable).toBe(false);
    expect(model.enabled).toBe(false);
  });
});

describe("opacityToPercent", () => {
  it("convertit l'opacité du modèle en pourcentage entier", () => {
    expect(opacityToPercent(0)).toBe(0);
    expect(opacityToPercent(0.6)).toBe(60);
    expect(opacityToPercent(1)).toBe(100);
  });

  it("arrondit au plus proche plutôt que de tronquer", () => {
    expect(opacityToPercent(0.635)).toBe(64);
    expect(opacityToPercent(0.634)).toBe(63);
  });

  it("borne, pour ne jamais afficher un pourcentage impossible", () => {
    expect(opacityToPercent(-1)).toBe(0);
    expect(opacityToPercent(4)).toBe(100);
  });
});

// Contrat de SAISIE du champ d'opacité de l'en-tête. Le champ lui-même n'est pas
// testable ici (aucun test de ce projet ne rend de composant React) : c'est
// cette fonction pure qui porte le contrat, et le composant ne fait que
// l'appeler.
describe("parseOpacityPercent", () => {
  it("accepte le nombre nu", () => {
    expect(parseOpacityPercent("60")).toBe(60);
  });

  it("accepte l'unité, collée ou espacée, et les espaces autour", () => {
    expect(parseOpacityPercent("60 %")).toBe(60);
    expect(parseOpacityPercent("60%")).toBe(60);
    expect(parseOpacityPercent("  60 %  ")).toBe(60);
  });

  it("accepte la virgule décimale et arrondit à l'entier", () => {
    expect(parseOpacityPercent("60,4")).toBe(60);
    expect(parseOpacityPercent("60.6")).toBe(61);
  });

  it("borne à 0..100 au lieu de laisser passer une valeur hors plage", () => {
    expect(parseOpacityPercent("250")).toBe(100);
    expect(parseOpacityPercent("-30")).toBe(0);
  });

  it("rend null sur une saisie sans nombre — l'appelant revient à la valeur précédente, jamais un NaN", () => {
    expect(parseOpacityPercent("")).toBeNull();
    expect(parseOpacityPercent("   ")).toBeNull();
    expect(parseOpacityPercent("abc")).toBeNull();
    expect(parseOpacityPercent("%")).toBeNull();
  });
});
