import type { EffectModule } from "./types";
import { LINEAR_TO_SRGB_WGSL } from "./srgbTransfer";
import { UV_SPACE_WGSL } from "./uvSpace";
import { INPUT_DRIVER_WGSL, inputModeParam } from "./inputMode";

/**
 * Gooey merge — les zones claires de la photo se comportent comme un liquide :
 * elles s'arrondissent, se rejoignent par des cols quand elles sont assez
 * proches, et présentent une vraie surface (ménisque réfractant + liseré
 * spéculaire) au lieu d'un bord découpé.
 *
 * SUR UNE PHOTO, ÇA VEUT DIRE QUOI. Le gooey merge d'origine (le vieux truc
 * SVG : flouter l'alpha, puis lui remettre un contraste violent) fusionne des
 * FORMES, et une photo n'a pas d'alpha à flouter. Ce qu'une photo a, en
 * revanche, ce sont des taches lumineuses séparées — bokeh, reflets sur l'eau,
 * lumières de ville, gouttes, peau grasse : le champ scalaire dont on a besoin
 * est là, c'est la LUMINANCE. Flouter la luminance puis lui appliquer une
 * iso-surface donne exactement la topologie métaball : deux taches proches
 * fusionnent par un col, une tache isolée trop petite se dilue sous le seuil et
 * disparaît. Le comportement n'est pas imité, il est reproduit — c'est la même
 * opération sur un autre champ.
 *
 * CE PARAGRAPHE DISAIT « le portage naïf n'existe donc pas ». PÉRIMÉ depuis
 * « le fond devient un calque » (2026-07-28) : `shaderCompose` compose un alpha
 * DROIT en source-over, et une toile de montage a de vraies régions
 * transparentes. Le mode d'entrée `Alpha` (2026-08-01, cahier de références
 * §6bis) n'est donc PAS un emprunt à Figma — c'est le gooey merge d'origine,
 * devenu atteignable parce que le substrat est arrivé. `Luminance inversée`
 * vient avec, et n'est pas décoratif : il fait fusionner les zones SOMBRES, ce
 * qu'aucun réglage des six autres curseurs ne sait produire.
 *
 * CE QUI EMPÊCHE QUE ÇA RENDE CHEAP. Le raccourci évident (seuiller, peindre
 * des aplats) donne un stencil : des taches plates, sans matière, qui ne
 * ressemblent à rien de liquide. Trois choses le rattrapent, dans cet ordre
 * d'importance :
 *
 * 1. **La photo reste dans la goutte.** L'iso-surface ne remplace pas l'image :
 *    elle la RÉFRACTE. Le long du ménisque, l'échantillonnage est déplacé selon
 *    la pente du champ — c'est le comportement optique d'une lentille
 *    plan-convexe, donc le détail de la photo se comprime au bord de la goutte
 *    exactement comme derrière une vraie goutte d'eau.
 * 2. **Le liseré est ÉCLAIRÉ, pas dessiné.** Un contour additif uniforme est la
 *    signature du sticker. Ici la brillance suit `dot(normale sortante,
 *    direction de la lumière)` avec une lumière haut-gauche (convention
 *    photographique) et une puissance 3 : la crête s'allume d'un côté des blobs
 *    et s'éteint de l'autre. C'est ce seul terme qui fait basculer la lecture
 *    de « aplat détouré » à « volume mouillé ».
 * 3. **Le bord ne crénelle jamais.** La largeur de la bascule est bornée par
 *    le bas à `fwidth(champ)` : à tension maximale l'iso-surface est nette au
 *    pixel près mais reste antialiasée analytiquement, au lieu de révéler la
 *    grille du champ (qui vit en demi-résolution et en 8 bits).
 *
 * PRÉCISION DU CHAMP — piège non évident. Les cibles des passes internes sont
 * au format `-srgb` 8 bits (`effectPassRunner.runInternalPasses`). Après un
 * flou large, deux texels voisins du champ diffèrent de MOINS d'un pas de
 * quantification : une différence centrale à un texel rendrait un gradient
 * quantifié, donc un liseré en escalier et une réfraction en facettes. Le pas
 * de la différence centrale est donc élargi avec la distance de fusion
 * (`2 + merge` texels) — plus le champ est lisse, plus il faut aller loin pour
 * mesurer sa pente au-dessus du bruit de quantification.
 *
 * COÛT : 9 passes internes (5 descentes jusqu'au 1/32, 4 remontées jusqu'au
 * 1/2), puis 5 taps sur le champ + 2 sur l'image en passe finale. Les niveaux
 * profonds sont quasi gratuits — 1/1024e de la surface au plus bas.
 */

/**
 * Descente dual-filter (Bjørge, SIGGRAPH 2015) — moyenne 4 diagonales + centre,
 * écartement FIXE à un texel. Ne pas la piloter par la distance de fusion : une
 * réduction de résolution doit rester échantillonnée serré, sinon elle crépite
 * (aliasing) au lieu de flouter. Toute la portée passe par la remontée.
 *
 * Note de duplication assumée : `glow.ts` porte le même noyau, en constante
 * PRIVÉE. Le factoriser imposerait de modifier `glow`, qui vient d'être repris
 * et n'est pas dans le périmètre de ce chantier — l'extraction dans un helper
 * partagé (`effects/blurKernels.ts`) est le geste à faire ensuite, en une seule
 * fois pour les deux effets.
 */
const GOOEY_DOWNSAMPLE_WGSL = `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let o = 1.0 / vec2<f32>(textureDimensions(srcTexture));
  // L'ALPHA traverse la chaîne au même titre que la couleur (2026-08-01) :
  // sans lui, le mode d'entrée Alpha lirait la constante 1.0 que ces passes
  // écrivaient, c'est-à-dire un champ plat — l'iso-surface ne trouverait
  // jamais aucun bord. Le chemin Luminance ne lit que \`.rgb\` : il est
  // inchangé au bit près.
  var sum = textureSample(srcTexture, srcSampler, uv) * 4.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x, -o.y));
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x, -o.y));
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x,  o.y));
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x,  o.y));
  return sum / 8.0;
}
`;

/**
 * Remontée : tente 3x3 canonique (1-2-1 / 2-4-2 / 1-2-1, somme 16) avec tap
 * CENTRAL explicite, lue sur la texture plus petite à la résolution plus
 * grande. Le tap central (poids 4/16) est ce qui rend l'écartement réglable :
 * sans lui, un anneau écarté au-delà d'un texel retombe sur les centres des
 * texels voisins et la bilinéaire ne ramène presque rien du centre — le noyau
 * devient une coquille creuse et le champ se creuse au lieu de s'élargir.
 * `params[0]` (distance de fusion) est donc sûr à exposer ici.
 */
const GOOEY_UPSAMPLE_WGSL = `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  // Borné en dur en plus du min du paramètre : à 0 les neuf taps tomberaient
  // sur le même point, donc une copie — l'effet disparaîtrait sans rien dire.
  let o = max(params[0], 0.05) / vec2<f32>(textureDimensions(srcTexture));
  // Alpha transporté, même raison qu'à la descente.
  var sum = textureSample(srcTexture, srcSampler, uv) * 4.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x,  0.0)) * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x,  0.0)) * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( 0.0, -o.y)) * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( 0.0,  o.y)) * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x, -o.y));
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x, -o.y));
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x,  o.y));
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x,  o.y));
  return sum / 16.0;
}
`;

export const gooeyMerge: EffectModule = {
  id: "gooeyMerge",
  name: "Gooey merge",
  params: [
    // Rayon du champ, en pixels pleine résolution :
    //   descentes (écartement fixe) : 2 + 4 + 8 + 16 + 32       = 62
    //   remontées (x distance d)    : (32 + 16 + 8 + 4) * d     = 60 * d
    //   total = 62 + 60 * d  ->  d=0.5 : ~92 px | d=2.2 (défaut) : ~194 px
    //                            d=6.0 : ~422 px
    // C'est LA distance de fusion : deux taches plus proches que ça se
    // rejoignent, au-delà elles restent deux gouttes.
    { name: "merge", label: "Distance de fusion", unit: "none", min: 0.5, max: 6, default: 2.2, step: 0.05, hint: "Jusqu'à quelle distance deux zones claires se rejoignent — rayon ≈ 62 + 60 x valeur, en pixels pleine résolution" },
    { name: "threshold", label: "Seuil de fusion", unit: "percent", min: 0, max: 1, default: 0.55, step: 0.01, hint: "Niveau de l'iso-surface, en tons perceptuels — bas = presque toute l'image devient une seule goutte, haut = seuls les reflets les plus vifs" },
    { name: "tension", label: "Tension de surface", unit: "percent", min: 0, max: 1, default: 0.8, step: 0.01, hint: "0 = transition molle (simple remise en forme des tons), 1 = surface nette au pixel près (toujours antialiasée)" },
    // Signé : le ménisque d'une goutte posée grossit ce qu'il y a dessous
    // (positif), celui d'un creux le pince (négatif). Les deux existent
    // optiquement, aucun n'est « le bon » — d'où une course des deux côtés.
    { name: "flow", label: "Réfraction", unit: "percent", min: -1, max: 1, default: 0.45, step: 0.01, hint: "Déplacement de l'image le long de la pente du champ, au bord des gouttes — positif = loupe, négatif = pincement" },
    { name: "rim", label: "Liseré spéculaire", unit: "none", min: 0, max: 2, default: 0.45, step: 0.01, hint: "Brillance sur la crête de l'iso-surface, éclairée depuis le haut-gauche — c'est ce qui fait lire un volume plutôt qu'un aplat détouré" },
    { name: "melt", label: "Fonte", unit: "percent", min: 0, max: 1, default: 0.35, step: 0.01, hint: "Part de l'image floutée reprise À L'INTÉRIEUR des gouttes — 0 = photo nette dans la goutte, 1 = matière entièrement fondue" },
    inputModeParam({
      hint: "Quel champ fusionne — Luminance : les zones claires (reflets, bokeh). Luminance inversée : les zones sombres. Alpha : les formes de la toile, le gooey merge d'origine (sans objet sur une toile entièrement opaque).",
    }),
  ],
  passes: [
    { scale: 0.5, wgsl: GOOEY_DOWNSAMPLE_WGSL },
    { scale: 0.25, wgsl: GOOEY_DOWNSAMPLE_WGSL },
    { scale: 0.125, wgsl: GOOEY_DOWNSAMPLE_WGSL },
    { scale: 0.0625, wgsl: GOOEY_DOWNSAMPLE_WGSL },
    { scale: 0.03125, wgsl: GOOEY_DOWNSAMPLE_WGSL },
    { scale: 0.0625, wgsl: GOOEY_UPSAMPLE_WGSL },
    { scale: 0.125, wgsl: GOOEY_UPSAMPLE_WGSL },
    { scale: 0.25, wgsl: GOOEY_UPSAMPLE_WGSL },
    { scale: 0.5, wgsl: GOOEY_UPSAMPLE_WGSL },
  ],
  wgsl: `
${UV_SPACE_WGSL}${LINEAR_TO_SRGB_WGSL}${INPUT_DRIVER_WGSL}
// Le champ métaball, lu sur le flou. En mode Luminance (défaut) il est lu sur
// l'axe PERCEPTUEL : le seuil est un curseur, donc une valeur perceptuelle ; le
// comparer à une luminance linéaire poserait l'iso-surface à ~0.26 perceptuel
// pour un curseur à 0.55 — l'erreur exacte qui rendait le bright-pass du glow
// inerte sur 85 % de sa course. On positionne une BASCULE sur l'axe perceptuel,
// on ne convertit aucune valeur de couleur (précédent : duotone, grain).
// En mode Alpha, aucune fonction de transfert n'est défaite : une couverture
// n'est pas un ton (voir \`input_driver\`).
fn gooField(uv: vec2<f32>, mode: f32) -> f32 {
  // mirrorUv : la différence centrale tape hors cadre près des bords.
  return input_driver(textureSample(prevPass, srcSampler, mirrorUv(uv)), mode);
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let merge = params[0];
  let threshold = params[1];
  let tension = clamp(params[2], 0.0, 1.0);
  let flow = params[3];
  let rim = max(params[4], 0.0);
  let melt = clamp(params[5], 0.0, 1.0);
  let mode = params[6];

  let ar = aspectScale(vec2<f32>(textureDimensions(srcTexture)));
  // Pas de la différence centrale, en texels du CHAMP (voir l'en-tête : sous
  // ~2 texels, la pente d'un champ très lissé passe sous le bruit de
  // quantification 8 bits de la cible de passe interne).
  let gs = (2.0 + merge) / vec2<f32>(textureDimensions(prevPass));

  let field = gooField(uv, mode);
  let fx = gooField(uv + vec2<f32>(gs.x, 0.0), mode) - gooField(uv - vec2<f32>(gs.x, 0.0), mode);
  let fy = gooField(uv + vec2<f32>(0.0, gs.y), mode) - gooField(uv - vec2<f32>(0.0, gs.y), mode);
  // Les deux pas valent le même nombre de texels sur chaque axe, donc la même
  // distance en PIXELS : \`grad\` vit déjà dans un espace isotrope, et \`gdir\`
  // est une direction unitaire en pixels. Le retour en UV se fait tout en bas,
  // par la division par \`ar\` — même convention que warp/chromaticBleed.
  let grad = vec2<f32>(fx, fy);
  // max plutôt que select : sur un champ plat, gdir tend vers 0 au lieu de
  // produire un NaN qui se propagerait dans toute la suite.
  let gdir = grad / max(length(grad), 0.00001);

  // ISO-SURFACE. Plancher fwidth : à tension 1 la bascule est aussi étroite que
  // possible SANS descendre sous un pixel écran — le champ vit en demi-résolution
  // et en 8 bits, une bascule plus étroite que ça n'ajouterait aucune netteté et
  // ne ferait que révéler sa grille en escalier.
  let band = max((1.0 - tension) * 0.25, fwidth(field) * 0.75);
  let coverage = smoothstep(threshold - band, threshold + max(band, 0.00001), field);

  // MÉNISQUE : bande de largeur FIXE (±0.15 de champ) autour de l'iso-surface,
  // volontairement découplée de \`tension\`. Une vraie surface liquide a une
  // épaisseur optique alors que sa limite est nette : indexer la réfraction sur
  // \`coverage\` la réduirait à un anneau d'un pixel dès que la tension monte,
  // c'est-à-dire à rien de visible.
  let soft = smoothstep(threshold - 0.15, threshold + 0.15, field);
  let meniscus = clamp(soft * (1.0 - soft) * 4.0, 0.0, 1.0);
  // 0.04 : plafond de déplacement, en fraction de sqrt(W*H) — ~250 px sur une
  // photo 24 Mpx à réfraction maximale, ~110 px au défaut.
  let push = gdir * flow * 0.04 * meniscus;
  let refracted = textureSample(srcTexture, srcSampler, mirrorUv(uv + push / ar)).rgb;

  // Matière fondue : l'intérieur de la goutte reprend le flou, pondéré par la
  // couverture. Le fond (couverture 0) n'est JAMAIS touché — un gooey merge
  // agit sur les formes, pas sur l'image entière.
  let molten = textureSample(prevPass, srcSampler, uv).rgb;
  var result = mix(refracted, molten, melt * coverage);

  // Spéculaire directionnel. \`gdir\` pointe vers l'intérieur (le champ croît
  // vers le clair), donc la normale SORTANTE de la surface est -gdir. La
  // lumière vient du haut-gauche (uv.y croît vers le bas) : convention
  // photographique, et surtout une direction FIXE — un liseré uniforme
  // s'éteindrait nulle part et se lirait comme un contour dessiné.
  let lightDir = normalize(vec2<f32>(-0.55, -0.83));
  let lit = max(dot(-gdir, lightDir), 0.0);
  // La crête suit la dérivée de la couverture : elle hérite donc du plancher
  // fwidth, et reste antialiasée à toute tension.
  let crest = clamp(coverage * (1.0 - coverage) * 4.0, 0.0, 1.0);
  // Additif en LUMIÈRE LINÉAIRE : c'est ce qu'est un reflet spéculaire.
  result = result + vec3<f32>(pow(lit, 3.0) * crest * rim);

  return vec4<f32>(result, color.a);
}
`,
};
