import { conditionRemplie } from "../render/effects/displayCondition";
import { controlFieldRoles } from "../render/effects/spatialParams";
import type { CanvasControl, EffectParam } from "../render/effects/types";

/**
 * TRANSLATER UN EFFET QUI A UN LIEU — ce que l'outil « Déplacer » écrit quand on
 * tire sur la toile avec un calque d'EFFET sélectionné (ticket 20).
 *
 * D'OÙ ÇA VIENT. L'outil sortait immédiatement sur tout calque sans
 * `imageSource` (`hooks/usePhotoLayer.ts`), donc les cinq effets qui ont un
 * ancrage ne se déplaçaient qu'en attrapant leur petite poignée propre — jamais
 * avec le geste que tout le monde tente en premier. Retour d'usage d'Antoine du
 * 2026-08-21 : « on veut pouvoir déplacer les calques qui sont des effets
 * créatifs et pas des outils de retouche photo ».
 *
 * ── CE QUI DÉCIDE QU'UN EFFET SE DÉPLACE ────────────────────────────────────
 *
 * `EffectModule.canvasControls`, et RIEN D'AUTRE — ni le nom, ni la catégorie.
 * C'est le critère déclaratif qui sépare un effet créatif POSÉ d'un outil de
 * retouche qui s'applique partout ; un calque de réglage n'a pas de position
 * chez Photoshop non plus, et un effet sans ancrage qui refuse de bouger est
 * correct, pas cassé. Les champs et leurs rôles viennent de `controlFieldRoles`
 * (`render/effects/spatialParams.ts`), seule énumération du dépôt : les deviner
 * par motif (`*X`, `centre*`) marcherait jusqu'au jour où un effet nomme
 * autrement, et échouerait alors sans rien dire.
 *
 * ── CE QUI BOUGE, ET CE QUI NE BOUGE PAS ────────────────────────────────────
 *
 * Une translation déplace une POSITION. Elle ne change ni un rayon (`iso`), ni
 * un angle (`degrees`), ni la longueur d'un axe (`length`), ni une ÉTENDUE
 * (`extentX`/`extentY`) — tirer sur un `aplat` doit le déplacer, pas
 * l'agrandir. Ces deux derniers rôles n'existaient pas avant ce module : ils
 * vivaient sous `x`/`y`, et c'est précisément la distinction que la table a dû
 * faire pour que la translation soit exprimable (voir son en-tête).
 *
 * Un contrôle dont le `visibleWhen` n'est pas rempli est SAUTÉ, avec la même
 * résolution de valeurs que `CanvasControls` : écrire dans le centre d'un
 * `motionBlur` réglé en Directionnel déplacerait un point que l'utilisateur ne
 * voit pas, sur un geste qui ne montre rien.
 *
 * Module PUR, testable en env Node — même convention que `tools.ts`,
 * `canvasMode.ts`, `boxControl.ts`. Il ne connaît ni le DOM, ni React, ni la
 * pile de calques : `EffectMoveSurface` lui donne un delta et pose ce qu'il
 * rend.
 */

/**
 * Les valeurs d'un calque complétées par les défauts de l'effet — ce sur quoi
 * une condition d'affichage se lit.
 *
 * MÊME RÉSOLUTION QUE `CanvasControls.tsx` (« valeur du calque, sinon défaut du
 * paramètre »), et ce n'est pas une commodité : si les deux divergeaient, la
 * surface déplacerait un contrôle que l'overlay ne dessine pas, ou refuserait
 * d'en déplacer un qui est là. Un preset ancien n'écrit que les paramètres qu'il
 * connaît, donc l'absence est le cas NORMAL, pas le cas limite.
 */
function valeursResolues(
  params: readonly EffectParam[],
  values: Readonly<Record<string, number>>,
): Record<string, number> {
  const resolues: Record<string, number> = {};
  for (const param of params) resolues[param.name] = values[param.name] ?? param.default;
  return resolues;
}

/**
 * Le patch de paramètres d'une translation de `(dx, dy)`, en FRACTIONS du cadre
 * — la même unité que les paramètres visés, donc aucune conversion ici.
 *
 * ⚠️ `values` EST L'ÉTAT DE DÉPART DU GESTE, jamais l'état courant, et le delta
 * est cumulé depuis l'appui. Appliquer un delta incrémental à l'état courant
 * ferait DÉRIVER le geste dès qu'un axe touche sa borne : chaque frame écrêtée
 * perdrait sa part de mouvement, et revenir sur ses pas ne ramènerait pas
 * l'effet où il était.
 *
 * Rend `null` quand aucun champ de position n'est visible — un effet sans
 * ancrage (`glow`, `curves`), un effet dont le seul contrôle est un AXE
 * (`motionBlur` en Directionnel : un angle et une longueur, pas de point), ou un
 * contrôle masqué par son `visibleWhen`. `null` et pas un patch vide : c'est
 * l'appelant qui décide de ne pas monter la surface, et « rien à écrire » doit
 * se distinguer d'« écrire zéro chose » sans avoir à compter les clés.
 *
 * L'écrêtage est celui du CURSEUR (`min`/`max` de l'`EffectParam`), qui déborde
 * souvent le cadre — `sourceX` va de −0,5 à 1,5, et c'est voulu : une source de
 * flare hors champ éclaire encore. Il ne remplace pas le clamp du shader, qu'un
 * preset atteint sans passer par ici.
 */
export function deplacementPatch(
  controls: readonly CanvasControl[] | undefined,
  params: readonly EffectParam[],
  values: Readonly<Record<string, number>>,
  dx: number,
  dy: number,
): Record<string, number> | null {
  if (!controls?.length) return null;
  const resolues = valeursResolues(params, values);
  const parNom = new Map(params.map((param) => [param.name, param]));
  const patch: Record<string, number> = {};
  for (const control of controls) {
    if (control.visibleWhen && !conditionRemplie(control.visibleWhen, resolues)) continue;
    for (const [nom, role] of controlFieldRoles(control)) {
      if (role !== "x" && role !== "y") continue;
      const param = parNom.get(nom);
      // `validateEffect` rend ce cas impossible au chargement ; sauter plutôt
      // qu'écrire sans bornes, comme `CanvasControls` saute le contrôle entier.
      if (!param) continue;
      const vise = resolues[nom] + (role === "x" ? dx : dy);
      patch[nom] = Math.min(param.max, Math.max(param.min, vise));
    }
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Cet effet a-t-il un ancrage à tirer, dans son état courant ?
 *
 * DÉRIVÉ de `deplacementPatch` sur un déplacement NUL, jamais une seconde
 * parcours des contrôles : deux énumérations divergeraient, et la divergence
 * serait muette dans les deux sens — une surface montée sur un effet immobile
 * (le curseur annonce une prise qui ne fait rien), ou pas montée sur un effet
 * qui bougeait très bien.
 */
export function effetDeplacable(
  controls: readonly CanvasControl[] | undefined,
  params: readonly EffectParam[],
  values: Readonly<Record<string, number>>,
): boolean {
  return deplacementPatch(controls, params, values, 0, 0) !== null;
}
