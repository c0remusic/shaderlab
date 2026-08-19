# Texturer le masque

Type: task
Status: open
Parent: ../map.md

## Le geste que ça débloque

Un masque peint au pinceau a des bords LISSES. Un masque tiré au dégradé a des
bords RÉGULIERS. Ni l'un ni l'autre ne donne un bord SALE — mangé, granuleux,
irrégulier comme une réserve de gomme arabique ou un bord de plaque.

C'est exactement la matière de notre positionnement : optique, analogique,
imprimé. Aujourd'hui on ne peut l'obtenir qu'en peignant à la main, longuement,
et sans pouvoir le refaire deux fois pareil.

## Ce qu'Affinity fait

Trois champs relevés dans `Serif.Affinity.dll` : `MaskTexture`,
`MaskTextureMode`, `MaskTextureScale`.

✅ **`Mode` est ÉNUMÉRÉ depuis le 2026-08-19 au soir** — lu dans l'app par le
SDK (`rasterbrush.js`, enum `RasterBrushTextureMode`) : **`None · Nozzle ·
Final`**, et le porteur est le PINCEAU (`RasterBrush.maskTextureMode` /
`maskTextureScale`). `Nozzle` texture chaque TAMPON ; `Final` ancre la texture
à la TOILE et le trait la révèle. Deux conséquences pour la forme à choisir
ci-dessous : chez la référence, texturer est (d'abord) une propriété du
pinceau, pas un post-traitement du masque résolu ; et le mode `Final` est
exactement le geste « bord sale reproductible » que ce ticket vise — repasser
au même endroit re-révèle la MÊME texture.

⚠️ Reste non regardé : la LOI de combinaison exacte (multiplication de
l'intensité ? seuillage ?) — mesurable par le protocole de l'audit
(PixelBuffer sur un trait texturé posé à la main, le trait n'étant pas
scriptable).

## Pourquoi c'est peu cher chez nous

Le mécanisme de texture de bibliothèque existe déjà et il est GÉNÉRIQUE depuis
son écriture (ADR-0018) : `EffectModule.libraryTexture` déclare qu'un effet
échantillonne une image, le paramètre porte le RANG dans le catalogue trié, et
le binding 7 porte les pixels (`render/textureLibraryStore.ts`). Trois effets
s'en servent déjà (`texture`, `displacementMap`, et `inkTexture` pour les trois
effets d'impression).

Ce qui manque n'est pas le chargement d'image : c'est de l'appliquer à un
MASQUE plutôt qu'à un effet.

## Ce qu'il faut regarder avant de choisir la forme

- **Une source de masque de plus, ou un modificateur de toutes ?** Nos quatre
  sources (`brush`, `gradient`, `luminosity`, `colorRange`) se combinent en
  `add`/`subtract`/`intersect`. Une texture peut être une CINQUIÈME source — et
  alors elle se combine comme les autres — ou un modificateur qui s'applique au
  masque RÉSOLU, à côté de l'affinage de bord. Les deux sont défendables et ne
  donnent pas le même geste.
- ⚠️ **Le second emplacement est probablement le bon**, et pour une raison
  mesurable : `RefineEdgeParams` existe déjà comme post-traitement du masque
  résolu (`feather`, `contract`, `smooth`, `edgeAware`…). Une texture de bord y
  est de la même famille. Mais c'est à vérifier contre l'usage, pas à décider
  ici.
- **Le binding 7 est-il libre pour un masque ?** Il est résolu pour la passe
  FINALE d'un effet ; le masque, lui, est évalué par `MaskTextureResolver`. Ce
  n'est pas le même chemin, et rien ne dit que le binding y est disponible.
  **À mesurer avant de s'engager.**

## Ce qui prouve que le ticket est fini

Un masque dont le bord porte une texture de la bibliothèque, une référence de
pixels dans `test/render-refs/`, et — la vraie garde — **une mire qui peut
MONTRER la propriété** : un bord franc sur fond uni, sans quoi le verrou
verrouillerait du bruit (leçon `lensBlur`, 2026-08-01).
