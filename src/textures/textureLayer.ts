/**
 * Décisions de MODÈLE propres à un calque de texture.
 *
 * Il n'y a volontairement pas de genre de calque « texture » : une texture est
 * un scan, donc un raster, donc un calque photo ordinaire portant
 * `imageSource` (arbitrage d'Antoine, 2026-08-05 — voir
 * `docs/superpowers/specs/2026-08-05-textures-scans-design.md` §2, D1). Ce
 * fichier ne porte donc AUCUN type : seulement les valeurs qui distinguent le
 * geste « ajouter une texture » du geste « importer une photo », et la raison
 * de chacune.
 *
 * Pur, sans dépendance au GPU ni à React — testable en Node.
 */

/**
 * Mode de fusion posé sur une texture qu'on vient d'ajouter.
 *
 * POURQUOI UN DÉFAUT EST NÉCESSAIRE : `addPhotoLayer` crée tout calque en
 * `normal`, c'est-à-dire opaque, c'est-à-dire que la texture CACHE la photo.
 * Le premier geste après un ajout serait donc toujours de changer ce mode —
 * ce n'est pas une préférence à deviner, c'est un défaut manquant.
 *
 * POURQUOI `soft-light` ET PAS UNE DÉDUCTION PAR FAMILLE. Le cahier de
 * références (`2026-08-03-references-postproduction.md:324`) liste trois modes
 * pour un scan d'overlay : `Screen`, `Multiply`, `Soft Light`. Les deux
 * premiers ne conviennent qu'à un sens de contraste — `Multiply` veut des
 * taches sombres sur fond clair, `Screen` l'inverse — et RIEN dans un fichier
 * ne dit lequel il contient. Un scan de rayures claires et un scan de taches
 * sombres portent les mêmes octets aux yeux d'un nom de fichier.
 *
 * La voie tentante est de mesurer la luminance moyenne du scan pour trancher
 * toute seule. Elle est écartée : une moyenne de luminance est un PROXY de
 * « clair sur sombre », pas la chose même, et le dépôt a déjà payé neuf fois
 * ce genre d'automatisme (mémoire `sondes-cdp-mesurent-un-proxy`). Un proxy
 * qui se trompe ici ne lève rien — il pose juste le mauvais mode, en silence.
 *
 * `soft-light` est le seul des trois qui tienne dans les DEUX sens : il ne
 * crase pas les ombres d'un scan sombre, ne lave pas un scan clair, préserve
 * le contraste de la photo dessous, et ne la cache jamais. C'est un point de
 * départ honnête plutôt qu'une devinette, et passer en Produit ou Écran reste
 * à un clic dans les contrôles de calque.
 *
 * ⚠️ Doit rester un `id` existant de `render/blend/registry.ts`. Un id inconnu
 * n'est PAS silencieux — `getBlendMode` lève `Mode de fusion inconnu` — mais il
 * lèverait au RENDU, sur le premier calque texture posé, c'est-à-dire aussi
 * tard que possible et devant l'utilisateur. Le test de
 * `test/textures/textureLayer.test.ts` avance cette levée au banc.
 */
export const DEFAULT_TEXTURE_BLEND_MODE = "soft-light";
