import { describe, expect, it } from "vitest";
import {
  LAYER_SHORTCUT_LABELS,
  layerActionFromShortcut,
  type LayerAction,
  type ShortcutChord,
} from "../../src/ui/shortcuts";

const chord = (over: Partial<ShortcutChord> = {}): ShortcutChord => ({
  key: "",
  code: "",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  ...over,
});

describe("layerActionFromShortcut", () => {
  it("Ctrl+Alt+Maj+E aplatit en nouveau calque (Tampon)", () => {
    expect(layerActionFromShortcut(chord({ code: "KeyE", ctrlKey: true, altKey: true, shiftKey: true }))).toBe("stamp");
  });

  it("Ctrl+E fusionne avec le dessous", () => {
    expect(layerActionFromShortcut(chord({ code: "KeyE", ctrlKey: true }))).toBe("merge");
  });

  it("Ctrl+J duplique", () => {
    expect(layerActionFromShortcut(chord({ code: "KeyJ", ctrlKey: true }))).toBe("duplicate");
  });

  it("Suppr et Retour arrière suppriment", () => {
    expect(layerActionFromShortcut(chord({ key: "Delete" }))).toBe("delete");
    expect(layerActionFromShortcut(chord({ key: "Backspace" }))).toBe("delete");
  });

  it("distingue le Tampon de la Fusion par ses deux modificateurs", () => {
    // Sans les deux, `Ctrl+E` reste la Fusion ; avec un seul (Maj OU Alt), aucune
    // commande — surtout pas un Tampon déclenché à moitié.
    expect(layerActionFromShortcut(chord({ code: "KeyE", ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(layerActionFromShortcut(chord({ code: "KeyE", ctrlKey: true, altKey: true }))).toBeNull();
  });

  it("accepte Cmd comme modificateur principal, pas seulement Ctrl", () => {
    // Parité avec Ctrl+Z/Y/I d'`App.tsx` — sans coût sur Windows (cible), et sans
    // conflit ailleurs.
    expect(layerActionFromShortcut(chord({ code: "KeyE", metaKey: true }))).toBe("merge");
    expect(layerActionFromShortcut(chord({ code: "KeyJ", metaKey: true }))).toBe("duplicate");
    expect(layerActionFromShortcut(chord({ code: "KeyE", metaKey: true, altKey: true, shiftKey: true }))).toBe("stamp");
  });

  it("lit la LETTRE par son code physique, jamais par le caractère produit", () => {
    // Sur AZERTY, la touche sous le doigt ne produit pas la même lettre — mais
    // `code` reste `KeyE`/`KeyJ`. Un `key` fantaisiste ne doit rien changer.
    expect(layerActionFromShortcut(chord({ code: "KeyE", key: "€", ctrlKey: true }))).toBe("merge");
  });

  it("Suppr exige une frappe NUE — un modificateur l'annule", () => {
    expect(layerActionFromShortcut(chord({ key: "Delete", ctrlKey: true }))).toBeNull();
    expect(layerActionFromShortcut(chord({ key: "Delete", altKey: true }))).toBeNull();
    expect(layerActionFromShortcut(chord({ key: "Backspace", metaKey: true }))).toBeNull();
  });

  it("une lettre NUE ne désigne aucune commande — c'est le vocabulaire des outils", () => {
    // `KeyE` nu est la gomme (`tools.ts`), `KeyJ` nu n'est rien : dans les deux
    // cas ce module doit se taire, sinon il volerait un raccourci d'outil.
    expect(layerActionFromShortcut(chord({ code: "KeyE" }))).toBeNull();
    expect(layerActionFromShortcut(chord({ code: "KeyJ" }))).toBeNull();
  });

  it("refuse l'auto-répétition — un geste de calque ne se tient pas enfoncé", () => {
    expect(layerActionFromShortcut(chord({ code: "KeyE", ctrlKey: true, repeat: true }))).toBeNull();
    expect(layerActionFromShortcut(chord({ key: "Delete", repeat: true }))).toBeNull();
  });

  it("chaque commande a un libellé de raccourci, sans manque ni surplus", () => {
    const actions: LayerAction[] = ["stamp", "merge", "duplicate", "delete"];
    expect(Object.keys(LAYER_SHORTCUT_LABELS).sort()).toEqual([...actions].sort());
    for (const a of actions) expect(LAYER_SHORTCUT_LABELS[a].length).toBeGreaterThan(0);
  });
});
