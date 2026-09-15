import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Garde du SEAM IPC : les noms de commande cités par `src/launch.ts` sont ceux
 * que le Rust enregistre, et réciproquement.
 *
 * Pourquoi elle manquait, et pourquoi elle compte. `launch.ts` tient le contrat
 * « une fonction = une enveloppe = une commande », et le tient au chiffre près.
 * Mais ce contrat repose entièrement sur des LITTÉRAUX DE CHAÎNE, que rien ne
 * relie au `generate_handler!` d'en face : renommer une commande côté Rust ne
 * fait rougir aucun test, et l'erreur n'apparaît qu'à l'exécution, sur le geste
 * de l'utilisateur qui l'appelle. `test/launch.test.ts` ne couvre que
 * `resolveLaunchFile` — la seule fonction du fichier qui n'appelle PAS `invoke`,
 * donc le seul morceau du seam qui n'en est pas un.
 *
 * Elle lit les deux sources comme du texte, à la manière de
 * `test/design/design-contract.test.ts` : ce sont deux listes de noms, et c'est
 * précisément ce qu'un test peut comparer sans rien exécuter.
 */

const racine = process.cwd();
const sourceTs = readFileSync(join(racine, "src", "launch.ts"), "utf8");
const sourceRust = readFileSync(join(racine, "src-tauri", "src", "lib.rs"), "utf8");

/** Les noms passés à `invoke("nom")` dans les enveloppes.
 *
 *  Le paramètre de type est OPTIONNEL et quatre appels s'en passent
 *  (`log_diagnostic`, `write_preset`, `delete_preset`, `export_preset`) : un
 *  motif qui exigerait `invoke<...>` en raterait quatre et ferait rougir la
 *  garde sur des commandes parfaitement câblées. Constaté en l'écrivant. */
function commandesAppelees(): string[] {
  return [...sourceTs.matchAll(/\binvoke(?:<[^>]*>)?\(\s*"([a-z0-9_]+)"/g)].map(([, nom]) => nom);
}

/** Les noms enregistrés dans `tauri::generate_handler![...]`. */
function commandesEnregistrees(): string[] {
  const bloc = /generate_handler!\[([\s\S]*?)\]/.exec(sourceRust)?.[1];
  if (bloc === undefined) return [];
  return bloc
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && !n.startsWith("//"));
}

describe("seam IPC — `launch.ts` et `generate_handler!` nomment les mêmes commandes", () => {
  const appelees = commandesAppelees();
  const enregistrees = commandesEnregistrees();

  it("trouve les deux listes — garde de SIGNAL", () => {
    // Sans elle, un changement de forme (reformatage, renommage d'`invoke`)
    // ferait passer la comparaison au vert en ne comparant rien.
    expect(appelees.length).toBeGreaterThanOrEqual(20);
    expect(enregistrees.length).toBeGreaterThanOrEqual(20);
  });

  it("n'appelle aucune commande que le Rust n'enregistre pas", () => {
    // Le sens qui CASSE À L'EXÉCUTION : l'appel part, et Tauri le refuse au
    // moment du geste de l'utilisateur.
    expect(appelees.filter((nom) => !enregistrees.includes(nom))).toEqual([]);
  });

  it("n'enregistre aucune commande qu'aucune enveloppe n'appelle", () => {
    // Le sens qui accumule du code MORT côté Rust — et qui signale surtout un
    // câblage oublié : une commande écrite, enregistrée, jamais atteinte.
    expect(enregistrees.filter((nom) => !appelees.includes(nom))).toEqual([]);
  });

  it("garde le contrat « une fonction = une commande » : aucun doublon", () => {
    expect(new Set(appelees).size).toBe(appelees.length);
    expect(new Set(enregistrees).size).toBe(enregistrees.length);
  });
});
