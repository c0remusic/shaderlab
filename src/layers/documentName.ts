/**
 * Nom affichable du DOCUMENT (la photo qui a ouvert la session), dérivé de son
 * chemin disque.
 *
 * Le document lui-même n'a pas d'identité dans le modèle de calques : ce qui
 * existe est la TOILE (`ImageFrameResources`, dimensions seules) et les calques
 * posés dessus. Son seul nom disponible reste donc le nom de fichier de son
 * chemin d'ouverture.
 *
 * DEUX CONSOMMATEURS, PLUS UN SEUL, depuis la tranche T1 (design 2026-07-28) :
 * le titre de la barre d'outils, et le `name` du CALQUE de fond que `App.tsx`
 * pousse dans la pile à l'ouverture. La ligne d'arrière-plan dérivée qui
 * l'affichait auparavant a disparu — c'est le calque qui porte son propre nom
 * maintenant. Fonction pure et partagée pour que ces deux affichages ne
 * puissent pas diverger.
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
 *  AUCUN nom. Il est affiché, jamais silencieux : le calque de fond doit porter
 *  un nom lisible dès qu'un document est chargé — un document sans nom reste un
 *  document, et une ligne au libellé vide est précisément le défaut que ce
 *  repli corrige. */
export const UNTITLED_DOCUMENT_NAME = "Document sans titre";

/**
 * Nom AFFICHABLE du document, quel que soit le chemin d'ouverture. Toujours une
 * chaîne : jamais `null`, donc jamais un calque de fond au nom escamoté.
 *
 * Les trois chemins d'ouverture ne fournissent pas la même chose :
 *  - lancement par argument (`getLaunchPath`, « Ouvrir avec » de Windows) et
 *    dialogue Ouvrir (`pick_image_file`) donnent un CHEMIN disque complet ;
 *  - le GLISSER-DÉPOSER sur le canvas ne donne qu'un `File`, dont seul `name`
 *    est exploitable — le navigateur ne divulgue jamais le chemin. C'est ce
 *    chemin d'ouverture qui faisait disparaître le nom affiché, alors que
 *    c'est le plus courant.
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
