# Les poignées de l'aplat

Type: task
Status: resolved
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


---

## Answer — RÉSOLU le 2026-08-18

**Le quatrième genre n'a demandé aucun manipulateur neuf.** C'est ce que ce
ticket n'avait pas vu, et c'est ce qui l'a rendu petit une fois le
[ticket 17](17-les-outils-sur-la-toile.md) débloqué.

`TransformHandles` fait DÉJÀ, pour le calque photo : quatre coins, quatre côtés,
une rotation, le magnétisme, l'accès clavier et le nom accessible. Une boîte
d'effet et une photo transformée sont **le même objet dans deux systèmes
d'unités** — un centre, deux demi-étendues, un angle.

Ce que le genre a coûté : `src/ui/boxControl.ts`, deux fonctions pures, sept
tests. Rien d'autre.

| côté EFFET | côté MANIPULATEUR |
| --- | --- |
| centre en UV (0..1) | centre en PIXELS du fond |
| étendues en fraction du cadre | `photoSize` × `scaleX`/`scaleY` |
| rotation en **degrés** | rotation en **radians** |

La `photoSize` n'est pas une photo : c'est la boîte mesurée en pixels, donnée au
manipulateur comme si elle était le contenu. C'est ce qui laisse les échelles à 1
au repos et fait que toute la mécanique existante s'applique sans que la boîte
ait à la comprendre.

⚠️ **Deux pièges, tous deux dans les tests plutôt que dans un commentaire.**
Confondre degrés et radians ne casse rien de visible : la boîte tourne, d'un
facteur 57. Et lire la seule `photoSize` au retour rendrait une boîte qui ne
grandit JAMAIS — le manipulateur ne touche pas à `photoSize`, il change
`scaleX` — donc le glissement paraîtrait sans effet. `validateEffect` exige
désormais les unités : étendues en `percent`, rotation en `degrees`.

### Vérifié dans la vraie fenêtre

Outil Forme, rectangle tracé à la souris par CDP, retour à *Déplacer* : **9
poignées et 1 cadre** rendus sur l'aplat, capture à l'appui.

⚠️ **Une observation qui n'est pas un défaut de ce ticket** : les manipulateurs
n'existent qu'en mode canvas `idle`, donc tracer une forme puis vouloir la
retoucher demande de repasser à *Déplacer*. Photoshop garde ses poignées dans
l'outil de forme. C'est une question d'enchaînement d'outils, pas de genre de
contrôle — à poser telle quelle si elle gêne à l'usage.

Le verdict d'Antoine sur le rectangle à quatre curseurs — « la pire façon de
créer un rectangle » — portait sur la CRÉATION, réglée le 2026-08-17 par l'outil
Forme. Celui-ci règle la RETOUCHE.
