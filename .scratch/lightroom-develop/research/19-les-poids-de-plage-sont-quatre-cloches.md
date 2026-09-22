# Les poids de plage sont quatre cloches, et celui des hautes lumières lâche le blanc

Mesuré le 2026-09-22, sans aucune mesure Lightroom neuve. Ce document reprend le
**premier des « défauts trouvés et NON corrigés »** de `docs/ROADMAP.md` — « le
poids des hautes lumières est NON MONOTONE, et aucune homographie ne rend ça » —
et lui donne sa cause. Aucun changement dans `src/`.

## Ce que l'instrument de research/18 rend possible

[research/18](18-la-forme-est-une-pente-en-lumiere-lineaire-plus-un-point-noir.md)
a identifié la forme du virage sur la roue des ombres :

```
lin_sortie = lin · (1 + w·(g−1)) + w·b
```

Deux constantes, un poids. La table de calibration affirme par ailleurs que
« Lightroom applique UN seul modèle de mélange, donc l'amplitude d'une roue ne
dépend pas de la plage ». **Si c'est vrai, l'équation s'inverse à chaque niveau** :

```
w(n) = (lin_sortie − lin) / (lin·(g−1) + b)
```

et les rampes `+50` des trois autres roues rendent leurs profils **sans mesure
neuve**. C'est une hypothèse, et elle se falsifie seule : un poids de plage vit
dans [0, 1] et est lisse.

**Elle n'est pas falsifiée.** Les 256 niveaux tombent dans [0, 1] pour les quatre
roues, le pire dépassement valant 0,011 (`assets/poids-des-quatre-roues.mjs`).
Rien ne garantissait ça.

## 1. La retombée des hautes lumières n'est PAS un écrêtage

Premier soupçon, et il était faux. Le profil extrait culmine au niveau 199 puis
retombe à 0,044 au niveau 248 ; or l'opérateur sature quand `lin·g + b > 1`, soit
au niveau sRGB **201,7** — calculé sans regarder la mesure. Une sortie écrêtée ne
s'inverse pas, et l'inversion attribuerait le plafond au poids.

Le contrôle tranche (`assets/hautes-lumieres-plafond.mjs`) : **la sortie mesurée
n'atteint jamais 254,5 avant le niveau 255 lui-même.** Et l'écart à la diagonale
redescend en douceur là où un plafond le garderait maximal avant de le raboter :

| niveau | 180 | 190 | 199 | **205** | 215 | 225 | 235 | 245 | 250 | 253 | 255 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| écart | 10,55 | 12,00 | 12,91 | **13,01** | 12,61 | 11,00 | 8,34 | 4,60 | 2,47 | 1,00 | 0,00 |

**La retombée est réelle.** Témoin contrôlé au passage : écart maximal 0,032
niveau à la rampe nue, donc ce n'est pas non plus la dérive d'export.

## 2. Ce n'est pas « non monotone », c'est une CLOCHE

Les quatre profils ajustés en gaussienne sur L d'OKLab
(`assets/quatre-cloches.mjs`) :

| roue | centre L | demi-largeur | hauteur | résidu moyen |
|---|---|---|---|---|
| ombres | 0,130 | 0,185 | 1,020 | 0,0117 |
| médians | **0,570** | **0,145** | 0,290 | 0,0040 |
| hautes | **0,810** | 0,205 | 0,180 | 0,0187 |
| globale | 0,450 | 0,285 | 0,330 | 0,0151 |

Les résidus sont petits devant les hauteurs : « cloche » décrit le profil, ce
n'est pas une façon de parler. Et **le mot qui manquait au ROADMAP est là** — une
homographie est monotone, une cloche ne l'est pas. Le défaut n'était pas une
anomalie à expliquer, c'était une famille de forme non reconnue.

### Une validation croisée non planifiée

`midSigma` vaut **0,144** dans la table en service, calibré sur
`grading-moyens-vert` — une mesure de **CHROMA**. L'ajustement ci-dessus tire
**0,145** de `cg-moyens-lum-p50`, une mesure de **LUMINANCE**, par un chemin qui
ne partage ni les données ni le code. Deux jeux disjoints, la même demi-largeur à
0,001 près. `midCenter` suit à 0,04 près (0,610 contre 0,570).

### Ce qui se cite, et ce qui attend

Un sommet stable ne dit pas qu'un centre ajusté l'est : l'ajustement voit tout le
profil, et les queues dépendent de `b`. Les trois jeux de constantes
(`assets/cloches-robustesse.mjs`) bornent chaque paramètre :

| roue | centre L | étendue | demi-largeur | étendue |
|---|---|---|---|---|
| ombres | 0,130 · 0,220 · 0,170 | 0,090 | 0,165 – 0,185 | 0,020 |
| **médians** | 0,570 · 0,570 · 0,560 | **0,010** | 0,140 – 0,150 | **0,010** |
| **hautes** | 0,810 · 0,810 · 0,810 | **0,000** | 0,175 – 0,210 | 0,035 |
| globale | 0,450 · 0,500 · 0,280 | 0,220 | 0,260 – 0,400 | 0,140 |

**Le centre des hautes lumières ne bouge sous aucun des trois jeux.** Celui des
médians non plus. Les ombres ajustent une demi-cloche (leur poids est maximal tout
en bas), et la globale n'est pas citable en l'état — les deux attendent la
campagne F.

## 3. Ce que notre modèle fait à la place, et pourquoi il écrase

`colorGrading.ts` traite les ombres et les hautes lumières en **rampes
complémentaires** : `ws = (1−α)^g · cov` et `wh = α^g · cov`. Une rampe qui monte
jusqu'au blanc. Le sommet de notre `wh` est au **niveau 253** (0,971) ; celui de
Lightroom au **niveau 200** (0,217), et il est retombé à 0,044 quand le nôtre vaut
encore 0,899.

| niveau | 128 | 160 | 190 | 205 | 220 | 235 | 248 |
|---|---|---|---|---|---|---|---|
| Lightroom | 0,086 | 0,143 | 0,210 | **0,213** | 0,183 | 0,118 | 0,044 |
| en service | 0,146 | 0,226 | 0,359 | 0,456 | 0,580 | 0,735 | **0,899** |

**Nous poussons là où Lightroom a déjà lâché.** C'est la cause directe de
l'écrasement au blanc que deux corrections ont traité par la conséquence : la
saturation contre la borne (`appliqueLum`) a ramené onze niveaux écrasés à cinq,
le raidissement du partage (`rangeContrast`) à quatre — et aucune des deux ne
pouvait fermer, puisque raidir une rampe l'approche d'une cloche sans en faire une.

Cela explique aussi, au passage, pourquoi `rangeContrast` améliorait **tout un
peu** — parité, chroma d'un gris moyen, écrasement — sans rien fermer : il
rapproche la mauvaise famille de forme de la bonne.

⚠️ **Et une roue de hautes lumières qui laisse le blanc pur intact DOIT avoir un
poids qui retombe à zéro au blanc**, sinon elle déplacerait le blanc. Le brevet
B220 dit « maintaining constant luminance ». La cloche n'est pas une bizarrerie de
mesure, c'est ce que l'opérateur doit faire.

## Ce qui manque encore, et c'est toujours la campagne F

1. Les constantes `(g, b)` viennent de la roue des OMBRES et restent celles de
   research/18 — provisoires tant que le signe négatif des trois autres roues
   n'est pas mesuré.
2. Deux des quatre centres ne sont pas citables (ombres, globale) : leur poids est
   maximal là où le lift domine, donc sensible à `b`.
3. La hauteur des cloches n'a pas été confrontée à `lumK`, qui reste calibré sur
   deux roues.

**Rien n'est posé dans `src/`**, et les quatre références `developpement-grading-*`
ne bougent pas. Mais le défaut n°1 du ROADMAP change de nature : il n'est plus
« une non-monotonie qu'aucune forme ne rend », il est **une cloche modélisée par
une rampe**, avec son centre mesuré et robuste.
