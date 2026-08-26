import type { EffectModule } from "./types";
import { UV_SPACE_WGSL } from "./uvSpace";

/**
 * Carte de déplacement — une IMAGE décide où chaque pixel va chercher sa
 * couleur. Cette image est au choix un SCAN de la bibliothèque, ou CE QUI EST
 * EN DESSOUS de l'effet (son entrée).
 *
 * CE QU'ELLE APPORTE QUE RIEN N'AVAIT. Deux effets déplacent déjà l'image, et
 * les deux fabriquent leur champ eux-mêmes : `warp` par un FBM, `glass` par le
 * relief d'une matière calculée. Aucun ne peut être PILOTÉ par une image
 * quelconque, et c'est précisément ce qu'on demande à une carte de déplacement —
 * plisser une photo selon un scan de papier froissé, la faire couler selon une
 * coulée d'encre, la tordre selon un dessin qu'on vient de poser dans le
 * dossier. Le champ devient une donnée, plus du code.
 *
 * Et `texture` lit bien une image, mais il en SORT les pixels ; celui-ci ne
 * regarde jamais la couleur du scan pour elle-même — il ne s'en sert que pour
 * décider d'un décalage.
 *
 * CE QUI LA REND BON MARCHÉ. Le binding 7 d'ADR-0018 : `EffectModule.libraryTexture`
 * est un mécanisme GÉNÉRIQUE, pas une pièce de `texture`. Le paramètre porte le
 * RANG du fichier dans le catalogue trié, les pixels arrivent par le binding, et
 * `render/textureLibraryStore.ts` fait le reste. Il n'y avait rien à ouvrir.
 *
 * ⚠️ CONTRAINTE À CONNAÎTRE AVANT D'AJOUTER QUOI QUE CE SOIT ICI :
 * `libraryTexture` + passes internes est REFUSÉ par `validateEffect` (le binding
 * n'est résolu que pour la passe finale). Cet effet ne peut donc pas se donner
 * une pyramide — tout ce qu'il fait tient dans une passe.
 *
 * ── DEUX SOURCES × DEUX MODES DE LECTURE ───────────────────────────────────
 *
 * Les deux axes sont INDÉPENDANTS : la source dit QUELLE image est la carte,
 * le mode dit COMMENT on lit un texel de cette carte. Les quatre combinaisons
 * existent, et les deux axes se règlent séparément.
 *
 * LES DEUX SOURCES.
 *
 *   Bibliothèque       — un scan du dossier, désigné par son rang (binding 7).
 *   L'image en dessous — l'entrée de l'effet elle-même (`srcTexture`). L'image
 *                        se déforme selon son propre relief tonal : les zones
 *                        claires et sombres se poussent les unes les autres.
 *
 * POURQUOI LA SECONDE EXISTE, et ce n'est pas une commodité. Antoine, le
 * 2026-08-21 : « l'effet est le même selon les textures ». Mesuré le même jour,
 * la cause n'était PAS dans l'effet — la bibliothèque est faite de scans
 * `Cardboard*` / `Paper*` d'ambientCG, qui sont des ALBÉDOS PBR dé-éclairés,
 * mesurés à ~10 niveaux sur 255 : quasi PLATS. Une carte de déplacement lit une
 * PENTE ; une image plate n'en a aucune, donc toutes les textures rendaient à
 * peu près la même chose. L'effet marchait, son entrée ne portait pas
 * d'information. La photo, elle, en porte partout et n'a rien à installer.
 * (Le fond du problème — un catalogue de vraies cartes de relief — reste un
 * chantier à part, ce n'est pas ce que cette source remplace.)
 *
 * ⚠️ La source Image ne dépend PAS du catalogue : le binding 7 sert toujours sa
 * texture de repli 1x1, mais on ne la lit pas. Catalogue vide, non décodé ou
 * rang hors borne, l'effet marche — c'est une propriété verrouillée par
 * `effet-deplacement-image`, dont le scénario ne charge aucune texture.
 *
 * LES DEUX MODES DE LECTURE, ET POURQUOI LE DÉFAUT N'EST PAS CELUI DE PHOTOSHOP.
 *
 *   Pente du gris  — le décalage suit le GRADIENT de la luminosité de la carte.
 *                    Une bosse claire pousse les pixels vers l'extérieur, un
 *                    creux les aspire : c'est une carte de RELIEF.
 *   Canaux R et V  — le rouge pilote l'horizontale, le vert la verticale, 0,5
 *                    étant le repos. C'est la convention de Photoshop, et la
 *                    seule qui sache exprimer un champ TOURNANT (un tourbillon
 *                    n'est le gradient d'aucune hauteur).
 *
 * Le défaut est la pente, et la raison est mesurable dans le dossier : la
 * bibliothèque est faite de SCANS — papier, grain, encre — donc d'images
 * essentiellement grises. Sur une image grise, R et V sont égaux, le mode
 * Photoshop pousse tout en diagonale à 45° et ne produit qu'un cisaillement
 * uniforme. Le mode par défaut doit marcher avec ce que la bibliothèque
 * contient, pas avec ce qu'un tutoriel suppose. En source Image, le même mode
 * redevient intéressant — une photo a de la chromaticité, donc R et V y
 * diffèrent.
 *
 * ── ESPACE D'ÉCHANTILLONNAGE, DÉCLARÉ (règle du dépôt) ──────────────────────
 *
 * La carte est mappée sur le CADRE dans LES DEUX SOURCES, par le même
 * `carte_uv`, comme dans `texture` : ses UV sont continus en espace écran, donc
 * les dérivées implicites sont justes et le LOD automatique est le bon choix —
 * d'où `textureSample` et non `textureSampleLevel`. C'est l'inverse
 * d'`inkTexture`, qui lit en espace TEXEL avec un `fract` discontinu et doit
 * forcer le niveau 0.
 *
 * Passer par le même `carte_uv` dans les deux sources n'est pas une économie de
 * code : c'est ce qui fait qu'`Échelle` et `Orientation` gardent EXACTEMENT le
 * même sens quand on bascule de source. À échelle 1 et angle 0, la carte est
 * l'image alignée sur elle-même — le cas d'usage de la source Image.
 *
 * ── LA BARRE DE QUALITÉ : LA DÉCHIRURE ─────────────────────────────────────
 *
 * Un déplacement naïf déchire l'image sur les bords du cadre (le sampler rend
 * le texel de bord en traînée) et crénèle dès que la carte est plus grossière
 * que la photo. Deux réponses, aucune n'est un dosage :
 *
 * 1. `mirrorUv` sur la lecture déplacée — le cadre se replie au lieu de s'étirer.
 * 2. La pente est mesurée sur QUATRE taps écartés d'une distance réglable
 *    (`finesse`), pas sur deux texels voisins. Un scan porte du grain ; mesurer
 *    sa pente au texel donnerait un champ de bruit et non un relief, et le
 *    résultat ressemblerait à du grain déplacé plutôt qu'à une surface.
 */
export const displacementMap: EffectModule = {
  id: "displacementMap",
  name: "Carte de déplacement",
  libraryTexture: { indexParam: "rang" },
  params: [
    {
      name: "rang",
      label: "Carte",
      min: 0,
      // Même borne arbitraire que `texture`, et même dette assumée : le vrai
      // maximum est la taille du catalogue, que `params` ne peut pas connaître.
      // Un rang hors catalogue rend la texture de repli 1x1, donc l'effet
      // devient inerte au lieu de casser.
      max: 63,
      default: 0,
      step: 1,
      unit: "none",
      // En source Image, le rang ne désigne rien : la carte est l'entrée de
      // l'effet, et le catalogue n'est même pas lu. Curseur sans objet, donc
      // masqué — même forme que `finesse` ci-dessous, sur l'autre axe.
      appliesWhen: { param: "source", equals: 0 },
      hint: "Rang de l'image dans le dossier de la bibliothèque, par ordre alphabétique",
    },
    {
      name: "mode",
      label: "Lecture",
      unit: "none",
      min: 0,
      max: 1,
      default: 0,
      step: 1,
      choices: ["Pente du gris", "Canaux R et V"],
      hint: "Pente = la carte est un relief, le décalage suit sa pente. Canaux = convention Photoshop, le rouge pousse à l'horizontale et le vert à la verticale",
    },
    { name: "amplitude", label: "Amplitude", unit: "pixels", min: 0, max: 200, default: 100, step: 1, hint: "Décalage maximum, en pixels de l'image pleine résolution" },
    { name: "echelle", label: "Échelle de la carte", unit: "none", min: 0.1, max: 4, default: 1, step: 0.05, hint: "1 = la carte couvre le cadre une fois. En dessous elle se répète" },
    { name: "angle", label: "Orientation de la carte", unit: "degrees", min: 0, max: 360, default: 0, step: 1 },
    {
      name: "finesse",
      label: "Finesse de la pente",
      unit: "pixels",
      min: 0.5,
      max: 16,
      default: 3,
      step: 0.1,
      // Le mode Canaux lit DEUX valeurs au point, pas une pente : il n'a aucun
      // écartement de taps à régler. Curseur sans objet, donc masqué.
      appliesWhen: { param: "mode", equals: 0 },
      hint: "Écartement des taps qui mesurent la pente. Petit = le grain du scan devient du relief ; grand = seules les grandes formes déplacent",
    },
    // ⚠️ EN FIN DE LISTE, ET C'EST LA SEULE PLACE POSSIBLE. Le shader lit ses
    // paramètres par INDEX (`params[6]` ci-dessous) et les presets persistent
    // ces mêmes index : insérer au milieu décalerait les cinq suivants, dans le
    // WGSL comme dans tout preset déjà enregistré. L'ordre de `params[]` n'est
    // pas l'ordre d'AFFICHAGE — ce sont les `sections` qui le décident, et
    // celle-ci pose `source` en tête de la carte.
    {
      name: "source",
      label: "Source de la carte",
      unit: "none",
      min: 0,
      max: 1,
      default: 0,
      step: 1,
      choices: ["Bibliothèque", "L'image en dessous"],
      hint: "Bibliothèque = un scan du dossier, désigné par son rang. L'image en dessous = l'entrée de l'effet elle-même, qui se déforme alors selon son propre relief tonal — aucune bibliothèque nécessaire",
    },
  ],
  sections: [
    { id: "carte", label: "Carte", layout: "liste", params: ["source", "rang", "echelle", "angle"] },
    { id: "deplacement", label: "Déplacement", layout: "liste", params: ["mode", "amplitude", "finesse"] },
  ],
  wgsl: `
${UV_SPACE_WGSL}

/** UV dans la carte, pour un point du cadre. Rotation autour du CENTRE puis
 *  echelle, comme \`texture\` — tourner autour de l'origine ferait fuir la carte
 *  hors du cadre des que l'angle bouge. \`fract\` : la carte se REPETE, un clamp
 *  etirerait son pixel de bord en trainee. */
fn carte_uv(uv: vec2<f32>, echelle: f32, s: f32, c: f32) -> vec2<f32> {
  let centre = uv - vec2<f32>(0.5);
  let tourne = vec2<f32>(centre.x * c - centre.y * s, centre.x * s + centre.y * c);
  return fract(tourne / echelle + vec2<f32>(0.5));
}

/** UN TEXEL DE LA CARTE. La SOURCE decide quelle texture est lue, jamais
 *  COMMENT elle est lue : les deux branches passent par le meme \`carte_uv\`,
 *  donc l echelle et l angle gardent exactement le meme sens de part et d
 *  autre. A echelle 1 et angle 0, en source Image, la carte EST l image alignee
 *  sur elle-meme.
 *
 *  Le branchement porte sur un uniform (\`params[6]\`), donc il est UNIFORME au
 *  sens WGSL et les \`textureSample\` a derivees implicites y sont legaux —
 *  meme construction que les quatorze matieres de \`glass\`. */
fn carte_texel(uv: vec2<f32>, echelle: f32, s: f32, c: f32, source: f32) -> vec3<f32> {
  let muv = carte_uv(uv, echelle, s, c);
  if (source < 0.5) {
    return textureSample(libraryTexture, srcSampler, muv).rgb;
  }
  return textureSample(srcTexture, srcSampler, muv).rgb;
}

fn carte_gris(uv: vec2<f32>, echelle: f32, s: f32, c: f32, source: f32) -> f32 {
  return dot(carte_texel(uv, echelle, s, c, source), vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let source = params[6];

  // REPLI 1x1, ET SEULEMENT EN SOURCE BIBLIOTHEQUE : le store sert une texture
  // minuscule tant que le decodage n'est pas fini. Rendre l'entree telle quelle
  // est le moins faux disponible pendant cette frame — meme convention que
  // \`texture\`.
  //
  // ⚠️ En source Image ce repli n'a aucun sens : rien n'attend de decodage, la
  // carte est l entree de l effet. Le binding 7 sert bien sa texture 1x1, mais
  // on ne la lit pas — donc catalogue vide, non decode ou rang hors borne,
  // l effet marche. Le \`textureDimensions\` se lit hors branche (il est
  // uniforme) ; c est le \`return\` qui devient conditionnel a la source.
  let dims = textureDimensions(libraryTexture);
  if (source < 0.5 && (dims.x <= 1u || dims.y <= 1u)) {
    return color;
  }

  let mode = params[1];
  let amplitude = params[2];
  let echelle = max(params[3], 0.01);
  let angle = params[4] * 0.017453292;
  let s = sin(angle);
  let c = cos(angle);

  // Un pixel de l'image, en UV. C'est lui qui rend l'amplitude independante du
  // format et de la definition de la photo : 24 px veut dire 24 px, pas 24
  // millemes de largeur.
  let pixel = 1.0 / vec2<f32>(textureDimensions(srcTexture));

  var champ = vec2<f32>(0.0);
  if (mode < 0.5) {
    // PENTE DU GRIS. Quatre taps, ecartes de \`finesse\` PIXELS D'IMAGE et non de
    // texels de carte : c'est ce qui rend le curseur lisible quand on change
    // l'echelle de la carte, la pente restant mesuree a la meme distance a
    // l'ecran. Difference centree, donc pas de biais d'un demi-tap.
    let h = pixel * max(params[5], 0.25);
    let gx = carte_gris(uv + vec2<f32>(h.x, 0.0), echelle, s, c, source) - carte_gris(uv - vec2<f32>(h.x, 0.0), echelle, s, c, source);
    let gy = carte_gris(uv + vec2<f32>(0.0, h.y), echelle, s, c, source) - carte_gris(uv - vec2<f32>(0.0, h.y), echelle, s, c, source);
    champ = vec2<f32>(gx, gy);
  } else {
    // CANAUX R ET V, convention Photoshop : 0,5 est le repos, 0 pousse d'un
    // cote et 1 de l'autre. Le facteur 2 ramene la course sur [-1, 1] pour que
    // l'amplitude veuille dire la meme chose dans les deux modes.
    let t = carte_texel(uv, echelle, s, c, source);
    champ = (t.rg - vec2<f32>(0.5)) * 2.0;
  }

  // mirrorUv : le cadre se replie. Sans lui, un deplacement vers l'exterieur
  // etirerait le texel de bord en trainee sur toute l'amplitude — la
  // signature la plus reconnaissable d'un mauvais deplacement.
  let dep = champ * amplitude * pixel;
  let src = textureSample(srcTexture, srcSampler, mirrorUv(uv + dep));
  return vec4<f32>(src.rgb, src.a);
}
`,
};
