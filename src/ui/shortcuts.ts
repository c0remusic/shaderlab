/**
 * Raccourcis clavier des GESTES DE CALQUE (ticket 30) — le pendant clavier des
 * boutons de la zone de contrôles et des entrées du menu contextuel (Tampon,
 * Fusionner, Dupliquer, Supprimer). Module PUR, même convention que
 * `ui/tools.ts` : aucune dépendance React/DOM, la frappe arrive en données
 * extraites, donc testable en env Node.
 *
 * ## Pourquoi un module à part de `tools.ts`
 *
 * `tools.ts` décode le choix d'un OUTIL, qui se fait d'une frappe NUE (V, B, U).
 * Ici on décode une COMMANDE de calque, qui porte des MODIFICATEURS — et
 * `isToolShortcutEvent` refuse justement toute combinaison à modificateur au
 * motif qu'elle « appartient à l'application ». Ce fichier EST cette part de
 * l'application, il ne recouvre donc pas le vocabulaire des outils.
 *
 * ## `code` pour les lettres, `key` pour les touches nommées
 *
 * Une lettre se lit par `KeyboardEvent.code` — la touche PHYSIQUE, stable quelle
 * que soit la disposition clavier —, pour la parité avec `tools.ts` et pour le
 * piège AZERTY que `App.tsx` documente déjà : `Ctrl+Alt` EST AltGr, donc sous
 * cette disposition `Ctrl+Alt+Maj+E` produit un `key` imprévisible là où `code`
 * reste `KeyE`. Une touche NOMMÉE (Suppr, Retour arrière) se lit par `key` :
 * « Delete » / « Backspace » sont déjà indépendants de la disposition.
 *
 * ## Modificateur principal : Ctrl OU Cmd
 *
 * On accepte `ctrlKey || metaKey`, exactement comme les autres raccourcis de
 * l'app (`App.tsx` Ctrl+Z/Y/I). Sur Windows — la cible du projet — c'est Ctrl ;
 * accepter Cmd ne coûte rien et n'entre en conflit avec rien. Les LIBELLÉS
 * affichés, eux, sont en forme Windows (Ctrl), voir `LAYER_SHORTCUT_LABELS`.
 */

/** Une commande de calque qu'un raccourci peut déclencher. Chaque valeur
 *  correspond à un handler déjà existant (ticket 27/28/29), jamais à un chemin
 *  d'exécution neuf. */
export type LayerAction = "stamp" | "merge" | "duplicate" | "delete";

/** La frappe, réduite à ce dont le décodage a besoin — mêmes champs qu'un
 *  `KeyboardEvent`, mais en données pures (aucun élément DOM), pour rester
 *  testable en env Node. */
export interface ShortcutChord {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
}

/** Le raccourci affiché à côté de chaque commande (infobulle du bouton, item de
 *  menu). Écrit UNE fois ici pour que l'affichage et le décodage ne divergent
 *  jamais. Forme Windows (Ctrl, jamais Cmd), cible du projet. */
export const LAYER_SHORTCUT_LABELS: Record<LayerAction, string> = {
  stamp: "Ctrl+Alt+Maj+E",
  merge: "Ctrl+E",
  duplicate: "Ctrl+J",
  delete: "Suppr",
};

/**
 * Commande de calque désignée par une frappe, ou `null` si la frappe n'en
 * désigne aucune.
 *
 * L'auto-répétition est écartée d'emblée : aplatir ou supprimer vingt fois de
 * suite en gardant la touche enfoncée n'a aucun sens. Le Tampon
 * (`Ctrl+Alt+Maj+E`) se distingue de la Fusion (`Ctrl+E`) par ses deux
 * modificateurs supplémentaires — mutuellement exclusifs, l'ordre des tests
 * n'importe donc pas.
 */
export function layerActionFromShortcut(event: ShortcutChord): LayerAction | null {
  if (event.repeat) return null;
  const primary = event.ctrlKey || event.metaKey;
  if (primary && event.altKey && event.shiftKey && event.code === "KeyE") return "stamp";
  if (primary && !event.altKey && !event.shiftKey && event.code === "KeyE") return "merge";
  if (primary && !event.altKey && !event.shiftKey && event.code === "KeyJ") return "duplicate";
  if (!primary && !event.altKey && !event.shiftKey && (event.key === "Delete" || event.key === "Backspace")) {
    return "delete";
  }
  return null;
}
