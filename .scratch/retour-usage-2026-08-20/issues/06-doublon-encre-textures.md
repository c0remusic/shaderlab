Type: grilling
Status: open

## Question

« "Encre réelle" dans hatching est juste du recyclage de "textures" » (retour
d'Antoine). Confirmé au code : `hatching` porte à la fois `inkTexture` (le
transversal `effects/inkTexture.ts`, bavure d'encre) ET `libraryTexture`
(`indexParam: encreRang`, binding 7) — DEUX mécanismes de texture dans le même
effet. La confusion est réelle.

À trancher :
- « Encre réelle » de `hatching` (et de `dither`/`halftone`, qui partagent
  `inkTexture`) est-elle vraiment redondante avec l'effet `Texture` / le mécanisme
  `libraryTexture`, ou porte-t-elle quelque chose qu'eux ne font pas (la bavure
  APPLIQUÉE à une marque calculée, pas une image plaquée) ?
- Si redondante : retirer/fusionner (mesurer la couverture avant, comme pour tout
  dédoublonnage — un doublon se MESURE, et la mesure répond souvent deux choses).
- Si distincte : clarifier les libellés pour que les deux ne se lisent pas comme
  la même chose.

Lié au ticket 04 (relation entre effets à texture de bibliothèque). Renvoie aussi
à `affinity/` ticket 02 (langage de la texture procédurale). Décision → grilling.
