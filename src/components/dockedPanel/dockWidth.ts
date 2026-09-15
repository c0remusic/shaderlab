/**
 * Bornes de largeur du dock — mêmes valeurs que les tokens
 * `--inspector-width-min`/`--inspector-width-max` (src/design/components.css),
 * dupliquées ici en constantes JS pour le clamp du drag (même pattern que
 * les constantes déjà utilisées ailleurs dans le projet).
 */
export const DOCK_WIDTH_MIN = 240;
export const DOCK_WIDTH_MAX = 400;

/** Largeur d'USINE — celle d'un premier lancement, avant qu'aucune disposition
 *  n'ait été enregistrée. Elle vivait en littéral dans `App.tsx`, à l'écart des
 *  deux bornes qui la contraignent ; depuis que la disposition est persistée
 *  (`ui/workspaceLayoutStore`), c'est aussi la valeur sur laquelle on retombe
 *  quand un fichier illisible est écarté, donc elle a deux lecteurs. */
export const DOCK_WIDTH_DEFAUT = 320;

export function clampDockWidth(width: number): number {
  return Math.min(DOCK_WIDTH_MAX, Math.max(DOCK_WIDTH_MIN, width));
}
