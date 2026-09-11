import { describe, it, expect } from "vitest";
import { effectRegistry } from "../../../src/render/effects/registry";
import { developModules } from "../../../src/render/developRegistry";
import type { EffectModule } from "../../../src/render/effects/types";

// La garde couvre le registre des effets ET les modules de l'ÉTAGE de
// développement (ticket 03) : un module de l'étage est un `EffectModule` dont le
// shader lit `params[N]` exactement comme un effet, donc un curseur mort y est
// aussi silencieux. `etalonnage` a quitté `effectRegistry` pour l'étage ; sans
// cette réunion, il ne serait plus câblé-vérifié par rien.
const modulesCables = [...effectRegistry, ...developModules];

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
  // Une courbe lit ses huit slots via `params[base + offset]`. On ne marque un
  // canal comme câblé que si son index de base est effectivement passé à
  // `curve_eval` dans le shader : la seule déclaration UI ne suffirait pas à
  // blanchir un contrôle mort.
  for (const control of effet.curveControls ?? []) for (const channel of control.channels) {
    const names = [channel.startY, ...channel.points.flatMap((point) => [point.x, point.y]), channel.endY];
    const indices = names.map((name) => effet.params.findIndex((param) => param.name === name));
    const base = indices[0];
    if (base >= 0 && sources.some((src) => new RegExp(`curve_eval\\([^,]+,\\s*${base}u\\)`).test(src))) {
      indices.forEach((index) => lus.add(index));
    }
  }
  // LE SEUL PARAMÈTRE DU DÉPÔT LU HORS DU SHADER, et l'exemption est étroite
  // exprès. Le rang d'une texture de bibliothèque (`libraryTexture.indexParam`)
  // est consommé par `FramePipelineExecutor`, qui s'en sert pour choisir
  // laquelle des textures du catalogue lier au binding 7 ; le WGSL, lui, ne
  // voit que les pixels. Un `params[N]` pour ce rang n'aurait aucun sens dans
  // le corps.
  //
  // ⚠️ Exempté par la DÉCLARATION, jamais par le nom : un effet qui appellerait
  // son paramètre « rang » sans déclarer `libraryTexture` reste couvert par la
  // garde. Et `validateEffect` vérifie que ce nom existe vraiment dans
  // `params`, donc une faute de frappe ne blanchit rien — elle lève au
  // chargement du registre.
  if (effet.libraryTexture) {
    const index = effet.params.findIndex((p) => p.name === effet.libraryTexture!.indexParam);
    if (index >= 0) lus.add(index);
  }
  return lus;
}

describe("registre — chaque paramètre déclaré est lu par son effet", () => {
  it.each(modulesCables.map((e) => [e.id, e] as const))("%s", (_id, effet) => {
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
    const fautifs = modulesCables
      .map((e) => ({ id: e.id, trop: [...indicesLus(e)].filter((i) => i >= e.params.length).sort() }))
      .filter((x) => x.trop.length > 0);
    expect(fautifs).toEqual([]);
  });
});
