/**
 * Le protocole d'un CHAMP À BROUILLON, en un seul endroit.
 *
 * Un champ à brouillon garde la frappe en local pendant l'édition et ne touche
 * au modèle qu'au `blur` : `Entrée` ne fait que blurrer, `Échap` abandonne, une
 * saisie illisible revient à la valeur précédente. C'est le contrôle le plus
 * utilisé de l'application — chaque curseur de paramètre d'effet en porte un.
 *
 * POURQUOI CE MODULE EXISTE. Le protocole était écrit CINQ fois (`NumberField`,
 * `LabeledSlider`, le renommage de calque, le renommage de preset, le champ hex
 * du sélecteur de couleur), avec trois mécanismes d'abandon différents — et
 * DEUX des cinq ne géraient pas `Échap` du tout. Le docblock de `NumberField`
 * annonçait pourtant un contrat « identique à celui du champ de valeur de
 * `LabeledSlider` » : il ne l'était plus depuis le correctif d'abandon, jamais
 * rétroporté. Conséquence vivante, mesurée le 2026-09-15 : taper une valeur
 * dans le champ de n'importe quel curseur d'effet, presser `Échap`, cliquer
 * ailleurs — la valeur était COMMITÉE, avec une entrée d'historique. Chromium
 * ne restaure rien de lui-même dans un `<input>` contrôlé.
 *
 * Et rien ne pouvait le dire : les seize stories de `LabeledSlider` ne tapent
 * jamais dans son champ de valeur, et un commit de trop ne change aucun pixel.
 *
 * Ce module ne DÉCIDE pas des effets de bord — il rend un verdict, et chaque
 * champ l'applique à sa façon (les deux primitives ne commitent déjà pas la
 * même chose quand la valeur n'a pas bougé). C'est ce qui le garde pur, donc
 * exécutable dans le projet `unit`, sans navigateur.
 */

/** Ce qu'une touche demande à un champ à brouillon. `null` = elle ne le
 *  concerne pas et la frappe continue. */
export type DraftKeyAction = "commit" | "abandon" | null;

/**
 * `Entrée` commite, `Échap` abandonne, le reste continue la frappe.
 *
 * ⚠️ Les deux passent par un `blur()` plutôt que par un commit direct : la prop
 * contrôlée n'est pas rafraîchie entre un commit explicite et le commit du
 * `blur` qui suit, donc aucune garde d'égalité ne saurait dédupliquer les deux
 * — l'entrée d'historique partirait en double.
 */
export function draftKeyAction(key: string): DraftKeyAction {
  if (key === "Enter") return "commit";
  if (key === "Escape") return "abandon";
  return null;
}

/** Verdict d'une fin d'édition. Quatre issues, et elles ne se confondent pas :
 *  `abandon` et `invalide` restaurent toutes deux l'affichage mais pour des
 *  raisons différentes, et `inchange` distingue « lu, égal » de « illisible »,
 *  ce dont les deux primitives font un usage différent. */
export type DraftOutcome =
  | { kind: "abandon" }
  | { kind: "invalid" }
  | { kind: "unchanged"; value: number }
  | { kind: "commit"; value: number };

/**
 * Que faire d'un brouillon à la fin de l'édition.
 *
 * `abandoned` est passé par l'appelant et non déduit de la touche, parce qu'il
 * doit être lu SYNCHRONEMENT : le `commit` déclenché par le `blur` s'exécute
 * AVANT le re-render, donc un `setDraft(valeurAffichée)` posé à la frappe
 * d'`Échap` ne serait pas encore visible et le brouillon abandonné serait
 * commité quand même. C'est le défaut constaté au test d'interaction Storybook
 * de `NumberField` — « 999 » commité malgré `Échap` — et la raison pour
 * laquelle chaque champ garde une ref plutôt qu'un état.
 */
export function draftOutcome(
  draft: string,
  currentValue: number,
  abandoned: boolean,
  parse: (draft: string) => number | null,
): DraftOutcome {
  if (abandoned) return { kind: "abandon" };
  const parsed = parse(draft);
  if (parsed === null) return { kind: "invalid" };
  if (parsed === currentValue) return { kind: "unchanged", value: parsed };
  return { kind: "commit", value: parsed };
}
