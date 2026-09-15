import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { scannerBackticks } from "../../scripts/wgslBackticks.mjs";

/**
 * Le piège le plus répété du dépôt, enfin vérifié là où la CI regarde.
 *
 * Un backtick nu dans un commentaire WGSL ferme le template literal qui le
 * contient. Dix occurrences datées, dont SEPT en une seule journée et une trois
 * heures après que l'avertissement eut été écrit. Le diagnostic désigne
 * systématiquement la mauvaise ligne : `tsc` rend TS1005 loin de la faute, et un
 * fichier qui ne parse plus fait échouer des tests sans rapport avec lui.
 *
 * La garde existait, correcte, dans `.claude/hooks/wgsl-backtick-guard.mjs` —
 * mais câblée en `PostToolUse` d'un agent SEULEMENT. Une édition humaine hors
 * Claude Code ne la déclenchait pas, et elle n'était ni dans `npm run lint` ni
 * dans la CI. Un seul appelant, donc une garde qui ne gardait que la moitié des
 * chemins d'écriture.
 *
 * Le corps de la machine à états n'a pas changé : il est extrait tel quel dans
 * `scripts/wgslBackticks.mjs`, que le hook et ce test lisent tous les deux.
 *
 * ⚠️ Ce test tourne dans `npm run test`, donc EN CI — c'est tout l'objet du
 * déplacement. 279 backticks échappés à la main vivent dans 30 fichiers ; chacun
 * est une occasion de faute, et aucune n'était rattrapée par une porte partagée.
 */

const RACINE = process.cwd();

/** Le même périmètre que le hook : les modules d'effets et le harnais de rendu,
 *  les deux seuls terrains où un `//` se trouve DANS un template literal. */
function fichiersSurveilles(): string[] {
  const effets = readdirSync(join(RACINE, "src", "render", "effects"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join("src", "render", "effects", f));
  return [...effets, join("scripts", "render-check.mjs")];
}

describe("piège du backtick dans un commentaire WGSL", () => {
  const fichiers = fichiersSurveilles();

  it("surveille bien le périmètre — garde de SIGNAL", () => {
    // Sans elle, un chemin devenu faux ferait passer la garde au vert en
    // n'inspectant aucun fichier.
    expect(fichiers.length).toBeGreaterThanOrEqual(30);
    for (const f of fichiers) expect(readFileSync(join(RACINE, f), "utf8").length).toBeGreaterThan(0);
  });

  it("aucun backtick nu, aucune interpolation ouverte, aucun literal resté ouvert", () => {
    const problemes: string[] = [];
    for (const fichier of fichiers) {
      const { trouves, literalNonFerme } = scannerBackticks(readFileSync(join(RACINE, fichier), "utf8"));
      for (const t of trouves) problemes.push(`${fichier}:${t.ligne} ${t.message}`);
      if (literalNonFerme) problemes.push(`${fichier} — template literal OUVERT en fin de fichier`);
    }
    expect(problemes).toEqual([]);
  });

  it("le scanner SAIT rougir — témoin de discrimination", () => {
    // Une garde qui ne peut pas échouer rend un vert sans valeur. Le témoin est
    // une source fabriquée qui porte exactement la faute visée.
    const fautif = "const m = { wgsl: `\nfn f() {\n  // ceci ferme le `literal\n}\n` }";
    expect(scannerBackticks(fautif).trouves.length).toBeGreaterThan(0);

    // Et la forme CORRECTE — le backtick échappé — ne doit pas être punie.
    const correct = "const m = { wgsl: `\nfn f() {\n  // ceci est \\`propre\\`\n}\n` }";
    expect(scannerBackticks(correct).trouves).toEqual([]);
  });

  it("ne punit pas les backticks de PROSE hors template literal", () => {
    // Hors literal, `//` est un vrai commentaire JS où les backticks sont
    // idiomatiques dans ce dépôt — les flaguer noierait le signal.
    const prose = "// voir `EffectModule.wgsl` et `params[0]`\nconst x = 1;";
    expect(scannerBackticks(prose).trouves).toEqual([]);
  });

  it("ne prend pas le `//` d'une URL pour un commentaire", () => {
    // Cas réel : `render-check.mjs` interpole un `http://localhost:${port}`.
    const url = "const m = { wgsl: `\nlet u = 1.0; // http://exemple\n` }";
    expect(scannerBackticks(url).trouves).toEqual([]);
  });
});
