import { describe, it, expect } from "vitest";
import { BLOC, mesurerStructureAjoutee, type FrameLike } from "../../src/render/frameStructure";

const W = 256;
const H = 256;

function frame(remplir: (x: number, y: number) => number): FrameLike {
  const pixels = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const v = Math.max(0, Math.min(255, Math.round(remplir(x, y))));
      const p = (y * W + x) * 4;
      pixels[p] = v;
      pixels[p + 1] = v;
      pixels[p + 2] = v;
      pixels[p + 3] = 255;
    }
  }
  return { pixels, width: W, height: H };
}

/** Générateur déterministe — un test qui dépend de `Math.random` rougit un jour
 *  sur deux et on finit par ne plus le lire. */
function alea(graine: number): () => number {
  let s = graine >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PLAT = frame(() => 128);

describe("mesurerStructureAjoutee", () => {
  it("un bruit BLANC perd ~3/4 de son écart en moyennant 4×4", () => {
    // Théorie : moyenner 16 échantillons INDÉPENDANTS divise l'écart-type par
    // racine(16) = 4, soit une survie de 0,25. C'est le point de repère qui
    // donne son sens à tous les autres.
    const r = alea(12345);
    const bruit = frame(() => 128 + (r() - 0.5) * 100);
    const m = mesurerStructureAjoutee(PLAT, bruit)!;
    expect(m.survie).toBeGreaterThan(0.2);
    expect(m.survie).toBeLessThan(0.32);
  });

  it("un bruit CORRÉLÉ garde presque tout son écart", () => {
    // Motif constant par blocs de 8, donc deux fois plus large que le bloc de
    // moyennage : le moyennage ne peut rien annuler. C'est la propriété que
    // porte un grain qui s'agglomère et déborde du pixel.
    const r = alea(999);
    const cellules = new Map<string, number>();
    const correle = frame((x, y) => {
      const cle = `${Math.floor(x / 8)},${Math.floor(y / 8)}`;
      if (!cellules.has(cle)) cellules.set(cle, 128 + (r() - 0.5) * 100);
      return cellules.get(cle)!;
    });
    const m = mesurerStructureAjoutee(PLAT, correle)!;
    expect(m.survie).toBeGreaterThan(0.9);
  });

  it("SÉPARE les deux — c'est toute la raison d'être de l'instrument", () => {
    // Un instrument qui rendrait des valeurs proches sur ces deux cas ne
    // distinguerait pas « du hasard par pixel » de « des grappes », et la
    // mesure du 2026-08-05 sur `grain` (0,81) n'aurait rien voulu dire.
    const r1 = alea(7);
    const blanc = mesurerStructureAjoutee(PLAT, frame(() => 128 + (r1() - 0.5) * 100))!;
    const r2 = alea(7);
    const cellules = new Map<string, number>();
    const grappes = mesurerStructureAjoutee(
      PLAT,
      frame((x, y) => {
        const cle = `${Math.floor(x / 8)},${Math.floor(y / 8)}`;
        if (!cellules.has(cle)) cellules.set(cle, 128 + (r2() - 0.5) * 100);
        return cellules.get(cle)!;
      }),
    )!;
    expect(grappes.survie).toBeGreaterThan(blanc.survie * 3);
  });

  it("le RAPPORT ne dépend pas de l'amplitude, les écarts bruts si", () => {
    // C'est pourquoi `survie` est le seul chiffre publiable : monter
    // l'intensité d'un grain change `plein` et `reduit`, jamais leur rapport.
    // ⚠️ Le générateur se crée UNE FOIS, hors du rappel. L'appeler dans le
    // rappel (`alea(3)()`) le réinitialise à chaque pixel : image constante,
    // écart nul, et l'assertion échoue pour une raison qui n'a rien à voir
    // avec ce qu'elle teste.
    const rf = alea(3);
    const faible = mesurerStructureAjoutee(PLAT, frame(() => (rf() > 0.5 ? 130 : 126)))!;
    const rF = alea(3);
    const fort = mesurerStructureAjoutee(PLAT, frame(() => (rF() > 0.5 ? 180 : 76)))!;
    expect(fort.plein).toBeGreaterThan(faible.plein * 5);
    expect(fort.survie).toBeCloseTo(faible.survie, 5);
  });

  it("rend null sur des dimensions différentes plutôt qu'un chiffre inventé", () => {
    const autre: FrameLike = { pixels: new Uint8Array(4), width: 1, height: 1 };
    expect(mesurerStructureAjoutee(PLAT, autre)).toBeNull();
    expect(mesurerStructureAjoutee(autre, PLAT)).toBeNull();
  });

  it("rend une survie nulle sur un delta strictement nul, sans diviser par zéro", () => {
    const m = mesurerStructureAjoutee(PLAT, PLAT)!;
    expect(m.plein).toBe(0);
    expect(m.survie).toBe(0);
  });

  it("expose la taille de bloc qui donne son sens au repère 0,25", () => {
    expect(BLOC).toBe(4);
  });
});
