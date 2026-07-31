---
id: ADR-0008
status: active
date: 2026-07-31
---

# ADR-0008 : un effet ne se pose jamais sur un calque photo

## Contexte

L'audit des effets du 2026-07-31 remonte comme finding dominant qu'un effet posé
sur le calque photo rend l'image entièrement noire — luminance 0, 100 % de pixels
noirs, mesuré au CDP sur la vraie fenêtre. Antoine l'a confirmé en usage réel le
même soir : « ça donne un écran noir ».

Le mécanisme est un trou de contrat, pas une étourderie. `shaderCompose.ts:178-181`
prépare deux valeurs distinctes : `color`, le composite EN DESSOUS, et
`effectInput`, la photo du calque. Le contrat est qu'un effet lit son PARAMÈTRE.
`glow.ts:96` le respecte ; `warp.ts:64` et `chromaticBleed.ts:29-31` rechargent
`srcTexture` — donc le composite d'en dessous, qui sur le calque de fond est la
toile vide depuis la tranche T1. La branche n'est atteignable que si
`layer.imageSource` est posé (`framePipelineExecutor.ts:413`), ce qui est le cas
de tout calque photo, calque de fond compris.

Ces deux effets ont besoin d'échantillonner à des **UV décalés** : c'est leur
raison d'être. Un paramètre `color`, échantillon unique à `in.uv`, ne peut pas le
leur donner. Les deux correctifs évidents ont été mesurés et refusés par la passe
adverse de l'audit : lire `coverageTexture` aux taps décalés produit un liséré
noir d'environ 55 px sur chaque bord de photo, et un helper d'échantillonnage
corrige les pixels mais pas le POIDS de compositing, toujours pris à `in.uv`
non déplacé (`shaderCompose.ts:115`).

Trois formes de correctif ont été posées : élargir l'ABI des effets, étendre la
pré-passe photo à la passe finale, ou passer les effets déplaçants en deux temps.
Toutes supposent que « effet sur un calque photo » est une capacité à conserver.

C'est cette supposition qu'Antoine a tranchée, et dans l'autre sens.

## Décision

**Un effet ne se pose jamais sur un calque photo. Un effet est un calque à part,
lié — écrêté — à la photo.**

La garde vit dans le MODÈLE : `LayerStack.setLayerEffect` refuse un calque portant
`imageSource`, en miroir exact de `setLayerClip`, qui refuse déjà l'inverse. Le
sélecteur d'effet disparaît de l'interface pour ces calques ; une garde de modèle
sans garde d'interface laisserait un contrôle qui ne fait rien.

Les trois formes de correctif du contrat `fs_main` deviennent sans objet : le
chemin qu'elles réparaient n'existe plus.

## Conséquences

- L'écran noir disparaît avec l'affordance. **Aucun shader n'est touché** — c'est
  le correctif le moins cher des quatre envisagés, et le seul sans risque de
  régression de rendu.
- Le modèle devient unique : l'application portait jusqu'ici DEUX modèles
  concurrents pour « appliquer un effet à une photo », et c'était le défaut de
  fond dont le noir n'était que le symptôme.
- `ARCHITECTURE.md` § 4.3 devient dépassé : il recommande l'approche C2
  précisément pour qu'un effet posé sur un calque photo fonctionne. La section est
  marquée dépassée par cette décision, texte d'origine conservé (append-only).
- **La pré-passe C2 n'est PAS déposée.** Elle reste nécessaire pour résoudre
  l'entrée d'un calque photo : fusion, masque, et double exposition. Toute partie
  qui deviendrait réellement inatteignable sera signalée, pas supprimée dans le
  même geste.
- Les documents et presets déjà enregistrés peuvent porter un `effectId`
  non-`passthrough` sur un calque photo. Leur sort est traité au chargement, de
  façon visible dans le code — un écran noir silencieux n'est pas une option, une
  mutation silencieuse du document d'un utilisateur non plus.
- La garde de modèle et sa couverture de test sont en cours d'écriture sur la
  branche `effet-calque-photo`. Le champ `confirmation` de ce record sera
  renseigné vers le test qui l'applique quand cette branche sera fusionnée.

## Alternatives écartées

- **Réparer le contrat `fs_main`** (étendre la pré-passe à la passe finale, mon
  option recommandée avant l'arbitrage). Coûte une décision d'architecture, du
  travail shader, et une passe plus une texture pleine taille par calque photo
  portant un effet — coût jamais mesuré sur une 24 MP. Garde deux modèles
  concurrents pour le même geste utilisateur, ce qui était le défaut de fond.
- **N'interdire que `warp` et `chromaticBleed`** sur un calque photo. Le moins
  cher, aucun risque, mais crée une règle « certains effets ne sont pas
  disponibles ici » à expliquer dans l'interface, et laisse le trou de contrat
  ouvert pour tout effet futur qui échantillonnerait à un UV décalé.
- **Ne rien faire.** L'écran noir est atteignable en deux clics sur le calque que
  porte tout document.

## Croyances révisées

- Croyance : « le noir est une étourderie de deux shaders qui lisent `srcTexture`
  au lieu de leur paramètre — deux lignes à corriger ».
  Réfutée par : la passe adverse de l'audit du 2026-07-31, qui a mesuré les deux
  correctifs évidents et les a refusés (liséré noir d'environ 55 px sur chaque
  bord ; poids de compositing pris à un UV non déplacé). Le contrat `fs_main`
  passe un ÉCHANTILLON là où ces effets ont besoin d'un ÉCHANTILLONNEUR.
  Ce que ça change : ce n'était pas un bug de shader mais un trou de contrat, et
  tout effet futur échantillonnant à un UV décalé aurait été concerné. C'est ce
  qui a fait remonter la question au niveau du modèle plutôt que du shader.

- Croyance : « interdire l'effet sur un calque photo supprime la double
  exposition, conçue en C2 ».
  Réfutée par : `layerStack.ts:141` le soir même. La double exposition est faite
  d'`addPhotoLayer` — plusieurs calques photo empilés — pas d'effets posés sur
  eux. Le seul mécanisme qui disparaît est `setLayerEffect` sur un calque photo,
  dont le commentaire (`layerStack.ts:176-181`) dit qu'il a été ajouté exactement
  pour ça.
  Ce que ça change : le correctif est bien plus étroit et moins risqué qu'annoncé
  au moment de poser la question. La conséquence « la double exposition disparaît »,
  écrite dans l'énoncé de l'option retenue, était fausse.

- Croyance : « le finding de l'audit se reproduit sur n'importe quel banc de
  rendu ».
  Réfutée par : le banc du 2026-07-31 à 02:49, qui a rendu `warp` et
  `chromaticBleed` avec ZÉRO pixel noir — luminance 42,83 et 42,60 contre 42,63
  sans effet. L'effet y avait été posé comme calque AU-DESSUS de la photo, où
  `layer.imageSource` est indéfini, `imageSourceView` reste nul et `effectInput`
  retombe sur `color`, qui contient le composite avec la photo.
  Ce que ça change : la condition décisive est `layer.imageSource`
  (`framePipelineExecutor.ts:413`), pas l'effet ni le sujet. Un banc qui ne pose
  pas l'effet SUR le calque photo ne peut pas reproduire le défaut — et a failli
  faire conclure à tort que le finding principal de l'audit était faux.
