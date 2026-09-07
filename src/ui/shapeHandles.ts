import type { PixelSize } from "./transform";
import type { StretchFrame, StretchHandle } from "./effectStretch";
import type { ShapeBox } from "./shapeDraw";

/**
 * LA GÉOMÉTRIE DES POIGNÉES DE LA FORME — ce qu'écrivent les huit pastilles de
 * `ShapeTransformHandles` quand on retouche sur la toile la source de masque
 * `shape` d'un calque d'effet (ticket 13, reprise du ticket 25 de
 * `prochain-palier`). « On trace, les poignées retouchent ce qui existe. »
 *
 * ── POURQUOI CE N'EST PAS `effectStretch.ts` ────────────────────────────────
 *
 * On RÉUTILISE le SOCLE (les huit `STRETCH_HANDLES`, `StretchFrame`,
 * `handlePoint`, le composant calqué sur `EffectTransformHandles`), mais PAS sa
 * géométrie, et la différence est de fond : une source `shape` EST une BOÎTE à
 * deux coins (`mask/sources/shape.ts`, `params[0..3] = x0,y0,x1,y1`, en
 * coordonnées image normalisées). Tirer une pastille ÉCRIT le coin, elle ne
 * pose pas un facteur d'échelle. Le pivot est donc le BORD OPPOSÉ (comme le
 * recadrage d'un calque photo et la boîte d'`aplat`), pas une ancre externe —
 * un effet est un champ sans bords qui grandit autour de sa position, une forme
 * a quatre bords que l'on saisit un par un.
 *
 * ── CUMULÉ DEPUIS L'APPUI, JAMAIS INCRÉMENTAL ───────────────────────────────
 *
 * `resizeShapeBox` reçoit la boîte de DÉPART (à l'appui) et le delta TOTAL du
 * pointeur depuis l'appui, en fractions de la toile affichée — qui, la source
 * étant en coordonnées image [0,1], sont exactement les fractions image. À delta
 * nul il rend la boîte de départ au bit près : pas de saut à la prise, pas de
 * dérive quand un bord touche sa borne. Même discipline que `effectStretch.ts`
 * et `effectMove.ts`.
 *
 * Module PUR (env Node) — aucune dépendance DOM/React. Le composant lui donne
 * une poignée, la boîte de départ, un delta et le drapeau `carre`, et pose ce
 * qu'il rend.
 */

/** Taille minimale d'un côté, en fraction de l'image : le bord tiré ne peut pas
 *  croiser ni coller le bord opposé (la boîte ne s'effondre ni ne se retourne).
 *  ~0,5 % de l'image — assez petit pour une sélection fine, assez franc pour
 *  rester saisissable. */
const MIN_COTE = 0.005;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Le cadre AFFICHÉ (bords min/max) d'une boîte à deux coins. L'ordre des coins
 *  de `ShapeBox` est libre (le shader prend `min`/`max`), mais les poignées se
 *  posent et se lient sur les bords min/max — sinon `left` désignerait `x0` même
 *  quand `x0 > x1`. Réutilise la forme `StretchFrame` du socle pour partager
 *  `handlePoint`. */
export function shapeFrame(box: ShapeBox): StretchFrame {
  return {
    left: Math.min(box.x0, box.x1),
    right: Math.max(box.x0, box.x1),
    top: Math.min(box.y0, box.y1),
    bottom: Math.max(box.y0, box.y1),
  };
}

/**
 * La NOUVELLE boîte qu'une poignée produit, cumulée depuis l'appui.
 *
 * `depart` est la boîte à l'APPUI, `(dx, dy)` le déplacement TOTAL du pointeur
 * depuis l'appui en fractions de la toile. Le bord OPPOSÉ à la poignée reste
 * fixe (le pivot) ; le bord tiré s'écrit à `bord + delta`. Un côté (poignée dont
 * `h` ou `v` est `null`) ne touche qu'un axe et laisse l'autre intact.
 *
 * `carre` contraint au CARRÉ SUR LA TOILE (pixels égaux sur les deux axes, via
 * `canvas`), et SEULEMENT sur un COIN : un côté ne commande qu'un axe, où le
 * carré n'a pas de sens. Le carré englobe le geste sur le plus grand côté —
 * même convention que `rectFromDrag` (Maj à la création), donc tracer puis
 * retoucher se comportent pareil.
 *
 * Les bords sont bornés à [0, 1] (la source ne vit que dans l'image, les
 * poignées restent sur la toile) et le bord tiré ne croise jamais le bord fixe
 * (`MIN_COTE`).
 */
export function resizeShapeBox(
  handle: StretchHandle,
  depart: ShapeBox,
  dx: number,
  dy: number,
  carre: boolean,
  canvas: PixelSize,
): ShapeBox {
  const f = shapeFrame(depart);
  let left = f.left;
  let right = f.right;
  let top = f.top;
  let bottom = f.bottom;

  if (handle.h === "left") left = f.left + dx;
  else if (handle.h === "right") right = f.right + dx;
  if (handle.v === "top") top = f.top + dy;
  else if (handle.v === "bottom") bottom = f.bottom + dy;

  if (carre && handle.h && handle.v && canvas.width > 0 && canvas.height > 0) {
    const fixedX = handle.h === "left" ? f.right : f.left;
    const fixedY = handle.v === "top" ? f.bottom : f.top;
    const movingX = handle.h === "left" ? left : right;
    const movingY = handle.v === "top" ? top : bottom;
    const exPx = (movingX - fixedX) * canvas.width;
    const eyPx = (movingY - fixedY) * canvas.height;
    const cote = Math.max(Math.abs(exPx), Math.abs(eyPx));
    const mx = fixedX + ((exPx < 0 ? -1 : 1) * cote) / canvas.width;
    const my = fixedY + ((eyPx < 0 ? -1 : 1) * cote) / canvas.height;
    if (handle.h === "left") left = mx;
    else right = mx;
    if (handle.v === "top") top = my;
    else bottom = my;
  }

  // Le bord TIRÉ ne franchit pas le bord FIXE (la boîte ne se retourne pas), puis
  // tout est borné à l'image.
  if (handle.h === "left") left = Math.min(left, right - MIN_COTE);
  else if (handle.h === "right") right = Math.max(right, left + MIN_COTE);
  if (handle.v === "top") top = Math.min(top, bottom - MIN_COTE);
  else if (handle.v === "bottom") bottom = Math.max(bottom, top + MIN_COTE);

  return { x0: clamp01(left), y0: clamp01(top), x1: clamp01(right), y1: clamp01(bottom) };
}

/**
 * La boîte DÉPLACÉE par le clavier (flèches sur le cadre focusable), d'un pas en
 * fraction d'image. La retouche des BORDS est déjà accessible par les quatre
 * curseurs « Bord gauche/haut/droit/bas » du panneau Masque ; le clavier couvre
 * donc ce qu'aucune autre route ne donne — DÉPLACER la sélection entière — comme
 * les flèches de `TransformHandles` déplacent le calque photo (précédent
 * « overlay transform inaccessible clavier »).
 *
 * Le déplacement est borné pour garder la boîte DANS l'image sans la déformer :
 * elle s'arrête au bord au lieu de rétrécir. Une boîte plus large que l'image
 * sur un axe n'y bouge plus (rien à gagner à la faire glisser).
 */
export function nudgeShapeBox(box: ShapeBox, dx: number, dy: number): ShapeBox {
  const f = shapeFrame(box);
  const w = f.right - f.left;
  const h = f.bottom - f.top;
  const left = w >= 1 ? f.left : Math.min(Math.max(f.left + dx, 0), 1 - w);
  const top = h >= 1 ? f.top : Math.min(Math.max(f.top + dy, 0), 1 - h);
  return { x0: left, y0: top, x1: left + w, y1: top + h };
}
