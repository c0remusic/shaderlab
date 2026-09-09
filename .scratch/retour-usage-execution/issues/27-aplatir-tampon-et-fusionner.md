# 27 — Aplatir un calque d'effet : Tampon et Fusionner

**What to build:** Le geste Photoshop **« Aplatir »** sur un calque d'effet : ses
pixels. Antoine, 2026-09-09 : « on ne peut toujours pas aplatir un calque/effet ».
Le « toujours » est mérité — la phrase du grilling du 2026-08-27 disait déjà
« il faut pouvoir aplatir le calque comme photoshop et donc pouvoir le déplacer
et l'étirer ensuite », et le ticket 24 l'a lue comme un scale Y (« étirer ET
aplatir »). Ce qu'il voulait : **rasteriser** — un calque d'effet devient un
calque PHOTO (des pixels), qui se déplace et s'étire ensuite avec les poignées
que les calques photo ont déjà (`LayerTransform`, `TransformHandles`).
Troisième mot du domaine mal traduit de la même famille (« forme », « encre »,
« aplatir ») : à chaque fois MA traduction, jamais mise en image.

Question posée en gestes (« tu sélectionnes un light leak avec deux calques
dessous, tu fais Aplatir : qu'est-ce qui apparaît ? ») — réponse d'Antoine :
**« 1 & 2 »**, donc DEUX commandes :

1. **Tampon** (Photoshop Ctrl+Alt+Maj+E, « stamp visible ») : un NOUVEAU calque
   photo opaque, inséré juste AU-DESSUS du calque sélectionné, = le composite de
   tout ce qu'il y a en dessous + l'effet lui-même, rendu en pixels. Les calques
   d'origine restent en place, intacts. Rien de détruit.
2. **Fusionner** (« Fusionner avec le calque inférieur » / « Aplatir l'image ») :
   même raster, mais il REMPLACE le calque sélectionné et tous ceux en dessous.
   Destructif, annulable (undo de session).

Un effet lit ce qui est en dessous : ses « pixels » sont le composite jusqu'à
lui, pas sa contribution seule. La troisième lecture (pixelliser l'effet seul
sur transparent) n'a pas été retenue — elle n'a de sens que pour les
générateurs (light leak, texture, aplat).

**Blocked by:** None — la décision est prise, les pièces existent.

**Status:** ready-for-agent
**Type:** task

## Ce qui existe déjà (mesuré sur disque le 2026-09-09)

- `Renderer.exportFrame(layers)` rend N'IMPORTE QUELLE liste de calques en
  pixels RGBA (octets + largeur + hauteur, à la taille de la toile). Il suffit
  de lui passer les calques jusqu'au sélectionné inclus.
- `PhotoSourceStore.register(bitmap: ImageBitmap)` → `sourceId` (produit la
  vignette ; ATTENDRE avant `addPhotoLayer`, voir `usePhotoLayer.ts:118`).
  Plafonds : `MAX_PHOTO_LAYERS = 5` (`canAddPhotoLayer`),
  `MAX_REGISTERED_PHOTO_SOURCES = 20`.
- `LayerStack.addPhotoLayer(sourceId, transform, name, afterId)` et
  `LayerStack.removeLayer(id)` (refuse un calque verrouillé : `isLocked`).
- Le patron d'import d'un calque photo depuis un fichier :
  `src/hooks/usePhotoLayer.ts` `importPhotoFromPath` — octets → `Blob` →
  `createImageBitmap` → `register` → `addPhotoLayer` → `commit`. Le tampon
  fait la même chaîne à partir de `exportFrame` au lieu d'un fichier
  (`ImageData` → `createImageBitmap`).
- La zone de contrôles UNIQUE de la pile (ADR-0001) : `LayerPanel.tsx` ~640-670,
  boutons « Dupliquer » / « Supprimer le calque » (`LayerControls`). Les deux
  commandes y entrent, à côté, avec le même style de bouton icône. Désactivées
  sans sélection, sur un calque photo (un calque photo est déjà des pixels —
  ou pas ? à trancher : Tampon d'un calque photo = composite jusqu'à lui, ça a
  un sens, l'autoriser), et Fusionner refusé si un calque en dessous est
  verrouillé (`isLocked`).
- `DocumentSession.commit(stack)` pour l'historique ; les deux commandes sont
  UN pas d'undo chacune.

## Ce qui reste à trancher en implémentant (décider, noter, ne pas demander)

- Le nom du calque photo créé : « Aplati — <nom du calque source> ».
- Le raster est OPAQUE et couvre toute la toile (transform centré, échelle 1,
  comme `importPhotoFromPath`). La photo de fond en dessous devient donc
  invisible tant qu'on ne bouge pas le tampon — c'est exactement Photoshop.
- Le recadrage de toile (`cadreToile`) : `exportFrame` rend la toile courante ;
  vérifier que le raster obtenu se pose au bon endroit dans le repère de la
  photo de fond (l'espace du masque est celui de la photo de fond).
- Fusionner sur le calque photo de FOND (le plus bas) : il n'y a rien en
  dessous ; la commande remplace le calque photo par son raster — no-op
  visuel, autorisé mais inutile ; ou refusé. Trancher, noter.

- [x] Commande Tampon : nouveau calque photo au-dessus du sélectionné, composite jusqu'à lui, un pas d'undo.
- [x] Commande Fusionner : même raster, remplace le sélectionné et tout ce qui est en dessous, un pas d'undo, refusée si un calque du lot est verrouillé.
- [x] Les deux dans la zone de contrôles de la pile (ADR-0001), désactivées quand sans objet, avec infobulle.
- [x] Le raster se déplace et s'étire aux poignées comme n'importe quel calque photo (rien à écrire : le raster est un `LayerState` photo ordinaire portant `imageSource`+`transform`, donc l'outil Déplacer/`TransformHandles` agit dessus sans code neuf — vérifié : mêmes champs qu'un import).
- [x] Tests unitaires sur la logique pure (`test/layers/flatten.test.ts`, 14 cas), stories de la zone de contrôles (`LayerControls.stories.tsx` : `FlattenActionsActOnSelectedLayer`, `MergeDisabledOnBottomLayer`, `StampDisabledAtPhotoCap`, + assertion dans `NoSelection`), `test-storybook` EN ENTIER vert (35 fichiers, 358 tests).
- [x] `test:render` zéro écart (aucun shader ne bouge) — vérifié.
- [ ] Validé en gestes par Antoine : aplatir un light leak, le déplacer, l'étirer. (RESTE — validation humaine ; le geste au pixel est prouvé par CDP, voir Décisions.)

## Décisions prises en implémentant (2026-09-09)

- **Nom du calque créé** : « Aplati — <nom du calque source> » (le nom source = nom
  explicite du calque, sinon nom de l'effet, comme la ligne de la pile). Sur un
  aplati d'aplati : « Aplati — Aplati — … », voulu (chaîne traçable).
- **Fond de l'aplati** : opaque, pleine toile, transform centré échelle 1 (comme
  l'import). Le raster est aplati sur fond opaque par la passe de présentation
  (garanti par `assertOpaqueForJpeg`, ADR-0006 fond d'export) — pas de forçage
  d'alpha nécessaire.
- **Fusionner sur le calque de FOND (le plus bas)** : REFUSÉE (bouton grisé,
  infobulle « Rien en dessous… »). Choix : « Fusionner avec le dessous » n'a pas
  de dessous — grisé, comme « Merge Down » de Photoshop sur le calque du fond.
  Plutôt refuser qu'autoriser un no-op visuel.
- **Le raster de Fusionner va au FOND (index 0)**, sous les calques restés
  au-dessus du sélectionné, qui se recomposent par-dessus lui (aspect inchangé).
- **Plafond photo** : Tampon refusé au plafond `MAX_PHOTO_LAYERS`=5 (il crée un
  calque photo). Fusionner calcule le plafond APRÈS retrait du lot (donc quasi
  toujours permis).
- **Layout (ADR-0001)** : les deux boutons rejoignent le cluster d'actions de la
  ligne « Verrous : » (à côté de Dupliquer/Supprimer), PAS une 3ᵉ ligne — une 3ᵉ
  ligne a été explicitement refusée (dépassement vertical, `LayerPanel.css`). Le
  cluster passe à 8 icônes ; son gap est resserré à `--space-1` pour tenir à 320px
  (mesuré sur la vraie fenêtre : 288px < 296px dispo). `FiveRowDocumentHidesNoRow`
  reste vert (aucune ligne de liste cachée : hauteur inchangée).

## Prémisse du ticket corrigée sur pièce

- **« Vérifie le repère avec le recadrage de toile (`cadreToile`) »** : le
  recadrage de TOILE (`LayerStack.cadre` / `DocumentSession.recadrerToile` /
  `cadreToile`) N'EST CÂBLÉ NULLE PART — zéro référence dans `render/`, dans
  `export/`, ni dans `App.tsx` (le seul « crop » de `ui/canvasMode.ts` est le crop
  d'un CALQUE photo, `LayerTransform`, pas la toile). Il n'entre donc ni dans
  `exportFrame` ni dans le pipeline. Conséquence : le tampon est crop-invariant par
  construction (le raster est placé aux coordonnées pleine toile `imageSize`,
  inchangées par un recadrage, exactement ce que rend `exportFrame`). Le gate
  discriminant réel — « un tampon posé au bon endroit ne change rien à l'image » —
  a été vérifié par CDP sur la vraie fenêtre : `frameSignature` avant/après tampon
  IDENTIQUE à la décimale (moyenne 46.68855218855222, écart 60.743273802699655),
  et idem après Fusionner. Un pas d'undo par commande confirmé (stamp → 2 calques
  → 1 undo → 1 calque).

## Reste

- Validation en gestes par Antoine (aplatir un light leak, le déplacer, l'étirer).
- **Pas de raccourci clavier dans cette tranche** (Tampon = `Ctrl+Alt+Maj+E`,
  Fusionner = `Ctrl+E` chez Photoshop) — suite à part.
