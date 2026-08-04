import { describe, expect, it } from "vitest";
import {
  IDLE_CANVAS_MODE,
  enterCrop,
  isMaskPaint,
  reconcileCanvasMode,
  showsTransformHandles,
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
});
