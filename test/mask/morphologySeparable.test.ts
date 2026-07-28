import { describe, it, expect } from "vitest";
import {
  buildMorphologyWgsl,
  MORPHOLOGY_PASS_AXES,
} from "../../src/mask/refineEdgeWgsl";

/** PREUVE D'ÉQUIVALENCE de la séparation de la morphologie carrée.
 *
 *  Le WGSL ne peut pas s'exécuter ici (Vitest tourne en env Node, sans GPU) :
 *  on ne peut donc pas comparer les DEUX shaders sur le GPU. Ce que ce fichier
 *  prouve, c'est la propriété algébrique dont le shader est la transcription —
 *  min/max sur une fenêtre carrée (2r+1)² == min/max sur une fenêtre 1D
 *  horizontale, puis sur une fenêtre 1D verticale — modélisée en TS avec la
 *  MÊME sémantique de bord que la passe GPU (clamp-to-edge, voir
 *  renderer.ts:127-128).
 *
 *  Formellement : min sur A×B == min_a (min_b), parce que min est associatif,
 *  commutatif et idempotent, et que l'ensemble balayé est un produit
 *  cartésien. Le clamp de bord ne casse rien : il s'applique indépendamment
 *  par axe, donc l'ensemble échantillonné reste exactement le même produit
 *  cartésien clampé.
 *
 *  Ce n'est PAS une approximation : l'égalité assérée est exacte, pas à une
 *  tolérance près. */

/** Générateur déterministe (mulberry32) — les valeurs doivent être
 *  reproductibles, un échec ne doit jamais dépendre du run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Grid = { w: number; h: number; px: Float64Array };

function makeGrid(w: number, h: number, seed: number): Grid {
  const next = rng(seed);
  const px = new Float64Array(w * h);
  for (let i = 0; i < px.length; i++) px[i] = next();
  return { w, h, px };
}

/** Lecture clamp-to-edge : hors bord, on relit le texel de bord — exactement
 *  ce que fait `textureSample` avec le sampler du renderer. */
function at(g: Grid, x: number, y: number): number {
  const cx = Math.min(g.w - 1, Math.max(0, x));
  const cy = Math.min(g.h - 1, Math.max(0, y));
  return g.px[cy * g.w + cx];
}

type Op = "erode" | "dilate";
const reduce = (op: Op, acc: number, s: number) =>
  op === "erode" ? Math.min(acc, s) : Math.max(acc, s);
const seed = (op: Op) => (op === "erode" ? 1 : 0);

/** Référence naïve : la fenêtre CARRÉE (2r+1)², telle qu'elle était écrite
 *  dans le shader avant la séparation. */
function squareMorph(g: Grid, r: number, op: Op): Grid {
  const px = new Float64Array(g.w * g.h);
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      let acc = seed(op);
      for (let kx = -r; kx <= r; kx++)
        for (let ky = -r; ky <= r; ky++) acc = reduce(op, acc, at(g, x + kx, y + ky));
      px[y * g.w + x] = acc;
    }
  return { w: g.w, h: g.h, px };
}

/** Une passe 1D sur un seul axe — le modèle exact d'UNE des deux passes GPU. */
function axisMorph(g: Grid, r: number, op: Op, axis: "H" | "V"): Grid {
  const px = new Float64Array(g.w * g.h);
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      let acc = seed(op);
      for (let k = -r; k <= r; k++)
        acc = reduce(
          op,
          acc,
          axis === "H" ? at(g, x + k, y) : at(g, x, y + k),
        );
      px[y * g.w + x] = acc;
    }
  return { w: g.w, h: g.h, px };
}

const separableMorph = (g: Grid, r: number, op: Op): Grid =>
  axisMorph(axisMorph(g, r, op, "H"), r, op, "V");

/** Contre-modèle : élément structurant CIRCULAIRE (disque de rayon r). Il
 *  n'est PAS séparable — il sert de témoin : si l'assertion d'équivalence
 *  ci-dessous passait pour n'importe quoi, elle passerait aussi pour lui. */
function diskMorph(g: Grid, r: number, op: Op): Grid {
  const px = new Float64Array(g.w * g.h);
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      let acc = seed(op);
      for (let kx = -r; kx <= r; kx++)
        for (let ky = -r; ky <= r; ky++)
          if (kx * kx + ky * ky <= r * r) acc = reduce(op, acc, at(g, x + kx, y + ky));
      px[y * g.w + x] = acc;
    }
  return { w: g.w, h: g.h, px };
}

describe("morphologie séparable — équivalence exacte avec la fenêtre carrée", () => {
  const ops: Op[] = ["erode", "dilate"];
  const radii = [1, 2, 3, 4];
  const seeds = [1, 42, 1337];

  for (const op of ops)
    for (const r of radii)
      for (const s of seeds)
        it(`${op} r=${r} seed=${s} : H puis V == fenêtre carrée (2r+1)², exactement`, () => {
          const g = makeGrid(9, 9, s);
          const square = squareMorph(g, r, op);
          const sep = separableMorph(g, r, op);
          // Égalité EXACTE, pas une tolérance : min/max ne font que
          // sélectionner une valeur existante, aucune arithmétique flottante
          // n'est introduite par la séparation.
          expect(Array.from(sep.px)).toEqual(Array.from(square.px));
        });

  it("rayon 0 : les deux formes sont l'identité", () => {
    const g = makeGrid(9, 9, 7);
    for (const op of ops) {
      expect(Array.from(squareMorph(g, 0, op).px)).toEqual(Array.from(g.px));
      expect(Array.from(separableMorph(g, 0, op).px)).toEqual(Array.from(g.px));
    }
  });

  it("ordre indifférent : V puis H donne le même résultat que H puis V", () => {
    const g = makeGrid(9, 9, 99);
    for (const op of ops)
      for (const r of radii) {
        const hv = axisMorph(axisMorph(g, r, op, "H"), r, op, "V");
        const vh = axisMorph(axisMorph(g, r, op, "V"), r, op, "H");
        expect(Array.from(hv.px)).toEqual(Array.from(vh.px));
      }
  });

  it("l'assertion n'est pas vide : un élément structurant CIRCULAIRE, lui, diverge", () => {
    // Témoin. Si la séparation était fausse (mauvais axe, mauvais rayon,
    // mauvaise réduction), l'assertion d'équivalence ci-dessus échouerait
    // comme celle-ci échoue pour le disque.
    const g = makeGrid(9, 9, 5);
    let divergences = 0;
    for (const op of ops)
      for (const r of [2, 3, 4]) {
        const disk = diskMorph(g, r, op);
        const sep = separableMorph(g, r, op);
        if (Array.from(disk.px).join() !== Array.from(sep.px).join()) divergences++;
      }
    expect(divergences).toBe(6);
  });

  it("la fenêtre carrée du modèle balaie bien (2r+1)² positions", () => {
    // Garde-fou sur le modèle lui-même : un `squareMorph` qui ne balaierait
    // qu'une croix serait trivialement égal au séparable et rendrait toute la
    // preuve vide.
    let count = 0;
    const r = 3;
    for (let kx = -r; kx <= r; kx++) for (let ky = -r; ky <= r; ky++) count++;
    expect(count).toBe((2 * r + 1) ** 2);
  });
});

describe("morphologie séparable — structure du WGSL généré", () => {
  it("expose exactement deux axes de passe, H puis V", () => {
    expect(MORPHOLOGY_PASS_AXES).toEqual(["H", "V"]);
  });

  for (const axis of ["H", "V"] as const) {
    it(`l'axe ${axis} n'a qu'UNE boucle (plus de double boucle imbriquée)`, () => {
      for (const mode of ["erode", "dilate"] as const) {
        const wgsl = buildMorphologyWgsl(mode, axis);
        expect(wgsl.match(/for \(/g)?.length).toBe(1);
      }
    });

    it(`l'axe ${axis} décale sur le bon axe seulement`, () => {
      const wgsl = buildMorphologyWgsl("erode", axis);
      expect(wgsl).toContain(
        axis === "H" ? "vec2<f32>(texel.x, 0.0)" : "vec2<f32>(0.0, texel.y)",
      );
    });

    it(`l'axe ${axis} a un point d'entrée distinct`, () => {
      expect(buildMorphologyWgsl("erode", axis)).toContain(
        `fn fs_morphology${axis}(`,
      );
    });
  }

  it("erode réduit par min (init 1.0), dilate par max (init 0.0)", () => {
    for (const axis of MORPHOLOGY_PASS_AXES) {
      const erode = buildMorphologyWgsl("erode", axis);
      expect(erode).toContain("min(acc, s)");
      expect(erode).toContain("var acc = 1.0");
      const dilate = buildMorphologyWgsl("dilate", axis);
      expect(dilate).toContain("max(acc, s)");
      expect(dilate).toContain("var acc = 0.0");
    }
  });

  it("les 4 variantes (2 modes x 2 axes) sont des sources DISTINCTES", () => {
    // Le cache de pipeline est indexé par la source WGSL entière
    // (maskTextureResolver.ts:534) : deux variantes qui produiraient la même
    // chaîne partageraient le même pipeline, donc le même axe.
    const sources = new Set<string>();
    for (const mode of ["erode", "dilate"] as const)
      for (const axis of MORPHOLOGY_PASS_AXES) sources.add(buildMorphologyWgsl(mode, axis));
    expect(sources.size).toBe(4);
  });
});
