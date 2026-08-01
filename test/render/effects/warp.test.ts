import { describe, it, expect } from "vitest";
import { warp } from "../../../src/render/effects/warp";

/**
 * QUATRE CONTRÔLES SUR SEPT ÉTAIENT CASSÉS, du 2026-07-31 au 2026-08-01.
 *
 * `5ffd6b3 feat(effets): parametres etendus` a ajouté `roughness`,
 * `anisotropy`, `twist` et `seed` à la LISTE sans jamais les câbler au shader,
 * qui ne lisait que `params[0..3]`. Conséquences, toutes silencieuses :
 *
 * - `params[3]` était lu comme la GRAINE, alors que l'index 3 est celui de la
 *   rugosité. Bouger « Rugosité » changeait le motif du bruit.
 * - « Graine » (index 6), « Anisotropie » (4) et « Torsion » (5) n'étaient lus
 *   NULLE PART. Trois curseurs morts, avec des `hint` décrivant un comportement
 *   inexistant.
 * - La persistance du FBM restait figée à 0.5, alors que le commentaire de
 *   `roughness` annonçait la correction au passé.
 *
 * Aucun test ne pouvait le voir : les tests d'effet vérifient la présence
 * textuelle d'appels dans le WGSL, et un `params[N]` absent ne se remarque pas.
 * Ce fichier vérifie la CORRESPONDANCE entre la position d'un paramètre dans la
 * liste et l'index que le shader lit — la seule chose qui manquait.
 */

/** L'index de `nom` dans la liste déclarée. C'est celui que le uniform porte
 *  (`effectPassRunner` remplit le Float32Array dans l'ordre de `params`). */
const index = (nom: string) => warp.params.findIndex((p) => p.name === nom);

describe("warp — chaque paramètre déclaré est lu à SON index", () => {
  it.each([
    ["scale", "let scale = params[0];"],
    ["amplitude", "let amplitude = params[1];"],
    ["octaves", "let octaves = i32(params[2]);"],
    ["roughness", "let roughness = clamp(params[3], 0.05, 0.95);"],
    ["anisotropy", "let anisotropy = clamp(params[4], -1.0, 1.0);"],
    ["twist", "let twist = radians(params[5]);"],
    ["seed", "let seed = params[6];"],
  ])("%s", (nom, ligne) => {
    const i = index(nom);
    expect(i).toBeGreaterThanOrEqual(0);
    // La ligne attendue cite l'index ; on vérifie qu'il vaut bien la position
    // déclarée, et que le shader porte cette ligne.
    expect(ligne).toContain(`params[${i}]`);
    expect(warp.wgsl).toContain(ligne);
  });

  it("ne laisse AUCUN paramètre déclaré sans lecture", () => {
    // La garde qui manquait. Un paramètre ajouté à la liste sans être câblé est
    // un contrôle inerte — ce que ce dépôt proscrit — et rien ne le signalait.
    const lus = new Set([...warp.wgsl.matchAll(/params\[(\d+)\]/g)].map((m) => Number(m[1])));
    const manquants = warp.params.map((p, i) => [p.name, i] as const).filter(([, i]) => !lus.has(i));
    expect(manquants).toEqual([]);
  });
});

describe("warp — les quatre réparations sont NEUTRES sur leur défaut", () => {
  it("persistance : le défaut vaut la constante qui était figée", () => {
    // 0.5 = la valeur en dur d'avant. La suite des poids reste 0.5, 0.25,
    // 0.125… donc le FBM ne bouge pas d'un bit à réglages par défaut.
    expect(warp.params[index("roughness")].default).toBe(0.5);
    expect(warp.wgsl).toContain("amplitude = amplitude * persistence;");
  });

  it("torsion : le défaut est l'identité", () => {
    expect(warp.params[index("twist")].default).toBe(0);
    expect(warp.wgsl).toContain("raw = vec2<f32>(raw.x * c - raw.y * s, raw.x * s + raw.y * c);");
  });

  it("anisotropie : le défaut donne un facteur (1, 1)", () => {
    expect(warp.params[index("anisotropy")].default).toBe(0);
    expect(warp.wgsl).toContain("raw = raw * vec2<f32>(1.0 + anisotropy, 1.0 - anisotropy);");
  });

  it("la somme des poids du FBM n'est PAS normalisée", () => {
    // À dessein : normaliser changerait le rendu par défaut. Le revers est
    // assumé et écrit dans le libellé — monter la rugosité augmente aussi le
    // déplacement total, parce que c'est ce que fait une persistance.
    expect(warp.wgsl).not.toContain("value / norm");
    expect(warp.wgsl).not.toMatch(/var norm/);
  });
});

describe("warp — la graine, seule réparation qui CHANGE un rendu", () => {
  it("est lue à l'index 6 et non à l'index 3", () => {
    // C'est la seule des quatre dont le correctif déplace des pixels : le
    // shader utilisait jusqu'ici la valeur de `roughness` (0.5 par défaut)
    // comme graine. `masque-pinceau-degrade`, seul scénario de rendu qui pose
    // un warp, a donc été régénéré — il déclarait `seed: 2` sans effet.
    expect(index("seed")).toBe(6);
    expect(warp.wgsl).toContain("let seed = params[6];");
    expect(warp.wgsl).not.toContain("let seed = params[3];");
  });
});
