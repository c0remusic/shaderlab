import type { ParamPresentation } from "../components/ParamPanel";
import { HSL_BANDES, type HslBande } from "../render/effects/hslBandes";

/**
 * LE MÉLANGEUR DE COULEURS, EN DEUX VUES (item 5 du ticket 07 de
 * `.scratch/lightroom-develop/`, différé au 2026-09-11 en attendant le 06).
 *
 * ⚠️ CE MODULE NE FABRIQUE AUCUN CONTRÔLE. Les deux vues de Lightroom ne sont
 * pas deux interfaces : ce sont les MÊMES vingt-quatre paramètres du module
 * `hsl`, REGROUPÉS selon deux axes différents. Ce fichier ne produit donc que
 * des `EffectSection` — la structure que `groupEffectParams` consomme déjà — et
 * une table de libellés courts. `ParamPanel` rend ensuite ses curseurs par le
 * chemin habituel : même `LabeledSlider`, même valeur signée, même double-clic
 * de retour au défaut, mêmes pistes colorées, même voie de commit.
 *
 * C'est la raison d'être de ce découpage. Une présentation « bespoke » écrite à
 * côté aurait recopié la logique de la ligne de curseur — bornes `maxFrom`,
 * valeur signée, saisie en pourcents, verrous, défaut du module — qui vit en un
 * seul endroit et doit y rester (CLAUDE.md : « si `LabeledSlider` ne sait pas
 * faire, on l'étend, on ne le fourche pas »).
 *
 * ── LES DEUX VUES ────────────────────────────────────────────────────────────
 *
 *  COULEUR  une bande à la fois, ses trois curseurs (Teinte, Saturation,
 *           Luminance). La bande se choisit par une pastille.
 *  MÉLANGE  un canal à la fois (Teinte · Saturation · Luminance · Tout), les
 *           huit bandes en colonne. « Tout » rend les trois canaux d'affilée,
 *           c'est-à-dire exactement ce que le panneau rendait avant ce ticket.
 *
 * ⚠️ L'ORDRE INTERNE D'UN BLOC RESTE CELUI DE `params[]` — `section.params`
 * ASSIGNE, il n'ordonne pas (CLAUDE.md, corollaire (a)). Ça tombe juste ici et
 * ce n'est pas un hasard : dans `hslDevelop.ts` les huit Teinte précèdent les
 * huit Saturation, qui précèdent les huit Luminance. Une bande rend donc
 * Teinte → Saturation → Luminance, et un canal rend Rouge → Magenta, dans les
 * deux cas l'ordre de Lightroom. Si cet ordre de déclaration changeait, les
 * vues suivraient sans qu'aucun test de ce fichier ne rougisse — d'où le test
 * qui vérifie l'ordre RENDU, pas l'ordre demandé.
 *
 * ⚠️ AUCUN INDEX NE BOUGE. `params[]` est intact, les presets aussi, et
 * `test:render` doit rendre zéro écart : ce fichier est de l'AFFICHAGE.
 */

/** Vue courante du mélangeur. Les libellés viennent du ticket 07, transcrits de
 *  la fenêtre de Lightroom 14.5 d'Antoine ; `lr-fr-develop-strings.txt` ne porte
 *  PAS les chaînes de ce sélecteur (vérifié), donc ils ne sont pas mesurés. */
export type MixerVue = "couleur" | "melange";

/** Canal affiché dans la vue Mélange. `tout` rend les trois d'affilée. */
export type MixerCanal = "hue" | "sat" | "lum" | "tout";

/** Nom court d'une bande, tel que Lightroom l'écrit en français
 *  (`$$$/AgCameraRawUI/HSLAdjustment/*` dans `lr-fr-develop-strings.txt` —
 *  mesuré, pas traduit : c'est « Turquoise » pour `aqua` et « Violet » pour
 *  `purple`). Les libellés du module, eux, sont des fragments grammaticaux
 *  (« Variation de la teinte rouge ») faits pour une liste à plat ; dans une
 *  grille à un seul axe ils répètent le titre de leur bloc. */
export const NOM_DE_BANDE: Record<HslBande["id"], string> = {
  red: "Rouge",
  orange: "Orange",
  yellow: "Jaune",
  green: "Vert",
  aqua: "Turquoise",
  blue: "Bleu",
  purple: "Violet",
  magenta: "Magenta",
};

/** Les trois canaux de couleur, dans l'ordre de Lightroom. Le suffixe est celui
 *  des noms de paramètres de `hslDevelop.ts`. */
export const CANAUX: readonly { id: Exclude<MixerCanal, "tout">; label: string; suffixe: string }[] = [
  { id: "hue", label: "Teinte", suffixe: "Hue" },
  { id: "sat", label: "Saturation", suffixe: "Sat" },
  { id: "lum", label: "Luminance", suffixe: "Lum" },
];

/** Tous les curseurs du module, dans l'ordre où `hslDevelop.ts` les déclare.
 *  `mode` n'en est pas : il n'appartient à aucune vue et reste rendu en tête. */
const TOUS_LES_CURSEURS: readonly string[] = ["Hue", "Sat", "Lum", "Gray"]
  .flatMap((suffixe) => HSL_BANDES.map((b) => `${b.id}${suffixe}`));

/** Ce que les sections ne citent pas est MASQUÉ, jamais laissé de côté.
 *
 *  ⚠️ Défaut trouvé par le test, pas par la relecture : un paramètre qu'aucune
 *  section ne cite ne disparaît pas, il retombe dans le bloc LIBRE de
 *  `groupEffectParams` et s'affiche quand même. La vue « Rouge » rendait donc
 *  ses trois curseurs PLUS les vingt et un autres, et le panneau avait l'air
 *  parfaitement normal. Masquer explicitement est la seule règle sans exception
 *  à retenir. */
function masquer(cites: readonly string[]): Set<string> {
  const gardes = new Set(cites);
  const caches = new Set(TOUS_LES_CURSEURS.filter((nom) => !gardes.has(nom)));
  // ⚠️ `mode` AUSSI, et c'est une question de PLACE, pas de doublon. C'est le
  // premier paramètre déclaré, donc `groupEffectParams` le rend en tête — sous
  // les pastilles, AU-DESSUS des trois curseurs qu'elles commandent. Il coupait
  // donc le sélecteur de ce qu'il sélectionne (vu sur la première capture).
  // `ColorMixer` le rend lui-même, avec les deux autres sélecteurs : Traitement
  // choisit l'espace dans lequel le mélangeur travaille, il est de leur famille.
  caches.add("mode");
  return caches;
}

/** Le module est-il en Noir et blanc ? (`hsl.mode` vaut 1.) Dans cet état il n'y
 *  a pas deux vues à choisir : Lightroom remplace le mélangeur par le seul
 *  « Mélange noir et blanc » (`$$$/AgDevelop/CameraRawPanel/Mixer/Grayscale/
 *  GrayscaleMix`), et le sélecteur de vue n'a plus d'objet. */
export function estNoirEtBlanc(values: Record<string, number> | undefined): boolean {
  return (values?.mode ?? 0) === 1;
}

/**
 * La PRÉSENTATION à passer à `ParamPanel`, pour un état de vue donné.
 *
 * ⚠️ La condition d'applicabilité des paramètres N'EST PAS RECOPIÉE ici : les
 * vingt-quatre curseurs de couleur portent déjà `appliesWhen mode == Couleur` et
 * les huit de mélange `mode == Noir et blanc`, et `groupEffectParams` les
 * applique. Ce module choisit seulement QUELLES sections exister ; c'est le
 * module d'effet qui garde le dernier mot sur ce qui s'affiche.
 */
export function rendreMixer(opts: {
  vue: MixerVue;
  canal: MixerCanal;
  bande: HslBande["id"];
  noirEtBlanc: boolean;
}): ParamPresentation {
  const labels = new Map<string, string>();

  if (opts.noirEtBlanc) {
    const cites = HSL_BANDES.map((b) => `${b.id}Gray`);
    for (const b of HSL_BANDES) labels.set(`${b.id}Gray`, NOM_DE_BANDE[b.id]);
    return {
      sections: [{ id: "melange-nb", label: "Mélange noir et blanc", layout: "liste", params: cites }],
      labels,
      hidden: masquer(cites),
    };
  }

  if (opts.vue === "couleur") {
    const cites = CANAUX.map((c) => `${opts.bande}${c.suffixe}`);
    for (const c of CANAUX) labels.set(`${opts.bande}${c.suffixe}`, c.label);
    return {
      // TITRE VIDE : la pastille sélectionnée dit déjà « Rouge », un en-tête
      // « Rouge » juste dessous répéterait le libellé de sa propre pastille —
      // motif retiré à `duotone` par ADR-0001. Voir `sansTitreSiSeule`.
      sections: [{ id: `bande-${opts.bande}`, label: "", layout: "liste", params: cites }],
      labels,
      hidden: masquer(cites),
    };
  }

  const canaux = opts.canal === "tout" ? CANAUX : CANAUX.filter((c) => c.id === opts.canal);
  for (const c of canaux) {
    for (const b of HSL_BANDES) labels.set(`${b.id}${c.suffixe}`, NOM_DE_BANDE[b.id]);
  }
  const cites = canaux.flatMap((c) => HSL_BANDES.map((b) => `${b.id}${c.suffixe}`));
  return {
    sections: canaux.map((c) => ({
      id: `canal-${c.id}`,
      // MÊME RÈGLE, DÉRIVÉE : un bloc n'est titré que s'il y en a PLUSIEURS.
      // À « Tout », les trois titres séparent les trois canaux ; sur un canal
      // seul, l'onglet actif le nomme déjà.
      label: sansTitreSiSeule(c.label, canaux.length),
      layout: "liste" as const,
      params: HSL_BANDES.map((b) => `${b.id}${c.suffixe}`),
    })),
    labels,
    hidden: masquer(cites),
  };
}

/** Un bloc ne porte son titre que s'il partage l'écran avec d'autres : seul, il
 *  est déjà nommé par le sélecteur au-dessus de lui. Dérivé du NOMBRE de blocs,
 *  jamais posé à la main — sinon la règle et le rendu divergeraient au premier
 *  canal ajouté. */
function sansTitreSiSeule(label: string, combien: number): string {
  return combien > 1 ? label : "";
}
