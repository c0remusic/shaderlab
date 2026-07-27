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

/** Libellé de repli quand un document est ouvert par un chemin qui ne fournit
 *  AUCUN nom. Il est affiché, jamais silencieux : la ligne d'arrière-plan doit
 *  exister dès qu'un document est chargé — un document sans nom reste un
 *  document, et le faire disparaître de la liste est précisément le défaut que
 *  cette ligne était censée corriger. */
export const UNTITLED_DOCUMENT_NAME = "Document sans titre";

/**
 * Nom AFFICHABLE du document, quel que soit le chemin d'ouverture. Toujours une
 * chaîne : jamais `null`, donc jamais une ligne d'arrière-plan escamotée.
 *
 * Les trois chemins d'ouverture ne fournissent pas la même chose :
 *  - lancement Lightroom (`getLaunchPath`) et dialogue Ouvrir (`pick_image_file`)
 *    donnent un CHEMIN disque complet ;
 *  - le GLISSER-DÉPOSER sur le canvas ne donne qu'un `File`, dont seul `name`
 *    est exploitable — le navigateur ne divulgue jamais le chemin. C'est ce
 *    chemin d'ouverture qui faisait disparaître la ligne d'arrière-plan, alors
 *    que c'est le plus courant.
 *
 * `documentFileName` est appliqué AUSSI à `fileName` : un `File.name` est
 * normalement un nom nu, mais un dossier déposé ou un `File` fabriqué peut en
 * porter un préfixé — l'y passer coûte une ligne et évite d'afficher un chemin
 * là où on attend un nom.
 */
export function documentDisplayName(
  sourcePath: string | null | undefined,
  fileName: string | null | undefined,
): string {
  return documentFileName(sourcePath) ?? documentFileName(fileName) ?? UNTITLED_DOCUMENT_NAME;
}
