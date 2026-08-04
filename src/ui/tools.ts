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
 *
 * ## La MAIN n'est pas un outil (décision utilisateur, 2026-07-31 soir)
 *
 * Elle l'a été une journée, avec Espace pour la sélectionner et l'y laisser.
 * Ce n'en est pas un : un outil est une chose qu'on choisit et qui reste
 * choisie *parce qu'on va s'en servir plusieurs fois*. Déplacer la vue est une
 * parenthèse au milieu d'autre chose — on la ferme et on reprend où on en
 * était. En faire un outil forçait donc à revenir au précédent à la main,
 * c'est-à-dire à payer une sortie pour un geste qui n'a pas d'entrée.
 *
 * Le geste vit ENTIÈREMENT dans `Canvas` (`spaceHeld`) : Espace maintenu
 * déplace la vue depuis n'importe quel outil, le relâchement rend l'outil
 * précédent puisqu'on ne l'a jamais quitté. C'est la convention de Photoshop,
 * de Figma et de Blender.
 */
export type ToolId = "move" | "brush" | "eraser";

/** L'outil de repos, celui sur lequel `Échap` ramène. « Déplacer » et non
 *  « aucun » : la palette ne doit jamais afficher zéro outil actif (cf.
 *  `activeTool`), et c'est déjà l'outil que `IDLE_CANVAS_MODE` produit. */
export const DEFAULT_TOOL: ToolId = "move";

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
] as const;

/** État que la palette pilote. Regroupé en UN objet parce que ces deux champs
 *  ne sont pas indépendants : `erase` n'a de sens qu'en mode peinture, et les
 *  poser séparément laisserait exprimer une gomme hors du pinceau.
 *
 *  Le déplacement de la vue N'EST PAS ici : c'est un geste transitoire de
 *  `Canvas` (Espace maintenu), pas un état d'outil — voir l'en-tête du module. */
export interface ToolState {
  mode: CanvasMode;
  /** Le pinceau efface au lieu de peindre. */
  erase: boolean;
}

/**
 * Outil actif déduit de l'état courant. Un mode `crop` retombe sur
 * « Déplacer » plutôt que sur un quatrième état sans bouton — la palette ne
 * doit jamais afficher zéro outil actif.
 *
 * Espace maintenu ne change RIEN ici, et c'est le point : pendant la
 * parenthèse de déplacement, la palette continue de montrer l'outil auquel on
 * va revenir.
 */
export function activeTool(state: ToolState): ToolId {
  if (state.mode.kind === "maskPaint") return state.erase ? "eraser" : "brush";
  return "move";
}

/**
 * État produit par le choix d'un outil.
 *
 * « Déplacer » PRÉSERVE le sens d'effacement (`current.erase`) au lieu de le
 * remettre à faux : c'est ce qui fait qu'un aller-retour vers la palette rend
 * la gomme et non le pinceau.
 */
export function selectTool(tool: ToolId, current: ToolState, target?: { layerId: string; sourceId: string | null }): ToolState {
  switch (tool) {
    case "move":
      return { mode: IDLE_CANVAS_MODE, erase: current.erase };
    case "brush":
      return { mode: target ? { kind: "maskPaint", ...target } : IDLE_CANVAS_MODE, erase: false };
    case "eraser":
      return { mode: target ? { kind: "maskPaint", ...target } : IDLE_CANVAS_MODE, erase: true };
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

/**
 * Vrai ssi un évènement clavier doit QUITTER l'outil courant pour revenir à
 * `DEFAULT_TOOL`.
 *
 * `Échap` est l'équivalent clavier du bouton « Quitter » de `BrushToolbar`,
 * qui n'existait qu'à la souris : entrer dans le pinceau avait un raccourci
 * (`B`), en sortir n'en avait aucun. Il ne vit PAS dans `TOOLS` parce qu'il ne
 * désigne pas un outil — sinon la palette afficherait un cinquième bouton
 * « Échap » qui ne sélectionne rien.
 *
 * Mêmes gardes de modificateur que `isToolShortcutEvent`, et pour la même
 * raison : `Ctrl+Échap` ouvre le menu Démarrer de Windows, ce n'est pas à nous.
 * L'auto-répétition est écartée aussi — revenir vingt fois de suite au même
 * outil n'a aucun sens.
 */
export function isQuitToolEvent(event: {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
}): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return false;
  return event.code === "Escape";
}

/** Ce qu'un `Échap` doit faire, selon ce qu'il y a à quitter. */
export type EscapeAction = "quitTool" | "deselect" | "none";

/**
 * `Échap` défait UNE couche à la fois, de la plus superficielle à la plus
 * profonde : d'abord l'outil courant, ensuite la sélection.
 *
 * L'ordre n'est pas arbitraire. Peindre un masque suppose un calque
 * sélectionné : désélectionner d'abord viderait le panneau sous les yeux de
 * quelqu'un qui voulait seulement ranger son pinceau, et il devrait re-choisir
 * son calque pour reprendre. L'inverse ne coûte rien — un second `Échap` est
 * juste là.
 *
 * Cette fonction existe séparément d'`App.tsx` pour être testable : la cascade
 * est une règle, pas un détail de câblage.
 */
export function escapeAction(currentTool: ToolId, hasSelection: boolean): EscapeAction {
  if (currentTool !== DEFAULT_TOOL) return "quitTool";
  return hasSelection ? "deselect" : "none";
}
