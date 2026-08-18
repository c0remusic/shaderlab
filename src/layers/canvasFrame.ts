/**
 * CADRE DE LA TOILE — le rectangle du document actuellement visible, exprimé
 * dans l'espace de coordonnées d'ORIGINE de la toile.
 *
 * POURQUOI UN CADRE ET NON DE NOUVELLES DIMENSIONS. Le recadrage a été arbitré
 * NON DESTRUCTIF (ticket 28, 2026-08-18) : on change ce qu'on montre, jamais ce
 * qu'on garde. Un cadre exprime exactement ça — les calques, leurs transforms et
 * leurs rasters de masque restent dans l'espace d'origine, intacts, et rien
 * n'est à découper. C'est aussi ce qui rend le geste RÉVERSIBLE sans stocker de
 * copie : annuler le recadrage, c'est reposer `null`.
 *
 * Ce que ça évite, chiffré dans le ticket : découper les rasters les REMPLACE,
 * donc les anciens restent retenus par les entrées d'historique passées (sinon
 * l'undo ne rend rien) pendant que les nouveaux s'ajoutent. À 26 Mpx et quatre
 * traits, 104 Mo retenus deviennent 156 Mo sur les 512 du budget ; au plafond de
 * `MAX_CANVAS_PIXELS`, huit rasters saturent le budget avant tout recadrage.
 * Ici : zéro octet.
 */

/** Rectangle en pixels, dans l'espace d'origine de la toile. */
export interface CanvasFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `null` = aucun recadrage, le cadre est la toile entière. */
export type CanvasFrameState = CanvasFrame | null;

/**
 * Compose un recadrage exprimé dans le cadre COURANT avec ce cadre, et rend le
 * cadre ABSOLU qui en résulte.
 *
 * Les deux points de vue sont nécessaires et ne se confondent pas :
 * l'utilisateur trace son rectangle sur l'image AFFICHÉE — le seul point de vue
 * qu'il ait, puisqu'il ne voit plus la toile d'origine — pendant que le cadre
 * stocké doit rester absolu, sinon plus rien ne sait où sont les pixels.
 */
export function composerCadre(courant: CanvasFrameState, demande: CanvasFrame): CanvasFrame {
  const origine = courant ?? { x: 0, y: 0, width: Infinity, height: Infinity };
  // BORNÉ AU CADRE COURANT, sur les quatre côtés. Un recadrage RETIRE ; agrandir
  // ferait apparaître des pixels que l'utilisateur ne voyait plus, ce qui n'est
  // pas le même geste et n'a pas le même nom.
  const gauche = Math.max(0, Math.min(demande.x, origine.width));
  const haut = Math.max(0, Math.min(demande.y, origine.height));
  return {
    x: origine.x + gauche,
    y: origine.y + haut,
    width: Math.max(0, Math.min(demande.width, origine.width - gauche)),
    height: Math.max(0, Math.min(demande.height, origine.height - haut)),
  };
}
