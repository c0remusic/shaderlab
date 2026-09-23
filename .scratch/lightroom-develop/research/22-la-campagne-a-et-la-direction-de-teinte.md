# La campagne A : la direction de teinte vient de ProPhoto, et l'ancienne question était mal posée

Mesuré le 2026-09-23, sur les onze teintes de la campagne A. Aucun changement dans
`src/`. Ce document rapporte **ce qui tient après réfutation** — quatre hypothèses
ont été explorées en parallèle et **trois ont été démolies**, y compris deux des
miennes.

## Ce que la campagne a rendu

Course lancée à 05:43:41, 21 exports en 18 secondes. Les onze teintes rendent
**202 à 219 niveaux lisibles** chacune — la révision de la campagne (chaque ligne à
`SplitToningBalance=-100`) a bien doublé le signal, et le twin prédisait 218.
Écarts-types de l'angle : 0,98° à 6,63°.

⚠️ **Contrôle d'idempotence gratuit** : le recalcul de l'ingestion a réécrit les
191 JSON et **n'en a modifié aucun** des anciens.

## 1. La direction vient de ProPhoto — sur deux métriques indépendantes

Lightroom Classic travaille en interne en ProPhoto RGB. L'hypothèse que ce dossier
n'avait jamais essayée : le cercle de teintes du sélecteur y est défini.

**Sur l'angle**, 28 familles à zéro paramètre (`assets/loi-h4-espaces.mjs`) :

| famille | écart moyen | médiane |
|---|---|---|
| **ProPhoto D50/Bradford linéaire** | **5,00°** | 2,79° |
| ProPhoto primaires + D65 sans adaptation | 5,20° | 1,79° |
| Rec.2020 linéaire | 5,35° | 3,23° |
| ProPhoto D50 / XYZ scaling | 5,74° | **1,27°** |
| ProPhoto gamma 1,8 | 8,91° | — |
| sRGB linéaire | 9,14° | — |
| **HSL sur sRGB (en service)** | **13,42°** | — |
| roue RYB (Gossett-Chen) | 31,91° | — |

**Sur les rampes entières**, en niveaux sRGB — la métrique qui décide
(`assets/virage-en-prophoto.mjs`), chaque modèle recevant la même amplitude tirée
de la mesure, donc jugé sur le seul espace :

| modèle | écart moyen |
|---|---|
| ajout en OKLab, direction **ProPhoto** | **3,77 niveaux** |
| ajout en **ProPhoto linéaire** | 7,11 |
| ajout en OKLab, direction sRGB/HSL (en service) | 8,87 |

Deux métriques indépendantes, même verdict, même facteur : **~2,4 à 2,7**.

Trois faits robustes en marge :

- **Le linéaire bat l'encodé sur cinq gamuts** : ProPhoto 5,00 contre 8,91 ;
  Rec.2020 5,35 contre 10,66 ; Adobe 7,03 contre 11,53 ; P3 7,56 contre 12,38 ;
  sRGB 9,14 contre 13,42. Ce n'est pas un hasard de classement.
- **HSV ≡ HSL sur une couleur pure saturée** : écart 1,11 × 10⁻¹⁵ sur 720 teintes.
  Mesuré, plus supposé — donc pas une famille de plus.
- **Le choix d'adaptation chromatique n'est pas le levier** : Bradford, von Kries,
  XYZ scaling et aucune adaptation tiennent dans moins de 2°.

⚠️ **Et mon hypothèse la plus élégante est FAUSSE.** « Lightroom ajoute sa chroma
en ProPhoto, son espace de travail » expliquait d'un coup quatre observations. Elle
rend **7,11 niveaux contre 3,77** : l'addition a bien lieu en OKLab, seule la
DIRECTION vient de ProPhoto. Un modèle qui explique tout et mesure mal reste faux.

## 2. L'ancienne question était mal posée

**La direction ProPhoto n'est pas stable en saturation** (`assets/loi-220-singularite.mjs`).
En désaturant vers le gris — ce qui ne change pas une teinte — l'angle bouge :

| teinte | 140 | 150 | 330 | 300 | 180 | 90 | 270 | 60 | 0 | 40 | **220** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| étendue | 0,8° | 1,2° | 1,3° | 1,4° | 2,9° | 3,4° | 5,2° | 8,3° | 9,3° | 19,2° | **33,1°** |

Six teintes sur onze bougent de plus de 3°. Pour celles-là, **la construction ne
définit pas de direction** : l'angle qu'on leur attribue dépend de la saturation à
laquelle on le lit. Le résidu moyen en dépend aussi — **5,00° à saturation pleine,
2,76° à mi-saturation, 5,43° à la limite infinitesimale**.

Le mécanisme est nommé : à la teinte 220, le sRGB linéaire de la couleur ProPhoto
vaut `[−0,549 ; 0,408 ; 1,111]` — hors gamut, une composante négative. La
composante `l` du LMS d'OKLab y traverse zéro (teintes 228,5 et 245,8) et la racine
cubique a une dérivée infinie en zéro : `dA/dh` vaut **0,22 à la teinte 220 et
29,86 à 246**. Le fameux +21,3° comparait une mesure à une extrapolation prise à
8,5° d'un point de branchement.

⚠️ **Ce n'est donc pas « Lightroom se décale de 21° sur le bleu ».** À
mi-saturation, h220 rend **+2,0°**. L'anomalie était la mienne.

## 3. Ce que trois réfutations ont démoli

Quatre hypothèses explorées en parallèle, chacune passée devant un réfuteur tenu de
la reproduire avant de l'accepter. **Trois n'ont pas tenu.**

**L'écrêtage de gamut (réfutée).** Le test « retirer les niveaux écrêtés » avait une
**puissance nulle** sur h220 : le bloc retiré pèse 16,1 % du poids, donc le
déplacement maximal possible était 10,9° contre 21,3 à expliquer — « inchangé »
était le seul résultat atteignable. Et sa conclusion « l'écrêtage explique 140 et
150 » est un **artefact de déplacement de fenêtre** : retirer les niveaux écrêtés
retire les niveaux bas, l'angle dérive avec le niveau, et dérive × déplacement
prédit +6,0° des +7,7 observés. Il reste 1,7°, sous le plancher de bruit.

⚠️ **Une erreur d'unité d'un facteur 18** y a aussi été trouvée : « les deux roues
sont d'accord à 0,6° » lisait la colonne *teinte impliquée*, pas le résidu. En
degrés de résidu l'écart est de **10,0°** — le gain local de la loi vaut 23,3° par
degré de curseur à cet endroit, et l'inverse écrase 10,0 en 0,6.

**La divergence entre roues (réfutée dans sa cause).** Sa prémisse était fausse : la
roue globale est **plus faible**, pas plus forte (×0,51 et ×0,68). L'écrêtage y est
mort — zéro niveau écrêté côté globale. Le vrai confondant est l'**échantillonnage
en (L, chroma)** : à niveau apparié, la chroma des ombres vaut jusqu'à 2,3× celle
de la globale, et l'angle dépend des deux. Apparié sur les deux, la divergence
tombe de 14,5° à 4,3° et de 10,0° à 3,9°. ⚠️ Mais ce reste de ~4° est mesuré dans
la **seule zone où des paires existent** — la queue éteinte de la roue des ombres.
Le postulat « une seule loi pour les quatre roues » n'est **ni confirmé ni
réfuté** ; il est entamé de 4°, sur deux teintes.

**La dérive des verts (fait juste, cause fausse).** La direction *demandée* est bien
constante le long de la rampe — le réfuteur l'a montré mieux que l'auteur, par
l'angle des deux canaux non écrêtés (dérive −1,54 °/100 quand l'angle OKLab dérive
de +9,9). Mais la signature avancée ne sépare pas les malades des saines : **h180
porte plus de niveaux écrêtés que h140** (164 contre 162) et ne dérive pas.

## 4. Ce qui reste ouvert, et c'est plus grand que prévu

⚠️ **Deux découvertes non demandées disent que le modèle est faux plus
profondément que sa direction de teinte.**

1. **L'angle mesuré dépend de L** — pentes de −8,3 à +12,9 degrés par unité de L
   sur les quatre scènes à roue unique, de signe opposé entre ombres et globale à
   teinte égale. Or un vecteur ajouté en OKLab donne un angle **indépendant de L
   par construction**. Quelque chose d'autre agit. (L'addition en ProPhoto, qui
   l'expliquerait, est réfutée par la mesure — voir §1.)
2. **La chroma ajoutée varie d'un facteur 1,77 selon la teinte** (0,0540 à h220,
   0,0958 à h300) alors qu'une direction UNITAIRE impose l'égalité. Sur cet axe, la
   famille ProPhoto fait **pire que ne rien supposer**. C'est un second chantier,
   indépendant de la loi d'angle, et personne ne l'avait ouvert.

Et l'arbitrage que la campagne rend visible : **aucun triangle de primaires ne
satisfait les deux régions de la roue.** Les primaires ProPhoto explosent à la
teinte 220 (+21 à +30°) là où Rec.2020 et ACEScg la réparent (+2,6 et +3,6°), mais
ces derniers paient −12° sur les teintes 0 et 40. La teinte 0 est d'ailleurs ratée
par les six meilleures familles (−7,5 à −12,6°) avec un écart-type de mesure de
1,7 : un manque structurel, pas du bruit.

## 5. Les sept mesures qui ne sont pas des teintes

⚠️ La campagne en portait **vingt et une**, et les quatre sections ci-dessus n'en
lisent que treize. Les sept autres répondent chacune à une question que le
ticket 06 déclare ouverte (`assets/campagne-a-le-reste.mjs`).

| scène | famille | écart du twin | pire |
|---|---|---|---|
| `st-ombres-sat20` | amplitude | **2,86** | 10,3 |
| `st-h220` (sat 60) | amplitude | 11,86 | 39,9 |
| **`st-ombres-sat100`** | amplitude | **21,48** | **128,4** |
| `cg-fusion-25` | fusion | 4,89 | 24,7 |
| `cg-fusion-75` | fusion | 5,21 | 28,1 |
| `st-balance-m50` | balance | 7,17 | 30,0 |
| `st-balance-p50` | balance | 4,99 | 32,2 |

### La BALANCE est linéaire, et sur l'axe sRGB

Le niveau où les deux teintes du duo se croisent, aux cinq doses désormais
mesurées :

| balance | −100 | −50 | 0 | +50 | +100 |
|---|---|---|---|---|---|
| croisement | 229 | 179 | 128 | 77 | 25 |

Pas d'écart : **50, 51, 51, 52** niveaux par cinquante unités. La linéarité est
exacte, **en niveau sRGB** — un quatrième argument indépendant pour l'axe que la
table avait choisi sur trois.

### L'AMPLITUDE est proportionnelle en bas, et sature en haut

| rapport de chroma | mesuré | attendu si proportionnel |
|---|---|---|
| sat 20 / sat 60 | **0,347** | 0,333 |
| sat 100 / sat 60 | **1,409** | 1,667 |

À basse saturation le modèle est juste à 4 % ; à saturation 100 il **sur-applique
de 18 %**. C'est le premier chiffre qu'on ait sur la loi d'amplitude, que
research/22 §4 nommait comme le chantier suivant.

### ⚠️ Et le pire écart de la campagne dit l'inverse de ce qu'on croit

`st-ombres-sat100` porte 21,48 de moyenne et **128,4 de pire cas**. En l'ouvrant :

| niveau | 96 | 128 | 150 | 158 | 190 |
|---|---|---|---|---|---|
| Lightroom, canal R | **0,0** | **0,1** | **0** | **0,1** | 138 |
| twin, canal R | 55 | 92 | 119 | 129 | 169 |
| chroma Lightroom | 0,1007 | 0,1135 | 0,1201 | **0,1219** | 0,0665 |
| chroma twin | 0,1283 | 0,1103 | 0,0953 | **0,0891** | 0,0612 |

**Lightroom écrête 129 niveaux, le twin 49.** Il laisse le rouge tomber à zéro sur
toute la plage 64–160 pendant que nous le retenons — et sa chroma y est PLUS forte
que la nôtre, pas plus faible. Le rapport global de 1,409 est donc une moyenne qui
mélange deux régimes, et la sur-application du modèle n'est pas uniforme.

⚠️ Ça touche `clipGamut`, introduit précisément parce qu'un écrêtage PAR CANAL
« fait dériver la teinte » — il avait amélioré la parité de 7,50 à 6,51 niveaux. À
saturation 100, Lightroom laisse pourtant un canal entier à zéro. **Fait mesuré, pas
conclusion sur le mécanisme** : il faudra distinguer « Lightroom écrête par canal »
de « Lightroom applique autre chose qui aboutit à R = 0 ».

### La FUSION est convexe

Chroma au niveau 160, le repère de `blendDepth`, aux cinq doses :

| fusion | 0 | 25 | 50 | 75 | 100 |
|---|---|---|---|---|---|
| chroma | 0,0119 | 0,0146 | 0,0161 | 0,0206 | 0,0292 |

La progression **accélère** (+27, +15, +45, +86 en dix-millièmes) : la courbe est
convexe, ce que les trois points d'avant ne pouvaient pas montrer. ⚠️ Le creux
entre 25 et 50 est le seul pas qui ralentit, et le point à 50 vient d'une AUTRE
campagne — à re-mesurer avant d'ajuster une forme dessus.

`temperature-m50` n'appartient pas à ce module : elle nourrit la balance des
blancs, et reste à dépouiller avec sa famille.

## Ce qui n'est pas posé, et pourquoi

**Rien dans `src/`.** La direction ProPhoto gagne d'un facteur 2,4 et ce serait le
plus gros gain jamais mesuré sur ce module — mais :

- elle n'est **pas définie** pour six teintes sur onze (§2), et le résidu dépend
  d'un choix de saturation de lecture qui est un paramètre libre déguisé ;
- le modèle qui l'accueillerait est faux sur deux axes que la campagne vient de
  révéler (§4), dont l'un — l'amplitude — n'a jamais été mesuré ;
- les quatre références `developpement-grading-*` bougeraient pour un modèle dont
  on sait déjà qu'il sera repris.

**Le prochain geste est une mesure, pas un réglage** : la loi d'AMPLITUDE de la
chroma par teinte, que les onze scènes portent déjà et que personne n'a lue.
