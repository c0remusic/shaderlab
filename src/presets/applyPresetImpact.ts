/**
 * Phrase du dialogue « Remplacer la pile de calques ? » — ce qu'appliquer un
 * preset détruit RÉELLEMENT, et ce qu'il ne détruit pas.
 *
 * Pourquoi cette fonction existe plutôt qu'un littéral dans `App.tsx` : cette
 * phrase est le seul énoncé qu'un utilisateur lit avant une action destructive,
 * et elle a menti. Elle annonçait la perte des calques photo — vrai tant que
 * `applyPreset` remplaçait la pile entière, faux depuis que T1 les préserve
 * (`preservePhotoLayers.ts`). C'est le miroir exact du défaut de l'avis de
 * capture que cette tranche corrige, dans la direction la plus coûteuse : une
 * fausse menace dissuade d'une action sûre. Une phrase testable ne peut plus
 * dériver en silence derrière le code qu'elle décrit.
 *
 * Ce qui est perdu : les calques d'EFFET du document et les masques peints
 * dessus (`presetDocument.apply` reconstruit chaque calque avec un masque
 * vide). Ce qui survit : les calques photo, préservés par référence — donc
 * avec leur masque, leur transformation, leur nom et leur verrou.
 */
export function applyPresetImpactMessage(photoLayerCount: number, lockedEffectCount = 0): string {
  let preserved = "";
  if (photoLayerCount === 1) {
    preserved = " Votre calque photo, et le masque peint dessus, est conservé.";
  } else if (photoLayerCount > 1) {
    preserved = ` Vos ${photoLayerCount} calques photo, et les masques peints dessus, sont conservés.`;
  }
  // Les calques VERROUILLÉS « Tout » survivent aussi depuis le 2026-09-15 : ils
  // étaient supprimés en silence, là où `removeLayer` et la fusion vers le bas
  // refusent tous deux de les toucher. La phrase le dit, pour la même raison
  // qu'elle a cessé d'annoncer la perte des photos : elle est le seul énoncé
  // qu'un utilisateur lit avant une action destructive.
  if (lockedEffectCount === 1) {
    preserved += " Votre calque verrouillé est conservé lui aussi.";
  } else if (lockedEffectCount > 1) {
    preserved += ` Vos ${lockedEffectCount} calques verrouillés sont conservés eux aussi.`;
  }
  return `Les calques d'effet actuels et les masques peints dessus seront remplacés (annulable par Ctrl+Z après confirmation).${preserved}`;
}
