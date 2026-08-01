import { describe, it, expect } from "vitest";
import { effectRegistry } from "../../../src/render/effects/registry";
import type { EffectModule } from "../../../src/render/effects/types";

/**
 * AUCUN PARAMÈTRE DÉCLARÉ NE DOIT RESTER SANS LECTURE — sur TOUT le registre.
 *
 * Cette garde naît d'un défaut réel, trouvé le 2026-08-01 en ouvrant `warp`
 * pour une autre raison : son shader ne lisait que `params[0..3]` alors que sa
 * liste en déclarait SEPT. « Graine », « Anisotropie » et « Torsion » n'étaient
 * lus nulle part, et `params[3]` — l'index de « Rugosité » — servait de graine.
 * Quatre contrôles sur sept, chacun avec un `hint` décrivant précisément un
 * comportement qui n'existait pas.
 *
 * POURQUOI RIEN NE LE VOYAIT. Les tests d'effet de ce dossier vérifient la
 * présence TEXTUELLE d'appels dans le WGSL — « le seuil est-il décodé ? », « la
 * somme est-elle divisée par les poids ? ». Ils constatent ce qui EST écrit ;
 * un `params[N]` ABSENT ne se remarque pas. Le compilateur ne dit rien non plus
 * (le uniform est un tableau de taille fixe, lire 4 slots sur 24 est légal), et
 * le verrou de pixels encore moins — un curseur mort ne bouge aucun pixel,
 * précisément parce qu'il est mort.
 *
 * Le lien est donc à faire ICI, entre deux choses qu'aucun outil ne rapproche :
 * la POSITION d'un paramètre dans `params` et l'INDEX que le shader lit.
 * `effectPassRunner` remplit le Float32Array dans l'ordre de la liste, donc les
 * deux doivent coïncider, sans trou.
 *
 * PORTÉE : le corps final ET les passes internes. `gooeyMerge` lit `params[0]`
 * dans sa remontée mais pas dans son composite ; un paramètre lu par une seule
 * passe est câblé, la garde doit l'accepter.
 */

/** Tous les indices `params[N]` lus par un effet, passes internes comprises. */
function indicesLus(effet: EffectModule): Set<number> {
  const sources = [effet.wgsl, ...(effet.passes ?? []).map((p) => p.wgsl)];
  const lus = new Set<number>();
  for (const src of sources) {
    for (const m of src.matchAll(/params\[(\d+)\]/g)) lus.add(Number(m[1]));
  }
  return lus;
}

describe("registre — chaque paramètre déclaré est lu par son effet", () => {
  it.each(effectRegistry.map((e) => [e.id, e] as const))("%s", (_id, effet) => {
    const lus = indicesLus(effet);
    const morts = effet.params
      .map((p, i) => ({ nom: p.name, index: i }))
      .filter(({ index }) => !lus.has(index));
    // Message porteur : le nom ET l'index, pour qu'un échec dise quoi câbler.
    expect(morts).toEqual([]);
  });

  it("ne lit aucun index AU-DELÀ de ce que l'effet déclare", () => {
    // L'autre moitié du décalage. Un shader qui lit `params[7]` alors que la
    // liste s'arrête à 6 ne lit pas un curseur : il lit un zéro, puisque
    // `effectPassRunner` remplit le reste du tableau de zéros. Panne
    // silencieuse et parfaitement stable — le pire des cas.
    const fautifs = effectRegistry
      .map((e) => ({ id: e.id, trop: [...indicesLus(e)].filter((i) => i >= e.params.length).sort() }))
      .filter((x) => x.trop.length > 0);
    expect(fautifs).toEqual([]);
  });
});
