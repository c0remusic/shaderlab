import { describe, expect, it } from "vitest";
import {
  IDLE_CANVAS_MODE,
  enterCrop,
  isMaskPaint,
  reconcileCanvasMode,
  showsTransformHandles,
  showsEffectControls,
  toggleMaskPaint,
  type CanvasMode,
} from "../../src/ui/canvasMode";

const CROP = { x: 0, y: 0, width: 10, height: 10 };

describe("CanvasMode — transitions", () => {
  it("toggleMaskPaint entre en peinture depuis idle et en sort", () => {
    const painting = toggleMaskPaint(IDLE_CANVAS_MODE, "l1", "brush-1");
    expect(painting).toEqual({ kind: "maskPaint", layerId: "l1", sourceId: "brush-1" });
    expect(toggleMaskPaint(painting, "l1", "brush-1")).toEqual({ kind: "idle" });
  });

  it("entrer en peinture depuis crop abandonne le crop (modes exclusifs)", () => {
    expect(toggleMaskPaint(enterCrop("l1", CROP), "l1", null)).toEqual({ kind: "maskPaint", layerId: "l1", sourceId: null });
  });

  it("enterCrop mémorise le calque cible et le crop d'entrée", () => {
    expect(enterCrop("l1", CROP)).toEqual({ kind: "crop", layerId: "l1", original: CROP });
  });

  it("enterCrop accepte un crop d'entrée absent (photo entière)", () => {
    expect(enterCrop("l1", undefined)).toEqual({ kind: "crop", layerId: "l1", original: undefined });
  });
});

describe("CanvasMode — prédicats d'affichage", () => {
  it("isMaskPaint n'est vrai qu'en maskPaint", () => {
    expect(isMaskPaint({ kind: "maskPaint", layerId: "l1", sourceId: null })).toBe(true);
    expect(isMaskPaint(IDLE_CANVAS_MODE)).toBe(false);
    expect(isMaskPaint(enterCrop("l1", CROP))).toBe(false);
  });

  it("les poignées de transform ne s'affichent qu'en idle", () => {
    expect(showsTransformHandles(IDLE_CANVAS_MODE)).toBe(true);
    expect(showsTransformHandles({ kind: "maskPaint", layerId: "l1", sourceId: null })).toBe(false);
    expect(showsTransformHandles(enterCrop("l1", CROP))).toBe(false);
  });
});

describe("CanvasMode — retour forcé en idle", () => {
  it("un changement de sélection abandonne le mode crop", () => {
    expect(reconcileCanvasMode(enterCrop("l1", CROP), "l2", ["l1", "l2"])).toEqual({ kind: "idle" });
  });

  it("une sélection vidée abandonne le mode crop", () => {
    expect(reconcileCanvasMode(enterCrop("l1", CROP), null, ["l1"])).toEqual({ kind: "idle" });
  });

  it("la suppression du calque en cours de crop abandonne le mode", () => {
    expect(reconcileCanvasMode(enterCrop("l1", CROP), "l1", ["l2"])).toEqual({ kind: "idle" });
  });

  it("le mode crop survit tant que son calque reste sélectionné et présent", () => {
    const mode = enterCrop("l1", CROP);
    expect(reconcileCanvasMode(mode, "l1", ["l1", "l2"])).toBe(mode);
  });

  it("maskPaint survit seulement tant que son calque reste sélectionné", () => {
    const painting: CanvasMode = { kind: "maskPaint", layerId: "l1", sourceId: "brush-1" };
    expect(reconcileCanvasMode(painting, "l1", ["l1"], new Map([["l1", ["brush-1"]]]))).toBe(painting);
    expect(reconcileCanvasMode(painting, null, [])).toEqual(IDLE_CANVAS_MODE);
    expect(reconcileCanvasMode(IDLE_CANVAS_MODE, null, [])).toBe(IDLE_CANVAS_MODE);
  });

  it("la suppression de la source pinceau ferme sa session", () => {
    const painting: CanvasMode = { kind: "maskPaint", layerId: "l1", sourceId: "brush-1" };
    expect(reconcileCanvasMode(painting, "l1", ["l1"], new Map([["l1", []]]))).toEqual(IDLE_CANVAS_MODE);
  });

  it("attache la source créée au premier trait à la session", () => {
    const pending: CanvasMode = { kind: "maskPaint", layerId: "l1", sourceId: null };
    expect(reconcileCanvasMode(pending, "l1", ["l1"], new Map([["l1", ["brush-1"]]])))
      .toEqual({ kind: "maskPaint", layerId: "l1", sourceId: "brush-1" });
  });

  /**
   * LES CONTRÔLES D'EFFET SURVIVENT À L'OUTIL FORME, et c'est le vrai « petit
   * problème de forme ».
   *
   * `showsTransformHandles` vaut `idle` seulement, et il gouvernait TOUT :
   * poignées du calque photo comme contrôles d'effet. Conséquence à l'usage —
   * on trace un rectangle, il se pose, et pour l'ajuster il faut QUITTER
   * l'outil qui vient de le créer. Photoshop garde ses poignées dans l'outil de
   * forme ; c'est là qu'on veut ajuster, juste après avoir tracé.
   *
   * Les deux prédicats se séparent donc, et ils ne disent pas la même chose :
   * - `showsTransformHandles` = les poignées du CALQUE PHOTO. Rien à faire en
   *   traçant une forme : déplacer la photo sous la forme qu'on dessine n'a
   *   aucun sens, et la boîte de la photo couvre toute l'image.
   * - `showsEffectControls` = les contrôles d'un EFFET (point, disque, axe,
   *   boîte). Ils portent sur ce qu'on vient de créer.
   */
  it("les contrôles d'effet vivent AUSSI dans l'outil Forme", () => {
    expect(showsEffectControls(IDLE_CANVAS_MODE)).toBe(true);
    expect(showsEffectControls({ kind: "shapeDraw" })).toBe(true);
    // Le pinceau doit rester seul maître du canvas : une poignée y
    // intercepterait un coup de pinceau.
    expect(showsEffectControls({ kind: "maskPaint", layerId: "l1", sourceId: null })).toBe(false);
    expect(showsEffectControls({ kind: "crop", layerId: "l1", original: undefined })).toBe(false);
  });

  it("les poignées du calque PHOTO restent réservées au repos", () => {
    // Déplacer la photo pendant qu'on trace une forme dessus n'a pas de sens,
    // et sa boîte couvre toute l'image — elle avalerait le tracé.
    expect(showsTransformHandles({ kind: "shapeDraw" })).toBe(false);
  });
});
