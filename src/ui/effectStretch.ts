import type { EffectTransform } from "../layers/types";

/**
 * LA GÉOMÉTRIE DU GESTE « ÉTIRER / APLATIR » — ce qu'écrivent les poignées de
 * `EffectTransformHandles` quand on tire un côté ou un coin sur la toile avec un
 * calque d'EFFET placé sélectionné (ticket 24, tranche 3).
 *
 * D'OÙ ÇA VIENT. La tranche 2 a posé le modèle (`LayerState.effectTransform`,
 * voie B) et le moteur (l'UV d'entrée de `fs_main` est déformé autour de l'ANCRE
 * de l'effet sur la seule passe de compositing). Restait le geste : tirer une
 * poignée pour fabriquer un `{ scaleX, scaleY }`. C'est ce module.
 *
 * ── LE PIVOT EST L'ANCRE, PAS LE CÔTÉ OPPOSÉ ────────────────────────────────
 *
 * C'est la différence de fond avec `ui/transform.ts` (le redimensionnement d'un
 * calque PHOTO), et elle n'est pas un choix d'ergonomie : le moteur déforme
 * `uvT = (uv - ancre) / scale + ancre` (`spatialParams.resolveEffectAnchor` +
 * `shaderCompose`), donc le point FIXE de l'étirement EST l'ancre. Faire pivoter
 * les poignées sur le côté opposé, comme Photoshop le fait sur un calque à bords
 * francs, mentirait sur ce que le rendu va faire — un manipulateur doit montrer
 * la transformation qu'il commande, pas une autre (leçon « une poignée aveugle
 * ne verrouille rien », CLAUDE.md). Un effet est un CHAMP sans bords : sa boîte
 * de sélection est le CADRE tout entier, qui grandit ou rétrécit autour de
 * l'ancre. Au repos (identité) la boîte épouse exactement la toile.
 *
 * ── CUMULÉ DEPUIS L'APPUI, JAMAIS INCRÉMENTAL ───────────────────────────────
 *
 * `stretchScale` reçoit l'échelle de DÉPART du geste et le delta TOTAL du
 * pointeur depuis l'appui, en fractions du cadre. À delta nul il rend l'échelle
 * de départ au bit près — donc pas de saut à la prise, sans avoir à mesurer un
 * écart de saisie. Un delta incrémental appliqué à l'échelle courante dériverait
 * dès qu'un axe touche sa borne : chaque frame écrêtée perdrait sa part de
 * mouvement et revenir sur ses pas ne ramènerait pas l'effet où il était. Même
 * discipline que `ui/effectMove.ts` et `EffectMoveSurface`.
 *
 * Module PUR (env Node) — aucune dépendance DOM/React. Le composant lui donne
 * une poignée, une ancre, l'échelle de départ et un delta, et pose ce qu'il rend.
 */

/** Bornes de l'échelle, communes au CURSEUR (ce module) et au moteur. Pas de
 *  valeur négative — le miroir n'est pas demandé (il viendrait par un signe
 *  explicite, jamais par une poignée qu'on tire au-delà de l'ancre) — et un
 *  plancher franc à 0,05 plutôt que 0 : une échelle nulle effondrerait le champ
 *  sur une ligne et le rendrait irrécupérable à la poignée. */
export const MIN_EFFECT_SCALE = 0.05;
export const MAX_EFFECT_SCALE = 8;

/** Sous ce seuil, un côté colle à l'ancre et ne peut plus commander son axe :
 *  l'ancre est au bord du cadre, la distance côté→ancre est nulle, la division
 *  qui en tire l'échelle diverge. On garde alors l'axe inchangé plutôt que
 *  d'écrire l'infini. Cas rare (un effet dont la position est pile sur un bord),
 *  mais silencieux si on ne le garde pas. */
const EPS_ANCRE = 1e-4;

export interface Anchor {
  x: number;
  y: number;
}

/**
 * Une des huit poignées, décrite par ce qu'elle TOUCHE sur chaque axe : un côté
 * horizontal (`left`/`right`, commande `scaleX`), un côté vertical
 * (`top`/`bottom`, commande `scaleY`), ou rien (`null`) sur l'axe qu'elle ne
 * touche pas. Un coin touche les deux ; un côté n'en touche qu'un.
 *
 * DÉCLARATIF, jamais déduit d'un index de coin : les huit entrées de
 * `STRETCH_HANDLES` portent leur rôle, et tout ce qui a besoin de savoir ce
 * qu'une poignée déplace en dérive — la position dessinée (`handlePoint`) comme
 * l'échelle produite (`stretchScale`). Deux énumérations divergeraient en
 * silence.
 */
export interface StretchHandle {
  /** Identifiant stable, sert de clé de rendu et de nom accessible. */
  id: "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";
  h: "left" | "right" | null;
  v: "top" | "bottom" | null;
}

/** LES HUIT POIGNÉES, dans l'ordre de lecture (haut-gauche → bas-droit). Quatre
 *  coins (deux axes chacun), quatre côtés (un axe chacun). */
export const STRETCH_HANDLES: readonly StretchHandle[] = [
  { id: "nw", h: "left", v: "top" },
  { id: "n", h: null, v: "top" },
  { id: "ne", h: "right", v: "top" },
  { id: "w", h: "left", v: null },
  { id: "e", h: "right", v: null },
  { id: "sw", h: "left", v: "bottom" },
  { id: "s", h: null, v: "bottom" },
  { id: "se", h: "right", v: "bottom" },
];

function clampScale(valeur: number): number {
  return Math.min(MAX_EFFECT_SCALE, Math.max(MIN_EFFECT_SCALE, valeur));
}

/**
 * La NOUVELLE échelle qu'une poignée produit, cumulée depuis l'appui.
 *
 * `depart` est l'échelle à l'APPUI, `(dx, dy)` le déplacement TOTAL du pointeur
 * depuis l'appui, en fractions du cadre. Le raisonnement, côté `right` : le côté
 * droit du cadre est à la fraction `ancre.x + (1 - ancre.x)·sx` ; le tirer de
 * `dx` amène ce côté à `… + dx`, d'où `sx = depart.scaleX + dx / (1 - ancre.x)`.
 * Les côtés `left`/`top` sont de signe opposé (les tirer VERS l'ancre agrandit).
 *
 * Chaque axe est borné indépendamment à `[MIN_EFFECT_SCALE, MAX_EFFECT_SCALE]`.
 * Le clamp ici borne le CURSEUR ; il ne remplace pas celui du shader, qu'un
 * preset atteint sans passer par ce module.
 */
export function stretchScale(
  handle: StretchHandle,
  anchor: Anchor,
  depart: EffectTransform,
  dx: number,
  dy: number,
): EffectTransform {
  let scaleX = depart.scaleX;
  let scaleY = depart.scaleY;

  if (handle.h === "right") {
    const distance = 1 - anchor.x;
    if (distance > EPS_ANCRE) scaleX = depart.scaleX + dx / distance;
  } else if (handle.h === "left") {
    const distance = anchor.x;
    if (distance > EPS_ANCRE) scaleX = depart.scaleX - dx / distance;
  }

  if (handle.v === "bottom") {
    const distance = 1 - anchor.y;
    if (distance > EPS_ANCRE) scaleY = depart.scaleY + dy / distance;
  } else if (handle.v === "top") {
    const distance = anchor.y;
    if (distance > EPS_ANCRE) scaleY = depart.scaleY - dy / distance;
  }

  return { scaleX: clampScale(scaleX), scaleY: clampScale(scaleY) };
}

export interface StretchFrame {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * LE CADRE TRANSFORMÉ, en fractions de la toile : où apparaissent les bords du
 * champ [0,1]² une fois étirés autour de l'ancre. `left = ancre.x·(1 - sx)`,
 * `right = ancre.x + (1 - ancre.x)·sx` (et de même en Y). À l'identité c'est
 * exactement `{0, 1, 0, 1}` — la boîte épouse la toile.
 *
 * Peut sortir de `[0, 1]` quand on agrandit : c'est fidèle, le champ déborde
 * alors du cadre. `right - left` vaut `sx > 0`, donc la boîte n'est jamais
 * dégénérée ni retournée.
 */
export function transformedFrame(anchor: Anchor, scale: EffectTransform): StretchFrame {
  return {
    left: anchor.x * (1 - scale.scaleX),
    right: anchor.x + (1 - anchor.x) * scale.scaleX,
    top: anchor.y * (1 - scale.scaleY),
    bottom: anchor.y + (1 - anchor.y) * scale.scaleY,
  };
}

/** La position d'une poignée sur le cadre transformé, en fractions de la toile.
 *  Un côté absent (`null`) tombe au MILIEU de l'axe qu'il ne touche pas — c'est
 *  ce qui place les poignées de côté au centre d'une arête. */
export function handlePoint(handle: StretchHandle, frame: StretchFrame): { x: number; y: number } {
  const x =
    handle.h === "left" ? frame.left : handle.h === "right" ? frame.right : (frame.left + frame.right) / 2;
  const y =
    handle.v === "top" ? frame.top : handle.v === "bottom" ? frame.bottom : (frame.top + frame.bottom) / 2;
  return { x, y };
}
