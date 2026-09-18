# Le zéro était bon, et l'écart de Texture vit dans la branche NÉGATIVE

Mesuré le 2026-09-18, pendant que la campagne Détail attend un redémarrage de
Lightroom. La question se pose **avant** que les amplitudes arrivent, et c'est
la raison de la poser maintenant : un zéro se contrôle avant de servir.

> **Notre pipeline change-t-il le grain de la photo avant qu'aucun débruitage
> n'existe ?** Si oui, toute amplitude de Détail calibrée sur la campagne serait
> biaisée du même facteur — et rien ne le dirait, puisque le biais vivrait dans
> le zéro de l'instrument et non dans les mesures.

## Le banc

`DSCF5171.JPG`, photo d'origine boîtier, 6240×4160. Les exports de Lightroom
font **exactement la même taille** que nos rendus, donc un crop de 1400×1400
pris au centre tombe sur **les mêmes pixels des deux côtés**, à l'échelle
native. Aucune réduction, donc aucune des chausse-trappes de la décimation ; et
un grain se juge en 1:1 de toute façon.

Les trois champs (grain, netteté, acuité) viennent de `assets/champs_detail.py`,
**partagé** avec `assets/analyse-detail.py` — extraction vérifiée, `ph-temoin`
rend 6,680 avant comme après. Notre côté se rend par
`assets/temoin-shaderlab.mjs`, se lit par `assets/comparer-temoin-shaderlab.py`.

| | grain | netteté | acuité |
|---|---|---|---|
| fichier boîtier | 5,099 | 12,822 | 0,684 |
| Lightroom témoin | 5,121 | 12,827 | 0,683 |
| **shaderlab témoin** | **5,099** | **12,822** | **0,684** |
| Lightroom Texture +100 | 7,918 | 21,223 | 0,676 |
| shaderlab Texture +100 | 7,927 | 21,402 | 0,695 |
| Lightroom Texture −60 | 2,885 | 8,270 | 0,725 |
| shaderlab Texture −60 | 3,047 | 8,537 | 0,714 |

## 1. Notre zéro est EXACT — ×1,000 sur les trois champs

À étage au défaut, notre composite rend les chiffres du fichier au millième.
C'est attendu (`isDevelopModuleAtDefault` saute le module, le ping-pong est
byte-identique) mais ce n'était pas **mesuré**, et c'est la seule façon de le
savoir : un test compare à ce qui existe, jamais à ce qui serait possible.

Le côté Lightroom, lui, dérive de **×1,004** sur le grain : son export
ré-encode. L'écart est minuscule et il va dans le sens qu'on attend d'un JPEG.
Il est surtout la preuve que l'instrument voit à ce niveau-là.

**Conséquence** : la campagne Détail peut se calibrer sans correction de zéro.

## 2. L'écart historique sur Texture +100 était l'INSTRUMENT, pas l'opérateur

Le même facteur d'amplification du grain par Texture +100 chez Lightroom a été
chiffré **trois fois, par trois instruments** :

| instrument | facteur |
|---|---|
| `research/08` (fenêtre fixe, écart-type nu) | ×1,76 |
| `analyse-detail.py` (image entière décimée vers 1400) | ×1,64 |
| **ce banc** (crop 1400 à l'échelle native) | **×1,546** |

Treize pour cent d'étalement sur une grandeur qu'on croyait lire. Et sur ce
banc-ci, **les deux côtés tombent l'un sur l'autre** :

- Texture +100 : Lightroom **×1,546**, shaderlab **×1,555** — 0,6 % d'écart.
- netteté à +100 : ×1,654 contre ×1,669 — 0,9 %.

⚠️ La leçon n'est pas « nous étions déjà bons » : elle est qu'un facteur
d'amplification de grain **n'a pas de valeur absolue**, il a la valeur que son
estimateur lui donne. Comparer nos chiffres aux leurs n'a de sens que mesurés
par le même code sur les mêmes pixels — ce que la campagne impose désormais des
deux côtés.

## 3. Ce qui reste : la branche NÉGATIVE, et elle diverge dans un seul sens

Contrôle de robustesse — cinq fenêtres de 600×600 dans le crop, chaque côté
rapporté à **son propre** témoin :

| fenêtre | LR +100 | SL +100 | LR −60 | SL −60 |
|---|---|---|---|---|
| 0,0 | 1,605 | 1,606 | 0,569 | **0,603** |
| 800,0 | 1,541 | 1,518 | 0,567 | **0,618** |
| 0,800 | 1,531 | 1,514 | 0,572 | **0,647** |
| 800,800 | 1,594 | 1,610 | 0,549 | **0,559** |
| 400,400 | 1,370 | 1,420 | 0,630 | **0,690** |
| moyenne | 1,528 | 1,534 | **0,577** | **0,623** |

- **+100 : aucun sens privilégié** — nous sommes au-dessus deux fois, en dessous
  deux fois, à égalité une fois. Écart moyen **+0,35 %**.
- **−60 : cinq fenêtres sur cinq dans le même sens.** Notre Texture négative
  laisse **+8,0 %** de grain de plus que la leur, partout.

Cinq sur cinq n'est pas un grand échantillon (un tirage à pile ou face y arrive
une fois sur seize). Ce qui porte la conclusion est l'ADDITION des deux : la
direction est constante ET les amplitudes le sont, là où la branche positive
change de signe d'une fenêtre à l'autre. La dispersion fenêtre à fenêtre est
d'ailleurs large des deux côtés (1,37 à 1,61 pour le même opérateur) — elle
mesure le CONTENU, pas l'opérateur, et c'est pourquoi la constance du signe
compte plus que la taille de l'écart.

## Ce que ça dit au ticket 10

L'écart restant entre notre Texture et la leur est **entièrement du côté où
elle lisse**, et c'est exactement le côté où
[`research/15`](15-l-anneau-de-texture-est-un-debruitage-manquant.md) place le
débruitage manquant : leur Texture négative lisse davantage parce qu'elle ne
travaille pas sur le même signal d'entrée que la nôtre.

⚠️ **Ce n'est pas une mesure neuve du PORTAIL**, et ça n'autorise pas une
cinquième tentative sur son coefficient — `15` l'interdit explicitement. C'est
une mesure du RÉSULTAT, qui dit où regarder : la tranche 1 (bruit de luminance)
est bien celle qui porte l'écart, et la branche positive n'a rien à corriger.

La campagne le tranchera : `det-tex100-nr0 / nr50 / nr100` mesure leur Texture
sur un grain qu'ils ont eux-mêmes réduit, aux trois doses.
