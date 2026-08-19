# Débloquer le 16 bits — la troisième voie qu'Affinity montre

Type: grilling
Status: open
Parent: ../map.md

## Ce qui est bloqué, et depuis quand

L'export print (`docs/PRD-print-export.md`) bute avant sa première ligne sur une
contradiction que le dépôt a mesurée puis LAISSÉE OUVERTE
(`.scratch/prochain-palier/research/01-16-bit-hors-du-depot.md` §1.7) :

- `CLAUDE.md` verrouille « sRGB par le FORMAT, jamais un gamma manuel en WGSL » ;
- aucun format flottant n'a de variante `-srgb` — les 23 qui existent sont
  toutes des `unorm`.

Le document conclut mot pour mot : « Ce document ne choisit pas lequel céder ».

## Ce que le relevé Affinity apporte

Détail : [`research/01-comment-affinity-fait-le-16-bit`](../research/01-comment-affinity-fait-le-16-bit.md).

Affinity **n'a aucun drapeau sRGB de format** — son moteur est en OpenCL, et un
buffer OpenCL n'a pas d'espace colorimétrique. La fonction de transfert est une
DONNÉE portée par un profil : `IsLinear`, `GetLinearRGBProfile`,
`GetGammaForProfile`, `LinearizationTable`, `CreateHardwareICCTransform`.

**D'où une troisième voie que notre document ne listait pas** : ne pas choisir
entre les deux phrases, mais retirer au FORMAT le rôle de porter l'espace.

> La chaîne est LINÉAIRE de bout en bout, et l'encodage sRGB est une étape
> EXPLICITE et unique, à la frontière de sortie.

Ce n'est pas ce que l'interdit visait : il visait des conversions dispersées,
refaites dans chaque effet. Une étape unique et nommée est le contraire. Et
c'est **déjà** la forme du chemin actuel — la vue srgb ne sert qu'à la passe
FINALE (`gpuContext.ts:155-164`).

## Ce qu'il faut mesurer AVANT de trancher

1. **Le coût.** Le matériel convertit gratuitement aujourd'hui ; en WGSL c'est
   une fonction de transfert par pixel de la passe finale. À mesurer en build de
   PRODUCTION — le plancher du build de dev est 2,6× celui de la prod et noie
   les petits signaux.
2. **Les sept modules** qui consomment `srgbFormat` : `effectPassRunner`,
   `imageFrameResources`, `textureLibraryStore`, `photoLayerInput`,
   `photoSourceStore`, `presentPass`, `renderer`.
3. ⚠️ **Les 119 références de pixels.** Un changement d'espace de la chaîne les
   déplace TOUTES ou AUCUNE, et il faut savoir laquelle des deux **avant** de
   commencer — pas en découvrant 119 fichiers rouges.

## ⚠️ Ce que ce ticket ne doit pas faire dire au relevé

Affinity n'a pas « choisi » cette architecture : un moteur OpenCL n'a aucune
conversion de format à laquelle se raccrocher. **Leur solution est peut-être une
contrainte déguisée en architecture**, et laisser le matériel faire reste plus
rapide tant qu'on est en 8 bits. La voie est nouvelle, elle n'est pas
automatiquement meilleure.

## Ce qui prouve que le ticket est fini

Un ADR qui tranche laquelle des trois voies, avec le coût mesuré de
l'encodage explicite en face. Pas une intention — un chiffre et une décision.
