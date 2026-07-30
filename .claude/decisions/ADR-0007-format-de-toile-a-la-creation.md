---
id: ADR-0007
status: active
date: 2026-07-30
---

# Le format de la toile se choisit à la création du document, la taille de la photo étant le défaut

## Contexte

Jusqu'ici la toile d'un document avait, sans exception, les dimensions de la photo
qui l'ouvrait : `setImageSize({ width: bitmap.width, height: bitmap.height })`
avait un seul site d'écriture, et `Renderer.loadImage` fondait « allouer une toile »
et « charger une photo » en une seule méthode qui commençait par tout détruire.

Le chantier « la toile devient un espace de montage » (design
`docs/superpowers/specs/2026-07-29-shaderlab-toile-de-montage-design.md`, §6 et
§11.2) montre que c'est la limite qui empêche le collage : on ne peut pas choisir
un format cible (carré, format d'impression) qui n'est celui d'aucune de ses
photos. Antoine a tranché sur un rendu : **un choix de format à l'ouverture, avec
la taille de la photo comme défaut**, parmi comme la photo (défaut), carré, 4:5,
A3, saisie libre.

Ce qui n'est PAS en jeu ici : redimensionner une toile **déjà ouverte**. C'est le
seul chemin qui invalide les masques déjà peints (design §4.1), et il reste différé
(§9). La décision ci-dessous ne concerne que l'instant où aucun raster de masque
n'existe encore.

## Décision

### 1. Le défaut est le MÊME CHEMIN DE CODE, pas une valeur par défaut

`Renderer.loadImage(bitmap, canvasSize?)` : `canvasSize` omis ⇒ dimensions du
bitmap. Le menu « Ouvrir » reste nu et ne demande rien ; le choix de format est une
entrée séparée (« Ouvrir dans un format de toile ▸ »). « Ouvrir sans rien choisir
rend exactement le comportement d'aujourd'hui » n'est donc pas une propriété à
surveiller par des tests : c'est la même branche de code, avec le même argument.

### 2. Les formats relatifs sont dérivés par CONTENANCE, jamais par recadrage

Règle unique pour « carré » et « 4:5 » : **le plus petit rectangle du ratio demandé
qui contient la photo à sa résolution native**. Elle ne rétrécit jamais la photo et
n'ajoute jamais un pixel de plus que nécessaire pour atteindre la proportion.
Conséquences chiffrées sur la photo de référence du projet (6240 × 4160) : carré
6240 × 6240, 4:5 orienté 6240 × 4992.

Le ratio est **orienté comme la photo** (une photo paysage en « 4:5 » rend un 5:4).
Imposer le portrait à une photo paysage coûterait ~50 % de surface — donc de VRAM —
uniquement pour tourner le cadre : 6240 × 7800 = 48,7 Mpx contre 6240 × 4992 =
31,2 Mpx. Une photo exactement carrée retombe sur l'orientation canonique du format
(portrait).

### 3. « A3 » est ABSOLU, et sa résolution d'impression est nommée

Un format papier n'a pas de pixels. `A3_PRINT_DPI = 300` (standard d'impression
photo ; 150 serait de la bureautique, 600 quadruplerait la surface pour un gain
invisible à l'œil nu). 297 × 420 mm à 300 dpi ⇒ **3508 × 4961 px**, orienté comme
la photo. Les pixels sont **dérivés des millimètres et du dpi dans le code**, jamais
recopiés en dur : changer le dpi change le format, sans recalcul à la main. Le
libellé du menu porte le dpi (« A3 (300 dpi) »), parce que l'omettre rendrait le
format ambigu.

Corollaire assumé : **A3 peut être PLUS PETIT que la photo** (17,4 Mpx contre 26).
La photo dépasse alors la toile — comportement déjà explicitement assumé
(`PhotoPanel` : « une photo peut légitimement être positionnée hors du fond ») et
rattrapable en un clic par « Ajuster à la toile ». L'alternative aurait été de
trahir le format d'impression, ce qui vide « A3 » de son sens.

### 4. La saisie libre demande les dimensions AVANT le fichier

Rien dans une saisie libre ne dépend de la photo ; l'ordre inverse obligerait à
décoder l'image pour poser un défaut. La saisie refuse une décimale, un zéro, un
négatif, un non-nombre et un dépassement de budget — le bouton reste désactivé et
le message est visible avant le clic, jamais un arrondi silencieux.

### 5. La dimension du document descend d'UNE SEULE SOURCE

`ImageFrameResources.width/height`, exposé par `Renderer.canvasSize`. Le state React
la COPIE à l'ouverture ; l'export **ne la lit plus du tout** — `exportFrame` rend un
`ExportedFrame { pixels, width, height }` et `exportImage` n'a plus aucun paramètre
de dimension. Voir « Croyances révisées ».

### 6. Une borne nommée de budget VRAM

`MAX_CANVAS_PIXELS = 64_000_000` (`src/render/limits.ts`), avec son critère de
révision écrit sur la constante, au même titre que `MAX_PHOTO_LAYERS`. Calibrage :
pire cas mesuré 67,8 % de 6 Go (4,07 Go) à toile ≡ photo de 26 Mpx ⇒ 1,33 Go de
marge sous un plafond de sécurité de 90 % ; au moins cinq textures pleine toile à
4 octets = 20 o/px, facteur de sûreté ×1,5 pour les résidents non dénombrés de
`MaskTextureResolver` ⇒ 30 o/px ⇒ ~44 Mpx de toile en plus des 26 déjà mesurés,
soit ~70 Mpx calculés, arrondis à la baisse à 64 Mpx. Vérifiée aux deux bouts : à la
dérivation d'un format et dans `ImageFrameResources.allocateCanvas`, pour qu'aucun
chemin d'allocation ne la contourne.

## Conséquences

- `Renderer` sépare désormais `allocateDocument(canvasSize)` de l'enregistrement de
  la photo d'ouverture. La géométrie du document ne descend plus d'aucune image.
- Un format refusé (budget dépassé) échoue **avant** toute allocation de texture et
  remonte au bandeau d'erreur ; le document précédent n'est jamais touché
  (l'ouverture reste transactionnelle).
- Le harnais de rendu porte un axe `toile` et un scénario
  `toile-plus-grande-que-la-photo` (toile 320 × 320, mire 256 × 256). Les références
  n'ont plus toutes les mêmes dimensions : elles voyagent avec chaque résultat.
- Sur une toile plus grande que la photo, **« Ajuster à la toile » agrandit la photo
  au-delà de sa résolution native** (`src/ui/transform.ts`, *contain* strict). Cet
  arbitrage (design §11.5) n'est **pas tranché** : le comportement est laissé
  inchangé et signalé en commentaire sur la fonction, à reposer à Antoine avec un
  rendu. Le borner à 100 % ferait du bouton un no-op sur une toile plus grande,
  c'est-à-dire une autre décision produit.
- Le format n'est PAS persisté ni réutilisé d'une ouverture à l'autre : aucun mode
  caché qui changerait le comportement d'« Ouvrir » sans qu'on l'ait demandé.

## Alternatives écartées

- **Un dialogue de format sur le chemin d'« Ouvrir ».** Écartée : elle contredit
  « ouvrir sans rien choisir, sans y penser ». Le choix vit dans une entrée de menu
  séparée.
- **Un sélecteur persistant de format dans la barre d'outils.** Écartée : un état
  caché qui change ce que fait « Ouvrir » plus tard est exactement le mode qu'on ne
  veut pas.
- **Formats nommés en valeurs absolues en pixels** (« carré = 4096 »). Écartée :
  soit elle rétrécit la photo (perte de résolution native, contraire à la barre de
  qualité), soit elle l'agrandit sans raison. La contenance dérivée est la seule
  règle qui ne fasse ni l'un ni l'autre.
- **Forcer l'orientation portrait des ratios nommés.** Écartée : ~50 % de surface
  et de VRAM pour tourner un cadre que personne n'a demandé de tourner.
- **Prendre l'enveloppe de tous les calques comme taille de toile** (design §10.3).
  Écartée : la toile changerait de taille à chaque déplacement d'image, invalidant
  les masques à chaque geste — et c'est l'inverse de ce qu'un collage demande.
- **Un type de document « montage » distinct** (design §10.2). Écartée : rouvrirait
  un statut spécial qu'ADR-0002 vient de supprimer. « Montage » est un usage, pas un
  type.
- **Deviner la borne VRAM plutôt que la calibrer.** Écartée : le design (§5.2) exige
  une borne adossée à une mesure, et les mesures existaient.

## Croyances révisées

- Croyance : « `imageSize` (React) et `ImageFrameResources.width/height` (GPU) sont
  deux copies d'une même vérité ; l'invariant tient. »
  Réfutée par : le design du 2026-07-29 §4.3, sur pièce — l'export encodait avec les
  dimensions du state React (`App.tsx` → `exportImage(..., width, height)`) et
  relisait le GPU avec celles de `ImageFrameResources`. L'invariant ne tenait que
  parce qu'un SEUL site posait les deux au même instant. Un pixel d'écart et le
  constructeur `ImageData` lève sur une incohérence de longueur — et une toile de
  format choisi crée le second site.
  Ce que ça change : le correctif n'est pas un test mais un type. Les dimensions
  voyagent avec les octets (`ExportedFrame`) et `exportImage` n'a plus de paramètre
  de dimension du tout : la divergence n'est plus exprimable.

- Croyance : « faire suivre une toile de taille arbitraire demandera de retoucher
  le pipeline de rendu. »
  Réfutée par : la tranche T1 du design du 2026-07-28, vérifiée sur pièce le
  2026-07-29 — `ImageFrameResources.allocateCanvas` prend déjà des DIMENSIONS et non
  un `ImageBitmap`, et `PhotoLayerInputResolver.resolve` réalloue déjà sa cible
  partagée sur changement de dimensions de toile.
  Ce que ça change : le coût réel de cette tranche était dans l'unicité de la source
  de dimension et dans la borne de budget, pas dans le moteur de rendu.
