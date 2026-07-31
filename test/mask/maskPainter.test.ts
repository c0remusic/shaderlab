import { describe, it, expect } from "vitest";
import { MaskPainter, type BrushSettings } from "../../src/mask/maskPainter";

/** Réglages d'un pinceau « plein » : plafond et dépôt à fond, donc le seul
 *  couple pour lequel le peintre DOIT rester identique à sa version
 *  d'avant opacité/débit (voir le témoin d'équivalence historique). */
function fullBrush(radius: number, hardness: number, erase = false): BrushSettings {
  return { radius, hardness, erase, opacity: 1, flow: 1 };
}

describe("MaskPainter", () => {
  it("starts fully transparent (all zero) by default", () => {
    const painter = new MaskPainter(4, 4);
    const data = painter.getMaskData();
    expect(data.every((v) => v === 0)).toBe(true);
  });

  it("clear(255) fills the mask fully opaque", () => {
    const painter = new MaskPainter(4, 4);
    painter.clear(255);
    expect(painter.getMaskData().every((v) => v === 255)).toBe(true);
  });

  it("paintStroke raises values at the brush center, tapering at the edge", () => {
    const painter = new MaskPainter(20, 20);
    painter.paintStroke(10, 10, 5, 1.0, false);
    const data = painter.getMaskData();
    const center = data[10 * 20 + 10];
    const edge = data[10 * 20 + 19]; // far from the brush
    expect(center).toBeGreaterThan(200);
    expect(edge).toBe(0);
  });

  it("erase mode lowers values instead of raising them", () => {
    const painter = new MaskPainter(20, 20);
    painter.clear(255);
    painter.paintStroke(10, 10, 5, 1.0, true);
    const data = painter.getMaskData();
    expect(data[10 * 20 + 10]).toBeLessThan(50);
  });

  it("paintStroke returns the touched region's bounding box, clamped to image bounds", () => {
    const painter = new MaskPainter(20, 20);
    const rect = painter.paintStroke(10, 10, 5, 1.0, false);
    expect(rect).toEqual({ x: 5, y: 5, width: 11, height: 11 });
  });

  it("paintStroke clamps the returned rect when the brush extends past the image edge", () => {
    const painter = new MaskPainter(20, 20);
    const rect = painter.paintStroke(0, 0, 5, 1.0, false);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBeLessThanOrEqual(6);
    expect(rect.height).toBeLessThanOrEqual(6);
  });

  it("paintStroke returns an EMPTY (non-negative) rect when the brush is entirely outside the image — regression: flicker bug (2026-07-18)", () => {
    // The pointer can now travel past the canvas edge while painting
    // (pointer-capture fix) — a point far outside the image, with the
    // brush's footprint not overlapping it at all, must never produce a
    // NEGATIVE width/height: that malformed rect flows straight into a GPU
    // partial-texture-upload copy size (computeR8UploadRegion → writeTexture),
    // which WebGPU rejects — a validation error every such frame, causing
    // the reported flicker.
    const painter = new MaskPainter(100, 100);
    const rect = painter.paintStroke(-500, 50, 10, 1.0, false); // way past the left edge
    expect(rect.width).toBeGreaterThanOrEqual(0);
    expect(rect.height).toBeGreaterThanOrEqual(0);
  });

  it("paintLine's union stays non-negative when interpolating through fully-out-of-bounds points", () => {
    const painter = new MaskPainter(100, 100);
    // A drag that starts inside, sweeps far outside the image, and comes back.
    const rect = painter.paintLine(10, 10, -400, 10, 10, 1.0, false);
    expect(rect.width).toBeGreaterThanOrEqual(0);
    expect(rect.height).toBeGreaterThanOrEqual(0);
  });

  it("loadFrom replaces the internal buffer so subsequent strokes build on top of it, not a fresh zero buffer", () => {
    const painter = new MaskPainter(20, 20);
    const seeded = new Uint8Array(20 * 20).fill(100);
    painter.loadFrom(seeded);
    expect(painter.getMaskData()[10 * 20 + 10]).toBe(100);
    painter.paintStroke(10, 10, 5, 1.0, false);
    const data = painter.getMaskData();
    expect(data[10 * 20 + 10]).toBeGreaterThan(100);
    // unaffected area still reflects the loaded seed, not a zero-fill
    expect(data[0]).toBe(100);
  });

  describe("paintLine", () => {
    it("fills the gap between two far-apart points instead of leaving a hole (regression: dotted-trail bug)", () => {
      const painter = new MaskPainter(100, 20);
      // Small brush, endpoints 40px apart — a single dab at each end would
      // leave a large untouched gap in between (the reported bug).
      painter.paintLine(10, 10, 50, 10, 5, 1.0, false);
      const data = painter.getMaskData();
      const midpoint = data[10 * 100 + 30]; // halfway between 10 and 50
      expect(midpoint).toBeGreaterThan(200);
    });

    it("with zero distance (same point twice) behaves like a single paintStroke dab", () => {
      const a = new MaskPainter(20, 20);
      a.paintStroke(10, 10, 5, 1.0, false);
      const b = new MaskPainter(20, 20);
      b.paintLine(10, 10, 10, 10, 5, 1.0, false);
      expect(b.getMaskData()).toEqual(a.getMaskData());
    });

    it("does not double-stamp the FROM point (already painted by the previous call)", () => {
      const painter = new MaskPainter(30, 20);
      painter.paintStroke(5, 10, 3, 1.0, false); // simulates the previous point already painted
      const afterFirstDab = painter.getMaskData()[10 * 30 + 5];
      painter.paintLine(5, 10, 8, 10, 3, 1.0, false);
      // The FROM point's value shouldn't jump past full saturation from a
      // redundant overlapping dab beyond what erase/paint clamping already allows.
      expect(painter.getMaskData()[10 * 30 + 5]).toBe(Math.min(255, afterFirstDab));
    });

    it("returns a DirtyRect covering the union of the interpolated dabs, up to the TO point's edge", () => {
      const painter = new MaskPainter(100, 100);
      // The exact FROM dab is deliberately excluded (see paintLine's doc
      // comment — the caller already painted it), so the rect starts near
      // fromX+spacing, not fromX itself.
      const rect = painter.paintLine(10, 10, 50, 10, 5, 1.0, false);
      expect(rect.x).toBeLessThanOrEqual(11);
      expect(rect.y).toBeLessThanOrEqual(5);
      expect(rect.x + rect.width).toBeGreaterThanOrEqual(55);
    });

    it("erase mode propagates through interpolated dabs, not just the endpoints", () => {
      const painter = new MaskPainter(100, 20);
      painter.clear(255);
      painter.paintLine(10, 10, 50, 10, 5, 1.0, true);
      const data = painter.getMaskData();
      expect(data[10 * 100 + 30]).toBeLessThan(50);
    });
  });
});

describe("MaskPainter — opacité (plafond du trait) et débit (dépôt par tampon)", () => {
  const CENTER = 10 * 20 + 10; // index du pixel (10,10) dans une image 20x20

  it("un trait à opacité 0.5 plafonne à 50 % même en repassant cent fois AU COURS DU MÊME TRAIT", () => {
    const painter = new MaskPainter(20, 20);
    painter.beginStroke();
    for (let i = 0; i < 100; i++) {
      painter.paintStroke(10, 10, { radius: 5, hardness: 1, erase: false, opacity: 0.5, flow: 0.1 });
    }
    // 0.5 x 255 = 127.5, non représentable en octet : le plafond est quantifié
    // vers le BAS pour que « ne dépasse jamais 50 % » soit vrai à l'octet près.
    expect(painter.getMaskData()[CENTER]).toBe(127);
  });

  it("à débit faible, la valeur monte tampon par tampon au lieu de saturer au premier", () => {
    const painter = new MaskPainter(20, 20);
    painter.beginStroke();
    const brush: BrushSettings = { radius: 5, hardness: 1, erase: false, opacity: 1, flow: 0.1 };
    const trace: number[] = [];
    for (let i = 0; i < 4; i++) {
      painter.paintStroke(10, 10, brush);
      trace.push(painter.getMaskData()[CENTER]);
    }
    // Strictement croissant, et encore loin de 255 après quatre tampons : c'est
    // exactement ce que « débit » veut dire, et ce que le peintre d'avant ne
    // savait pas faire (chaque tampon écrivait à pleine force).
    expect(trace[0]).toBeGreaterThan(0);
    expect(trace[0]).toBeLessThan(40);
    expect(trace).toEqual([...trace].sort((a, b) => a - b));
    expect(new Set(trace).size).toBe(trace.length);
    expect(trace[3]).toBeLessThan(255);
  });

  it("deux traits SÉPARÉS à opacité 0.5 dépassent 50 % — le plafond se réancre sur ce qui était là AVANT le trait", () => {
    const painter = new MaskPainter(20, 20);
    const brush: BrushSettings = { radius: 5, hardness: 1, erase: false, opacity: 0.5, flow: 1 };

    painter.beginStroke();
    painter.paintStroke(10, 10, brush);
    painter.endStroke();
    const afterFirst = painter.getMaskData()[CENTER];
    expect(afterFirst).toBe(127);

    painter.beginStroke();
    painter.paintStroke(10, 10, brush);
    painter.endStroke();
    // Plafond du 2e trait = 127 + 0.5 x (255 - 127) = 191.
    expect(painter.getMaskData()[CENTER]).toBe(191);
    expect(painter.getMaskData()[CENTER]).toBeGreaterThan(afterFirst);
  });

  it("gommer à opacité 0.5 ne descend jamais sous la moitié de ce qui était là avant le trait", () => {
    const painter = new MaskPainter(20, 20);
    painter.clear(255);
    painter.beginStroke();
    for (let i = 0; i < 50; i++) {
      painter.paintStroke(10, 10, { radius: 5, hardness: 1, erase: true, opacity: 0.5, flow: 1 });
    }
    // Plancher = 255 x (1 - 0.5) = 127.5, quantifié vers le HAUT (symétrique du
    // plafond de peinture : on ne franchit jamais la limite demandée).
    expect(painter.getMaskData()[CENTER]).toBe(128);
  });

  it("le débit s'applique aussi aux tampons interpolés de paintLine, pas seulement aux extrémités", () => {
    const slow = new MaskPainter(100, 20);
    slow.paintLine(10, 10, 50, 10, { radius: 5, hardness: 1, erase: false, opacity: 1, flow: 0.05 });
    const fast = new MaskPainter(100, 20);
    fast.paintLine(10, 10, 50, 10, fullBrush(5, 1));
    const midpoint = 10 * 100 + 30;
    expect(fast.getMaskData()[midpoint]).toBe(255);
    expect(slow.getMaskData()[midpoint]).toBeGreaterThan(0);
    expect(slow.getMaskData()[midpoint]).toBeLessThan(255);
  });

  it("opacité 0 ne dépose rien (le plafond du trait est la valeur d'avant le trait)", () => {
    const painter = new MaskPainter(20, 20);
    painter.loadFrom(new Uint8Array(400).fill(60));
    painter.paintStroke(10, 10, { radius: 5, hardness: 1, erase: false, opacity: 0, flow: 1 });
    expect(painter.getMaskData()[CENTER]).toBe(60);
  });

  it("débit 0 ne dépose rien non plus, sans jamais faire baisser la valeur", () => {
    const painter = new MaskPainter(20, 20);
    painter.loadFrom(new Uint8Array(400).fill(60));
    painter.paintStroke(10, 10, { radius: 5, hardness: 1, erase: false, opacity: 1, flow: 0 });
    expect(painter.getMaskData()[CENTER]).toBe(60);
  });

  describe("cycle de vie du trait", () => {
    it("un tampon sans beginStroke ouvre le trait de lui-même (l'ancre est ce premier tampon)", () => {
      const painter = new MaskPainter(20, 20);
      const brush: BrushSettings = { radius: 5, hardness: 1, erase: false, opacity: 0.5, flow: 1 };
      painter.paintStroke(10, 10, brush);
      painter.paintStroke(10, 10, brush);
      expect(painter.getMaskData()[CENTER]).toBe(127); // toujours le même trait
    });

    it("loadFrom termine le trait courant — sinon le plafond resterait ancré sur un masque qui n'existe plus (undo/redo)", () => {
      const painter = new MaskPainter(20, 20);
      const brush: BrushSettings = { radius: 5, hardness: 1, erase: false, opacity: 0.5, flow: 1 };
      painter.beginStroke();
      painter.paintStroke(10, 10, brush);
      painter.loadFrom(new Uint8Array(400).fill(200));
      painter.paintStroke(10, 10, brush);
      // Plafond réancré sur 200 : 200 + 0.5 x 55 = 227.5 -> 227.
      expect(painter.getMaskData()[CENTER]).toBe(227);
    });

    it("clear termine le trait courant pour la même raison", () => {
      const painter = new MaskPainter(20, 20);
      const brush: BrushSettings = { radius: 5, hardness: 1, erase: false, opacity: 0.5, flow: 1 };
      painter.beginStroke();
      painter.paintStroke(10, 10, brush);
      painter.clear(0);
      painter.paintStroke(10, 10, brush);
      expect(painter.getMaskData()[CENTER]).toBe(127);
    });
  });

  describe("équivalence historique (opacité 1 / débit 1)", () => {
    /** La formule EXACTE du peintre d'avant opacité/débit : chaque tampon écrit
     *  à pleine force, additivement, clampé à [0,255]. Elle est recopiée ici
     *  telle quelle parce que c'est le rendu déjà validé à l'œil et verrouillé
     *  au pixel par `npm run test:render` — le couple opacité 1 / débit 1 doit
     *  rester byte-identique, sinon la fonctionnalité se paie d'une régression
     *  visuelle silencieuse sur tous les traits existants. */
    function legacyStroke(
      data: Uint8Array,
      width: number,
      height: number,
      x: number,
      y: number,
      radius: number,
      hardness: number,
      erase: boolean
    ): void {
      const minX = Math.max(0, Math.floor(x - radius));
      const maxX = Math.min(width - 1, Math.ceil(x + radius));
      const minY = Math.max(0, Math.floor(y - radius));
      const maxY = Math.min(height - 1, Math.ceil(y + radius));
      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const dist = Math.hypot(px - x, py - y);
          if (dist > radius) continue;
          const falloffStart = radius * hardness;
          let strength = 1.0;
          if (dist > falloffStart) {
            strength = 1.0 - (dist - falloffStart) / Math.max(radius - falloffStart, 0.0001);
          }
          const idx = py * width + px;
          const delta = strength * 255;
          const current = data[idx];
          data[idx] = erase ? Math.max(0, current - delta) : Math.min(255, current + delta);
        }
      }
    }

    it("un pinceau DOUX sur un masque déjà peint rend exactement les mêmes octets qu'avant", () => {
      const painter = new MaskPainter(40, 40);
      const seed = new Uint8Array(40 * 40).fill(100);
      painter.loadFrom(seed);
      const expected = new Uint8Array(seed);

      // Hardness 0.3 : le fondu est réel, donc les tampons partiels — le seul
      // endroit où une formule additive et une formule à plafond peuvent
      // diverger — sont bien exercés.
      for (let i = 0; i < 6; i++) {
        painter.paintStroke(18 + i, 20, fullBrush(7, 0.3));
        legacyStroke(expected, 40, 40, 18 + i, 20, 7, 0.3, false);
      }
      expect(painter.getMaskData()).toEqual(expected);
    });

    it("une GOMME douce sur un masque plein rend exactement les mêmes octets qu'avant", () => {
      const painter = new MaskPainter(40, 40);
      painter.clear(255);
      const expected = new Uint8Array(40 * 40).fill(255);
      for (let i = 0; i < 6; i++) {
        painter.paintStroke(18 + i, 20, fullBrush(7, 0.3, true));
        legacyStroke(expected, 40, 40, 18 + i, 20, 7, 0.3, true);
      }
      expect(painter.getMaskData()).toEqual(expected);
    });

    it("la forme positionnelle héritée (5 arguments) équivaut à opacité 1 / débit 1", () => {
      const positional = new MaskPainter(40, 40);
      positional.loadFrom(new Uint8Array(40 * 40).fill(100));
      positional.paintLine(10, 20, 30, 20, 7, 0.3, false);

      const settings = new MaskPainter(40, 40);
      settings.loadFrom(new Uint8Array(40 * 40).fill(100));
      settings.paintLine(10, 20, 30, 20, fullBrush(7, 0.3));

      expect(positional.getMaskData()).toEqual(settings.getMaskData());
    });
  });
});
