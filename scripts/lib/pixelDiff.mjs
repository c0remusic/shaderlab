// Comparaison de deux images RGBA en PIXELS, et verdict.
//
// Logique PURE, isolee du transport CDP pour etre testable en env Node
// (`test/scripts/pixelDiff.test.ts`) — c'est elle qui decide ce qui est une
// regression, donc c'est la seule partie du harnais qui ne doit pas dependre
// d'un GPU pour etre verifiee.

/** Ecart d'ARRONDI tolere, par canal. Un aller-retour par une texture
 *  `-srgb` (encodage lineaire->sRGB a l'ecriture, decodage a la lecture)
 *  quantifie sur 8 bits : deux implementations qui arrondissent la derniere
 *  decimale differemment se separent d'un LSB, jamais plus. Au-dela de 1,
 *  ce n'est plus de l'arrondi — c'est un calcul different. */
export const ROUNDING_LSB = 1;

/** Part de canaux au-dela de laquelle un ecart d'1 LSB cesse d'etre EPARS.
 *
 *  Un ecart d'arrondi ne se produit qu'aux valeurs qui tombent pile sur une
 *  frontiere de quantification : il est rare et disperse. Un changement de
 *  formule, lui, deplace le resultat PARTOUT ou la formule s'applique. Le
 *  seuil separe « quelques pixels sur une frontiere » de « toute une zone a
 *  bouge d'un cran » — 0,2 % de 256x256x4 canaux = 524 canaux.
 *
 *  ATTENTION a ce que ce seuil est et n'est PAS. Il CLASSE, il n'absout pas :
 *  `scripts/render-check.mjs` fait echouer les DEUX classes par defaut (voir
 *  son en-tete, section Tolerance). La mesure du temoin le justifie — une
 *  constante de shader decalee de 1e-4 produit 100 canaux a 1 LSB, soit
 *  0,038 % : sous ce seuil. Un seuil qui laisserait passer ca serait un
 *  harnais qui ne rougit sur rien. */
export const ROUNDING_MAX_RATIO = 0.002;

/**
 * Statistiques d'ecart entre deux tampons RGBA de meme longueur.
 * `differing` compte les CANAUX (pas les pixels) qui different.
 */
export function comparePixels(a, b) {
  if (a.length !== b.length) throw new Error(`comparePixels: longueurs differentes (${a.length} vs ${b.length})`);
  let maxAbs = 0;
  let differing = 0;
  let sumAbs = 0;
  let firstIndex = -1;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d === 0) continue;
    if (firstIndex === -1) firstIndex = i;
    differing++;
    sumAbs += d;
    if (d > maxAbs) maxAbs = d;
  }
  return {
    channels: a.length,
    differing,
    ratio: a.length === 0 ? 0 : differing / a.length,
    maxAbs,
    meanAbs: a.length === 0 ? 0 : sumAbs / a.length,
    /** Index du premier canal divergent, -1 si aucun. Sert au rapport :
     *  `firstIndex >> 2` est le numero de pixel, `firstIndex & 3` le canal. */
    firstIndex,
  };
}

/**
 * CLASSE un ecart. Ne decide pas du sort du build — c'est l'appelant qui
 * decide, et par defaut il fait echouer tout ce qui n'est pas `identique`.
 *
 * - `identique`      : pas un octet d'ecart.
 * - `infra-lsb-epars`: <= ROUNDING_LSB par canal ET disperse. COMPATIBLE avec
 *                      un arrondi (autre GPU, autre pilote) — ce qui ne veut
 *                      pas dire que c'en est un : le temoin (constante de
 *                      shader a 1e-4) tombe precisement dans cette classe.
 *                      D'ou le refus par defaut, et l'option explicite
 *                      `--tolerer-arrondi` pour l'accepter en connaissance de
 *                      cause.
 * - `rendu-modifie`  : tout le reste. Aucune lecture benigne possible.
 */
export function verdictFor(stats) {
  if (stats.differing === 0) return { verdict: "identique", raison: "aucun ecart" };
  if (stats.maxAbs > ROUNDING_LSB)
    return { verdict: "rendu-modifie", raison: `ecart max ${stats.maxAbs} > ${ROUNDING_LSB} LSB` };
  if (stats.ratio > ROUNDING_MAX_RATIO)
    return {
      verdict: "rendu-modifie",
      raison: `1 LSB sur ${(stats.ratio * 100).toFixed(3)} % des canaux > ${(ROUNDING_MAX_RATIO * 100).toFixed(3)} % — un arrondi n'est jamais aussi etendu`,
    };
  return {
    verdict: "infra-lsb-epars",
    raison: `1 LSB sur ${stats.differing} canaux (${(stats.ratio * 100).toFixed(4)} %) — compatible avec un arrondi, pas une preuve`,
  };
}
