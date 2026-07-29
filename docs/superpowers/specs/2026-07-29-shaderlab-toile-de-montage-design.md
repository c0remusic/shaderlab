# La toile devient un espace de montage — design d'architecture

> Statut : **proposition d'architecture, non implémentée.** Aucun code n'a été
> modifié pour produire ce document.
> Date : 2026-07-29. Branche observée : `master` (`9272a7d`).
> Décision amont : ADR-0002 (abandon du round-trip) ; design du 2026-07-28
> (« le fond devient un calque »), §8 « Différé », dont l'item **taille de toile
> indépendante de toute photo** est rouvert ici.
>
> Convention de durabilité : les `fichier:ligne` cités sont des **preuves d'état
> observé le 2026-07-29**, pas des instructions « éditer ici plus tard ».

---

## 0. Ce qui déclenche ce cadrage, et ce qui ne l'a pas déclenché

Verbatim d'Antoine, 2026-07-29 : « On veut aussi faire du montage
potentiellement, de type "collage" mais numérique. »

Le déclencheur écrit du différé était : « **demande explicite de recadrage de
document** ». **Ce déclencheur-là n'a pas été tiré.** Antoine n'a pas demandé à
recadrer ; il a nommé un usage — le collage — dont le recadrage n'est qu'une
conséquence possible. La distinction n'est pas de la pédanterie : elle décide
laquelle des deux capacités doit être construite d'abord, et la réponse du §6
n'est pas celle qu'on aurait donnée en lisant le déclencheur littéralement.

Le mot **« potentiellement »** est retenu comme cadrage, pas comme feu vert :
la gate YAGNI du §7 s'y adosse.

---

## 1. Verdict de faisabilité

**Le collage est déjà là à environ 70 %, et personne ne l'a nommé.**

Ce qui suit est vérifié sur pièce, pas déduit :

| Ce que le collage exige | État réel au 2026-07-29 | Preuve |
|---|---|---|
| Plusieurs images dans un même document | **existe** (5 max) | `src/layers/photoLayer.ts:35`, `:37-39` |
| Superposition partielle, ordre libre | **existe** | `src/layers/layerStack.ts` (`addPhotoLayer`, insertion après la sélection, `src/hooks/usePhotoLayer.ts:113-116`) |
| Déplacer / redimensionner / tourner une image | **existe** | `src/layers/types.ts:27-32` ; `src/ui/transform.ts:126-166` ; `src/components/TransformHandles.tsx` |
| Poignées de manipulation au canvas | **existe** (4 coins + rotation + corps) | `src/components/TransformHandles.tsx:107-144` |
| Snap d'angle 15° | **existe** (Shift pendant le drag) | `src/ui/transform.ts:73-81` ; `src/components/TransformHandles.tsx:73-78` |
| Saisie numérique du placement | **existe** | `src/components/PhotoPanel.tsx:113-120` |
| Débordement hors toile assumé | **existe, explicitement** | `src/components/PhotoPanel.tsx:7-11` (« une photo peut légitimement être positionnée hors du fond ») |
| Bord propre d'une image transformée | **existe** (couverture analytique sub-pixel) | `src/render/photoLayerInput.ts:70-71` |
| Fusion / opacité / masque par image | **existe** | `src/layers/types.ts:39-46` |
| Effet écrêté à une image seule | **existe** | `src/layers/clipping.ts` ; `LayerStack.setLayerClip` (`src/layers/layerStack.ts:226-234`) |
| Zone non couverte visible comme telle | **existe** (damier écran, noir export) | `src/render/presentPass.ts:56-60`, `:126-145` |
| **Toile d'un format qui n'est celui d'aucune photo** | **impossible** | §3.1 |
| **Sélectionner une image en cliquant dessus** | **impossible** | §3.2 |
| **Plus de 5 images** | **impossible** | `src/layers/photoLayer.ts:35`, `:41-43` |
| **Recadrer une image (crop)** | **injoignable** (à moitié câblé) | §3.3 |
| Magnétisme / guides d'alignement au canvas | **absent** | §3.4 |

Les cinq dernières lignes sont le chantier possible. Les trois premières d'entre
elles sont le chantier **réel** ; les deux dernières sont du différé (§9).

---

## 2. Ce qui existe déjà et que le brief n'anticipait pas

Trois découvertes qui changent le coût du chantier.

### 2.1 La géométrie du document est déjà découplée de la texture de la photo

C'est le §1.4 du design du 2026-07-28, livré en T1 et vérifiable : le port de
ressources de frame expose des dimensions **explicites**, avec un commentaire qui
nomme cette feature-ci comme sa raison d'être — « permet [...] comme une future
toile de taille indépendante » (`src/render/framePipelineExecutor.ts:31-37`,
interface `:38-43`). `ImageFrameResources.allocateCanvas(width, height)` prend
des dimensions et non un `ImageBitmap`, et son en-tête le dit explicitement
(`src/render/imageFrameResources.ts:32-35`).

Conséquence : **le moteur de rendu accepte déjà une toile de taille arbitraire.**
Rien dans le pipeline ne rattache la géométrie du document à celle d'une photo.

### 2.2 La pré-passe photo se réalloue déjà toute seule à un changement de toile

`PhotoLayerInputResolver.resolve` recrée sa cible partagée dès que
`bgWidth`/`bgHeight` diffèrent du cache (`src/render/photoLayerInput.ts:156-165`).
Un redimensionnement de toile est donc déjà correct côté pré-passe — sans une
ligne de plus.

### 2.3 Le hit-test de sélection directe est à 90 % écrit

`compositeUvToPhotoUv` rend **`null` quand le point tombe hors des bornes de la
photo** (`src/ui/transform.ts:43-66`, garde `:62-64`). C'est exactement le
prédicat « ce clic est-il sur cette image ? ». Une sélection directe au canvas =
parcourir la pile du haut vers le bas et rendre le premier calque photo pour
lequel cette fonction ne rend pas `null`. Fonction pure, testable en Node, aucune
lecture GPU, aucun rendu d'ID buffer.

C'est le meilleur rapport valeur/coût de tout le chantier, et il n'était pas dans
la liste du brief.

---

## 3. Ce qui manque réellement — avec preuves

### 3.1 La taille de toile est posée une fois, à l'ouverture, et n'est plus jamais touchée

Trois faits, indépendants :

1. `imageSize` a **exactement un** site d'écriture : `setImageSize({ width:
   bitmap.width, height: bitmap.height })` (`src/App.tsx:295`), déclaré
   `:86`. Portée du balayage : repo entier hors `node_modules`, motif
   `setImageSize` → 6 correspondances, dont 4 dans `docs/superpowers/plans/`
   (documents de plan, pas du code) et 2 dans `src/App.tsx` (déclaration +
   unique appel).
2. `canvasRef.current.width/height` est posé au même endroit et nulle part
   ailleurs (`src/App.tsx:290-291`).
3. Il n'existe **aucune commande « Nouveau document »** : le seul point d'entrée
   d'un document est `openFile`, atteint par `handleOpenFile` (`src/App.tsx:411`,
   câblé `:1326`, `:1365`) ou par un glisser-déposer de fichier
   (`src/components/Canvas.tsx:160-165`). Portée : `src/`, 142 fichiers
   `.ts`/`.tsx`, motif `Nouveau|nouveau document|handleOpenFile` → 4
   correspondances, toutes dans `App.tsx`, aucune n'étant une création de
   document vide.

Et `allocateCanvas` commence par `this.dispose()` — il détruit la toile, la paire
de ping-pong et la cible d'export (`src/render/imageFrameResources.ts:35-47`,
`dispose` `:56-66`). Son seul appelant est `Renderer.loadImage`
(`src/render/renderer.ts:255`), lui-même appelé par `createLoaded` (`:242`) et par
le harnais de rendu (`scripts/render-check.mjs:512`, `:561`).

**Donc : aujourd'hui, changer la taille de la toile = reconstruire le renderer =
perdre le document.** Ce n'est pas une limite du GPU, c'est un chemin de code qui
n'a jamais eu de raison d'exister.

### 3.2 On ne peut pas désigner une image en cliquant dessus

`Canvas.tsx` (228 lignes, lu en entier) ne porte que des gestes de **peinture de
masque** : `onPointerDown` sort immédiatement si `!maskPaintMode`
(`src/components/Canvas.tsx:173`), idem `onPointerMove` (`:199`). Aucun handler
de sélection, aucun `onClick`.

Les poignées ne s'affichent que pour un calque **déjà sélectionné dans le
panneau** et **déjà photo** (`src/App.tsx:1377-1386`), et seulement en mode
canvas `idle` (`src/ui/canvasMode.ts:56-58`).

Conséquence d'usage pour un collage : pour déplacer l'image qu'on regarde, il
faut d'abord retrouver sa ligne dans la liste des calques. Avec deux images c'est
une friction ; avec cinq images qui se recouvrent, c'est le geste central de
l'outil qui manque.

### 3.3 Le recadrage existe à l'état de squelette, sans point d'entrée ni géométrie

État exact, trois niveaux :

- **Le type existe** : `CanvasMode` déclare la variante `{ kind: "crop";
  layerId; original }` (`src/ui/canvasMode.ts:22-25`), avec son constructeur
  `enterCrop` (`:36-40`) et son garde de réconciliation `reconcileCanvasMode`
  (`:70-79`). `CropRect` est défini (`src/layers/types.ts:11-22`).
- **Rien ne l'atteint** : `enterCrop` n'a **aucun appelant en production**.
  Portée du balayage : repo entier hors `node_modules`, motif
  `enterCrop|showsTransformHandles|reconcileCanvasMode|CropRect|canvasMode` → 60
  correspondances ; les seuls appels à `enterCrop` sont dans
  `test/ui/canvasMode.test.ts:22,26,30,38,44,50,54,58,62`. `usePhotoLayer` ne
  pose jamais que `IDLE_CANVAS_MODE` ou `toggleMaskPaint`
  (`src/hooks/usePhotoLayer.ts:265-266`). Constat déjà consigné le 2026-07-29
  (`.claude/learning-log.md:1245-1257`).
- **La géométrie n'existe pas** : `LayerTransform` porte `x, y, scale,
  rotation` et **rien d'autre** (`src/layers/types.ts:27-32`) ; le champ `crop`
  était prévu pour la tranche T4 du design du 2026-07-26 et n'a pas été livré
  — l'en-tête de `CropRect` le dit lui-même (`src/layers/types.ts:14-16`). Le
  WGSL de la pré-passe ne connaît que huit paramètres : x, y, scale, rotation,
  bgW, bgH, photoW, photoH (`src/render/photoLayerInput.ts:26-32`).

Autrement dit : ce qui manque au crop n'est pas « le point d'entrée UI » (la
lecture du learning-log), c'est **le point d'entrée UI ET toute la géométrie ET
son transport jusqu'au shader**. Le squelette d'état ne représente qu'une
fraction du travail.

### 3.4 Aucun magnétisme ni guide d'alignement au canvas

Portée : `src/`, 142 fichiers, motif `snap|align|magnet` insensible à la casse →
les seules correspondances utiles sont `snapAngle`/`ANGLE_SNAP_DEGREES`
(`src/ui/transform.ts:68-81`, rotation uniquement),
`HORIZONTAL_DOCK_SNAP_RATIO` (`src/ui/dockLayout.ts:7`, panneaux du dock, pas le
canvas) et `.drag-reorder__alignment-guide` (`src/ui/dragReorder.css:1`,
réordonnancement de cartes du dock). Le reste est du CSS `align-items`.

**Aucun alignement de position d'image sur le canvas n'existe.**

---

## 4. Ce qui casse — inventaire avec preuves

Même exercice que le §2 du design du 2026-07-28. Chaque entrée nomme ce qui
suppose aujourd'hui **toile ≡ photo d'ouverture**.

### 4.1 CRITIQUE — Les masques peints sont en coordonnées de document, et un changement de toile les invalide tous

`MaskPainter` alloue `new Uint8Array(width * height)` aux dimensions reçues
(`src/mask/maskPainter.ts:29-32`), et `App.tsx` lui passe `imageSize.width /
imageSize.height` (`src/App.tsx:775-781`). ARCHITECTURE.md le pose comme un fait
de conception (`ARCHITECTURE.md:413-417`).

Le piège n'est pas la taille elle-même, c'est le cache :
`getSyncedMaskPainter` retrouve le peintre **par `layerId` seul** et ne revalide
**jamais** ses dimensions (`src/mask/maskPainterSync.ts:41-55`) — il ne re-seed
que si la référence du raster a changé (`:49`). Un redimensionnement de toile
laisserait donc un peintre à l'ancienne taille peindre dans un document à la
nouvelle, en silence.

Corollaire déjà écrit ailleurs : `LayerStack.setLayerImageSource` justifie de ne
pas toucher au masque **précisément parce que « la toile ne bouge pas »**
(`src/layers/layerStack.ts:269-270`). Cette phrase devient fausse le jour où la
toile bouge.

**Toute tranche qui redimensionne une toile doit trancher le sort des rasters de
masque** — les invalider, les recadrer, ou les rééchantillonner. Aucune des trois
n'est gratuite, et le silence est le seul résultat inacceptable.

### 4.2 HAUTE — Les ressources GPU dimensionnées au document ne sont construites qu'à `loadImage`

`EffectPassRunner` et `MaskTextureResolver` reçoivent `width`/`height` à la
construction, et ne sont construits que dans `loadImage`
(`src/render/renderer.ts:259-264` et `:275-282`). Redimensionner la toile sans
les reconstruire ferait rendre les effets et les masques à l'ancienne taille.

Ce qui **ne** casse **pas**, vérifié : les cibles de passes internes sont
dimensionnées sur le document et non sur la texture d'entrée (constat déjà porté
par le design du 2026-07-28 §8) ; et la pré-passe photo se réalloue seule (§2.2).

### 4.3 HAUTE — `imageSize` (React) et `ImageFrameResources.width/height` (GPU) sont deux sources séparées que rien ne réconcilie

L'export lit les dimensions **du state React** pour encoder
(`src/App.tsx:940-941` → `exportImage(..., width, height)`,
`src/export/exportImage.ts:175-186`), alors que la relecture GPU lit
`this.imageResources.width/height` (`src/render/renderer.ts:449-451`).
`encodeJpeg` construit une `ImageData` à partir des premières et du tampon issu
des secondes (`src/export/exportImage.ts:79-87`) : si les deux divergent d'un
seul pixel, le constructeur `ImageData` lève sur une incohérence de longueur.

Aujourd'hui l'invariant tient parce qu'un seul site pose les deux, au même
instant. Une toile réglable crée un deuxième site, donc un vrai risque. **Le
correctif n'est pas un test, c'est de faire descendre la dimension d'une source
unique.**

### 4.4 HAUTE — `MAX_PHOTO_LAYERS = 5` compte le fond

`MAX_PHOTO_LAYERS` vaut 5 (`src/layers/photoLayer.ts:35`) et `countPhotoLayers`
compte tout calque portant `imageSource`, fond compris (`:37-39`, en-tête
`:3-11`). Un collage est donc **plafonné à 5 images**, refus applicatif compris
(`canAddPhotoLayer` `:41-43`, message `src/hooks/usePhotoLayer.ts:97-102`).

C'est la limite la plus visible à l'usage pour un collage. Elle est pilotée par
un critère de révision explicitement adossé à une mesure VRAM **non encore
relevée** (`src/layers/photoLayer.ts:30-34`) — la tranche T4 du design du
2026-07-28.

### 4.5 MOYENNE — Le fond d'export est noir, en dur

`presentBackgroundFor` rend `{ kind: "black" }` pour toute destination d'export
(`src/render/presentPass.ts:56-60`), et le WGSL correspondant sort `bg = 0`
(`:145`). Le damier n'est qu'un rendu d'écran, et c'est correct.

Mais dans un document « une photo qu'on retouche », la zone non couverte est un
cas dégénéré ; dans un collage, **elle est le passe-partout de l'image finale**.
Un collage sur toile 1:1 exporté avec des bandes noires est une décision
esthétique forte, prise aujourd'hui par défaut et jamais posée à personne.
→ arbitrage §11, à poser avec un rendu.

### 4.6 MOYENNE — `resetTransform` / `fitToCanvas` / `centerTransform` lisent la toile en direct

Les trois actions du panneau Photo prennent `imageSize` au moment de l'appel
(`src/hooks/usePhotoLayer.ts:238-263`, fonctions pures
`src/ui/transform.ts:87-111`). Elles suivront donc un changement de toile **sans
une ligne de plus** — c'est une bonne nouvelle, à condition que `imageSize` reste
bien l'unique source (§4.3).

Un point à noter : `fitToCanvas` est un *contain* strict (`src/ui/transform.ts:96-111`).
Sur une toile bien plus grande que la photo, « Ajuster à la toile » **agrandit**
la photo au-delà de sa résolution native. C'est cohérent avec le nom, mais c'est
un upscale silencieux — contraire à la barre de qualité du projet. À nommer, pas
à corriger en douce.

### 4.7 MOYENNE — Le harnais de rendu ne couvre pas une toile ≠ photo

`scripts/render-check.mjs` construit tous ses scénarios sur `W = 256, H = 256`
(`:269`) et alloue la toile via `r.loadImage(await mire(W, H, 0))` (`:512`,
`:561`) : **la toile y est toujours exactement la taille de la mire.** Le
scénario nominal pose le calque de fond avec `resetTransform({ width: W, height:
H })` (`:513-523`).

Bonne nouvelle au passage : le harnais **a été adapté à T1** — il porte
désormais un axe `fond` et des scénarios `toile-vide` / `toile-damier`
(`:349-363`). La note du 2026-07-29 qui le déclarait rouge 6/6
(`.claude/learning-log.md:1259-1289`) décrit donc un état antérieur à cette
adaptation. **Je n'ai pas exécuté `npm run test:render`** : je n'affirme pas
qu'il passe, seulement que le motif qui le faisait échouer a été traité dans le
script.

Ce qui manque pour ce chantier : **aucun scénario n'a une toile de dimensions
différentes de la photo**. C'est précisément le cas que toute tranche « toile
réglable » doit verrouiller.

### 4.8 BASSE — Ce qui ne casse PAS, vérifié

- **Presets** : le format ne contient aucune dimension de document, et les
  calques photo sont exclus de la capture — l'application préserve désormais les
  calques photo (`src/presets/preservePhotoLayers.ts`, importé
  `src/App.tsx:57`, consommé `:1110-1111`). Une toile réglable ne touche pas au
  format de preset.
- **Round-trip Lightroom** : `hasImportedPhotoLayer` (`src/layers/photoLayer.ts:119-122`)
  bascule déjà l'export en copie dès qu'il y a plus d'une photo ; en collage il
  est toujours vrai. Aucune régression — seulement du poids mort qui part avec
  ADR-0002.
- **Undo/redo** : `PhotoSourceStore` ne libère jamais une source au retrait d'un
  calque (`src/render/photoSourceStore.ts:154-159`), donc annuler un ajout ou une
  suppression d'image reste correct sans un geste de plus.
- **Conversion écran → pixels de document** : `Canvas.toImageCoords`
  (`src/components/Canvas.tsx:96-103`) et
  `TransformHandles.screenToImagePixels` (`src/components/TransformHandles.tsx:29-39`)
  dérivent toutes deux de `canvas.width` mesuré en direct — elles suivent un
  changement de dimensions du canvas DOM sans modification.
- **Damier** : sa taille de case est dérivée du facteur de réduction CSS mesuré
  (`src/render/presentPass.ts:113-118`, mesure `src/App.tsx:242-253`), pas de la
  taille de l'image. Une toile plus grande ne change pas la taille perçue des
  cases.

---

## 5. Coût VRAM

### 5.1 Ce que le chantier ajouterait, exprimé en unités et non en chiffres

Une toile plus grande que les photos ne coûte pas « une texture de plus ». Les
textures dimensionnées **à la toile** sont, au minimum :

| Texture | Preuve |
|---|---|
| La toile | `src/render/imageFrameResources.ts:40-44` |
| Ping-pong × 2 | `:46`, `createRenderTarget` `:102-108` |
| Cible d'export (allouée à la demande) | `:50-54` |
| Cible partagée de la pré-passe photo | `src/render/photoLayerInput.ts:156-165` |

Soit **au moins cinq textures pleine toile**, plus ce que `MaskTextureResolver`
garde résident (construit avec les dimensions du document,
`src/render/renderer.ts:275-282` — je n'ai pas dénombré ses allocations).

Les textures dimensionnées **à la photo** (les sources de `PhotoSourceStore`) ne
bougent pas.

**Formulation honnête de l'ajout : agrandir la toile d'un facteur *k* en surface
multiplie par *k* au moins cinq textures pleine taille, et ne touche pas aux
sources photo.** Aucun chiffre absolu n'est écrit ici : la mesure de référence
est en cours de refonte (tranche T4 du design du 2026-07-28) et le design du
2026-07-26 pose la règle « jamais extrapolé, toujours re-mesuré ».

### 5.2 Conséquence sur le découpage

Une toile réglable **sans borne** est un chèque en blanc sur la VRAM : rien
n'empêche aujourd'hui de demander une toile 4× plus grande que la photo, et
`assertImageFitsGpu` ne borne que la dimension maximale d'une texture GPU
(`src/render/imageFrameResources.ts:36`, `src/render/limits.ts`), pas le budget.
**Toute tranche « toile réglable » doit poser une borne nommée, au même titre que
`MAX_PHOTO_LAYERS`**, et cette borne doit attendre la mesure T4 plutôt que d'être
devinée.

---

## 6. Réponse franche à « ne rien changer »

Question posée dans le brief : se contenter de photos qui se superposent dans une
toile à la taille de la première suffit-il pour ce qu'Antoine décrit ?

**Réponse : oui pour environ 70 % du besoin, et non pour les 30 % qui font qu'un
collage est un collage.**

Ce qu'on peut faire aujourd'hui, sans une ligne de code : ouvrir la photo qui
donne le bon format, importer quatre autres images, les placer, les tourner, les
mettre à l'échelle, les masquer au pinceau, choisir un mode de fusion par image,
écrêter un effet à une image seule, réordonner la pile, exporter. C'est
littéralement un montage.

Ce qu'on ne peut pas faire : choisir un **format** (carré, affiche, format
d'impression) qui n'est celui d'aucune de ses photos ; **cliquer sur une image
pour la saisir** ; dépasser **cinq** images.

Recommandation qui en découle, et elle est bon marché : **la sélection directe
(§2.3) rend plus de confort par franc dépensé que la toile réglable.** Elle ne
dépend de rien, ne casse rien de la §4, et se teste en Node. Si une seule tranche
devait être faite, c'est celle-là — et ce n'est pas celle que le déclencheur du
différé désignait.

---

## 7. Gate YAGNI — ce qui entre, ce qui sort

| Candidat | Preuve du besoin | Verdict |
|---|---|---|
| Sélection directe au canvas | douleur mécanique dès 3 images superposées (§3.2), coût quasi nul (§2.3) | **entre** |
| Toile de taille choisie à la **création** | « collage » implique un format cible ; sans elle le format est dicté par la 1ʳᵉ photo | **entre** |
| Plafond d'images relevé | 5 est bas pour un collage (§4.4) ; borné par une mesure déjà planifiée | **entre, dépendant de la mesure T4** |
| Redimensionner une toile **après coup** | aucune demande ; c'est la partie qui casse les masques (§4.1) | **différé, §9** |
| Recadrage d'image (crop) | squelette d'état seul, géométrie entière à écrire (§3.3) ; aucune demande | **différé, §9** |
| Magnétisme / guides d'alignement | aucune demande ; le snap 15° existe déjà pour la rotation | **différé, §9** |
| Nombre d'images illimité | jamais demandé ; incompatible avec un budget VRAM non mesuré | **écarté, §10** |
| Groupes de calques | déjà différé ailleurs (`CONTEXT.md`, « Groupe ») | **hors sujet ici** |

---

## 8. Découpage en tranches verticales

Trois tranches, dont deux sans dépendance entre elles ⇒ le DAG se justifie, mais
il est plat : un plan séquentiel conviendrait presque aussi bien. Les relations
sont posées parce qu'elles sont réelles, pas par prudence.

### T1 — Saisir une image en cliquant dessus
**bloqué_par : —** · **type : AFK** (la logique), **checkpoint visuel humain en fin**

Un module pur `hitTestPhotoLayer(layers, point, bgSize, photoSizeOf)` qui parcourt
la pile du **haut vers le bas** et rend le premier calque photo dont
`compositeUvToPhotoUv` ne rend pas `null` (`src/ui/transform.ts:43-66`). Câblage :
un `pointerdown` sur le canvas en mode `idle` qui appelle `selectLayer(id)` — donc
un mode canvas de plus à respecter, jamais en `maskPaint` (le pinceau garde la
main, `src/ui/canvasMode.ts:42-45`).

Interface étroite (une fonction pure, une entrée de geste), implémentation riche
(transform inverse, ordre de pile, calques désactivés à ignorer, clic dans le vide
= désélection).

Points à trancher **dans** la tranche, pas après : un clic sur une zone où seule
la *couverture* est partielle (bord adouci) compte-t-il ? Un calque à l'œil éteint
est-il saisissable ? Un calque **verrouillé** (`locked`, `src/layers/types.ts:70-81`)
est-il sélectionnable mais non déplaçable ?

**Done =** dans la vraie fenêtre, cliquer sur une image la sélectionne (sa ligne
se surligne dans le panneau, ses poignées apparaissent), cliquer sur une zone
vide désélectionne, et le pinceau de masque n'est jamais intercepté. Preuve : test
Node sur la fonction pure + CDP sur la vraie fenêtre + checkpoint visuel humain.

### T2 — La toile a un format choisi à la création du document
**bloqué_par : —** · **type : HITL** (choix de format = décision produit + rendu)

Portée : séparer « allouer une toile W×H » de « charger une photo » dans
`Renderer` (aujourd'hui fondues dans `loadImage`,
`src/render/renderer.ts:254-317`) ; poser la dimension de document depuis **une
seule source** consommée par le state React et par l'export (§4.3) ; offrir le
choix du format à l'ouverture, avec **la taille de la photo comme défaut** — le
comportement actuel doit rester atteignable sans y penser.

**N'INCLUT PAS** le redimensionnement d'une toile existante (§9) : la tranche
alloue une toile une fois, comme aujourd'hui, à une dimension qui n'est plus
forcément celle de la photo. C'est ce qui la rend sûre — aucun raster de masque
n'existe encore au moment où la dimension est posée (§4.1).

Doit poser une **borne nommée** de dimension de toile (§5.2), avec son critère de
révision écrit sur la constante, comme `MAX_PHOTO_LAYERS`.

Doit ajouter au harnais un scénario **toile ≠ photo** (§4.7) — sans lui, la
tranche n'a pas de preuve de non-régression.

**Done =** ouvrir une photo dans une toile carrée plus grande qu'elle affiche la
photo centrée sur un damier ; l'export sort un JPEG aux dimensions de la toile ;
ouvrir sans rien choisir rend exactement le comportement d'aujourd'hui, au pixel
près (comparaison d'export avant/après). Preuve : scénario de rendu + CDP +
checkpoint visuel.

### T3 — Plafond d'images relevé, sur mesure
**bloqué_par : T2, ET la tranche T4 du design 2026-07-28 (mesure VRAM)** · **type : HITL**

`MAX_PHOTO_LAYERS` et `MAX_REGISTERED_PHOTO_SOURCES` (`= 4 × MAX`,
`src/render/photoSourceStore.ts:54`) fixés **sur une mesure**, pas sur une
arithmétique. Bloqué par T2 parce qu'une toile plus grande que les photos change
le dénominateur de cette mesure (§5.1) : mesurer avant T2 mesurerait un autre
produit.

**Done =** encadré de mesure rempli au protocole existant, avec une toile plus
grande que les photos ; plafond fixé ou descendu selon la mesure ; message de
refus toujours exact.

### Vagues

- **Vague 0** : T1, T2 en parallèle (aucune dépendance réelle entre elles ;
  T1 ne touche ni au renderer ni aux dimensions).
- **Vague 1** : T3, après T2 **et** après la mesure VRAM déjà planifiée.

---

## 9. Différé — avec déclencheur de réouverture nommé

- **Redimensionner / recadrer une toile déjà ouverte.** C'est la seule partie du
  chantier qui casse les masques peints (§4.1) et qui oblige à reconstruire les
  ressources GPU du document (§4.2). **Déclencheur** : Antoine commence un
  montage puis demande à en changer le format sans repartir de zéro. Le jour où
  ça arrive, la première décision à prendre n'est pas technique : c'est le sort
  des masques déjà peints (invalider / recadrer / rééchantillonner).
- **Recadrage d'une image (crop) dans le collage.** Le squelette d'état existe
  (§3.3) mais la géométrie entière reste à écrire, jusque dans le WGSL de la
  pré-passe. **Déclencheur** : Antoine demande à ne montrer qu'une partie d'une
  image importée autrement qu'en la masquant au pinceau. Note : le pinceau de
  masque couvre déjà ce besoin de façon approximative, ce qui explique
  probablement que le crop n'ait jamais été réclamé.
- **Magnétisme et guides d'alignement au canvas** (bords de toile, centres,
  bords des autres images). **Déclencheur** : Antoine signale avoir peiné à
  aligner deux images à la main. Le snap d'angle 15° existant
  (`src/ui/transform.ts:73-81`) est le précédent à imiter — déclenché par une
  modification (`Shift`), jamais permanent.
- **Le masque suit la photo.** Déjà ouvert avant ce chantier
  (`ARCHITECTURE.md:413-429`, mémoire projet « décisions produit 2026-07-26 »),
  et le collage **augmente sa gêne** : dans un montage, on déplace ses images
  bien plus souvent que dans une retouche. **Déclencheur** : ce chantier ne le
  tranche pas, mais il déplace le curseur — à reposer à Antoine dès que T1 rend
  le déplacement d'image facile, parce que c'est exactement à ce moment que la
  douleur deviendra quotidienne.
- **Toile 1×1** (optimisation VRAM, différé du 2026-07-28). Reste valide, et
  **entre en tension avec T2** : une toile de format libre rend la toile
  physique plus grande, pas plus petite. Si la mesure T4 serre, ces deux items
  doivent être arbitrés ensemble.

---

## 10. Alternatives écartées

### 10.1 Ne rien changer
Traitée franchement au §6 : suffisante à ~70 %, insuffisante sur le format, la
saisie directe et le nombre d'images. **Écartée partiellement seulement** — c'est
elle qui justifie de ne construire que trois tranches au lieu du chantier complet
que « montage » pourrait laisser imaginer.

### 10.2 Un nouveau type de « document de montage », distinct du document photo
Écarté pour la raison exacte qui a fait écarter `isBackground` le 2026-07-28 :
cela rouvre dans le modèle un statut spécial qu'on vient de supprimer. Un
document est une toile plus une pile de calques ; « montage » est un usage, pas
un type.

### 10.3 Faire dériver la taille de toile de l'enveloppe de tous les calques
Séduisant et faux : la toile changerait de taille à chaque déplacement d'image,
invalidant les masques (§4.1) à chaque geste. C'est aussi l'inverse de ce qu'un
collage demande — on choisit un format, puis on compose dedans.

### 10.4 Sélection directe par rendu d'un buffer d'identifiants au GPU
Écarté : coûte une passe et une relecture GPU par clic, là où une fonction pure
déjà écrite répond exactement à la question (§2.3). À rouvrir uniquement si un
jour la couverture n'est plus calculable analytiquement (formes non
rectangulaires arbitraires).

### 10.5 Livrer d'abord le recadrage, puisque le squelette existe
Écarté : le squelette est la partie facile (§3.3), la géométrie et son transport
GPU sont la partie chère, et personne ne l'a demandé. Un état à moitié câblé
n'est pas une avance prise, c'est une dette de forme.

---

## 11. Ce qui exige un arbitrage d'Antoine

**Règle du projet, rappelée parce qu'elle a déjà été enfreinte** (CLAUDE.md
global, clause de récidive NG78) : toute question de goût visuel se pose **avec
un rendu en face**, jamais en options textuelles A/B/C. Les questions 1, 2 et 4
ci-dessous en sont.

1. **Que voit-on autour du collage dans le fichier exporté ?** *(goût — exige un
   rendu)* Aujourd'hui : noir, en dur (`src/render/presentPass.ts:56-60`, `:145`).
   Dans une retouche c'est un cas dégénéré ; dans un collage c'est le
   passe-partout de l'image. Blanc, noir, gris, couleur choisie ? À montrer sur
   un vrai montage, pas à décrire.

2. **D'où vient le format de la toile à la création ?** *(usage + goût — exige un
   rendu de l'écran d'ouverture)* Taille de la première photo (défaut actuel),
   liste de formats nommés, saisie libre en pixels ? La question n'est pas
   technique : c'est ce qu'on voit au moment d'ouvrir une image.

3. **Combien d'images au maximum ?** *(chiffre, pas goût)* 5 aujourd'hui, fond
   compris (`src/layers/photoLayer.ts:35`). La réponse ne peut pas être donnée
   avant la mesure VRAM (T4 du design précédent) — mais la **cible** d'Antoine
   est utile dès maintenant : viser 8 ou viser 20 ne se mesure pas pareil.

4. **Le masque doit-il suivre la photo qu'on déplace ?** *(usage — exige une
   démonstration en direct de la gêne, pas une description)* Question ouverte
   depuis le 2026-07-26, que le collage rend quotidienne (§9). À reposer une fois
   T1 livrée, sur un vrai montage.

5. **« Ajuster à la toile » a-t-il le droit d'agrandir une photo au-delà de sa
   résolution native ?** *(règle produit)* C'est ce qu'il ferait sur une toile
   plus grande (`src/ui/transform.ts:96-111`, §4.6), en contradiction avec la
   barre de qualité du projet. Borner à 100 %, ou assumer l'upscale ?

---

## 12. AUTO-VÉRIFICATION

État lu sur disque le 2026-07-29, branche `master` (`9272a7d`).

| Affirmation | Preuve |
|---|---|
| Le port de ressources expose des dimensions explicites, en nommant la toile indépendante comme raison | `src/render/framePipelineExecutor.ts:31-43` |
| `allocateCanvas` prend des dimensions, dispose tout, et n'a qu'un appelant produit | `src/render/imageFrameResources.ts:32-47`, `:56-66` ; `src/render/renderer.ts:255` |
| La toile est effacée en alpha 0 et n'est jamais uploadée | `src/render/imageFrameResources.ts:68-100` |
| `imageSize` n'a qu'un site d'écriture | `src/App.tsx:86`, `:295` ; balayage repo hors `node_modules`, motif `setImageSize` → 6 correspondances, 4 dans `docs/superpowers/plans/`, 2 dans `src/App.tsx` |
| Aucune commande « Nouveau document » | balayage `src/`, 142 fichiers `.ts`/`.tsx`, motif `Nouveau\|nouveau document\|handleOpenFile` → 4 correspondances, toutes dans `App.tsx`, aucune ne créant un document vide |
| `LayerTransform` porte x/y/scale/rotation et rien d'autre | `src/layers/types.ts:27-32` |
| `CropRect` existe mais le champ `crop` n'a jamais été livré | `src/layers/types.ts:11-22` (en-tête `:14-16`) |
| `enterCrop` n'a aucun appelant en production | balayage repo hors `node_modules` → appels uniquement dans `test/ui/canvasMode.test.ts:22,26,30,38,44,50,54,58,62` ; `src/hooks/usePhotoLayer.ts:265-266` ne pose que `IDLE_CANVAS_MODE`/`toggleMaskPaint` ; constat concordant `.claude/learning-log.md:1245-1257` |
| Le WGSL de la pré-passe ne connaît que 8 paramètres, sans crop | `src/render/photoLayerInput.ts:26-32` |
| `Canvas` n'a aucun geste de sélection, seulement la peinture de masque | `src/components/Canvas.tsx:172-223` (sorties `:173`, `:199`) |
| Les poignées exigent une sélection préalable et le mode `idle` | `src/App.tsx:1377-1386` ; `src/ui/canvasMode.ts:56-58` |
| `compositeUvToPhotoUv` rend `null` hors bornes (base du hit-test) | `src/ui/transform.ts:43-66`, garde `:62-64` |
| Aucun magnétisme/guide d'alignement au canvas | balayage `src/`, 142 fichiers, motif `snap\|align\|magnet` (insensible à la casse) → seules correspondances utiles : `src/ui/transform.ts:68-81` (angle), `src/ui/dockLayout.ts:7` (dock), `src/ui/dragReorder.css:1` (dock) |
| Le raster de masque est alloué aux dimensions du document | `src/mask/maskPainter.ts:29-32` ; `src/App.tsx:775-781` ; `ARCHITECTURE.md:413-417` |
| Le peintre est caché par `layerId` sans revalidation de dimensions | `src/mask/maskPainterSync.ts:41-55` |
| Le modèle s'appuie explicitement sur « la toile ne bouge pas » | `src/layers/layerStack.ts:269-270` |
| `EffectPassRunner`/`MaskTextureResolver` ne sont construits qu'à `loadImage` | `src/render/renderer.ts:259-264`, `:275-282` |
| L'export encode avec les dimensions du state React, la relecture avec celles du GPU | `src/App.tsx:940-941` ; `src/export/exportImage.ts:79-87`, `:175-186` ; `src/render/renderer.ts:449-451` |
| `MAX_PHOTO_LAYERS = 5`, fond compris | `src/layers/photoLayer.ts:35`, `:37-39`, en-tête `:3-11` |
| `MAX_REGISTERED_PHOTO_SOURCES = 4 × MAX_PHOTO_LAYERS` | `src/render/photoSourceStore.ts:54` |
| Le fond d'export est noir en dur | `src/render/presentPass.ts:56-60`, `:145` |
| Le débordement hors toile est assumé explicitement | `src/components/PhotoPanel.tsx:7-11` |
| `fitToCanvas` est un *contain* qui peut agrandir | `src/ui/transform.ts:96-111` |
| La pré-passe photo réalloue sa cible sur changement de dimensions de toile | `src/render/photoLayerInput.ts:156-165` |
| Cinq textures au moins sont dimensionnées à la toile | `src/render/imageFrameResources.ts:40-44`, `:46`, `:50-54`, `:102-108` ; `src/render/photoLayerInput.ts:156-165` |
| Le harnais fixe toujours toile ≡ mire, et a été adapté à T1 | `scripts/render-check.mjs:269`, `:512`, `:561` ; axe `fond` et scénarios `toile-vide`/`toile-damier` `:349-363` |
| Les presets préservent désormais les calques photo | `src/App.tsx:57`, `:1110-1111` ; module `src/presets/preservePhotoLayers.ts` |
| `PhotoSourceStore` ne libère qu'au changement de document | `src/render/photoSourceStore.ts:154-159` |

**Non vérifié, explicitement :**
- **Aucun rendu n'a été observé.** Ce document n'affirme aucun comportement
  visuel constaté, seulement des conséquences dérivées du code lu.
- **`npm run test:render` n'a pas été exécuté.** Le §4.7 affirme que le harnais a
  été adapté (preuve dans le script), pas qu'il passe.
- **Aucune mesure VRAM n'a été relevée.** Le §5 n'écrit aucun chiffre absolu, par
  construction.
- Les allocations résidentes de `MaskTextureResolver` n'ont pas été dénombrées.
- La forensics de co-changement git n'a pas été relancée pour ce document.
