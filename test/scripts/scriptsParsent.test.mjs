import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * TOUT SCRIPT `.mjs` DU DÉPÔT DOIT PARSER.
 *
 * D'OÙ ÇA VIENT. Un backtick dans un commentaire FERME le template literal qui
 * le porte. Le dépôt connaît le piège et le documente (`CLAUDE.md`, § Décisions
 * techniques verrouillées) — il a quand même été commis **six fois le
 * 2026-08-05**, dont une fois APRÈS que la règle ait été réécrite le jour même,
 * et une fois pendant la correction d'une autre occurrence.
 *
 * Une règle enfreinte six fois n'est pas mal documentée : elle n'est pas
 * applicable à la vigilance. Ce garde la rend mécanique.
 *
 * POURQUOI RIEN D'AUTRE NE L'ATTRAPAIT. Les corps `wgsl:` sont couverts par
 * `npx tsc --noEmit` (l'erreur `TS1005` désigne une ligne LOIN de la faute,
 * mais elle sort). Les scripts `.mjs`, eux, ne sont vus par AUCUN outil du
 * dépôt : ni `tsc` (ils ne sont pas dans le projet TS), ni ESLint (qui ne
 * plante pas sur un template literal mal fermé, il l'analyse comme une chaîne).
 * La faute ne se manifestait qu'à l'exécution, sur un `SyntaxError` désignant
 * le mot QUI SUIT le backtick — jamais le backtick.
 *
 * `node --check` fait une passe de PARSING seule, sans exécuter : c'est
 * exactement ce qu'il faut pour un script dont l'exécution demande une app
 * lancée, un GPU et un port CDP.
 */

const RACINE = path.join(import.meta.dirname, "..", "..");

/** Scripts à vérifier : ceux de `scripts/`, plus le pilote de la skill — il
 *  porte lui aussi des expressions injectées dans une page, donc le même
 *  piège. Chemins RELATIFS à la racine : le message d'échec doit être
 *  cliquable. */
function scriptsAVerifier() {
  const trouves = readdirSync(path.join(RACINE, "scripts"))
    .filter((nom) => nom.endsWith(".mjs"))
    .map((nom) => path.posix.join("scripts", nom));
  const pilote = path.posix.join(".claude", "skills", "run-shaderlab", "driver.mjs");
  if (existsSync(path.join(RACINE, pilote))) trouves.push(pilote);
  return trouves;
}

describe("tout script .mjs parse", () => {
  const scripts = scriptsAVerifier();

  it("le dépôt en contient (sinon ce banc ne garde rien)", () => {
    // Garde du garde : un glob qui ne trouve plus rien passerait au vert en
    // silence, et c'est précisément le mode d'échec que ce fichier existe pour
    // empêcher ailleurs.
    expect(scripts.length).toBeGreaterThan(0);
  });

  it.each(scripts)("%s", (relatif) => {
    let erreur = null;
    try {
      execFileSync(process.execPath, ["--check", relatif], {
        cwd: RACINE,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      // `stderr` porte le fichier, la ligne et le mot fautif — le reproduire
      // tel quel évite d'avoir à relancer la commande à la main pour savoir où.
      erreur = String(e.stderr ?? e.message);
    }
    expect(erreur, `${relatif} ne parse pas.\n${erreur ?? ""}`).toBeNull();
  });
});
