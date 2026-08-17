import type { EffectModule } from "./types";
import { validateEffect } from "./validate";
import { glow } from "./glow";
import { warp } from "./warp";
import { grain } from "./grain";
import { duotone } from "./duotone";
import { gooeyMerge } from "./gooeyMerge";
import { channelMixer } from "./channelMixer";
import { outlines } from "./outlines";
import { pixelStretch } from "./pixelStretch";
import { sliceShift } from "./sliceShift";
import { gradientMap } from "./gradientMap";
import { halation } from "./halation";
import { lensBlur } from "./lensBlur";
import { hatching } from "./hatching";
import { dither } from "./dither";
import { isolines } from "./isolines";
import { halftone } from "./halftone";
import { lensDistortion } from "./lensDistortion";
import { motionBlur } from "./motionBlur";
import { glass } from "./glass";
import { lensFlare } from "./lensFlare";
import { curves } from "./curves";
import { texture } from "./texture";
import { lightLeak } from "./lightLeak";
import { aplat } from "./aplat";
import { PASSTHROUGH_EFFECT } from "../effectPassRunner";

// Les six du milieu suivent l'ordre de priorité du backlog d'effets confirmé par
// l'utilisateur (design.md du MVP § « Backlog d'effets futurs ») : Gooey merge,
// Channel mixer, Outlines, Pixel stretch, Slice shift, Gradient map. Ce backlog
// est ÉPUISÉ depuis le 2026-07-31.
//
// `halation` (2026-08-01) ne vient PAS de ce backlog : il naît du cahier de
// références (`docs/superpowers/specs/2026-08-01-references-effets.md`), qui a
// montré que `glow` confondait deux phénomènes distincts. Posé juste après glow
// parce que c'est là qu'on le cherche — les deux s'empilent sur un rendu film.
//
// `lensBlur` (2026-08-01) vient du même cahier, §6ter : aucun flou n'existait
// ici, et c'était l'absence la plus voyante face à la référence. Posé après les
// deux halos parce qu'il appartient à la même famille — ce que fait l'objectif
// avec la lumière qu'il ne met pas au point.
//
// Ce tableau alimente le sélecteur « ajouter un effet ».
export const effectRegistry: EffectModule[] = [
  glow,
  halation,
  // `lensFlare` (2026-08-03) ROUVRE LA FAMILLE DES HALOS À TROIS, close à deux
  // le matin même quand `anamorphicStreak` en est sorti pour `lensDistortion`.
  //
  // La clôture portait sur un découpage : `glow` étale sans colorer
  // (diffusion), `halation` réexpose en rouge sur fond sombre (film). Celui-ci
  // n'est variante ni de l'un ni de l'autre — c'est une RÉFLEXION entre les
  // faces des lentilles, qui produit des copies DÉPLACÉES de la source au lieu
  // de l'étaler sur place. Le cahier de références le disait déjà en creux en
  // décrivant la traînée anamorphique comme « ni bloom ni flare à fantômes » :
  // le flare à fantômes y était nommé comme absent.
  //
  // Et il reste dans cette famille plutôt que d'aller chez `lensDistortion`
  // pour la raison qui structure tout ce bloc : un flare n'est pas une
  // DÉFORMATION — l'image derrière ne bouge pas d'un pixel — c'est de la
  // lumière AJOUTÉE. Première question de la famille, pas la troisième.
  lensFlare,
  // `lightLeak` (2026-08-05) ferme la famille des halos À QUATRE, et la règle
  // qui l'y admet est celle qui décide dans les deux sens depuis ADR-0014 : un
  // halo AJOUTE de la lumière, il ne déforme pas l'image. Celui-ci n'en ajoute
  // même que ça — il ne lit pas un seul texel de ce qui est en dessous.
  //
  // C'est justement ce qui le distingue des trois autres, et le distingue ASSEZ
  // pour justifier une quatrième entrée plutôt qu'un mode : `glow`, `halation`
  // et `lensFlare` partent tous les trois des hautes lumières DE L'IMAGE et les
  // transforment (étaler, réexposer, réfléchir). Une fuite ne vient pas de
  // l'image du tout — elle vient d'un jeu du boîtier, en aval de l'objectif et
  // en amont de l'émulsion. Aucun des trois ne peut la produire à aucun
  // réglage, et elle ne peut produire aucun des trois.
  //
  // Il vient du cahier de postproduction (ligne 330) et non du backlog Figma,
  // épuisé depuis le 2026-07-31.
  lightLeak,
  // `lensDistortion` (2026-08-03) a ABSORBÉ `anamorphicStreak` (ADR-0014), qui
  // occupait cette place depuis le 2026-08-01. La traînée bleue sur un seul axe
  // n'était pas un halo de plus : c'est ce que fait le VERRE cylindrique d'un
  // anamorphique, donc elle appartient à la distorsion d'objectif — la fiche
  // Figma nomme d'ailleurs `Anamorphic` un de ses trois modes d'aberration.
  //
  // Posé ici, entre les halos et les flous, parce que c'est la troisième
  // question qu'on pose à un objectif : ce qu'il RENVOIE (halos), ce qu'il ne
  // met pas au point (flous), et ce que sa FORME fait à l'image.
  //
  // Ses quatre passes de traînée sont CONDITIONNELLES : à intensité nulle (son
  // défaut) elles ne tournent pas et n'allouent rien, donc poser cet effet pour
  // un simple fisheye ne coûte que sa géométrie.
  lensDistortion,
  lensBlur,
  // `motionBlur` (2026-08-01) suit `lensBlur` : les deux sont des intégrations,
  // l'une sur la SURFACE de l'ouverture, l'autre le long d'une TRAJECTOIRE
  // pendant une durée. Ils ne partagent aucun noyau — un disque de bokeh n'a
  // rien à faire dans une traînée — mais c'est là qu'on cherche le second quand
  // on vient de poser le premier.
  motionBlur,
  // `surfaceBlur` (bilatéral) a occupé cette place du 2026-08-01 au 2026-08-03,
  // puis a été RETIRÉ sur verdict d'usage (ADR-0011). La famille des flous ne
  // compte donc plus que les deux intégrations ci-dessus. Le gaussien, lui, est
  // toujours dehors et pour une autre raison — la référence §6ter dit qu'il lave
  // l'image (ADR-0010) ; son garde vit désormais dans `registry.test.ts`, et non
  // plus dans le fichier de test d'un effet qui pouvait disparaître.
  //
  // `chromaticBleed` a occupé cette place jusqu'au 2026-08-03, puis a été
  // ABSORBÉ par le mode Latérale de `lensDistortion` (ADR-0016). Le recouvrement
  // était déclaré depuis ADR-0014 ; il a été MESURÉ avant d'être conclu, et la
  // mesure a dit deux choses : les deux effets s'écartaient de 0,005 % des
  // canaux sur le cas radial (le doublon était réel), mais l'orientation du
  // décalage — ±45°, les franges tangentielles d'un objectif décentré — valait
  // 23,1 % et n'existait nulle part ailleurs. Elle a donc été portée
  // (`aberrationAngle`) AVANT le retrait, un paramètre pour tout un effet.
  //
  // `glass` (2026-08-03) suit les trois précédents parce qu'il pose la même
  // question qu'eux — que fait un morceau de VERRE à l'image qui le traverse —
  // et qu'il y répond par le seul bout qu'ils ne prennent pas. `lensDistortion`
  // déforme par la forme d'une lentille POLIE, `lensBlur` par son ouverture ;
  // celui-ci part d'une surface IMPRIMÉE, dont le relief se répète. C'est ce
  // relief qui distingue ses neuf matières, et rien d'autre : l'optique en aval
  // est commune aux neuf.
  //
  // TRANCHE 1 : la feuille. Les cinq matières de PAVÉ (grille de blocs,
  // mortier, arête biseautée) sont la tranche 2 et viendront à la FIN de sa
  // liste de matières, pas dans un second effet — plan validé le 2026-08-03.
  glass,
  warp,
  grain,
  duotone,
  // `hatching` et `halftone` (2026-08-01) appartiennent à la référence
  // d'IMPRESSION, et c'est là qu'on cherche l'un quand on vient de poser
  // l'autre — trame, taille-douce, aplats.
  hatching,
  halftone,
  // `dither` (2026-08-03) ferme la famille d'IMPRESSION et occupe désormais
  // SEUL la place des aplats : `posterize` a tenu ce rôle jusqu'au 2026-08-03,
  // puis a été retiré parce que celui-ci le couvre (ADR-0012). Le tramage de
  // `posterize` était un CORRECTIF — un demi-palier de décalage pour cacher une
  // frontière, sans taille ni style, au service de la quantification. Ici le
  // motif EST le sujet : sa taille se règle, il descend à deux niveaux, il peut
  // réduire l'image à deux encres, et sa force descend à zéro — ce dernier
  // point étant exactement le rendu que faisait `posterize`.
  dither,
  gooeyMerge,
  channelMixer,
  curves,
  // `outlines` a ABSORBÉ `coloredEdges` le 2026-08-03 (arbitrage d'Antoine).
  // Les deux partageaient déjà leur détecteur (`edgeGradient.ts`) et cinq
  // paramètres sur huit, écrits deux fois aux mêmes valeurs ; ce qui les
  // séparait tenait en une seule décision — jeter la DIRECTION du gradient, ou
  // en faire une teinte. Une décision n'est pas un effet, c'est un mode : voir
  // le paramètre `inkMode`. Les neuf premiers index sont ceux d'`outlines`,
  // inchangés, donc son rendu et ses références de pixels sont conservés au bit.
  //
  // SECONDE ABSORPTION LE MÊME JOUR : `echoOutlines` (ADR-0015). Il était né
  // d'un signalement d'Antoine (« ça ne ressemble pas du tout ») sur la fiche
  // de référence, qui décrit sous le nom `Outlines` un effet d'échos
  // concentriques et non un détecteur. Sa fusion était décidée mais BLOQUÉE sur
  // une capacité : il porte neuf passes de pyramide, `outlines` n'en avait
  // aucune, et `runInternalPasses` les exécutait sans condition. Depuis
  // `EffectPass.enabled` (posé le même jour, pour une autre raison), les neuf
  // passes portent un prédicat sur `detectMode` et ne coûtent rien aux deux
  // modes locaux.
  //
  // Effet de bord heureux : la question de NOM que le cahier laissait ouverte
  // s'éteint. Elle venait de ce que « Outlines » désignait deux choses ; il n'y
  // en a plus qu'une.
  outlines,
  // `isolines` (2026-08-03) est le frère du mode Échos ci-dessus, et posé juste
  // après lui : les deux tracent des lignes équidistantes en ramenant une
  // grandeur EN PIXELS avant de décider. Ce qu'ils mesurent diffère — l'un une
  // distance à une forme seuillée, l'autre les niveaux du ton lui-même, qui se
  // referment sur les sommets comme sur une carte.
  //
  // Ce n'est pas `posterize` + `outlines` empilés : là-bas la largeur du trait
  // suit le gradient local (une bande dans un ciel doux, un cheveu sur une
  // arête), ici elle est constante par construction.
  isolines,
  pixelStretch,
  sliceShift,
  gradientMap,
  // PREMIER effet du registre qui échantillonne une IMAGE plutôt que ce qui est
  // en dessous de lui. Il désigne un scan de la bibliothèque par son rang
  // (`libraryTexture`), et les pixels arrivent par le binding 7 — voir
  // `render/textureLibraryStore.ts`.
  texture,
  // ⚠️ PROTOTYPE, ticket 23 — à garder ou à jeter selon l'arbitrage d'Antoine
  // sur le ticket 03. Il est au registre parce qu'un effet ne se montre pas
  // autrement : la seule façon de le juger est de le poser sur une photo dans
  // la vraie fenêtre. Ne rien construire dessus tant que 03 n'est pas résolu.
  aplat,
];
effectRegistry.forEach(validateEffect);

/** `"passthrough"` résout vers `PASSTHROUGH_EFFECT` SANS apparaître dans
 *  `effectRegistry` — ce tableau alimente le sélecteur "ajouter un effet"
 *  de LayerPanel, et passthrough n'est pas un effet choisissable par
 *  l'utilisateur : c'est l'effectId par défaut d'un calque de photo (double
 *  exposure), posé par `LayerStack.addPhotoLayer`. */
export function getEffect(id: string): EffectModule {
  if (id === PASSTHROUGH_EFFECT.id) return PASSTHROUGH_EFFECT;
  const effect = effectRegistry.find((e) => e.id === id);
  if (!effect) throw new Error(`Effet inconnu: ${id}`);
  return effect;
}
