import { IDLE_CANVAS_MODE, type CanvasMode } from "./canvasMode";

/**
 * Outil actif du canvas — la palette commutable type Photoshop.
 *
 * Existe parce que l'app n'avait qu'une BASCULE de peinture de masque enfouie
 * dans la carte Masque du dock : entrer dans le pinceau se faisait loin du
 * canvas, et en sortir demandait de retrouver la même bascule. Un outil est
 * une chose qu'on choisit et qui reste choisie, pas une case à cocher.
 *
 * Module PUR : aucune dépendance React/DOM, testable en env Node — même
 * convention que `canvasMode.ts` et `viewport.ts`.
 *
 * ## Pourquoi ce module NE remplace PAS `CanvasMode`
 *
 * `CanvasMode` reste l'état d'interaction EXCLUSIF du canvas, et sa raison
 * d'être ne change pas : rendre les combinaisons incompatibles inexprimables.
 * L'outil est ce que l'UTILISATEUR choisit ; le mode est ce que le canvas en
 * DÉDUIT. Deux outils (pinceau et gomme) donnent le même mode, et un mode
 * (`crop`) n'a aujourd'hui aucun outil — les deux notions ne se recouvrent
 * donc pas, et les fondre ferait perdre l'un ou l'autre.
 *
 * `crop` est délibérément ABSENT de la palette : `LayerTransform`
 * (`src/layers/types.ts`) n'a toujours pas de champ `crop` et `enterCrop`
 * n'a aucun appelant de production. Un bouton qui ferait entrer dans un mode
 * sans géométrie derrière serait un bouton qui ment. Il arrivera avec la
 * tranche qui implémente le recadrage, pas avant.
 */
export type ToolId = "move" | "brush" | "eraser" | "hand";

export interface ToolDefinition {
  id: ToolId;
  label: string;
  /** `KeyboardEvent.code` et non `key` : `code` désigne la TOUCHE PHYSIQUE et
   *  reste stable quelle que soit la disposition clavier. Sur un AZERTY,
   *  `key` vaudrait autre chose pour la même touche sous le doigt. */
  shortcut: string;
  /** Lettre montrée à l'utilisateur dans l'infobulle. */
  shortcutLabel: string;
  hint: string;
}

/** Ordre d'affichage de la palette, du plus général au plus spécialisé. */
export const TOOLS: readonly ToolDefinition[] = [
  {
    id: "move",
    label: "Déplacer",
    shortcut: "KeyV",
    shortcutLabel: "V",
    hint: "Sélectionner une image et la déplacer, la tourner, la redimensionner",
  },
  {
    id: "brush",
    label: "Pinceau de masque",
    shortcut: "KeyB",
    shortcutLabel: "B",
    hint: "Peindre le masque du calque sélectionné",
  },
  {
    id: "eraser",
    label: "Gomme de masque",
    shortcut: "KeyE",
    shortcutLabel: "E",
    hint: "Effacer le masque du calque sélectionné",
  },
  {
    id: "hand",
    label: "Main",
    shortcut: "KeyH",
    shortcutLabel: "H",
    hint: "Déplacer la vue (Espace maintenu fait la même chose depuis n'importe quel outil)",
  },
] as const;

/** État que la palette pilote. Regroupé en UN objet parce que ces trois
 *  champs ne sont pas indépendants : les poser séparément laisse passer des
 *  combinaisons qu'aucun outil ne produit (main + peinture, par exemple). */
export interface ToolState {
  mode: CanvasMode;
  /** Le pinceau efface au lieu de peindre. */
  erase: boolean;
  /** L'outil Main est actif : le clic gauche déplace la vue. Distinct du geste
   *  Espace, qui est TRANSITOIRE et disponible depuis n'importe quel outil. */
  handTool: boolean;
}

/**
 * Outil actif déduit de l'état courant. L'ordre des tests n'est pas anodin :
 * la main l'emporte sur le pinceau parce qu'elle neutralise réellement le
 * geste de peinture, et un mode `crop` retombe sur « Déplacer » plutôt que sur
 * un cinquième état sans bouton — la palette ne doit jamais afficher zéro
 * outil actif.
 */
export function activeTool(state: ToolState): ToolId {
  if (state.handTool) return "hand";
  if (state.mode.kind === "maskPaint") return state.erase ? "eraser" : "brush";
  return "move";
}

/**
 * État produit par le choix d'un outil.
 *
 * Choisir la main REMET le mode à `idle` au lieu de le conserver : garder
 * `maskPaint` sous la main laisserait le curseur de pinceau affiché et le
 * canvas en `cursor: none` pendant un geste qui ne peint pas. Sortir du mode
 * est la seule lecture qui ne ment pas sur ce que fait le clic gauche.
 */
export function selectTool(tool: ToolId, current: ToolState): ToolState {
  switch (tool) {
    case "move":
      return { mode: IDLE_CANVAS_MODE, erase: current.erase, handTool: false };
    case "brush":
      return { mode: { kind: "maskPaint" }, erase: false, handTool: false };
    case "eraser":
      return { mode: { kind: "maskPaint" }, erase: true, handTool: false };
    case "hand":
      return { mode: IDLE_CANVAS_MODE, erase: current.erase, handTool: true };
  }
}

/** Outil désigné par une touche, ou `null` si la touche n'en désigne aucun. */
export function toolFromShortcut(code: string): ToolId | null {
  return TOOLS.find((t) => t.shortcut === code)?.id ?? null;
}

/**
 * Vrai ssi un évènement clavier doit être interprété comme un raccourci
 * d'outil.
 *
 * Les modificateurs sont EXCLUS : `Ctrl+B` ou `Ctrl+E` appartiennent à
 * l'application (ou au navigateur), pas à la palette. Et une frappe dans un
 * champ de saisie écrit une lettre — sans cette garde, taper « brush » dans le
 * nom d'un preset changerait d'outil à chaque lettre.
 */
export function isToolShortcutEvent(event: {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
}): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return false;
  return toolFromShortcut(event.code) !== null;
}
