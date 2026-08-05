---
id: ADR-0018
status: active
date: 2026-08-05
---

# ADR-0018 : une texture est un EFFET, pas un calque photo

## Contexte

Demande d'Antoine, à partir d'une page produit (*Surface Supply*, 83 scans
4961×7016) : « je voudrais qu'on puisse ajouter des textures du type aussi ».

Trois voies lui ont été posées le matin :

- **A** — une texture est un calque photo ordinaire (`imageSource` + mode de
  fusion) ;
- **B** — un genre de calque « texture » distinct ;
- **C** — un effet du registre.

Il a retenu **A**, et A a été livré : bibliothèque de textures, vignettes,
`coverCanvas`, `importTextureFromPath`. Le design
`docs/superpowers/specs/2026-08-05-textures-scans-design.md` §2 D1 écrit cette
décision, et écarte C.

**Antoine a rouvert la question trois fois dans la journée** — « attends mais ce
n'est pas un effet ? », puis « ce n'est toujours pas un effet », puis « fais
le ». Ce n'est pas un changement d'avis : c'est un décalage entre le MODÈLE
(A est correct : un scan est un raster) et le GESTE (poser une matière est un
réglage, pas un empilement de calque photo).

## Ce qui a d'abord été opposé à C, et qui était FAUX

L'argument donné contre l'effet était : « ADR-0008 interdit de poser un effet
sur un calque photo, donc sur la photo qu'on veut texturer ».

**La seconde moitié est fausse.** ADR-0008 interdit d'écrire un `effectId` **sur**
le calque qui porte `imageSource` ; il n'interdit pas d'appliquer un effet à une
photo — c'est le flux normal, par un calque d'effet posé au-dessus et écrêté
(`setLayerClip`, ADR-0005). Tous les effets du registre atteignent la photo par
ce chemin, tous les jours. L'objection ne tenait pas.

## La vraie contrainte, et comment elle se contourne

`LayerState.params` est un `Record<string, number>` parce que l'uniform est
`array<f32, MAX_EFFECT_PARAMS>` et que rien d'autre ne franchit cette frontière
(`layers/types.ts`). **Un effet n'a donc aucun champ par lequel désigner une
image.** C'est le même mur que celui du §3 du cadrage « éléments et
composition », qui bloque la typographie.

Il se contourne en séparant les deux moitiés de la référence :

> **le paramètre porte le RANG, le binding porte les pixels.**

- `EffectModule.libraryTexture: { indexParam }` — déclaratif, vérifié par
  `validateEffect` ;
- `@group(0) @binding(7) var libraryTexture` dans `shaderCompose`, sur les deux
  chemins, et il entre dans la clé de cache des pipelines ;
- `render/textureLibraryStore.ts` résout le rang en texture GPU — chargement
  paresseux, éviction du moins récemment servi, plafond de 6 (une 8K pèse
  268 Mo) ;
- l'index est le rang dans le catalogue **trié** du dossier, donc stable d'un
  lancement à l'autre.

## Décision

**`texture` entre au registre comme effet** (catégorie Texture, 22ᵉ effet), et le
mécanisme du binding 7 est **générique** : tout effet peut déclarer
`libraryTexture`.

**Il SORT le scan brut, il ne le mélange pas.** Le premier jet portait ses
propres paramètres « Mélange » (quatre modes) et « Force » ; les deux
doublonnaient `LayerState.blendMode` et `LayerState.opacity`, appliqués par le
compositing de `shaderCompose`. En rendant le scan brut, l'effet hérite des
**onze** modes du registre de fusion au lieu de quatre. Arbitrage d'Antoine :
« le sélecteur de mélange est inutile puisqu'on peut déjà choisir les modes de
fusion ».

Ne restent que les réglages qu'un calque ne sait pas exprimer : quel scan, à
quelle échelle, tourné comment, décalé où, plus inversion, désaturation, et un
**Levels** (contraste + point médian).

**A n'est PAS retiré.** La bibliothèque, les vignettes et `coverCanvas`
subsistent et servent les deux voies. Un scan reste importable en calque photo ;
c'est simplement le geste rare.

## Conséquences

- **`EffectModule` gagne `defaultBlendMode` / `defaultOpacity`.** Un effet qui
  PRODUIT du contenu au lieu d'en traiter doit dire comment il se pose : posé en
  `normal` à 1, `texture` cacherait la photo. Il arrive en Incrustation à 0,7.
- **La garde de câblage a dû être amendée.** `test/render/effects/parametresCables.test.ts`
  exige que chaque paramètre soit lu à son index par le shader ; le RANG est lu
  par le CPU (`FramePipelineExecutor`), pas par le WGSL. Exemption par la
  DÉCLARATION, jamais par le nom — un effet qui appellerait son paramètre
  « rang » sans déclarer `libraryTexture` reste couvert.
- **`libraryTexture` + passes internes est REFUSÉ** par `validateEffect` : le
  binding n'est résolu que pour la passe finale. C'est ce qui exclut `lensFlare`
  (10 passes) aujourd'hui.
- **`exportFrame` attend désormais les textures en vol.** `viewFor` ne bloque
  jamais — un rendu à l'écran sert le repli 1×1 et redemande une frame — mais un
  export n'a pas cette seconde chance : le fichier écrit serait dépourvu de
  l'effet, définitivement et sans message.
- **`Renderer` prend un port de décodage de texture en troisième argument.** Le
  harnais de rendu n'a AUCUN accès IPC (ses modules viennent du Vite 1421, et
  Tauri restreint ses commandes à l'origine de l'app) : sans ce port, aucun
  scénario ne pourrait verrouiller un effet à texture.
- **Deux références de pixels** : `effet-texture` (68,6 % d'écart contre la photo
  nue) et `effet-halftone-encre` (42,9 % contre la trame nue).
- **L'encre suit le même mécanisme, en TRANSVERSAL** : `effects/inkTexture.ts`,
  adopté par `halftone`, `dither` et `hatching`. Ni un effet à part (il n'aurait
  rien à encrer) ni trois modes recopiés — le patron est celui de `blendSpace` et
  `inputMode`, posés le 2026-08-01 pour exactement ce cas.

## Croyances révisées

- Croyance : « ADR-0008 interdit d'appliquer un effet à une photo, donc un effet
  `texture` ne pourrait pas s'appliquer là où on en a besoin ».
  Réfutée par : la lecture d'ADR-0008 lui-même, sur objection d'Antoine
  (« c'est impossible puisqu'on le fait déjà avec nos effets actuels ? »). L'ADR
  interdit un `effectId` SUR un calque photo, pas un calque d'effet écrêté
  au-dessus.
  Ce que ça change : l'objection ne portait pas, et la vraie contrainte
  (`params` numérique) était ailleurs — et contournable.

- Croyance : « une texture doit apporter son propre mode de mélange et sa propre
  force ».
  Réfutée par : Antoine, en une phrase. `blendMode` et `opacity` sont des champs
  de `LayerState` appliqués par le compositing.
  Ce que ça change : deux paramètres retirés, onze modes gagnés au lieu de
  quatre, et un principe — un effet ne redouble jamais ce que le calque sait
  faire.

## Alternatives écartées

- **Rester sur A seul.** Le modèle est juste et le geste ne l'est pas : poser une
  matière demandait d'importer un calque photo, de changer son mode de fusion et
  de le redimensionner. Trois gestes pour un réglage.
- **B, un genre de calque « texture ».** Touche `LayerState`, la couche la plus
  partagée du projet, pour une capacité que le calque photo porte déjà — et
  n'aurait toujours pas donné le geste « réglage ».
- **Retirer A en livrant C.** La bibliothèque et les vignettes servent les deux,
  et un scan reste légitimement importable en calque photo (une double
  exposition sur un papier, par exemple).
