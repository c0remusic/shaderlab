import type { EffectModule } from "./types";
import { HSL_TO_RGB_WGSL } from "./hsl";
import { HASH_WGSL, VALUE_NOISE_WGSL } from "./hash";
import { OKLAB_WGSL } from "./oklab";
import { UV_SPACE_WGSL } from "./uvSpace";
import { APERTURE_WGSL } from "./aperture";
import { DOWNSAMPLE_WGSL, upsampleWgsl } from "./blurChain";
import {
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

/**
 * Lens flare — la lumière parasite qu'un objectif AJOUTE quand une source forte
 * entre dans son champ : la chaîne de fantômes colorés, l'anneau autour de
 * l'axe, et le voile qui lave les noirs.
 *
 * ─── POURQUOI CE N'EST PAS UN MODE DE `lensDistortion` ──────────────────────
 *
 * Le CLAUDE.md range déjà l'optique en trois questions : ce qu'un objectif
 * RENVOIE (les halos), ce qu'il ne met pas au point (les flous), ce que sa FORME
 * déforme (`lensDistortion`). Un flare n'est pas une déformation — l'image
 * derrière ne bouge pas d'un pixel. C'est de la lumière AJOUTÉE, par réflexion
 * entre les faces des lentilles. Il appartient donc à la première question, et
 * pas à la troisième, quel que soit le fait qu'il vienne du même objectif.
 *
 * ⚠️ **LA FAMILLE DES HALOS ROUVRE À TROIS**, après avoir été déclarée close à
 * deux le 2026-08-03 (`anamorphicStreak` en était sorti pour `lensDistortion`).
 * La clôture portait sur un découpage — `glow` étale sans colorer (diffusion),
 * `halation` réexpose en rouge sur fond sombre (film) — et celui-ci n'est
 * variante ni de l'un ni de l'autre : c'est une RÉFLEXION, qui produit des
 * copies DÉPLACÉES de la source au lieu de l'étaler sur place. Le cahier de
 * références le disait déjà en creux, en décrivant la traînée anamorphique
 * comme « ni bloom ni flare à fantômes ». Le flare à fantômes y était donc nommé
 * comme absent, et il l'est resté deux jours.
 *
 * ─── DEUX VOIES POUR LES FANTÔMES, ET C'EST LA LEÇON DE LA REVUE ────────────
 *
 * Demande d'Antoine : le flare doit pouvoir partir des hautes lumières de la
 * photo ET d'un point qu'on pose soi-même.
 *
 * La première version faisait les deux par PRÉLÈVEMENT, à la façon du « pseudo
 * lens flare » d'écran : un lobe synthétique injecté dans le champ de hautes
 * lumières, puis toute la chaîne lue dedans. Verdict d'usage d'Antoine :
 * « pas très raffiné ». Il avait raison, et la cause est structurelle plutôt
 * qu'un réglage — l'auteur même de cette technique écrit que ses fantômes
 * « gardent la forme de l'image SOURCE » au lieu des formes géométriques du
 * réel, et conseille de ne pas s'y fier seule.
 *
 * Hullin & al. le disent par l'autre bout, et c'est la phrase qui a tout
 * décidé : un fantôme est « a deformed image of the aperture opening ». **Une
 * image de l'OUVERTURE, pas de la source.** Un prélèvement dans les hautes
 * lumières ne peut donc PAS en produire : il rend des copies molles du soleil.
 *
 * D'où deux voies, et non deux machineries redondantes :
 *
 * - **Source POSÉE : les fantômes sont DESSINÉS** (`ghost_cover`). On connaît sa
 *   position, donc celle et la taille de chaque fantôme sont connues en forme
 *   close. Anneau polygonal à liseré vif, découpé en croissant. Zéro lecture de
 *   texture, et tout l'écart de raffinement s'y joue.
 * - **Hautes lumières RÉELLES : les fantômes sont PRÉLEVÉS.** C'est la seule
 *   voie possible quand on ne sait pas où sont les sources, et elle garde son
 *   défaut : des taches rondes et molles. Écrit plutôt que tu.
 *
 * ⚠️ LE LOBE INJECTÉ A ÉTÉ DÉPOSÉ, et le chemin pour y arriver vaut d'être
 * écrit parce qu'il s'est trompé trois fois. Tant que les fantômes, l'anneau et
 * le voile étaient tous prélevés dans le même champ, il fallait y injecter la
 * source posée. Une fois les fantômes dessinés, ce lobe produisait EN DOUBLE des
 * fantômes prélevés, aux mêmes endroits, et les empâtait. On a cherché un
 * dosage : à 0,3 ça empâtait encore, à 0,08 l'anneau et le voile s'effondraient.
 * Aucune valeur ne réglait les deux — parce que ce n'était pas un problème de
 * dosage mais de RÔLE.
 *
 * La sortie a été de passer l'anneau et le voile de la source posée en
 * analytique eux aussi. Le champ redevient alors ce qu'il aurait toujours dû
 * être — les hautes lumières RÉELLES et rien d'autre — les deux voies ne peuvent
 * plus fabriquer le même artefact, et le hors-cadre marche par-dessus le marché.
 *
 * ─── LES TROIS FAMILLES, ET POURQUOI UN SEUL MÉCANISME NE SUFFIT PAS ────────
 *
 * Question d'Antoine à la revue : « ça c'est un flare quand le capteur regarde
 * directement la source, et pour les autres types ? ». Elle était juste — la
 * première version ne modélisait qu'UNE des trois familles reconnues, et
 * plafonnait là. Elles ne diffèrent pas par leur apparence mais par l'ENDROIT
 * où la lumière se perd :
 *
 * - entre deux faces POLIES → **ghosting**, des images nettes de l'ouverture ;
 * - sur une surface SALE ou rayée → **diffusion**, des stries radiales ;
 * - par aller-retour avec le CAPTEUR → un **quadrillage** régulier.
 *
 * Aucun mécanisme unique ne les produit toutes, et c'est pour ça qu'elles sont
 * trois blocs distincts plus bas plutôt que trois réglages d'un même.
 *
 * ─── CE QUE LES PHOTOGRAPHIES ONT IMPOSÉ ────────────────────────────────────
 *
 * Quatre traits relevés sur photographies (Wikimedia Commons « Crescent Lens
 * Flare » ; un recadrage de chaîne chez ishootshows.com), et AUCUN n'était rendu
 * avant. Ils sont détaillés sur `ghost_cover` :
 *
 *   1. un fantôme est un ANNEAU, pas une tache pleine
 *   2. il est DÉCOUPÉ EN CROISSANT dès qu'il s'éloigne de l'axe
 *   3. son liseré est coloré, différemment d'un fantôme à l'autre
 *   4. les tailles sont très inégales, souvent par paires grand/petit
 *
 * Et un cinquième, qui a fait revoir un réglage : les couleurs sont PASTEL, pas
 * néon. Le premier essai saturait le liseré de 60 % ; la photographie montre des
 * teintes à peine posées sur le fond.
 *
 * ─── CE QUI EMPÊCHE QUE ÇA RENDE CHEAP ──────────────────────────────────────
 *
 * 1. **Tout est ADDITIF, en linéaire.** Une lumière parasite s'ajoute, elle ne
 *    remplace rien. Un flare composé en `mix` masquerait l'image sous lui, ce
 *    qui est le rendu « calque de flare posé par-dessus » qu'on veut éviter.
 * 2. **Les fantômes s'éteignent vers les bords.** Sans ce poids, la chaîne
 *    garde la même force jusqu'au coin du cadre et se lit comme une rangée de
 *    gommettes. La lumière réfléchie, elle, rate le capteur d'autant plus
 *    qu'elle est loin de l'axe.
 * 3. **Le dégradé de teinte de la chaîne court en OKLCH**, pas en RVB. Faire
 *    dériver la teinte par permutation de canaux — l'astuce habituelle — fait
 *    varier la CLARTÉ en même temps, et la chaîne se met à clignoter du clair au
 *    sombre alors qu'un seul curseur devrait la régler. Même mesure que celle
 *    qui a fait passer la roue d'`outlines` en OKLCH : 0,290 d'étendue de clarté
 *    perçue pour une teinte qui fait le tour.
 * 4. **Le voile n'est pas un glow.** Il ajoute une lumière SCALAIRE teintée, pas
 *    une copie floutée de l'image : c'est ce qui lave les noirs sans redessiner
 *    les formes. Un glow ajouterait la couleur locale et donnerait un halo, pas
 *    une perte de contraste.
 *
 * ─── COÛT ───────────────────────────────────────────────────────────────────
 *
 * Cinq passes internes (seuillage, deux réductions, deux remontées), puis
 * `nombre de fantômes + 10` taps en passe finale — dont huit pour la somme
 * azimutale de l'anneau. **Tout ce qui part de la source posée ne coûte AUCUNE
 * lecture** : chaîne dessinée, voile, anneau, stries, arcs et quadrillage sont
 * de l'ALU pure. C'est aussi ce qui les rend nets, et ce qui les fait marcher
 * hors cadre.
 *
 * ⚠️ **Les cinq passes sautent quand les trois contributions de CHAMP sont à
 * zéro** (`EffectPass.enabled`). La passe finale porte DEUX prédicats, et ils ne
 * disent pas la même chose : `champActif` est le jumeau exact de celui des
 * passes — sans lui, un effet réglé à zéro lirait la texture SOURCE en croyant
 * lire son champ de hautes lumières — tandis que `dessinActif` laisse passer ce
 * qui ne lit aucune texture. Un flare entièrement posé, sur une photo sans la
 * moindre haute lumière, est un cas parfaitement légitime, et c'est le premier
 * qui a cassé quand la sortie anticipée ne regardait que le champ.
 */

/** Index du paramètre d'étalement, lu par la remontée pyramidale partagée. En
 *  dur dans l'appel serait une panne silencieuse au premier réordonnancement. */
const P_SPREAD = 1;

/** Nombre maximal de fantômes. Borné en DUR et pas seulement par le curseur :
 *  la boucle WGSL doit avoir une borne constante, et un `count` lu d'un uniforme
 *  ne peut pas la donner. Le curseur s'arrête au même chiffre. */
const GHOSTS_MAX = 8;

/** Prédicat commun aux sept passes et à la sortie anticipée de la composite.
 *  ⚠️ LES DEUX DOIVENT DIRE LA MÊME CHOSE : si les passes sautent et que la
 *  composite lit quand même `prevPass`, elle lit la texture SOURCE — donc
 *  l'image ajoutée à elle-même. Un seul prédicat, appelé des deux côtés. */
const flareActif = (p: Record<string, number>) =>
  (allume(p.ghostsOn) && (p.ghostIntensity > 0 || p.haloIntensity > 0)) ||
  (allume(p.diffusionOn) && p.veil > 0);

/** Un interrupteur de phénomène, avec son défaut ALLUMÉ quand le calque ne le
 *  porte pas. C'est le cas de tout preset écrit avant le 2026-08-14 : sans ce
 *  `??`, un `undefined` comparé à 0,5 rendrait faux et éteindrait en silence
 *  les trois familles d'un preset existant. Le shader n'a pas ce risque — le
 *  runner y écrit `layer.params[nom] ?? p.default`. */
function allume(v: number | undefined): boolean {
  return (v ?? 1) > 0.5;
}

/** Vrai si QUELQUE CHOSE est dessiné depuis la source posée — chaîne, termes
 *  diffus ou l'une des trois familles analytiques. Ne lit aucune texture, donc
 *  reste valide même quand les passes sautent : un flare entièrement posé sur
 *  une photo sans haute lumière est un cas légitime, et c'était le premier à
 *  casser quand la sortie anticipée ne regardait que le champ. */
export const dessinActif = (p: Record<string, number>) =>
  p.sourceIntensity > 0 &&
  ((allume(p.ghostsOn) && (p.ghostIntensity > 0 || p.haloIntensity > 0 || p.arcs > 0)) ||
    (allume(p.diffusionOn) && (p.veil > 0 || p.scatter > 0 || p.plume > 0)) ||
    (allume(p.sensorOn) && p.sensor > 0));

/** SEUILLAGE DES HAUTES LUMIÈRES RÉELLES, et rien d'autre.
 *
 *  Cette passe a porté une INJECTION de la source posée tant que les fantômes,
 *  l'anneau et le voile étaient tous prélevés dans ce champ. Ils ne le sont
 *  plus : la source posée a sa propre chaîne dessinée et ses propres termes
 *  diffus, calculés depuis sa POSITION. Le champ est donc redevenu ce qu'il
 *  aurait toujours dû être, et les deux voies ne peuvent plus fabriquer le même
 *  artefact. Voir l'en-tête pour les trois dosages essayés avant de comprendre
 *  que le problème n'était pas un réglage mais un partage de rôle. */
const FLARE_BRIGHT_WGSL = `
${SRGB_TO_LINEAR_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  // Seuil DÉCODÉ vers le linéaire : c'est une valeur de curseur, donc
  // perceptuelle, comparée à une luminance qui vient du format -srgb et est
  // donc déjà linéaire. Précédent coûteux : le bright-pass du glow, dont ce
  // décodage manquant rendait le curseur inerte sur 85 % de sa course.
  let seuil = srgb_to_linear(clamp(params[0], 0.0, 1.0));
  let l = max(color.r, max(color.g, color.b));
  // Genou doux plutôt que bascule : une coupure franche fait clignoter toute la
  // chaîne de fantômes quand une haute lumière traverse le seuil d'un cran
  // d'exposition — et un fantôme qui clignote se voit bien plus qu'un halo.
  let e = max(l - seuil, 0.0) / max(1.0 - seuil, 0.0001);
  // Couleur CONSERVÉE, pas seulement l'énergie : un fantôme issu d'un néon rouge
  // n'a pas la même dominante qu'un fantôme de ciel, et la teinte du réglage
  // vient TEINTER cette couleur au lieu de la remplacer.
  // ⚠️ PLUS AUCUNE INJECTION ICI, et c'est le nettoyage qui a suivi le passage
  // des termes diffus en analytique. Cette passe a porté un lobe synthétique
  // pour la source posée tant que les fantômes, l'anneau et le voile étaient
  // tous PRÉLEVÉS dans ce champ. Ils ne le sont plus : la source posée a sa
  // propre chaîne dessinée et ses propres termes diffus, calculés depuis sa
  // POSITION — ce qui marche hors cadre, là où un lobe rastérisé n'existait pas.
  //
  // Le champ redevient donc ce qu'il aurait toujours dû être : les hautes
  // lumières RÉELLES de la photo, et rien d'autre. Deux voies séparées, aucune
  // qui empâte l'autre — trois dosages d'injection avaient été essayés avant de
  // comprendre que le problème n'était pas un réglage mais un partage de rôle.
  return vec4<f32>(color.rgb * (e * e), 1.0);
}
`;

export const lensFlare: EffectModule = {
  id: "lensFlare",
  name: "Lens flare",
  params: [
    { name: "threshold", label: "Seuil des hautes lumières", unit: "percent", min: 0, max: 1, default: 0.78, step: 0.01, hint: "À partir de quel ton une lumière provoque un flare. Haut = seules les sources franches, ce qui est le cas réel — un objectif ne fantôme pas sur un ciel gris" },
    { name: "spread", label: "Étalement des sources", unit: "none", min: 0.5, max: 6, default: 2, step: 0.05, hint: "Adoucit les hautes lumières avant d'en tirer les fantômes. Bas = des fantômes nets qui gardent la forme de la source ; haut = des taches molles" },
    // ── LA SOURCE POSÉE (manipulateur sur la toile) ──────────────────────────
    // Mêmes plages que la zone de `pixelStretch`, dont l'ADR dit pourquoi un
    // point se pose sur l'image et ne se règle pas aux curseurs. Débordement
    // au-delà du cadre volontairement autorisé : une source de flare est
    // souvent HORS champ, c'est même le cas le plus fréquent.
    { name: "sourceX", label: "Centre X de la source", unit: "percent", min: -0.5, max: 1.5, default: 0.5, step: 0.01, hint: "Position horizontale de la source posée. Peut sortir du cadre — un soleil qui provoque un flare est rarement dans l'image" },
    { name: "sourceY", label: "Centre Y de la source", unit: "percent", min: -0.5, max: 1.5, default: 0.2, step: 0.01, hint: "Position verticale de la source posée" },
    // DÉFAUT À 0,10 ET NON 0,05. Sous ~0,08, le lobe est plus petit que le
    // niveau le plus grossier de la pyramide et ses ARÊTES n'y survivent pas :
    // les fantômes sortent ronds, ce qui vide de son sens toute la mécanique
    // d'injection qui devait leur donner la forme du diaphragme. Le curseur
    // descend plus bas parce qu'une source lointaine est légitimement petite —
    // mais il faut alors savoir qu'on renonce au polygone.
    { name: "sourceRadius", label: "Rayon de la source", unit: "percent", min: 0.005, max: 0.5, default: 0.1, step: 0.005, hint: "Taille du lobe posé. C'est lui qui fixe la taille des fantômes : ils en sont des copies à l'échelle. Sous ~0,08 la forme du diaphragme ne survit pas au lissage et les fantômes redeviennent ronds" },
    { name: "sourceIntensity", label: "Intensité de la source posée", unit: "none", min: 0, max: 8, default: 0, step: 0.1, hint: "À 0, aucune source n'est posée et le flare ne part que des hautes lumières de la photo. Au-dessus, un lobe s'ajoute à l'endroit choisi — et comme il porte la forme du diaphragme, ses fantômes l'héritent" },
    // DÉFAUT À 0, DONC CIRCULAIRE — arbitrage d'Antoine (« je n'aime pas les
    // lames de diaphragme »). Un objectif moderne à lames arrondies rend
    // d'ailleurs des fantômes ronds, et aucune de ses cinq photographies de
    // référence ne montre de polygone. Le contrôle reste : il porte une capacité
    // réelle, partagée avec `lensBlur` par `effects/aperture.ts`.
    { name: "blades", label: "Lames du diaphragme", unit: "none", min: 0, max: 12, default: 0, step: 1, hint: "Forme des fantômes. 0 à 2 = diaphragme circulaire, donc des fantômes RONDS — le défaut, et ce que rend un objectif moderne à lames arrondies. Six lames donnent des hexagones, cinq des pentagones. C'est le MÊME diaphragme que celui de Lens blur : un objectif n'en a qu'un" },
    { name: "bladeRotation", label: "Rotation du diaphragme", unit: "degrees", min: 0, max: 180, default: 0, step: 1, hint: "Oriente le polygone. SANS OBJET au défaut, qui est le diaphragme circulaire — un cercle n'a pas d'orientation" },
    // ── LA CHAÎNE DE FANTÔMES ────────────────────────────────────────────────
    { name: "ghostCount", label: "Nombre de fantômes", unit: "none", min: 0, max: GHOSTS_MAX, default: 5, step: 1, hint: "Combien de reflets dans la chaîne. Chacun correspond à un couple de faces de l'objectif ; un zoom en compte plus qu'une focale fixe, et c'est ce qui les distingue à l'œil" },
    { name: "ghostSpacing", label: "Espacement", unit: "percent", min: 0.05, max: 1.2, default: 0.35, step: 0.01, hint: "Écart entre deux fantômes le long de l'axe source-centre. Bas = ils se serrent près du miroir de la source ; haut = la chaîne traverse tout le cadre" },
    { name: "ghostIntensity", label: "Intensité des fantômes", unit: "none", min: 0, max: 4, default: 0.7, step: 0.05, hint: "Force de la chaîne. À 0, avec l'anneau et le voile aussi à 0, les sept passes internes ne tournent PAS — l'effet ne coûte alors rien du tout" },
    { name: "ghostDispersion", label: "Dérive de teinte", unit: "percent", min: 0, max: 1, default: 0.45, step: 0.01, hint: "Fait tourner la teinte le long de la chaîne — le traitement anti-reflet ne renvoie pas la même couleur à chaque face. 0 = tous les fantômes de la même teinte, ce qu'aucun objectif ne fait" },
    { name: "tintHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 262, step: 1, colorGroup: { key: "tint", role: "hue", label: "Teinte du traitement" } },
    { name: "tintSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.62, step: 0.01, colorGroup: { key: "tint", role: "saturation", label: "Teinte du traitement" } },
    { name: "tintLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.6, step: 0.01, colorGroup: { key: "tint", role: "lightness", label: "Teinte du traitement" } },
    // ── L'ANNEAU ET LE VOILE ─────────────────────────────────────────────────
    { name: "haloIntensity", label: "Intensité de l'anneau", unit: "none", min: 0, max: 4, default: 0.4, step: 0.05, hint: "Le cercle irisé autour de l'axe optique. Centré sur le CENTRE du cadre et non sur la source, parce que c'est l'axe de l'objectif qui le produit — c'est ce qui le distingue d'un halo de diffusion" },
    { name: "haloRadius", label: "Rayon de l'anneau", unit: "percent", min: 0.05, max: 0.9, default: 0.42, step: 0.01, hint: "Distance de l'anneau au centre du cadre, en fraction de la plus petite dimension" },
    { name: "veil", label: "Voile", unit: "none", min: 0, max: 2, default: 0.25, step: 0.01, hint: "Le lavage général du contraste quand une source forte entre dans le champ. Ajoute une lumière SCALAIRE teintée, pas une copie floutée de l'image — c'est ce qui remonte les noirs sans redessiner les formes, et ce qui sépare un voile d'un glow" },
    // ── LA FORME DES FANTÔMES DESSINÉS (2026-08-03 soir) ─────────────────────
    // Trois contrôles, et chacun sort d'un relevé sur PHOTOGRAPHIE. Ils ne
    // concernent que la chaîne dessinée, c'est-à-dire la source posée : les
    // fantômes prélevés dans les hautes lumières de la photo n'ont pas de forme
    // connue, et c'est le prix annoncé de la voie automatique.
    { name: "ghostFill", label: "Remplissage des fantômes", unit: "percent", min: 0, max: 1, default: 0.8, step: 0.01, hint: "1 = polygones PLEINS au contour souligné, le défaut. 0 = anneaux creux — juste pour UN artefact isolé : répétés le long de l'axe ils forment un motif de ronds qui trahit la synthèse. Sans objet sur la voie automatique" },
    { name: "ghostClip", label: "Découpe du fût", unit: "percent", min: 0, max: 1, default: 0.4, step: 0.01, hint: "Le fût tranche une part du fantôme vu de biais, d'autant plus qu'il s'éloigne de l'axe. La coupe est DROITE : il en reste un polygone à un côté de moins, jamais une ellipse — une ellipse serait l'intersection de deux disques, et ce n'est pas ce que fait un barillet" },
    { name: "ghostVariation", label: "Inégalité des tailles", unit: "percent", min: 0, max: 1, default: 0.6, step: 0.01, hint: "Les photographies ne montrent jamais une progression régulière : les tailles sont très inégales, souvent par paires grand/petit voisines. À 0, une rangée de gommettes" },
    // ── LES TROIS AUTRES FAMILLES DE FLARE (2026-08-03 soir) ─────────────────
    // Un flare n'est pas UN phénomène mais TROIS, et ils diffèrent par l'endroit
    // où la lumière se perd — pas par leur apparence :
    //   · entre deux faces POLIES        -> ghosting, des images nettes de l'ouverture
    //   · sur une surface SALE ou rayée  -> diffusion, des stries radiales
    //   · par aller-retour avec le CAPTEUR -> un quadrillage régulier
    // C'est pour ça qu'un seul mécanisme ne peut pas les produire toutes, et
    // pourquoi la première version — qui ne modélisait que le premier —
    // plafonnait là. Tous trois partent de la source POSÉE : ils n'ont pas
    // d'équivalent sur la voie automatique, faute de savoir où sont les sources.
    // DÉFAUT À 0 — arbitrage d'Antoine, le même jour et pour la même raison
    // que les lames de diaphragme. Les stries sont un ORNEMENT : elles disent
    // « objectif sale », ce qui est une intention et pas un état de fait. Le
    // défaut d'un effet doit rendre l'objectif propre ; la saleté se demande.
    { name: "scatter", label: "Stries de diffusion", unit: "none", min: 0, max: 4, default: 0, step: 0.05, hint: "Poussière, rayures et gras sur la lentille frontale — la lumière n'y est plus réfléchie mais DIFFUSÉE, en stries radiales depuis la source. C'est ce qui fait qu'un flare a l'air filmé plutôt que calculé" },
    { name: "scatterDetail", label: "Finesse des stries", unit: "none", min: 4, max: 220, default: 70, step: 1, hint: "SANS OBJET au défaut, les stries étant éteintes. Combien de stries sur le tour. Bas = quelques grosses coulures, comme une trace de doigt ; haut = une fine chevelure, comme de la poussière" },
    { name: "sensor", label: "Quadrillage capteur", unit: "none", min: 0, max: 4, default: 0, step: 0.05, hint: "Le « red dot flare » : la lumière fait un aller-retour capteur → lentille arrière → capteur, et le pas des photosites en fait une grille régulière de points. Signature du numérique moderne à petite ouverture, pas d'un objectif — d'où sa couleur propre, qui ne suit pas la teinte du traitement" },
    { name: "sensorSpacing", label: "Pas du quadrillage", unit: "percent", min: 0.01, max: 0.2, default: 0.05, step: 0.005, hint: "Écart entre deux points de la grille. Sans objet à quadrillage nul" },
    { name: "arcs", label: "Arcs de barillet", unit: "none", min: 0, max: 4, default: 0.6, step: 0.05, hint: "Les grands arcs très faibles qui traversent le cadre, renvoyés par les bords internes du fût et la bague de retenue. Discrets, et c'est ce qui remplit le vide entre les fantômes sur les vraies photographies" },
    // ── LA PLUME (2026-08-03, troisième passe) ───────────────────────────────
    // Ajoutée sur CINQ photographies d'Antoine, prises avec son propre matériel,
    // et elle a renversé la hiérarchie de l'effet : aucune des cinq ne montre de
    // chapelet ni d'anneau. Toutes montrent la MÊME chose — une plume large et
    // molle, fortement teintée par le revêtement (bleu-violet sur trois, ambre
    // sur deux), et coupée par un bord DROIT.
    //
    // C'est de la diffusion rasante dans le fût, pas de la réflexion entre
    // faces : la lumière entre de biais, se disperse sur toute la longueur du
    // barillet et ressort en cône. D'où un cône et non un lobe rond, et d'où le
    // bord franc — l'ombre du parasoleil ou de la baïonnette le tranche net.
    { name: "plume", label: "Plume de diffusion", unit: "none", min: 0, max: 4, default: 1, step: 0.05, hint: "Le cône de lumière diffusée qui part de la source et traverse l'image. C'est ce que rendent la plupart des objectifs modernes face au soleil, bien plus souvent qu'une chaîne de fantômes — et c'est ce que montrent les photographies de référence" },
    { name: "plumeLength", label: "Longueur de la plume", unit: "percent", min: 0.05, max: 2, default: 0.7, step: 0.01, hint: "Jusqu'où le cône porte, en fraction de la plus petite dimension de l'image" },
    { name: "plumeSpread", label: "Évasement", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, hint: "0 = un faisceau parallèle et étroit ; 1 = un large éventail qui s'ouvre en s'éloignant. C'est un CÔNE et non un cylindre parce que la lumière se disperse tout au long du fût" },
    { name: "plumeEdge", label: "Bord franc", unit: "percent", min: 0, max: 1, default: 0.25, step: 0.01, hint: "Position de la coupe DROITE en travers de la plume — l'ombre du parasoleil ou de la baïonnette. C'est elle qui fait lire un BANDEAU plutôt qu'un halo, et aucun lobe rond ne sait la produire. À 0, pas de coupe" },
    // ── LES TROIS INTERRUPTEURS DE PHÉNOMÈNE (2026-08-14) ────────────────────
    //
    // Arbitrage d'Antoine du 2026-08-13 : « ses trois phénomènes deviennent
    // trois options sélectionnables dans l'effet ». Trois options CUMULABLES et
    // non un sélecteur exclusif — un objectif réel produit les trois à la fois,
    // et ADR-0017 tient précisément là-dessus. Un mode unique retirerait une
    // capacité au lieu d'en ranger l'accès.
    //
    // ⚠️ LEUR PLACE EN FIN DE LISTE EST LE CONTRAT, pas un rangement. L'index
    // d'un paramètre est persisté dans les presets et gelé par les références
    // de pixels ; ajoutés à la fin, les trente premiers ne bougent pas, et un
    // preset écrit avant aujourd'hui ne les porte pas — il reçoit alors leur
    // DÉFAUT (`layer.params[p.name] ?? p.default`, effectPassRunner), donc les
    // trois phénomènes allumés, donc son rendu d'avant.
    //
    // ⚠️ ET ILS DOIVENT COUPER POUR DE BON. Un interrupteur qui ne ferait que
    // masquer des curseurs serait un curseur mort de plus : chaque contribution
    // est multipliée par le sien plus bas dans le shader, et `flareActif` les
    // lit aussi, si bien qu'éteindre les fantômes fait aussi SAUTER les cinq
    // passes de pyramide.
    { name: "ghostsOn", label: "Fantômes", unit: "none", min: 0, max: 1, default: 1, step: 1, choices: ["Éteints", "Allumés"], hint: "Les reflets entre deux faces POLIES de l'objectif : chaîne de fantômes, anneau irisé, arcs de barillet. Éteindre masque leurs réglages ET saute les cinq passes de pyramide" },
    { name: "diffusionOn", label: "Diffusion", unit: "none", min: 0, max: 1, default: 1, step: 1, choices: ["Éteinte", "Allumée"], hint: "Ce qui se perd sur une surface SALE ou rayée, et en rasant dans le fût : voile, stries radiales, plume. C'est ce que montrent les cinq photographies d'Antoine, bien plus souvent qu'une chaîne de fantômes" },
    { name: "sensorOn", label: "Quadrillage capteur", unit: "none", min: 0, max: 1, default: 1, step: 1, choices: ["Éteint", "Allumé"], hint: "L'aller-retour capteur → lentille arrière → capteur, dont le pas des photosites fait une grille. La seule des trois familles qui ne vienne pas du verre" },
  ],
  passes: [
    // Seuillage + injection de la source posée, fondus (voir FLARE_BRIGHT_WGSL).
    { scale: 0.5, wgsl: FLARE_BRIGHT_WGSL, enabled: flareActif },
    // DEUX NIVEAUX, ET PAS QUATRE COMME `glow`. Corrigé sur pièce : à quatre
    // niveaux la chaîne descend au 1/16, et un lobe de diaphragme de 12 px n'y
    // survit pas — les fantômes sortaient RONDS, ce qui vide de son sens toute
    // la mécanique d'injection qui leur donne leurs arêtes.
    //
    // C'est une différence de NATURE avec un bloom, pas un réglage : le halo
    // d'un glow EST un flou, donc plus il est profond mieux c'est. Un fantôme
    // est une IMAGE de l'ouverture — la pyramide ne sert ici qu'à ne pas
    // crénerler quand il rétrécit, et le curseur `Étalement` fait le reste.
    { scale: 0.25, wgsl: DOWNSAMPLE_WGSL, enabled: flareActif },
    { scale: 0.125, wgsl: DOWNSAMPLE_WGSL, enabled: flareActif },
    { scale: 0.25, wgsl: upsampleWgsl(P_SPREAD), enabled: flareActif },
    { scale: 0.5, wgsl: upsampleWgsl(P_SPREAD), enabled: flareActif },
  ],
  canvasControls: [{ id: "source", kind: "disk", x: "sourceX", y: "sourceY", radius: "sourceRadius", label: "Source" }],
  /**
   * TROIS SECTIONS CUMULATIVES, ET C'EST L'EXCEPTION QUI A FAÇONNÉ LE CONTRAT.
   *
   * Les autres effets sectionnés le sont par un MODE : une matière, un
   * détecteur, un canal. Celui-ci porte trente paramètres et AUCUN `choices`,
   * et ce n'est pas un oubli — ses trois phénomènes s'ADDITIONNENT au lieu de
   * s'exclure (ADR-0017). Un mode y serait faux : rien n'interdit une photo qui
   * porte à la fois une chaîne de fantômes, une plume de diffusion et un
   * quadrillage capteur, et les photographies de référence en montrent
   * plusieurs à la fois. C'est cet effet-là qui a imposé d'articuler le contrat
   * sur des GROUPES QUI APPARAISSENT ENSEMBLE plutôt que sur « le mode »
   * (design §2C).
   *
   * Le découpage n'est pas celui des apparences mais celui de l'ENDROIT OÙ LA
   * LUMIÈRE SE PERD — la seule ligne qui sépare vraiment ces trois-là, et la
   * même qui fait de leurs blocs WGSL trois blocs distincts plus bas :
   *
   *   · entre deux faces POLIES          -> Fantômes, des images de l'ouverture
   *   · sur une surface SALE, ou de biais -> Diffusion, des stries et un cône
   *   · par aller-retour avec le CAPTEUR  -> Quadrillage
   *
   * DEUX RATTACHEMENTS QUI NE SE DEVINENT PAS depuis le nom du paramètre :
   *
   * - **L'anneau est un fantôme**, malgré son apparence de halo. Il vient de la
   *   réflexion sur une face SPHÉRIQUE, donc entre faces polies comme la chaîne
   *   — ce qui le distingue d'un halo de diffusion est justement qu'il reste
   *   centré sur l'axe et non sur la source. Même chose pour les arcs de
   *   barillet, dont le shader dit lui-même qu'ils sont « la même intersection
   *   que celle des fantômes, poussée à son extrême ».
   * - **Le voile est une diffusion**, et c'est le seul rattachement discutable
   *   des trente. Aucune image de l'ouverture n'y apparaît : c'est de la lumière
   *   dispersée qui remonte les noirs sans rien redessiner, donc la même famille
   *   que les stries et la plume, et pas celle des reflets. Le prédicat de coût
   *   `flareActif` le range avec les fantômes et l'anneau — mais il groupe ce qui
   *   LIT le champ de hautes lumières, pas ce qui vient du même phénomène. Les
   *   deux découpages n'ont pas à coïncider.
   *
   * CE QUI RESTE HORS SECTION EST COMMUN À PLUSIEURS PHÉNOMÈNES, et un
   * paramètre qu'aucune section ne cite reste rendu à sa place : le seuil et
   * l'étalement fabriquent le champ de hautes lumières que lisent les fantômes,
   * l'anneau ET le voile ; la source posée alimente les trois familles ; la
   * teinte du traitement les colore toutes sauf le quadrillage, dont la couleur
   * est une propriété du phénomène et non un réglage. Les enfermer dans une
   * section les rattacherait à un phénomène qui ne les possède pas — et le
   * disque posé se retrouverait titré « Fantômes » alors que la plume et les
   * stries en partent aussi.
   *
   * ✅ **LES TROIS PORTENT DÉSORMAIS LEUR CONDITION** (2026-08-14). Ce
   * paragraphe a dit pendant neuf jours qu'elles n'en portaient aucune, « et
   * c'est une LIMITE du contrat, pas un choix » — en concluant qu'il faudrait
   * pour ça un paramètre à `choices` ajouté en FIN de `params[]`, « et à ce
   * prix-là c'est un arbitrage, pas une finition ». L'arbitrage a été rendu par
   * Antoine le 2026-08-13, et c'est exactement ce prix qui a été payé : trois
   * interrupteurs en fin de liste, la section de tête qui les porte, et les
   * trois sections de détail conditionnées par eux.
   *
   * Ce qui NE change pas : les intensités restent des curseurs, donc une
   * famille allumée mais réglée à zéro reste affichée. Masquer sur un seuil de
   * curseur ferait disparaître des réglages pendant qu'on les tire vers zéro,
   * ce qu'aucun panneau ne devrait faire.
   */
  sections: [
    {
      // LA SECTION DE TÊTE, et elle n'a que des interrupteurs. Trois options
      // CUMULABLES, pas un mode : un objectif produit les trois phénomènes à la
      // fois (ADR-0017), et les photographies de référence en montrent
      // plusieurs ensemble. Un sélecteur exclusif aurait retiré une capacité en
      // croyant ranger un panneau.
      id: "phenomenes",
      label: "Phénomènes",
      layout: "liste",
      params: ["ghostsOn", "diffusionOn", "sensorOn"],
    },
    {
      id: "fantomes",
      label: "Fantômes",
      layout: "liste",
      appliesWhen: { param: "ghostsOn", equals: [1] },
      params: [
        // La forme de l'ouverture d'abord : c'est elle dont chaque fantôme est
        // une image, et elle vaut pour toute la chaîne.
        "blades",
        "bladeRotation",
        // La chaîne elle-même, puis l'anneau, puis ce qui donne aux fantômes
        // DESSINÉS leur allure de photographie plutôt que de gommette.
        "ghostCount",
        "ghostSpacing",
        "ghostIntensity",
        "ghostDispersion",
        "haloIntensity",
        "haloRadius",
        "ghostFill",
        "ghostClip",
        "ghostVariation",
        "arcs",
      ],
    },
    {
      id: "diffusion",
      label: "Diffusion",
      layout: "liste",
      appliesWhen: { param: "diffusionOn", equals: [1] },
      params: [
        // Du plus large au plus dessiné : le voile lave tout le cadre, la plume
        // en traverse une part, les stries en sont le détail.
        "veil",
        "scatter",
        "scatterDetail",
        "plume",
        "plumeLength",
        "plumeSpread",
        "plumeEdge",
      ],
    },
    {
      id: "capteur",
      label: "Quadrillage capteur",
      layout: "liste",
      appliesWhen: { param: "sensorOn", equals: [1] },
      // Deux paramètres, et une section quand même : ce n'est pas un réglage de
      // l'objectif mais du CAPTEUR — la seule des trois familles qui ne vienne
      // pas du verre, et la seule dont la couleur ne suive pas le traitement.
      // Les laisser en vrac entre les stries et les arcs effacerait exactement
      // ce que le découpage sert à dire.
      params: ["sensor", "sensorSpacing"],
    },
  ],
  wgsl: `
${UV_SPACE_WGSL}${HSL_TO_RGB_WGSL}${HASH_WGSL}${VALUE_NOISE_WGSL}${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}${OKLAB_WGSL}

const FLARE_LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);
const TAU = 6.283185307179586;
${APERTURE_WGSL}

/** COUVERTURE ANALYTIQUE D'UN FANTÔME, et c'est le cœur du raffinement du
 *  2026-08-03 (soir). Rend \`vec2(remplissage, liseré)\`.
 *
 *  ─── POURQUOI DESSINER PLUTÔT QUE PRÉLEVER ───────────────────────────────
 *
 *  La première version prélevait les fantômes dans le champ de hautes lumières
 *  flouté, à la façon du « pseudo lens flare » d'écran. Son auteur écrit
 *  lui-même que ses fantômes « gardent la forme de l'image SOURCE » au lieu des
 *  formes géométriques du réel, et conseille de ne pas s'y fier seule. C'est
 *  exactement ce qu'on obtenait : des copies molles du soleil.
 *
 *  Hullin & al. le disent par l'autre bout : un fantôme est « a deformed image
 *  of the aperture opening ». **Une image de l'OUVERTURE, pas de la source.**
 *  Quand la source est POSÉE on connaît sa position exacte, donc la position et
 *  la taille de chaque fantôme sont connues en forme close — on peut le
 *  DESSINER. Zéro lecture de texture, et tout l'écart de raffinement s'y joue.
 *
 *  ─── CE QUE LES PHOTOS DE RÉFÉRENCE IMPOSENT ─────────────────────────────
 *
 *  Relevé sur photographies (Wikimedia Commons, « Crescent Lens Flare » et
 *  « Sunrise Lens Flare »), et aucun de ces quatre points n'était rendu avant :
 *
 *  1. **Un fantôme est un ANNEAU**, pas une tache pleine : bord vif et net,
 *     intérieur nettement plus sombre. Sur la seconde photo les fantômes verts
 *     montrent même plusieurs cercles concentriques à l'intérieur du polygone.
 *  2. **Il est DÉCOUPÉ EN CROISSANT** dès qu'il s'éloigne de l'axe — le barillet
 *     mange une part de l'ouverture, vue de biais. C'est la signature la plus
 *     reconnaissable des trois, celle qui donne son nom à la photo de référence,
 *     et un disque entier trahit immédiatement le rendu de synthèse.
 *  3. **Son liseré est COLORÉ et saturé**, différemment d'un fantôme à l'autre
 *     (magenta près de la source, vert-bleu loin).
 *  4. **Les tailles sont très inégales**, souvent par paires grand/petit
 *     voisines, jamais une progression régulière.
 *
 *  ─── LA DÉCOUPE, ET POURQUOI ELLE EST UNE INTERSECTION ───────────────────
 *
 *  Le croissant n'est pas une forme à dessiner : c'est ce qui RESTE du polygone
 *  du diaphragme quand un second disque — le barillet — en recouvre une part. On
 *  l'obtient donc en intersectant deux couvertures, et le décalage du second
 *  disque croît avec la distance à l'axe. Le dessiner comme un croissant serait
 *  juste au centre du cadre et faux partout ailleurs. */
fn ghost_cover(p: vec2<f32>, rayon: f32, versAxe: vec2<f32>, decoupe: f32, douceur: f32) -> vec2<f32> {
  let theta = atan2(p.y, p.x);
  // Distance NORMALISÉE au bord du polygone : 1 sur l'arête, quel que soit
  // l'angle. C'est \`aperture_radius\` qui porte la forme du diaphragme, et c'est
  // le même que celui de \`lensBlur\` — un objectif n'a qu'un diaphragme.
  let rPoly = length(p) / max(rayon * aperture_radius(theta, params[6], radians(params[7])), 1e-6);
  let dansPoly = 1.0 - smoothstep(1.0 - douceur, 1.0, rPoly);

  // ─── LA COUPE EST UN DEMI-PLAN, PAS UN DISQUE ──────────────────────────
  //
  // Première écriture, et le verdict d'usage qui l'a renversée : le barillet
  // était modélisé par un second DISQUE décalé, et l'intersection de deux
  // disques **est une ellipse**. « J'aime les fantômes mais pas les ellipses »
  // — la remarque désignait exactement ça, et elle est géométriquement
  // imparable : aucun réglage d'un disque ne rend un polygone tranché.
  //
  // Un demi-plan, lui, coupe le polygone par une DROITE : il en reste un
  // polygone à un côté de moins, ce que montrent les photographies de fantômes
  // vignettés. Et la même primitive sert au bord franc de la plume plus bas —
  // les deux viennent du même obstacle, le fût ou le parasoleil.
  //
  // \`t\` est l'avancée du point du côté OPPOSÉ à l'axe optique : c'est ce
  // côté-là que le fût mange, jamais l'autre.
  let t = dot(p, -versAxe) / max(rayon, 1e-6);
  // Ligne de coupe : à découpe nulle elle est au-delà du bord (rien n'est
  // mangé), à découpe pleine elle traverse au-delà du centre.
  let ligne = 1.0 - 2.0 * decoupe;
  let dansCoupe = 1.0 - smoothstep(ligne - douceur, ligne, t);

  let plein = dansPoly * dansCoupe;
  // LISERÉ sur les DEUX bords — l'arête du polygone ET la tranche. Sur les
  // photographies la coupe est aussi lumineuse que le reste du contour ; ne
  // l'allumer que sur le polygone donnerait un fantôme à un côté éteint, ce
  // qui se lit comme un défaut de dessin.
  let bordPoly = smoothstep(1.0 - douceur * 3.0 - 0.18, 1.0 - douceur, rPoly);
  let bordCoupe = smoothstep(ligne - douceur * 3.0 - 0.18, ligne - douceur, t);
  let liseré = plein * max(bordPoly, bordCoupe);
  return vec2<f32>(plein, liseré);
}

/** Une lecture du champ de hautes lumières, hors cadre comprise.
 *
 *  ⚠️ CLAMPÉE ET NON REPLIÉE, contrairement à presque tout le reste du dossier.
 *  Un fantôme lit très loin du pixel courant — c'est sa définition — et
 *  \`mirrorUv\` ferait alors RÉAPPARAÎTRE une source réelle par réflexion sur le
 *  bord, donc un fantôme fantôme, à un endroit qu'aucune optique ne justifie.
 *  Hors du champ seuillé il n'y a pas de lumière, et c'est exactement ce que le
 *  bord noir dit. */
fn flare_lire(uv: vec2<f32>) -> vec3<f32> {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return vec3<f32>(0.0);
  }
  return textureSampleLevel(prevPass, srcSampler, uv, 0.0).rgb;
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  // LES TROIS INTERRUPTEURS DE PHENOMENE, appliques UNE SEULE FOIS ici, sur les
  // intensites. Tout le reste du shader ne les voit jamais : chaque bloc est
  // deja garde par un \`if (intensite > 0.0)\`, donc eteindre une famille la fait
  // sauter sans qu'aucune de ces conditions ait a changer. Un interrupteur pose
  // bloc par bloc aurait ete sept endroits a tenir d'accord.
  let allumeFantomes = select(0.0, 1.0, params[30] > 0.5);
  let allumeDiffusion = select(0.0, 1.0, params[31] > 0.5);
  let allumeCapteur = select(0.0, 1.0, params[32] > 0.5);

  let ghostIntensity = max(params[10], 0.0) * allumeFantomes;
  let haloIntensity = max(params[15], 0.0) * allumeFantomes;
  let arcsIntensite = max(params[25], 0.0) * allumeFantomes;
  let veil = max(params[17], 0.0) * allumeDiffusion;
  let striesIntensite = max(params[21], 0.0) * allumeDiffusion;
  let plumeIntensite = max(params[26], 0.0) * allumeDiffusion;
  let capteurIntensite = max(params[23], 0.0) * allumeCapteur;

  // SORTIE ANTICIPÉE, ET C'EST UNE CONDITION DE CORRECTION. Le prédicat est le
  // JUMEAU EXACT de celui des sept passes : quand elles sautent, \`prevPass\`
  // reçoit la texture SOURCE, et tout ce qui suit ajouterait l'image à
  // elle-même. Voir l'avertissement porté par \`EffectPass.enabled\`.
  // ⚠️ DEUX CONDITIONS, ET ELLES NE DISENT PAS LA MÊME CHOSE.
  //
  // \`champActif\` est le JUMEAU EXACT du prédicat des passes : quand elles
  // sautent, \`prevPass\` reçoit la texture SOURCE, et tout ce qui la lit
  // ajouterait l'image à elle-même. Voir l'avertissement d'\`EffectPass.enabled\`.
  //
  // \`dessinActif\` couvre ce qui ne lit AUCUNE texture — la chaîne dessinée et
  // les trois familles analytiques. Elles doivent pouvoir rendre même quand la
  // pyramide ne tourne pas : un flare entièrement posé, sur une photo sans la
  // moindre haute lumière, est un cas parfaitement légitime.
  let champActif = ghostIntensity > 0.0 || haloIntensity > 0.0 || veil > 0.0;
  let dessinActif = params[5] > 0.0
    && (ghostIntensity > 0.0 || haloIntensity > 0.0 || veil > 0.0
        || striesIntensite > 0.0 || capteurIntensite > 0.0 || arcsIntensite > 0.0
        || plumeIntensite > 0.0);
  if (!champActif && !dessinActif) {
    return color;
  }

  let dims = vec2<f32>(textureDimensions(srcTexture));
  let ar = aspectScale(dims);
  let centre = vec2<f32>(0.5, 0.5);
  // Écart au centre optique, en unités ISOTROPES : sans ça la chaîne de
  // fantômes sortirait de l'axe sur une photo 3:2, et l'anneau serait un ovale.
  let versCentre = (uv - centre) * ar;
  let dCentre = length(versCentre);
  // Demi-diagonale isotrope : la plus grande distance au centre, donc l'échelle
  // naturelle des atténuations qui suivent.
  let dMax = length(vec2<f32>(0.5) * ar);

  // TEINTE DU TRAITEMENT, en OKLCH. Elle sort du picker en sRGB — valeur
  // perceptuelle, exactement ce qu'affiche la pastille — donc décodée vers le
  // linéaire avant tout mélange, comme l'encre de duotone.
  let teinteRvb = srgb_to_linear3(hsl2rgb(params[12] / 360.0, params[13], params[14]));
  let teinteLch = oklab_to_oklch(linear_srgb_to_oklab(teinteRvb));
  let derive = clamp(params[11], 0.0, 1.0);

  var flare = vec3<f32>(0.0);

  // ─── LES FANTÔMES ───────────────────────────────────────────────────────
  //
  // Lus et non dessinés : pour ce pixel, le fantôme d'indice i vaut le champ de
  // hautes lumières au point \`centre + (uv - centre) * s\`, avec s négatif. À
  // s = -1 le fantôme est le miroir exact de la source par le centre optique ;
  // plus s s'éloigne, plus le fantôme est petit et proche de l'axe.
  //
  // Borne de boucle CONSTANTE (\`GHOSTS_MAX\`) et compte lu d'un uniforme : WGSL
  // n'accepte pas une borne dynamique, et le curseur s'arrête au même chiffre.
  //
  // Elle tourne TOUJOURS, y compris quand une source est posée : le champ ne
  // contient plus que les hautes lumières réelles, donc les deux voies ne
  // peuvent plus fabriquer le même fantôme. C'est ce que la dépose de
  // l'injection a acheté.
  if (ghostIntensity > 0.0) {
    let compte = i32(clamp(params[8], 0.0, ${GHOSTS_MAX}.0) + 0.5);
    let espacement = max(params[9], 0.01);
    for (var i = 0; i < ${GHOSTS_MAX}; i = i + 1) {
      if (i >= compte) { break; }
      let s = -1.0 - f32(i) * espacement;
      let uvS = centre + (uv - centre) * s;

      // ATTÉNUATION VERS LES BORDS. Sans elle la chaîne garde la même force
      // jusqu'au coin du cadre et se lit comme une rangée de gommettes ; la
      // lumière réfléchie, elle, rate le capteur d'autant plus qu'elle est loin
      // de l'axe.
      //
      // EXPOSANT 1 ET NON 2, corrigé sur pièce. Au carré, le fantôme d'indice 0
      // — le miroir exact de la source par le centre, donc le plus lisible et
      // celui qui SIGNE le flare — tombait à 19 % quand les suivants, plus près
      // de l'axe, passaient devant. La chaîne se lisait à l'envers.
      let att = clamp(1.0 - dCentre / dMax, 0.0, 1.0);

      // DÉRIVE DE TEINTE, EN OKLCH. La faire par permutation de canaux — l'astuce
      // habituelle — ferait varier la CLARTÉ en même temps que la teinte, et la
      // chaîne clignoterait du clair au sombre sous un curseur censé ne régler
      // que la couleur. Même mesure que celle qui a fait passer la roue
      // d'\`outlines\` en OKLCH.
      let t = f32(i) / max(f32(${GHOSTS_MAX} - 1), 1.0);
      let teinteI = oklab_to_linear_srgb(oklch_to_oklab(vec3<f32>(
        teinteLch.x, teinteLch.y, fract(teinteLch.z + derive * t)
      )));
      flare = flare + flare_lire(uvS) * teinteI * att;
    }
    flare = flare * ghostIntensity;
  }

  // ─── LES FANTÔMES DE LA SOURCE POSÉE, DESSINÉS ──────────────────────────
  //
  // Ceux du dessus sont PRÉLEVÉS dans le champ de hautes lumières : c'est la
  // seule voie possible quand on ne sait pas où sont les sources, et elle rend
  // des copies molles de ce qu'elle trouve. Quand la source est posée, on sait —
  // donc on DESSINE, et on obtient l'anneau polygonal découpé en croissant que
  // les photographies montrent et qu'aucun prélèvement ne peut fabriquer.
  //
  // Les deux coexistent sans se gêner : une photo peut porter à la fois ses
  // propres hautes lumières et une source ajoutée, et chacune produit sa chaîne.
  if (ghostIntensity > 0.0 && params[5] > 0.0) {
    let compte = i32(clamp(params[8], 0.0, ${GHOSTS_MAX}.0) + 0.5);
    let espacement = max(params[9], 0.01);
    let remplissage = clamp(params[18], 0.0, 1.0);
    let decoupe = clamp(params[19], 0.0, 1.0);
    let variation = clamp(params[20], 0.0, 1.0);
    // Douceur du bord DÉRIVÉE de l'étalement, pas d'un curseur de plus : c'est
    // la même idée physique des deux côtés — une ouverture grande ouverte donne
    // des fantômes gros et mous, fermée elle les rend petits et nets. Le
    // paragraphe de PhotographyLife le dit dans ces termes.
    let douceur = clamp(params[1] * 0.05, 0.02, 0.3);
    // Source, en unités isotropes, mesurée depuis l'axe optique.
    let sIso = (vec2<f32>(params[2], params[3]) - centre) * ar;

    for (var i = 0; i < ${GHOSTS_MAX}; i = i + 1) {
      if (i >= compte) { break; }
      // ÉCHELLE LE LONG DE L'AXE. Le fantôme i est sur la droite source-axe, de
      // l'AUTRE côté : d'où le signe négatif. À k = 1 il est le miroir exact de
      // la source ; en deçà il se rapproche de l'axe, au-delà il le dépasse.
      let k = f32(i + 1) * espacement;
      let gIso = -sIso * k;
      // TAILLES INÉGALES, tirées par indice. Les photographies ne montrent
      // jamais une progression régulière — souvent des paires grand/petit
      // voisines. Une chaîne régulière se lit comme une rangée de gommettes,
      // exactement le défaut que l'atténuation seule ne corrigeait pas.
      let jitter = mix(1.0, 0.45 + hash(vec2<f32>(f32(i), 4.7)) * 1.5, variation);
      // Croissance MODÉRÉE avec l'éloignement (0,35 + 0,5·k et non 0,4 + 1,1·k) :
      // au premier essai le fantôme le plus lointain occupait un tiers du cadre.
      // Sur les photographies les grands fantômes sont larges mais très faibles,
      // c'est l'atténuation qui les rend discrets, pas leur taille.
      let rayon = max(params[4], 0.001) * (0.35 + 0.5 * k) * jitter;

      let p = (uv - centre) * ar - gIso;
      let dG = length(gIso);
      // DÉCOUPE CROISSANTE AVEC L'ÉLOIGNEMENT. Au centre du cadre le barillet
      // est vu de face et ne mange rien ; loin de l'axe il en mange une part
      // franche. Dessiner un croissant de forme fixe serait juste en un point et
      // faux partout ailleurs.
      let versAxe = select(-gIso / max(dG, 1e-5), vec2<f32>(1.0, 0.0), dG < 1e-5);
      let mordu = decoupe * clamp(dG / dMax, 0.0, 1.0) * 1.5;

      let cover = ghost_cover(p, rayon, versAxe, mordu, douceur);
      // ⚠️ PLEINS PAR DÉFAUT, ET C'EST UN VERDICT D'USAGE. Ils étaient creux —
      // le liseré portait tout — parce que les photographies de fantômes
      // vignettés montrent bien un anneau. Mais une CHAÎNE d'anneaux creux se
      // lit comme une série de ronds, et c'est précisément ce qu'Antoine a
      // rejeté (« l'anneau unique est sympa, c'est plutôt les anneaux en série
      // que je n'aime pas »).
      //
      // La nuance compte : l'anneau reste le bon rendu pour UN artefact isolé —
      // celui de la famille « anneau », plus bas, qui garde sa forme creuse.
      // Répété cinq fois le long d'un axe, il devient un motif, et un motif
      // trahit la synthèse. D'où un remplissage dominant ici, et un liseré qui
      // ne fait plus que souligner le contour.
      let encre = mix(cover.y, cover.x + cover.y * 0.35, remplissage);

      let att = clamp(1.0 - dG / dMax, 0.0, 1.0);
      let t = f32(i) / max(f32(${GHOSTS_MAX} - 1), 1.0);
      // TEINTE PROPRE À CHAQUE FANTÔME, et plus SATURÉE que le réglage : sur les
      // photographies les liserés sont francs — magenta près de la source,
      // vert-bleu loin — là où une teinte commune donnerait une chaîne fade.
      let teinteI = oklab_to_linear_srgb(oklch_to_oklab(vec3<f32>(
        teinteLch.x, teinteLch.y * 1.25, fract(teinteLch.z + derive * t)
      )));
      flare = flare + teinteI * encre * att * ghostIntensity * params[5] * 0.25;
    }
  }

  // ─── L'ANNEAU ───────────────────────────────────────────────────────────
  //
  // Centré sur le CENTRE DU CADRE et non sur la source, et ce n'est pas une
  // approximation : l'anneau vient de la réflexion sur une face SPHÉRIQUE, donc
  // il est centré sur l'axe optique quelle que soit la position de la source.
  // C'est précisément ce qui le distingue d'un halo de diffusion, lequel suit
  // la source. Le confondre donnerait un glow déguisé.
  if (haloIntensity > 0.0) {
    let rayon = clamp(params[16], 0.05, 0.9);

    // SOMME AZIMUTALE, ET C'EST CE QUI FAIT UN ANNEAU PLUTÔT QU'UN ARC.
    //
    // Deux écritures fausses ont précédé, et les deux paraissent la bonne :
    //
    // 1. \`uv - dir * rayon\` — un pas de \`rayon\` vers le centre depuis le pixel
    //    courant. Chaque pixel lit alors un point DIFFÉRENT, donc une source
    //    ponctuelle n'est vue que par un pixel : rien ne se forme du tout. Le
    //    garde de signal du harnais a refusé d'écrire la référence.
    // 2. \`centre - dir * rayon\` — le point diamétralement opposé, à distance
    //    fixe du centre. Mieux : tous les pixels d'un même rayon lisent le même
    //    point. Mais seul le SECTEUR face à la source s'allume, puisque les
    //    autres angles ne trouvent rien. Ça rend un ARC, et l'image l'a montré.
    //
    // Un anneau demande que chaque point du tour connaisse l'énergie de TOUT le
    // tour — une intégrale azimutale. Huit prélèvements régulièrement espacés
    // sur le cercle de rayon \`rayon\` suffisent : leur moyenne est l'énergie
    // trouvée à cette distance de l'axe, et elle est peinte sur tout l'anneau.
    // C'est la bonne physique par le bon bout : une face sphérique renvoie la
    // source en la répartissant sur un cercle centré sur l'AXE, pas en la
    // laissant là où elle est.
    var energie = vec3<f32>(0.0);
    for (var k = 0; k < 8; k = k + 1) {
      let a = f32(k) * 0.7853981633974483;
      energie = energie + flare_lire(centre + (vec2<f32>(cos(a), sin(a)) * rayon) / ar);
    }
    energie = energie * 0.125;

    // Profil d'anneau : un pic autour du rayon demandé, large de la moitié de
    // celui-ci. Au carré pour que le bord s'éteigne tangentiellement — une rampe
    // linéaire poserait deux plis fins de part et d'autre, soit deux traits au
    // lieu d'un anneau.
    let ring = clamp(1.0 - abs(dCentre - rayon) / max(rayon * 0.5, 1e-3), 0.0, 1.0);
    flare = flare + energie * teinteRvb * (ring * ring) * haloIntensity;
  }

  // ─── LE VOILE ───────────────────────────────────────────────────────────
  //
  // Une lumière SCALAIRE teintée, pas une copie floutée de l'image. C'est toute
  // la différence avec un glow : le glow ajoute la couleur LOCALE et redessine
  // donc les formes en plus clair ; le voile ajoute une lumière uniforme dont
  // seule la QUANTITÉ suit la lumière parasite, et remonte les noirs sans que
  // rien de nouveau n'apparaisse. C'est la perte de contraste qu'on lit sur une
  // photo à contre-jour.
  if (veil > 0.0) {
    let energie = dot(flare_lire(uv), FLARE_LUMA);
    flare = flare + teinteRvb * energie * veil;
  }

  // ═══ CE QUI PART DE LA SOURCE POSÉE, ET QUI MARCHE HORS CADRE ═══════════
  //
  // ⚠️ TOUT CE BLOC EST ANALYTIQUE, et c'est une CORRECTION de défaut autant
  // qu'un ajout. Le voile et l'anneau étaient prélevés dans le champ de hautes
  // lumières, où le lobe de la source est rastérisé — donc **ils ne rendaient
  // RIEN quand la source était hors cadre**, alors que le curseur va de −0,5 à
  // 1,5 et que l'infobulle promet ce cas (« un soleil qui provoque un flare est
  // rarement dans l'image »). Mesuré avant de le corriger : à \`sourceX = 1.25\`
  // les fantômes dessinés entraient bien par le bord, le voile réglé à 1,6 était
  // absent. Le curseur et l'infobulle mentaient tous les deux.
  //
  // Calculés depuis la POSITION, ils marchent à n'importe quelle distance hors
  // champ — et le voile y devient DIRECTIONNEL sans qu'on ait rien demandé,
  // c'est-à-dire le lavage qui entre par un bord, le cas le plus courant en
  // photographie réelle.
  if (params[5] > 0.0) {
    let force = params[5];
    let rayonSrc = max(params[4], 0.001);
    let sIso = (vec2<f32>(params[2], params[3]) - centre) * ar;
    let vers = (uv - centre) * ar - sIso;
    let dSrc = length(vers);

    // ── LA PLUME, et c'est désormais le cœur de l'effet ─────────────────────
    //
    // Cinq photographies d'Antoine, prises avec son propre matériel, ne
    // montraient NI chapelet NI anneau — mais toutes la même plume large,
    // fortement teintée et coupée droit. C'est de la diffusion rasante dans le
    // fût, pas de la réflexion entre faces polies : la lumière entre de biais,
    // se disperse sur toute la longueur du barillet et ressort en CÔNE.
    //
    // Un cône, donc, et pas un lobe rond — la largeur croît le long de l'axe.
    // Et une coupe DROITE en travers, l'ombre du parasoleil, qui est ce qui
    // fait lire un BANDEAU au lieu d'un halo. Aucun réglage d'un lobe isotrope
    // ne produit ni l'un ni l'autre, et c'est pourquoi c'est un bloc à part
    // plutôt qu'un curseur du voile.
    if (plumeIntensite > 0.0) {
      // AXE : de la source vers le centre optique. C'est le trajet de la
      // lumière rasante à travers le fût, donc la direction dans laquelle elle
      // ressort. Repli sur le bas quand la source est pile sur l'axe — il n'y a
      // alors plus de direction, et une normalisation de zéro rendrait NaN.
      let dS0 = length(sIso);
      let axe = select(-sIso / max(dS0, 1e-5), vec2<f32>(0.0, 1.0), dS0 < 1e-5);
      let perp = vec2<f32>(-axe.y, axe.x);
      let q = (uv - centre) * ar - sIso;
      // Avancée LE LONG de l'axe, et écart LATÉRAL. Tout le reste s'exprime
      // dans ce repère, ce qui rend la plume indépendante de l'orientation de
      // l'image — elle suit la source, pas les bords du cadre.
      let le = dot(q, axe);
      let tr = dot(q, perp);

      let longueur = max(params[27], 0.02);
      let evase = clamp(params[28], 0.0, 1.0);
      // Largeur croissante : c'est ce qui fait le cône. Le terme constant
      // empêche la pointe de se fermer sur un fil à la source.
      let largeur = longueur * (0.08 + evase * clamp(le / longueur, 0.0, 2.0) * 0.6);
      // CHUTE LATÉRALE GAUSSIENNE et non \`smoothstep\`, corrigé sur pièce : une
      // bascule, même adoucie, donne deux bords francs sur les côtés et la plume
      // se lit comme un faisceau de PROJECTEUR — un trapèze découpé. Une
      // gaussienne n'a de bord nulle part, ce qui est le propre d'une lumière
      // diffusée. Le seul bord franc de cet effet est la COUPE, et il est
      // transversal : c'est lui qui doit se voir, et lui seul.
      let lat = exp(-(tr / largeur) * (tr / largeur) * 2.5);
      // Décroissance en 1/(1+r²), à queue longue : la plume atteint encore le
      // bord opposé du cadre, comme sur les photographies.
      let r = max(le, 0.0) / longueur;
      let lon = 1.0 / (1.0 + r * r * 3.0);
      // LA COUPE DROITE. Bande de transition étroite et FIXE (3 % de la
      // longueur) : ce bord est une ombre portée, donc net par nature — le
      // rendre réglable inviterait à l'adoucir, et un bord adouci redonne
      // exactement le halo qu'on essaie de ne pas faire.
      let coupe = smoothstep(0.0, 0.03 * longueur, le - clamp(params[29], 0.0, 1.0) * longueur);
      // En AVANT de la source seulement : derrière elle il n'y a pas de fût à
      // traverser, donc rien à diffuser.
      flare = flare + teinteRvb * lat * lon * coupe * step(0.0, le) * plumeIntensite * force * 0.22;
    }

    // ── VOILE, en lobe large autour de la source ────────────────────────────
    // Décroissance en 1/(1+r²) et non exponentielle : elle a une QUEUE longue,
    // donc le lavage atteint encore le bord opposé du cadre. Une exponentielle
    // s'éteindrait trop tôt et rendrait une tache, pas un voile.
    if (veil > 0.0) {
      // Largeur ramenée de \`rayon*8 + 0,35\` à \`rayon*4 + 0,15\` : au premier
      // essai le lobe valait plus d'une fois la diagonale, donc il teintait tout
      // le cadre À PLAT — un voile n'est pas une dominante, c'est un gradient qui
      // vient de quelque part.
      let largeur = rayonSrc * 4.0 + 0.15;
      let r = dSrc / largeur;
      flare = flare + teinteRvb * (1.0 / (1.0 + r * r)) * veil * force * 0.12;
    }

    // ── ANNEAU ──────────────────────────────────────────────────────────────
    // Il ne s'allume que si la source se trouve à peu près à la distance de
    // l'axe qu'exige le rayon réglé : c'est la vérité optique — le rayon de
    // l'anneau est fixé par le verre, pas par l'endroit où on met le soleil.
    if (haloIntensity > 0.0) {
      let rayonA = clamp(params[16], 0.05, 0.9);
      let ecart = (length(sIso) - rayonA) / max(rayonA * 0.6, 1e-3);
      let accord = exp(-ecart * ecart);
      let ring = clamp(1.0 - abs(dCentre - rayonA) / max(rayonA * 0.5, 1e-3), 0.0, 1.0);
      flare = flare + teinteRvb * ring * ring * accord * haloIntensity * force * 0.2;
    }

    // ── STRIES DE DIFFUSION (objectif sale) ─────────────────────────────────
    //
    // Deuxième famille : la lumière n'est plus RÉFLÉCHIE entre deux faces
    // polies, elle est DIFFUSÉE par ce qui traîne sur la frontale. D'où des
    // stries radiales et non des images de l'ouverture.
    //
    // Le bruit est échantillonné sur la DIRECTION unitaire, donc sur un cercle :
    // il est périodique en angle par construction, et aucune couture n'apparaît
    // à ±180°. L'échantillonner sur l'angle lui-même en poserait une, et elle se
    // lirait comme une strie de plus — la pire des coutures, celle qui ressemble
    // à ce qu'on voulait dessiner.
    if (striesIntensite > 0.0) {
      let dir = select(vers / max(dSrc, 1e-5), vec2<f32>(1.0, 0.0), dSrc < 1e-5);
      let detail = max(params[22], 4.0);
      let n = valueNoise(dir * detail) * 0.62
            + valueNoise(dir * detail * 2.7 + vec2<f32>(11.3, 4.1)) * 0.38;
      // SEUIL puis carré : sans lui le bruit couvre tout le tour d'un voile
      // uniforme, et on obtient un halo de plus au lieu de stries. Ce qui fait
      // la strie, c'est le VIDE entre deux.
      // SEUIL HAUT (0,60) ET CUBE, corriges sur piece : a 0,46 et au carre,
      // les stries sortaient en larges coins sombres au lieu d une chevelure.
      // Ce qui fait la strie est le VIDE entre deux, donc il faut en garder peu.
      let stries = pow(max(n - 0.60, 0.0) / 0.40, 3.0);
      // Chute en 1/(1+r^1.6) : plus lente qu'un carré, parce que les stries
      // d'un objectif sale courent loin — sur les photographies elles atteignent
      // le bord du cadre.
      let r = dSrc / max(rayonSrc * 3.0, 1e-4);
      let chute = 1.0 / (1.0 + pow(r, 1.6));
      flare = flare + teinteRvb * stries * chute * striesIntensite * force * 0.045;
    }

    // ── ARCS DE BARILLET ────────────────────────────────────────────────────
    //
    // De très grands anneaux, très minces et très faibles, fortement découpés :
    // ce que renvoient les bords internes du fût et la bague de retenue. Ils ne
    // sont pas un ornement — sur les photographies de référence, ce sont eux qui
    // remplissent le vide entre les fantômes, et leur absence est ce qui fait
    // « vide » dans un flare de synthèse.
    if (arcsIntensite > 0.0) {
      for (var a = 0; a < 2; a = a + 1) {
        let k = 2.2 + f32(a) * 1.4;
        let gIso = -sIso * k;
        let rayon = rayonSrc * (6.0 + 4.0 * f32(a));
        let p = (uv - centre) * ar - gIso;
        let dG = length(gIso);
        let versAxe = select(-gIso / max(dG, 1e-5), vec2<f32>(1.0, 0.0), dG < 1e-5);
        // Découpe TRÈS forte (0,85) : un arc, pas un anneau. C'est la même
        // intersection que celle des fantômes, poussée à son extrême.
        let e = max(length(p) / max(rayon, 1e-6), length(p - versAxe * 0.85 * rayon) / max(rayon, 1e-6));
        // Bande étroite autour du bord : l'arc est un FIL, pas une couronne.
        let bande = smoothstep(0.90, 1.0, e) * (1.0 - smoothstep(1.0, 1.04, e));
        flare = flare + teinteRvb * bande * arcsIntensite * force * 0.05;
      }
    }

    // ── QUADRILLAGE CAPTEUR (« red dot flare ») ─────────────────────────────
    //
    // Troisième famille, et la seule qui ne vienne PAS de l'objectif : la
    // lumière repart du capteur, rebondit sur la face arrière de la lentille et
    // revient. Le pas des photosites en fait une grille RÉGULIÈRE, centrée sur
    // le miroir de la source par l'axe.
    //
    // ⚠️ SA COULEUR NE SUIT PAS LA TEINTE DU TRAITEMENT, et c'est voulu : elle
    // vient de la matrice de Bayer et des microlentilles, pas du revêtement
    // anti-reflet. La lui faire suivre serait cohérent à l'œil et faux au fond —
    // et le nom que les photographes lui donnent, « red dot », dit bien que la
    // couleur est une propriété du phénomène et non un réglage.
    if (capteurIntensite > 0.0) {
      let miroir = -sIso;
      let pas = max(params[24], 0.005);
      let g = ((uv - centre) * ar - miroir) / pas;
      let cellule = fract(g) - vec2<f32>(0.5);
      let point = 1.0 - smoothstep(0.10, 0.24, length(cellule));
      // ENVELOPPE : la grille ne couvre qu'une zone autour du miroir. Sans elle
      // elle pave tout le cadre, ce qui ne ressemble plus à un défaut optique
      // mais à une texture posée.
      let env = 1.0 - smoothstep(0.0, 0.55, length((uv - centre) * ar - miroir));
      flare = flare + vec3<f32>(1.0, 0.22, 0.16) * point * env * env * capteurIntensite * force * 0.05;
    }
  }

  // ADDITIF. Une lumière parasite s'AJOUTE — elle ne remplace rien. Un flare
  // composé en \`mix\` masquerait l'image sous lui, ce qui est exactement le
  // rendu « calque de flare posé par-dessus » que cet effet doit éviter.
  return vec4<f32>(color.rgb + flare, color.a);
}
`,
};
