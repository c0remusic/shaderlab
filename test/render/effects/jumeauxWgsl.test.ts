import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Garde de JUMEAU : une constante d'un corps WGSL ne s'écrit pas à la main.
 *
 * Onze modules d'effets portent un JUMEAU TypeScript de leur shader — une
 * fonction qui recalcule sur le CPU ce que le GPU calcule, pour que le
 * comportement soit testable sans GPU. Ce que rien ne garantissait, c'est que
 * les deux disent la même chose : sept des onze n'ont aucun lien avec leur
 * WGSL, et le seul recours est `npm run test:render`, une porte locale qui
 * exige une vraie fenêtre et ne tourne pas en CI.
 *
 * Fermer entièrement cet écart demanderait de GÉNÉRER le corps WGSL depuis la
 * source TS — un chantier qui change la chaîne de chaque shader, donc la clé de
 * cache de `shaderCompose`, et qu'il faut mener effet par effet. Cette garde
 * ferme la moitié qui a RÉELLEMENT divergé, mesurée le 2026-09-15 : les
 * CONSTANTES écrites deux fois, une fois côté twin et une fois en dur dans le
 * WGSL, souvent sous un autre nom.
 *
 * Sept cas trouvés à l'écriture, tous réparés en les interpolant :
 * `CG_BLEND_MAP_A` (qui divergeait déjà — `0.42857142857142866` contre
 * `0.42857143`), les deux d'`etalonnage` et les quatre de `reglagesDeBase`.
 *
 * Le mécanisme n'a rien de neuf : `bayer.ts` le dit depuis toujours pour sa
 * matrice — « une seule source pour la matrice, côté CPU comme côté GPU ». Il
 * n'avait simplement jamais été tourné vers les constantes SCALAIRES.
 */

const RACINE = join(process.cwd(), "src", "render", "effects");

/**
 * Constantes que l'on accepte de voir écrites en dur, avec la raison.
 *
 * Le critère n'est PAS « elle est petite » mais « existe-t-il une seconde
 * écriture qui pourrait diverger ? ». Une constante mathématique universelle
 * n'en a pas ; une constante propre au shader et absente du twin non plus.
 */
const TOLEREES: Record<string, string> = {
  TAU: "constante mathématique universelle : aucune seconde écriture à tenir d'accord.",
  LEAK_BASE: "`lightLeak` n'a pas de jumeau TS — rien en face qui puisse diverger.",
};

/** ⚠️ La garde ne vise que les constantes SCALAIRES : un `const X = vec3<f32>(…)`
 *  lui échappe (`LEAK_ECART` en est un). C'est une portée, pas un oubli — un
 *  vecteur écrit en dur pose la même question, et l'étendre demande de savoir
 *  lire un constructeur WGSL. Dit ici plutôt que découvert plus tard. */

/** Les `const NOM = <littéral numérique>;` situés DANS un corps `wgsl:`. */
function constantesEnDur(source: string): string[] {
  const trouvees: string[] = [];
  let dansWgsl = false;
  for (const ligne of source.split("\n")) {
    if (/\bwgsl:\s*`/.test(ligne)) dansWgsl = true;
    else if (dansWgsl && /^\s*`,?\s*$/.test(ligne)) dansWgsl = false;
    if (!dansWgsl) continue;
    const m = /^\s*const ([A-Z][A-Z0-9_]*)\s*(?::\s*f32\s*)?=\s*-?[0-9]/.exec(ligne);
    // Une ligne qui interpole (`${...}`) est par construction d'accord avec sa
    // source TS : c'est exactement ce que la garde demande.
    if (m && !ligne.includes("${")) trouvees.push(m[1]);
  }
  return trouvees;
}

describe("jumeaux TS/WGSL — les constantes ne s'écrivent pas deux fois", () => {
  const fichiers = readdirSync(RACINE).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("lit bien les corps WGSL — garde de SIGNAL", () => {
    // Sans elle, un changement de forme du fichier (indentation, renommage de
    // `wgsl:`) ferait passer la garde au vert en n'inspectant rien.
    const avecWgsl = fichiers.filter((f) => readFileSync(join(RACINE, f), "utf8").includes("wgsl: `"));
    expect(avecWgsl.length).toBeGreaterThanOrEqual(25);
  });

  it("aucune constante en dur, hors les tolérées qui disent pourquoi", () => {
    const fautives: string[] = [];
    for (const fichier of fichiers) {
      const source = readFileSync(join(RACINE, fichier), "utf8");
      for (const nom of constantesEnDur(source)) {
        if (nom in TOLEREES) continue;
        fautives.push(`${fichier} : ${nom}`);
      }
    }
    expect(fautives).toEqual([]);
  });

  it("chaque tolérance est encore UTILISÉE — une dérogation périmée se retire", () => {
    // Même principe que `ECART_CONNU_PARAMS` du gate naga : une dérogation qui
    // ne couvre plus rien fait croire à une exception qui n'existe pas.
    const vues = new Set<string>();
    for (const fichier of fichiers) {
      for (const nom of constantesEnDur(readFileSync(join(RACINE, fichier), "utf8"))) vues.add(nom);
    }
    expect(Object.keys(TOLEREES).filter((n) => !vues.has(n))).toEqual([]);
  });
});
