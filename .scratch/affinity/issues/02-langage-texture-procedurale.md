# Le langage de la texture procédurale — combien de nos effets s'y expriment ?

Type: research
Status: open
Parent: ../map.md

## La question

`ProceduralTextureCommand@RasterTools` est le filtre où l'utilisateur écrit ses
équations par canal, sur le même chemin OpenCL que les filtres intégrés — donc
sur GPU, à leur vitesse.

**Combien de nos vingt-sept effets s'y exprimeraient ?**

## Hypothèse à éprouver, pas à croire

Une expression PAR PIXEL ne fait pas un effet à VOISINAGE. Devraient passer :
`curves`, `duotone`, `gradientMap`, `channelMixer`, `dither`, `aplat` — des
opérateurs qui ne lisent qu'un texel.

Ne devraient pas passer : tout ce qui a une pyramide (`glow`, `halation`,
`outlines` en mode Échos et ses neuf passes), les seize prélèvements de la
diffusion de `glass`, les flous.

⚠️ **C'est une hypothèse formée SANS avoir vu le langage.** Le relevé n'a que le
nom du filtre et le mot `Equations`. Si le langage sait échantillonner un
voisinage, la liste change complètement — et c'est exactement le genre de
conclusion depuis une absence qui a déjà mordu trois fois sur cette carte.

## Comment mesurer

Ouvrir le filtre dans Affinity et relever : les variables disponibles, les
fonctions, s'il existe un accès aux pixels VOISINS, et s'il accepte une seconde
image en entrée. Puis porter UN effet par pixel de bout en bout — `duotone` est
le plus simple — et comparer les pixels aux nôtres.

## Ce qui prouve que le ticket est fini

Le vocabulaire du langage écrit noir sur blanc, et un compte : N de nos 27
effets exprimables, avec la LISTE et la raison de chaque exclusion.

## Ce que ça débloque au-delà de la question posée

Si le langage est riche, il devient un moyen de **prototyper un effet avant de
l'écrire en WGSL** — leur filtre a des presets et un rendu immédiat. Ça vaut
peut-être plus que le portage lui-même.
