# Les poignées de l'aplat

Type: task
Status: open
Blocked by: 17
Parent: ../map.md

## Question

Troisième des fronts retenus par Antoine le 2026-08-17 pour amener `aplat` « type
photoshop ». Les deux autres — dégradé de remplissage et polygone — sont livrés
([ticket 24](24-aplat-passe-a-la-qualite.md)) ; celui-ci ne l'est pas, et il ne
peut pas l'être seul.

Aujourd'hui **seul le CENTRE se manipule sur l'image** (`CanvasControl` de genre
`point`). Largeur, hauteur et rotation restent au curseur, alors que Photoshop
donne huit poignées et une rotation au coin.

## Pourquoi il est BLOQUÉ, et pas seulement « pas encore fait »

`CanvasControl` n'a que **trois genres** — `point`, `disk`, `axis`
(`effects/types.ts:151`) — et aucun ne sait exprimer une boîte redimensionnable
avec rotation.

Ajouter un quatrième genre touche un mécanisme **partagé par quatre effets**
(`lensFlare`, `lightLeak`, `pixelStretch`, `motionBlur`), plus `RegionHandles` et
`ParamPanel`. Ça se décide au [ticket 17](17-les-outils-sur-la-toile.md), qui est
précisément le front « les outils sur la toile » du chantier des contrôles — pas
dans le coin d'un effet.

⚠️ **Ne pas contourner en câblant des poignées propres à `aplat`.** Ce serait le
cinquième mécanisme de manipulation directe du dépôt, et le chantier des contrôles
existe parce que les précédents ont divergé. Un effet qui se fabrique son propre
manipulateur est exactement ce que le ticket 17 doit rendre inutile.

## Matière déjà instruite

Le [ticket 18](18-ce-qu-est-un-manipulateur-de-niveau-pro.md) porte **42 lignes
de grille** sur ce qu'est un manipulateur de niveau professionnel — 17 genres,
25 points d'anatomie du geste, dont 11 déjà faits ici. Écarts chiffrés qui
concernent directement ce ticket :

- **zéro `:hover`** dans les quatre CSS d'overlay ;
- **poignées de 12 px** pour 24 recommandés ;
- **aucune valeur affichée pendant le geste**.

⚠️ Et son avertissement, qui vaut ici : **14 des 42 lignes supposent qu'un
manipulateur soit un OBJET** — le même mur que la typographie. Une boîte à huit
poignées peut y tomber ; le vérifier avant d'écrire le genre.

## Ce qui rendrait ce ticket raté

Livrer des poignées qui ne servent qu'`aplat`. Le besoin est partagé : quatre
effets posent déjà une géométrie sur la toile, et au moins `lensFlare` et
`lightLeak` gagneraient une boîte s'il en existait une.
