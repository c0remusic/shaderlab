/**
 * Nom affichable du DOCUMENT (la photo qui a ouvert la session), dérivé de son
 * chemin disque.
 *
 * Le document n'est pas un `LayerState` : c'est `sourceTexture`, la texture
 * d'entrée du pipeline (`src/render/framePipelineExecutor.ts`). Il n'a donc ni
 * nom ni identité propres dans le modèle — son seul nom disponible est le nom
 * de fichier de son chemin. Fonction pure et partagée : le titre de la barre
 * d'outils et la ligne d'arrière-plan de la liste des calques doivent afficher
 * exactement le même nom, sinon l'utilisateur voit deux libellés pour un seul
 * objet.
 *
 * Sépare sur les DEUX séparateurs (`\` et `/`) : les chemins viennent de
 * Windows via Tauri, mais un chemin POSIX peut arriver d'un test ou d'un
 * export.
 */
export function documentFileName(sourcePath: string | null | undefined): string | null {
  if (!sourcePath) return null;
  // `filter(Boolean)` : un chemin terminé par un séparateur produirait sinon un
  // dernier segment vide, donc un nom vide affiché comme une ligne sans titre.
  const segments = sourcePath.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : null;
}
