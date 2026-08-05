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

describe("warp — les huit types analytiques", () => {
  it("garde le bruit fractal à l'index 0, donc en défaut", () => {
    // C'est ce qui permet d'ajouter huit rendus à un effet déjà présent dans
    // des presets sans en bouger aucun. `test:render` le confirme : le seul
    // scénario qui pose un warp n'a pas bougé après cet ajout.
    const type = warp.params.find((p) => p.name === "type");
    expect(type?.choices?.[0]).toBe("Bruit fractal");
    expect(type?.default).toBe(0);
    expect(type?.choices).toHaveLength(9);
  });

  it("branche sur un UNIFORME, donc une seule famille s'exécute", () => {
    expect(warp.wgsl).toContain("let kind = i32(params[7] + 0.5);");
    expect(warp.wgsl).toContain("if (kind == 0) {");
  });

  it("rend les huit formes, et rien au-delà", () => {
    for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(warp.wgsl).toContain(`if (kind == ${k}) {`);
    }
    // Repli explicite : un index inconnu ne déforme pas, il ne bricole pas.
    expect(warp.wgsl).toContain("return vec2<f32>(0.0);");
  });

  it("écrit la torsion comme une DIFFÉRENCE, pas comme une tangente", () => {
    // Une tangente donnerait une spirale qui s'ouvre au lieu de se refermer :
    // le déplacement doit être l'écart entre le point tourné et le point
    // d'origine, sinon la rotation n'est plus une rotation.
    expect(warp.wgsl).toContain("return vec2<f32>(q.x * c2 - q.y * s2, q.x * s2 + q.y * c2) - q;");
  });

  it("décroît par une gaussienne, sans borne de rayon", () => {
    // Une borne poserait un cercle visible à sa limite. Le revers, mesuré et
    // écrit : la déformation ne s'annule pas non plus — à échelle 3 le facteur
    // vaut encore ~0.23 dans les coins.
    expect(warp.wgsl).toContain("let decay = exp(-r * r * freq);");
    expect(Math.exp(-(0.7 ** 2) * 3)).toBeCloseTo(0.23, 2);
  });

  it("protège la direction radiale au centre exact", () => {
    expect(warp.wgsl).toContain("let dir = q / max(r, 0.0001);");
  });
});

describe("warp — les dix réglages rangés en trois sections", () => {
  const sections = warp.sections!;

  it("range chaque paramètre dans exactement une section, sans toucher à params[]", () => {
    // Les sections sont une donnée d'AFFICHAGE : l'index d'un paramètre est
    // persisté dans les presets, donc l'ordre de `params[]` ne bouge pas et la
    // couverture se vérifie comme un ENSEMBLE, pas comme une concaténation.
    // C'est la différence avec `glass`, dont les trois sections tombaient déjà
    // contiguës : ici deux blocs se déplacent à l'affichage (l'anisotropie et
    // la torsion remontent avec l'échelle et l'amplitude, la graine redescend
    // avec les octaves), ce que `groupEffectParams` fait en attirant un item
    // vers la section déjà ouverte plus haut.
    expect(sections.map((s) => s.id)).toEqual(["deplacement", "bruit", "forme"]);
    expect([...sections.flatMap((s) => s.params)].sort()).toEqual([...warp.params.map((p) => p.name)].sort());
  });

  it("sépare ce que la seule branche du bruit lit de ce que les neuf types lisent", () => {
    // Le découpage EST celui du shader : une famille fabrique le déplacement,
    // tout ce qui suit le branchement est commun.
    expect(sections[0].params).toEqual(["scale", "amplitude", "anisotropy", "twist"]);
    expect(sections[1].params).toEqual(["octaves", "roughness", "seed"]);
    expect(sections[2].params).toEqual(["type", "centerX", "centerY"]);
    expect(sections.map((s) => s.layout)).toEqual(["liste", "liste", "liste"]);
  });

  it("ne masque RIEN de plus que ce qui a été mesuré", () => {
    // Les deux conditions tentantes — le bruit hors du type 0, la forme
    // restreinte aux huit types centrés — porteraient sur des déclarations que
    // la campagne du 2026-08-05 n'a jamais éprouvées, et la seconde emporterait
    // `centerY`, laissé visible pour cette raison exacte. Un curseur masqué à
    // tort ne bouge plus aucun pixel : aucune référence de rendu ne peut le
    // dire, ce test est le seul endroit qui le tienne.
    for (const section of sections) expect(section.appliesWhen).toBeUndefined();
    // Le seul masquage de l'effet reste celui qui a été mesuré, au paramètre.
    expect(warp.params.find((p) => p.name === "centerX")?.appliesWhen).toEqual({ param: "type", equals: [1, 2, 3, 4, 5, 6, 7, 8] });
    expect(warp.params.find((p) => p.name === "centerY")?.appliesWhen).toBeUndefined();
  });
});
