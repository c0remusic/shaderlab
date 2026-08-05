import type { EffectModule } from "./types";
import { HSL_TO_RGB_WGSL } from "./hsl";
import {
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";
import { DOWNSAMPLE_KARIS_WGSL, DOWNSAMPLE_WGSL, upsampleWgsl } from "./blurChain";

/**
 * Teintes bornes du halo, en degrés. La halation n'est PAS un halo de couleur
 * libre : c'est un phénomène à une seule famille de teintes, et laisser
 * l'utilisateur en choisir une arbitraire serait la même erreur que la teinte de
 * glow retirée le même jour — un contrôle qui promet une physique qu'il ne tient
 * pas.
 *
 * Un film couleur empile ses couches sensibles dans cet ordre depuis l'objectif :
 * bleu, vert, rouge. La lumière qui traverse l'émulsion, se réfléchit sur les
 * surfaces internes de l'appareil et revient est filtrée de ses composantes
 * bleues et vertes par les couches qu'elle retraverse ; elle ré-expose donc
 * surtout la couche ROUGE, la plus profonde. D'où un halo rouge.
 *
 * Là où le retour est très énergétique — au bord immédiat de la zone brûlée — il
 * pénètre ENCORE la couche verte, et le halo y tire vers l'orange. En
 * s'éloignant, l'énergie chute, le vert décroche le premier, et il ne reste que
 * le rouge. C'est ce dégradé orange-au-bord / rouge-au-loin qui fait lire un
 * halo comme de la halation plutôt que comme un voile coloré, et c'est
 * exactement ce qu'un gain de teinte uniforme ne pouvait pas produire.
 */
const HALATION_HUE_ROUGE = 0;
const HALATION_HUE_ORANGE = 30;

/**
 * Halation — le halo rouge-orangé du film argentique.
 *
 * DISTINCT DU BLOOM, et c'est tout l'intérêt de l'avoir séparé de `glow` le
 * 2026-08-01. Un bloom est une diffusion : il étale la lumière présente SANS la
 * colorer, et se lit partout. Une halation est une ré-exposition chimique : elle
 * ajoute du rouge quelle que soit la couleur de la source, et ne se lit que sur
 * fond sombre. Les deux s'empilent — un vrai rendu film porte souvent les deux —
 * mais aucun n'est un réglage de l'autre.
 *
 * TROIS PROPRIÉTÉS QUE LE CODE DOIT TENIR, faute de quoi c'est un voile coloré :
 *   1. La couleur du halo REMPLACE celle de la source. C'est du rouge, pas du
 *      « bloom teinté en rouge ». Physique : la couche rouge est ré-exposée, elle
 *      ne sait pas ce qui l'a exposée.
 *   2. Sa teinte suit un dégradé orange (au cœur) vers rouge (au loin), porté
 *      ici par la MAGNITUDE du halo — voir `coreness` dans le composite.
 *   3. Elle s'efface sur fond clair. Dehancer expose ça sous le nom *Background
 *      Gain* ; sans ce contrôle, le halo se pose aussi bien sur un ciel blanc, où
 *      aucune halation ne serait visible sur un vrai film.
 *
 * CORRESPONDANCE avec la surface de contrôle de Dehancer, prise comme référence :
 *   Source Limiter -> Seuil · Local Diffusion -> Portée · Amplify -> Intensité ·
 *   Hue -> Teinte du cœur · Background Gain -> Effacement sur fond clair.
 * *Global Diffusion* (voile secondaire sur les demi-tons) et *Smoothness* n'ont
 * PAS d'équivalent, et c'est une limite assumée, pas un oubli : `passes` est une
 * chaîne strictement séquentielle dont seule la DERNIÈRE sortie est exposée au
 * composite (`prevPass`). Deux rayons simultanés demanderaient deux chaînes, donc
 * un changement de moteur. Empiler deux calques halation aux portées différentes
 * donne le même résultat aujourd'hui.
 *
 * CHAÎNE, moins profonde que celle de glow :
 *   bright-pass 1/2 -> 1/4 -> 1/8 -> 1/16 -> 1/32 -> 1/16 -> 1/8 -> 1/4 -> 1/2
 * Rayon en pixels pleine résolution :
 *   descentes (écartement fixe) : 2 + 4 + 8 + 16        = 30
 *   remontées (x portée s)      : (32 + 16 + 8 + 4) * s = 60 * s
 *   total = 30 + 60 * s  ->  s=0.3 : ~48 px | s=1 (défaut) : ~90 px | s=3 : ~210 px
 * Sur 6240 px de large, ~1,4 % au défaut. C'est VOULU plus serré qu'un bloom :
 * une halation est une frange autour d'une source brûlée, pas un voile d'ambiance.
 */
export const halation: EffectModule = {
  id: "halation",
  name: "Halation",
  params: [
    // Seuil haut par défaut, contrairement à glow. Une halation naît d'une
    // SUREXPOSITION — assez de lumière pour traverser l'émulsion, se réfléchir
    // et revenir. Un seuil bas en ferait un voile rouge sur toute l'image, ce
    // qui est précisément le rendu « filtre » que la barre de qualité interdit.
    { name: "threshold", label: "Seuil", unit: "percent", min: 0, max: 1, default: 0.78, step: 0.01, hint: "Luminosité à partir de laquelle une zone déclenche un halo — haut par défaut, une halation naît d'une surexposition" },
    { name: "spread", label: "Portée du halo", unit: "none", min: 0.3, max: 3, default: 1, step: 0.05, hint: "Rayon ≈ 30 + 60 x portée, en pixels pleine résolution" },
    { name: "intensity", label: "Intensité", unit: "none", min: 0, max: 4, default: 1.2, step: 0.05 },
    { name: "hue", label: "Orangé du cœur", unit: "percent", min: 0, max: 1, default: 0.7, step: 0.01, hint: "0 = halo rouge pur sur toute sa largeur ; 1 = cœur franchement orange, virant au rouge en s'éloignant" },
    { name: "transition", label: "Resserrement de l'orange", unit: "none", min: 1, max: 40, default: 8, step: 0.5, hint: "Vitesse à laquelle l'orange cède au rouge quand on s'éloigne de la source — haut = liseré orange fin, bas = halo orange large" },
    { name: "background", label: "Effacement sur fond clair", unit: "percent", min: 0, max: 1, default: 0.6, step: 0.01, hint: "0 = le halo se pose partout ; 1 = il disparaît complètement sur les fonds clairs, comme sur un vrai film" },
  ],
  passes: [
    {
      scale: 0.5,
      wgsl: `${SRGB_TO_LINEAR_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  // Seuil décodé vers le LINÉAIRE : il vient d'un curseur, donc d'une valeur
  // perceptuelle, alors que \`brightness\` est déjà linéaire (le format -srgb
  // décode à l'échantillonnage). Même convention que le bright-pass de glow —
  // comparés tels quels, le curseur serait inerte sur la majeure partie de sa
  // course.
  let threshold = srgb_to_linear(params[0]);
  let brightness = max(color.r, max(color.g, color.b));
  // Bascule FRANCHE, sans genou — à l'inverse de glow. Le genou de glow existe
  // parce qu'un bloom doit prendre les demi-tons clairs sans marquer de
  // frontière. Ici la frontière est le sujet : la halation trace le contour de
  // ce qui a brûlé, et l'adoucir reviendrait à teinter en rouge tout ce qui est
  // simplement lumineux.
  //
  // On ne garde que l'ÉNERGIE au-dessus du seuil, en niveau de gris : la couleur
  // de la source est délibérément jetée ici, puisque le halo sera recoloré au
  // composite. La garder aurait fait transparaître la teinte de la source dans
  // le halo, ce qui est le comportement d'un bloom, pas d'une halation.
  let energy = max(brightness - threshold, 0.0);
  return vec4<f32>(vec3<f32>(energy), 1.0);
}
`,
    },
    { scale: 0.25, wgsl: DOWNSAMPLE_KARIS_WGSL },
    { scale: 0.125, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.0625, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.03125, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.0625, wgsl: upsampleWgsl(1) },
    { scale: 0.125, wgsl: upsampleWgsl(1) },
    { scale: 0.25, wgsl: upsampleWgsl(1) },
    { scale: 0.5, wgsl: upsampleWgsl(1) },
  ],
  /**
   * DEUX SECTIONS : ce qui DÉCLENCHE le halo, et ce que le halo EST.
   *
   * Pas de mode exclusif ici — les six paramètres servent tous, tout le temps.
   * Le découpage est donc THÉMATIQUE : il ne masque rien, il répond aux deux
   * questions que l'effet pose.
   *
   * POURQUOI « Effacement sur fond clair » EST UN SEUIL. Une halation a DEUX
   * conditions d'existence, et n'en tenir qu'une est exactement ce qui la fait
   * rendre comme un voile rose : il faut assez de lumière pour brûler l'émulsion
   * (seuil sur la SOURCE) et assez de noir autour pour que le retour se voie
   * (seuil sur le FOND). Les deux décident SI un halo apparaît ; aucun ne décide
   * de quoi il a l'air. Ils se règlent donc ensemble, bien qu'ils soient lus par
   * deux passes différentes — c'est la seule section des quatre effets de cette
   * passe qui ne suive pas une frontière de passes, et c'est délibéré.
   *
   * Les quatre autres décrivent le halo une fois qu'il existe : jusqu'où il
   * porte, avec quelle force, et le dégradé orange-au-cœur / rouge-au-loin qui
   * le fait lire comme de la halation plutôt que comme un bloom teinté.
   *
   * ⚠️ `params[]` ne bouge pas — les index sont persistés dans les presets. Le
   * seul effet visible est que « Effacement sur fond clair », dernier du
   * tableau, rejoint à l'AFFICHAGE la section ouverte par le seuil.
   */
  sections: [
    { id: "seuil", label: "Seuil", layout: "liste", params: ["threshold", "background"] },
    { id: "halo", label: "Halo", layout: "liste", params: ["spread", "intensity", "hue", "transition"] },
  ],
  wgsl: `
${HSL_TO_RGB_WGSL}${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let intensity = params[2];
  let orange = clamp(params[3], 0.0, 1.0);
  let transition = params[4];
  let background = clamp(params[5], 0.0, 1.0);

  // Le halo est en niveaux de gris depuis le bright-pass : ses trois canaux sont
  // égaux, on en lit un seul.
  let magnitude = textureSample(prevPass, srcSampler, uv).r;

  // DÉGRADÉ ORANGE -> ROUGE, dérivé de la MAGNITUDE du halo plutôt que d'une
  // distance géométrique. C'est le même fait physique lu autrement : la teinte
  // suit l'énergie du retour lumineux, et l'énergie est précisément ce que la
  // pyramide de flou a calculé. Une distance mesurée en pixels aurait demandé un
  // second champ (donc une seconde chaîne, impossible ici) et aurait en plus été
  // fausse — deux sources voisines s'additionnent, leur zone commune est plus
  // énergétique que la distance à chacune ne le laisse croire.
  //
  // \`1 - exp(-m * t)\` sature vers 1 sans jamais l'atteindre : le cœur tend vers
  // l'orange choisi, la périphérie vers le rouge pur, et la transition n'a pas de
  // frontière visible. \`transition\` en règle la raideur.
  let coreness = 1.0 - exp(-magnitude * transition);
  let hueDeg = mix(${HALATION_HUE_ROUGE}.0, ${HALATION_HUE_ORANGE}.0, orange * coreness);
  // Saturation 1 et luminosité 0.5 : la teinte PURE. Son dosage vient de
  // \`magnitude\` et \`intensity\`, pas d'une luminosité de picker — deux réglages
  // de force sur le même canal se contrediraient.
  //
  // Décodée vers le linéaire avant tout usage, comme le duotone : \`hsl2rgb\` rend
  // une valeur perceptuelle, et l'ajouter telle quelle à une couleur linéaire
  // serait le double gamma que ce projet interdit.
  let teinte = srgb_to_linear3(hsl2rgb(hueDeg / 360.0, 1.0, 0.5));

  // EFFACEMENT SUR FOND CLAIR (Background Gain). Une halation ne se voit que
  // contre du sombre : sur un vrai film, le halo rouge posé sur une zone déjà
  // claire est noyé dans sa densité. Sans ce terme, l'effet teinte les ciels
  // blancs en rose, ce qu'aucun film ne fait.
  //
  // Le poids se calcule sur le ton PERCEPTUEL du fond, pas sur la luminance
  // linéaire : c'est la clarté vue qui décide si le halo se lit, et une bascule
  // posée en linéaire tomberait bien trop haut (même constat qu'au checkpoint
  // duotone du 2026-07-26).
  let fond = linear_to_srgb(dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722)));
  let poidsFond = mix(1.0, 1.0 - fond, background);

  // Additif : une ré-exposition AJOUTE de la densité, elle ne remplace pas le
  // pixel. La couleur ajoutée, elle, est bien celle du halo et non celle de la
  // source — c'est ce qui sépare une halation d'un bloom teinté.
  return vec4<f32>(color.rgb + teinte * magnitude * intensity * poidsFond, color.a);
}
`,
};
