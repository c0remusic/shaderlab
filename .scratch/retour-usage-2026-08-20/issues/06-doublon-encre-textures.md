Type: grilling
Status: resolved

> ✅ **Grilling 2026-08-21** : l'encre-par-texture (pré-baked) est refusée →
> **encre PROCÉDURALE** (shader) dans la famille Impression, chantier séparé à
> charter. `Texture` (plaquer un scan) RESTE et s'enrichit (« plus de textures »,
> pack/procédural, chantier séparé). Détail : `../map.md` § Décisions du grilling.

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
