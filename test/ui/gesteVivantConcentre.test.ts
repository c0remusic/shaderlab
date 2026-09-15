import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Garde de CONCENTRATION : la séquence d'un geste vivant ne se récite plus.
 *
 * `replaceLiveLayers` et `replaceLiveDevelop` ne font qu'un quart du geste — le
 * reste (salir le drapeau de commit, synchroniser React, redemander un rendu)
 * était à la charge de l'appelant, et quatorze sites le récitaient à la main.
 * Trois en omettaient un membre, et l'aperçu de mode de fusion a été LIVRÉ sans
 * son `requestRender` : le modèle changeait, l'écran ne repeignait pas.
 *
 * Rien ne pouvait le voir. Il n'y a pas de frame à comparer, seulement une frame
 * absente ; `frameSignature` re-rend la pile lui-même, donc il mesure ce qu'il
 * produit ; et aucun test de ce dépôt ne monte `App`. Le seul témoin a été
 * Antoine devant la fenêtre.
 *
 * Cette garde tient ce qui a été concentré : un chemin vivant neuf passe par
 * `ui/gesteVivant`, ou il apparaît ici.
 */

const RACINE = process.cwd();

/** Appels DIRECTS aux deux portes vivantes, hors du câblage des ports. */
function appelsDirects(source: string): number {
  return [...source.matchAll(/\.replaceLive(?:Layers|Develop)\(/g)].length;
}

/**
 * Appels tolérés, avec leur raison. Un compte et pas une liste de lignes : un
 * numéro de ligne se périme au premier ajout au-dessus, et la garde deviendrait
 * un faux positif permanent.
 */
const TOLERES: Record<string, { compte: number; raison: string }> = {
  "src/App.tsx": {
    // 2 pour le câblage des ports (`poserPile`, `poserEtage`) + 1 fin de geste.
    compte: 3,
    raison:
      "deux dans le câblage de `portsGesteVivant`, et un à la FIN du tracé de forme — " +
      "celui-là pose l'état puis COMMITE, et c'est `commit` qui porte la synchronisation " +
      "et le rendu ; passer par le geste vivant y ferait un rendu de plus pour rien.",
  },
};

describe("le geste vivant est concentré", () => {
  const fichiers = [
    "src/App.tsx",
    ...readdirSync(join(RACINE, "src", "hooks"))
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .map((f) => `src/hooks/${f}`),
  ];

  it("inspecte bien les fichiers — garde de SIGNAL", () => {
    expect(fichiers.length).toBeGreaterThanOrEqual(8);
    expect(readFileSync(join(RACINE, "src/App.tsx"), "utf8")).toContain("gestePileVivante");
  });

  it("aucun appel direct aux portes vivantes, hors les tolérés qui disent pourquoi", () => {
    const fautifs: string[] = [];
    for (const fichier of fichiers) {
      const n = appelsDirects(readFileSync(join(RACINE, fichier), "utf8"));
      const tolere = TOLERES[fichier]?.compte ?? 0;
      if (n > tolere) fautifs.push(`${fichier} : ${n} appel(s) direct(s), ${tolere} toléré(s)`);
    }
    expect(fautifs).toEqual([]);
  });

  it("chaque tolérance est encore UTILISÉE — une dérogation périmée se retire", () => {
    const perimees = Object.entries(TOLERES).filter(
      ([fichier, { compte }]) => appelsDirects(readFileSync(join(RACINE, fichier), "utf8")) < compte,
    );
    expect(perimees.map(([f]) => f)).toEqual([]);
  });
});
