import type { EffectModule } from "./types";
import { validateEffect } from "./validate";
import { glow } from "./glow";
import { chromaticBleed } from "./chromaticBleed";
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
import { coloredEdges } from "./coloredEdges";
import { echoOutlines } from "./echoOutlines";
import { dither } from "./dither";
import { isolines } from "./isolines";
import { halftone } from "./halftone";
import { anamorphicStreak } from "./anamorphicStreak";
import { motionBlur } from "./motionBlur";
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
  // `anamorphicStreak` (2026-08-01) complete la famille des halos, et les trois
  // ne se doublent pas : `glow` etale la lumiere SANS la colorer (diffusion),
  // `halation` la reexpose en rouge sur fond sombre (film), celui-ci la tire en
  // trait bleu sur un seul axe (optique cylindrique). Ils s'empilent.
  anamorphicStreak,
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
  chromaticBleed,
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
  outlines,
  // `coloredEdges` (2026-08-01) est posé juste après `outlines` parce qu'ils
  // partagent leur détecteur (`edgeGradient.ts`) et se choisissent l'un contre
  // l'autre : encre unique, ou teinte donnée par l'orientation du bord.
  coloredEdges,
  // `echoOutlines` (2026-08-03) ferme la famille des contours, et n'est PAS un
  // troisième réglage des deux précédents. Les deux au-dessus répondent à « où
  // l'image change-t-elle ? » (un gradient) ; celui-ci répond à « à quelle
  // DISTANCE de la forme suis-je ? », ce qu'aucun gradient ne sait dire.
  //
  // Il naît d'un signalement d'Antoine (« ça ne ressemble pas du tout ») sur la
  // fiche de référence, qui décrit sous le nom `Outlines` un effet d'échos
  // concentriques — pas un détecteur. Le cahier l'avait écrit dès le 2026-08-01
  // (§6quinquies, « MÊME NOM, AUTRE EFFET ») et ça n'était jamais devenu du
  // travail. Notre `outlines` garde sa place et son id : il est bon à ce qu'il
  // fait, il ne fait simplement pas ça.
  echoOutlines,
  // `isolines` (2026-08-03) est le frère d'`echoOutlines`, et posé juste après
  // lui : les deux tracent des lignes équidistantes en ramenant une grandeur EN
  // PIXELS avant de décider. Ce qu'ils mesurent diffère — l'un une distance à
  // une forme seuillée, l'autre les niveaux du ton lui-même, qui se referment
  // sur les sommets comme sur une carte.
  //
  // Ce n'est pas `posterize` + `outlines` empilés : là-bas la largeur du trait
  // suit le gradient local (une bande dans un ciel doux, un cheveu sur une
  // arête), ici elle est constante par construction.
  isolines,
  pixelStretch,
  sliceShift,
  gradientMap,
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
