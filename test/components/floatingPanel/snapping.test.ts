import { describe, it, expect } from "vitest";
import { computeSnappedPosition, PANEL_GAP, SNAP_DISTANCE } from "../../../src/components/floatingPanel/snapping";
import type { Rect, SnapCandidate } from "../../../src/components/floatingPanel/snapping";

const CANVAS = { width: 1000, height: 800 };

function rect(x: number, y: number, width = 200, height = 150): Rect {
  return { x, y, width, height };
}

describe("computeSnappedPosition", () => {
  it("aucun candidat sous le seuil -> position brute inchangée", () => {
    const dragged = rect(500, 400);
    const result = computeSnappedPosition(dragged, [], CANVAS);
    expect(result).toEqual({ x: 500, y: 400 });
  });

  it("accroche horizontalement à un panneau voisin avec un écart PANEL_GAP (jamais 0)", () => {
    const neighbor: SnapCandidate = { id: "layers", rect: rect(100, 100) };
    const dragged = rect(300 + SNAP_DISTANCE - 1, 100);
    const result = computeSnappedPosition(dragged, [neighbor], CANVAS);
    expect(result.x).toBe(100 + 200 + PANEL_GAP);
    expect(result.y).toBe(100);
  });

  it("frontière du seuil : distance bord-à-bord exactement SNAP_DISTANCE -> snap ; SNAP_DISTANCE+1 -> pas de snap", () => {
    const neighbor: SnapCandidate = { id: "layers", rect: rect(100, 100) }; // end=300
    const atThreshold = computeSnappedPosition(rect(300 + SNAP_DISTANCE, 100), [neighbor], CANVAS);
    expect(atThreshold.x).toBe(300 + PANEL_GAP);
    const beyondThreshold = computeSnappedPosition(rect(300 + SNAP_DISTANCE + 1, 100), [neighbor], CANVAS);
    expect(beyondThreshold.x).toBe(300 + SNAP_DISTANCE + 1); // inchangé, aucun snap
  });

  it("régression : le seuil se mesure bord-à-bord, pas sur la position finale post-PANEL_GAP", () => {
    // Ancien bug : la distance était mesurée jusqu'à (end + PANEL_GAP), pas
    // jusqu'à `end` lui-même. Ce cas est bord-à-bord à exactement
    // SNAP_DISTANCE (12px) du voisin, donc DOIT snapper — mais l'ancien
    // calcul mesurait |288 - 308| = 20px (> seuil) et aurait refusé le snap.
    const neighbor: SnapCandidate = { id: "layers", rect: rect(100, 100) }; // end=300
    const dragged = rect(300 - SNAP_DISTANCE, 100); // draggedStart=288
    const result = computeSnappedPosition(dragged, [neighbor], CANVAS);
    expect(result.x).toBe(300 + PANEL_GAP); // snap correct (nouveau calcul)
    expect(result.x).not.toBe(288); // preuve que ce n'est PAS le comportement bugué (pas de snap)
  });

  it("accroche verticalement à un panneau voisin avec un écart PANEL_GAP", () => {
    const neighbor: SnapCandidate = { id: "layers", rect: rect(100, 100) };
    const dragged = rect(100, 250 + SNAP_DISTANCE - 1);
    const result = computeSnappedPosition(dragged, [neighbor], CANVAS);
    expect(result.y).toBe(100 + 150 + PANEL_GAP);
    expect(result.x).toBe(100);
  });

  it("accroche simultanément horizontal ET vertical (coin proche d'un coin)", () => {
    const neighbor: SnapCandidate = { id: "layers", rect: rect(100, 100) };
    const dragged = rect(300 + SNAP_DISTANCE - 2, 250 + SNAP_DISTANCE - 2);
    const result = computeSnappedPosition(dragged, [neighbor], CANVAS);
    expect(result.x).toBe(100 + 200 + PANEL_GAP);
    expect(result.y).toBe(100 + 150 + PANEL_GAP);
  });

  it("accroche à un bord du canvas de façon flush (0px, pas de PANEL_GAP)", () => {
    const dragged = rect(SNAP_DISTANCE - 1, 400);
    const result = computeSnappedPosition(dragged, [], CANVAS);
    expect(result.x).toBe(0);
  });

  it("accroche au bord droit du canvas de façon flush", () => {
    const dragged = rect(CANVAS.width - 200 - (SNAP_DISTANCE - 1), 400);
    const result = computeSnappedPosition(dragged, [], CANVAS);
    expect(result.x).toBe(CANVAS.width - 200);
  });

  it("plusieurs candidats sous le seuil -> retient le plus proche (distance minimale)", () => {
    const near: SnapCandidate = { id: "near", rect: rect(300 + PANEL_GAP + 1, 100) };
    const far: SnapCandidate = { id: "far", rect: rect(100, 400) };
    const dragged = rect(300 + PANEL_GAP + 1 - 200 - PANEL_GAP + 1, 100);
    const result = computeSnappedPosition(dragged, [near, far], CANVAS);
    expect(result.x).toBe(near.rect.x - 200 - PANEL_GAP);
  });

  it("égalité exacte de distance -> résolue par l'ordre de rendu (premier trouvé)", () => {
    // dragged.x=150 ; deux voisins dont le bord "fin" est respectivement à
    // 145 et 155 -> distance bord-à-bord réelle de 5 de part et d'autre,
    // strictement égale et sous SNAP_DISTANCE. y=500 hors de portée du
    // dragged (y=100) pour isoler l'axe x.
    const first: SnapCandidate = { id: "first", rect: rect(0, 500, 145, 150) }; // end=145, distance 5
    const second: SnapCandidate = { id: "second", rect: rect(0, 500, 155, 150) }; // end=155, distance 5
    const dragged = rect(150, 100, 200, 150);
    const result = computeSnappedPosition(dragged, [first, second], CANVAS);
    const resultReversed = computeSnappedPosition(dragged, [second, first], CANVAS);
    expect(result.x).toBe(145 + PANEL_GAP);
    expect(resultReversed.x).toBe(155 + PANEL_GAP);
    expect(result.x).not.toBe(resultReversed.x);
  });

  it("contraint le panneau relâché à rester dans les limites du canvas", () => {
    const dragged = rect(-999, -999);
    const result = computeSnappedPosition(dragged, [], CANVAS);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.x + dragged.width).toBeLessThanOrEqual(CANVAS.width);
    expect(result.y + dragged.height).toBeLessThanOrEqual(CANVAS.height);
  });
});
