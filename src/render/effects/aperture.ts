/**
 * DIAPHRAGME — rayon du polygone régulier inscrit dans le disque unité.
 *
 * Extrait de `lensBlur.ts` le 2026-08-03, au moment où un SECOND effet en a eu
 * besoin (`lensFlare`, pour la forme du lobe injecté et donc de ses fantômes).
 * Même raison exactement que l'extraction de `edgeGradient.ts` et de
 * `blurChain.ts` : deux copies auraient dérivé, et l'écart se serait lu comme un
 * choix esthétique alors qu'il n'aurait été qu'un copier-coller qui a vieilli.
 *
 * Ici la conséquence serait pire qu'ailleurs. Le nombre de lames est la
 * SIGNATURE d'un objectif : c'est lui qui décide de la forme du bokeh comme de
 * celle des fantômes de flare, et les deux viennent du même diaphragme
 * physique. Deux effets posés sur la même photo qui rendraient un hexagone d'un
 * côté et un heptagone de l'autre ne seraient pas approximativement justes, ils
 * seraient faux — l'objectif n'a qu'un diaphragme.
 *
 * ⚠️ INSCRIT ET NON CIRCONSCRIT, et c'est le seul endroit où l'erreur passerait
 * pour une intention : un polygone circonscrit rendrait des taches plus GROSSES
 * que le rayon réglé, sans que rien ne le signale. Le rayon vaut donc
 * `cos(pi/n)` au milieu d'une arête et 1 aux sommets.
 *
 * ⚠️ Le jumeau TS et le corps WGSL disent la même chose deux fois, ce qui est
 * assumé (même dispositif que `channelMixSpec` et `inputDriver`) : le premier
 * rend la géométrie testable sans GPU, le second est ce qui tourne. Toute
 * modification se fait des DEUX côtés, et un test les compare.
 */

/**
 * COURBURE DES LAMES (2026-08-19). Une lame de diaphragme réelle est un ARC,
 * pas un segment : l'ouverture d'un objectif moderne est un polygone à côtés
 * BOMBÉS, et elle se referme vers le polygone à arêtes droites en s'ouvrant.
 * Un bokeh à arêtes strictement droites est donc le cas particulier d'un vieux
 * diaphragme, pas le cas général — et c'est exactement le rendu « filtre 2005 »
 * que ce dépôt s'interdit.
 *
 * MESURÉ, pas supposé : Affinity expose `bladeCurvature` sur son Lens Blur, et
 * le rendu sur cinq sources ponctuelles donne un pentagone à arêtes droites à 0
 * et un disque à 1 (mires et protocole dans le relevé du 2026-08-19). C'est ce
 * comportement-là qui est reproduit ici, pas le nom du paramètre.
 *
 * ⚠️ LE MODÈLE EST UNE INTERPOLATION DU RAYON, PAS UN ARC EXACT, et l'écart est
 * MESURÉ par un test plutôt qu'affirmé. `apertureRadiusArcSpec` ci-dessous
 * calcule le vrai arc de cercle passant par les deux sommets ;
 * `aperture.test.ts` balaie 3 à 12 lames, toute la course de courbure et tout
 * le tour, et relève :
 *
 *   lames >= 3 : 3,16 %   (le pire cas est le TRIANGLE, à courbure 0,40)
 *   lames >= 4 : 0,86 %
 *   lames >= 5 : 0,33 %
 *   lames >= 6 : 0,16 %
 *
 * ⚠️ LA PREMIÈRE VERSION DE CE COMMENTAIRE ANNONÇAIT « moins de 0,3 % », borne
 * calculée à la main sur UN point (5 lames, mi-course) — dix fois trop serrée
 * pour le triangle, et c'est le test qui l'a dit. Même faute que
 * `mesurer-un-cran-au-dela-du-gain` : un seul échantillon fait écrire une borne
 * qui n'en est pas une.
 *
 * Ce que ça vaut à l'écran : 3,16 % du rayon, c'est 1,3 px sur une tache de
 * 40 px et 3,8 px au rayon maximal — visible, mais seulement à 3 lames, qui est
 * un diaphragme de style et non d'objectif (les vrais en ont 5 à 11, où l'écart
 * retombe sous 0,33 %). Le vrai arc n'est PAS ce qui tourne pour deux raisons :
 * son rayon part à l'infini quand la courbure tend vers zéro, et il coûterait un
 * `sqrt` et une division de plus PAR TAP dans la boucle la plus chaude de
 * l'app — jusqu'à 256 taps par pixel. Il reste ici pour que la borne soit
 * vérifiable, et il ne doit pas migrer dans un shader sans que ce coût-là soit
 * mesuré.
 */

/** Jumeau TS de `aperture_radius`. Moins de 3 lames n'est pas un polygone :
 *  c'est le diaphragme circulaire, et la fonction rend 1 partout.
 *  `curvature` vaut 0 par défaut : les appelants d'avant la courbure gardent
 *  leur géométrie au bit près. */
export function apertureRadiusSpec(
  theta: number,
  blades: number,
  rotation: number,
  curvature = 0,
): number {
  if (blades < 2.5) return 1;
  const seg = (2 * Math.PI) / blades;
  const a = theta + rotation;
  const k = a - seg * Math.floor(a / seg) - seg * 0.5;
  const droit = Math.cos(Math.PI / blades) / Math.cos(k);
  const c = Math.min(1, Math.max(0, curvature));
  return droit + (1 - droit) * c;
}

/**
 * ARC EXACT — le modèle de référence, présent UNIQUEMENT pour borner l'écart de
 * `apertureRadiusSpec`. Il n'est appelé par aucun shader.
 *
 * L'arête est l'arc de cercle qui passe par les deux sommets (rayon 1, à
 * ±pi/n du milieu d'arête) et dont le milieu est à la distance
 * `m = cos(pi/n) + curvature * (1 - cos(pi/n))`. En posant sigma = pi/n, le
 * rayon R et le centre c de cet arc valent :
 *
 *   R = (2 m cos(sigma) - 1 - m^2) / (2 (cos(sigma) - m))     c = m - R
 *
 * et le rayon polaire dans la direction k se lit sur ce cercle :
 *
 *   r(k) = c cos(k) + sqrt(R^2 - c^2 sin^2(k))
 *
 * À courbure 0, m = cos(sigma) : le numérateur vaut -sin^2(sigma), le
 * dénominateur 0, et R diverge — c'est la droite. On rend donc le cas droit
 * directement, ce qui est aussi ce qui rend cette fonction inutilisable telle
 * quelle dans un shader.
 */
export function apertureRadiusArcSpec(
  theta: number,
  blades: number,
  rotation: number,
  curvature: number,
): number {
  if (blades < 2.5) return 1;
  const seg = (2 * Math.PI) / blades;
  const a = theta + rotation;
  const k = a - seg * Math.floor(a / seg) - seg * 0.5;
  const sigma = Math.PI / blades;
  const cosSigma = Math.cos(sigma);
  const droit = cosSigma / Math.cos(k);
  const c = Math.min(1, Math.max(0, curvature));
  if (c < 1e-9) return droit;
  const m = cosSigma + (1 - cosSigma) * c;
  const denom = 2 * (cosSigma - m);
  if (Math.abs(denom) < 1e-12) return droit;
  const R = (2 * m * cosSigma - 1 - m * m) / denom;
  const centre = m - R;
  const sousRacine = R * R - centre * centre * Math.sin(k) * Math.sin(k);
  return centre * Math.cos(k) + Math.sqrt(Math.max(sousRacine, 0));
}

/**
 * Corps WGSL. Requiert la constante `TAU` — elle est déclarée par les deux
 * appelants et n'est PAS incluse ici : `lensBlur` la partage avec sa spirale
 * d'angle d'or, et la redéclarer dans ce bloc ferait un doublon que le
 * compilateur refuse.
 *
 * Le texte est celui d'origine au caractère près, y compris ses commentaires :
 * `shaderCompose` prend la chaîne WGSL pour clé de cache, et les cinq
 * références de pixels de `lensBlur` devaient rester valables à travers
 * l'extraction. Elles le sont — vérifié, `aucun ecart`.
 */
export const APERTURE_WGSL = `
// Rayon du polygone régulier inscrit dans le disque unité, dans la direction
// \`theta\`. Moins de 3 lames n'est pas un polygone : c'est le diaphragme
// circulaire, et la fonction rend 1 partout.
// La COURBURE bombe l'arête vers le cercle circonscrit : 0 = arêtes droites
// (vieux diaphragme), 1 = ouverture ronde. Les sommets ne bougent pas, seul le
// milieu d'arête monte de cos(pi/n) vers 1 — c'est ce que fait une lame courbe
// quand le diaphragme s'ouvre. Interpolation du rayon et non arc exact : l'arc
// vrai en dévie de 0,33 % au plus a partir de 5 lames, chiffre mesuré par
// aperture.test.ts, et son rayon part a l'infini quand la courbure tend vers 0.
fn aperture_radius(theta: f32, blades: f32, rotation: f32, curvature: f32) -> f32 {
  if (blades < 2.5) {
    return 1.0;
  }
  let seg = TAU / blades;
  let a = theta + rotation;
  // Repli dans un secteur, centré sur le milieu d'arête : le rayon y vaut
  // cos(pi/n) et monte à 1 aux deux sommets qui le bordent.
  let k = a - seg * floor(a / seg) - seg * 0.5;
  let droit = cos(3.141592653589793 / blades) / cos(k);
  return mix(droit, 1.0, clamp(curvature, 0.0, 1.0));
}
`;
