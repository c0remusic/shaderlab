# La Balance n'est pas en cause : c'est la direction de teinte

Mesuré le 2026-09-23. [research/20](20-la-cloche-ne-transfere-pas-et-ce-qu-elle-a-trouve-a-la-place.md)
concluait que le pire cas des treize mesures « vit dans ce que la Balance fait à
`alpha` ». **C'est faux, et voici la mesure qui le dit.** Aucun changement dans
`src/`.

## Ce que la piste promettait

`st-balance-p100` porte le pire cas des treize mesures (41,0) depuis le début,
`st-balance-m100` la pire moyenne (11,47), et research/20 avait montré que
n'importe quelle forme bornée en haut de rampe divisait le pire cas par 2,7. Un
défaut qu'on soulage sans le viser est un symptôme — la piste était bonne.

Elle était aussi la seule à ne dépendre ni de la campagne F ni du modèle courbe.

## 1. Une erreur d'instrument, attrapée par son propre contrôle

Premier instrument : résoudre le système `chroma = chromaK·sat·(dSh·ws + dH·wh)`
pour extraire les deux poids à chaque niveau. Deux équations, deux inconnues, le
partage se résout au lieu de s'ajuster.

Il rendait des poids **négatifs, jusqu'à −2,9**, et `ws` ≈ 0,7·`wh` partout.

Le contrôle l'a refusé : relire les poids du TWIN sur la sortie du TWIN, où la
réponse est connue exactement, donne **0,21 d'écart sur `ws` et 0,44 sur `wh`**.
Deux causes, chacune suffisante :

1. `clipGamut` réduit la chroma **après** le mélange — la chroma de sortie n'est
   donc plus la somme pondérée des deux roues ;
2. les deux teintes du duo (bleu 220, orange 40) sont à **170,63°** l'une de
   l'autre : conditionnement **12,2**, donc la quantification 8 bits de ±0,5
   niveau ressort à ±6,1 sur les poids.

⚠️ **Le déterminant valait 0,163 et avait l'air sain.** Pour deux vecteurs
unitaires il vaut `sin(angle)`, donc il reste gros quand les directions sont
presque OPPOSÉES — exactement le cas ici. Le garde-fou que j'avais écrit testait
le déterminant ; c'est le **conditionnement** qu'il fallait regarder. L'instrument
suivant ne résout plus rien : il compare la chroma mesurée à celle du twin en
module et en angle, deux lectures directes, et `clipGamut` s'applique des deux
côtés puisque le twin passe par le même code.

## 2. Ce n'est pas un partage qui dérive, c'est un plateau

La « part hautes » — 0 = teinte des ombres pure, 1 = celle des hautes — lue en
angle, donc insensible à l'amplitude et à l'écrêtage :

| `st-balance-m100`, niveau | 8 | 48 | 96 | 128 | 160 | 190 | 220 |
|---|---|---|---|---|---|---|---|
| mesurée | −0,173 | −0,222 | −0,212 | −0,214 | −0,202 | −0,195 | −0,132 |
| en service | 0,000 | 0,000 | 0,001 | 0,002 | 0,004 | 0,011 | 0,068 |

**−0,21 ± 0,01 du niveau 8 au niveau 190.** Une part constante et hors [0, 1]
n'est pas un défaut de partage : c'est un **biais d'angle fixe**. Et le croisement
mesuré à Balance +100 tombe au niveau **34** quand le nôtre est entre 24 et 48 —
le point de bascule est juste, `balanceMid` aussi. **La piste est réfutée.**

## 3. Les scènes de Balance extrême MESURENT, elles ne sont pas un défaut

À Balance −100 tout est ombre : la chroma de la rampe est celle de la roue des
ombres seule sur presque toute sa longueur. À +100, celle des hautes. Ces deux
scènes **isolent** donc une teinte chacune — et trois scènes simples n'activent
qu'une roue par construction. Cinq scènes, trois teintes, **deux chemins
indépendants pour le bleu et l'orange**.

| scène | teinte | niveaux lus | angle mesuré | angle calculé | écart | écart-type |
|---|---|---|---|---|---|---|
| `st-ombres-bleu` | 220 | 107 | −128,03° | −97,36° | **−30,67°** | 4,19° |
| `st-balance-m100` | 220 | 197 | −132,56° | −97,36° | −35,19° | 2,26° |
| `st-hl-orange` | 40 | 92 | 57,50° | 73,27° | **−15,77°** | 2,08° |
| `st-balance-p100` | 40 | 193 | 49,55° | 73,27° | −23,71° | 3,18° |
| `grading-moyens-vert` | 140 | 152 | 155,15° | 145,94° | **+9,21°** | 0,83° |

⚠️ Les deux chemins d'une même teinte s'accordent à 4,5° (bleu) et 7,9° (orange),
pas mieux : dans les scènes de Balance extrême l'autre roue garde un poids petit
mais non nul, donc sa teinte contamine l'angle. **Les mesures PURES sont celles
des trois scènes simples** — une seule roue active, zéro contamination.

### L'instrument reproduit l'inventaire existant

Le ticket 06 porte depuis longtemps « nos directions de teinte sont fausses de
**+15,7°** sur l'orange, **−12,9°** sur le vert, **+26,8°** sur le bleu ». Mes
mesures pures : **−15,77°**, **+9,21°**, **−30,67°**. Signes opposés — convention
inverse — et l'orange coïncide **à 0,07° près**. Deux chemins de mesure
indépendants, le même nombre : l'instrument est validé par l'inventaire, et
l'inventaire par l'instrument.

### Ce qui est neuf : l'angle ne dérive pas avec le niveau

Écart-type de **0,83° à 4,19°** sur 92 à 197 niveaux. La correction est donc une
**rotation par teinte**, pas une fonction du niveau — ce qui restreint la forme de
la loi à chercher, et n'avait jamais été mesuré.

## 4. Le gain est gros, et la loi n'est pas une rotation

Rotation constante appliquée à toutes les directions (look-dev jetable, repris
ensuite) :

| rotation | moyenne des 13 | pire cas |
|---|---|---|
| 0 (en service) | 4,17 | 41,0 (`st-balance-p100`) |
| **−14°** | **3,44** | **30,2** (`st-balance-p100`) |
| −25° | **3,23** | 39,9 (`grading-moyens-vert`) |

**Un seul paramètre fait −17,5 % de moyenne et −26,3 % de pire cas** — de loin le
plus gros gain jamais obtenu sur ce module, où `rangeContrast` valait 3 %.

Mais le détail à −14° interdit de le poser :

| scène | en service | −14° |
|---|---|---|
| `st-balance-m100` | 11,47 | **6,80** |
| `st-balance-p100` | 6,99 (max **41,0**) | **4,73** (max **30,2**) |
| `cg-fusion-100` | 6,35 | 4,15 |
| `cg-fusion-0` | 4,99 | 3,72 |
| `st-duo` | 4,84 | 3,32 |
| `st-ombres-bleu` | 3,62 | 2,15 |
| `st-hl-orange` | 2,15 | 1,56 |
| **`grading-moyens-vert`** | **3,85** | **8,43** |

**Sept scènes améliorées de 30 à 40 %, une dégradée de 119 %** — et c'est celle du
vert, la teinte sur laquelle `chromaK` a été calibré. L'écart **change de signe**
entre le vert (+9,2°) et le bleu/orange (−30,7° et −15,8°) : aucune rotation
constante ne peut satisfaire les trois.

## Ce que ça laisse

**La campagne A est confirmée dans son énoncé, et sa valeur est maintenant
chiffrée par le bas.** Elle demande huit teintes de plus (0, 60, 90, 150, 180,
270, 300, 330) pour identifier la loi ; avec les trois mesurées ici, onze points.
Trois points et trois inconnues s'ajustent exactement sans rien valider — c'est
pourquoi la loi ne se tranche pas aujourd'hui.

Ce que l'on sait désormais, et qui contraint la recherche :

1. l'écart est une **rotation par teinte**, stable sur la rampe (écart-type sous
   4,2°) — pas une fonction du niveau ;
2. il **change de signe** entre 140° et {40°, 220°}, donc la loi s'annule au moins
   deux fois sur le cercle ;
3. le gain à en attendre vaut **au moins** −17,5 % de moyenne et −26,3 % de pire
   cas, puisqu'une rotation constante — que la mesure dit fausse — les obtient
   déjà.

⚠️ **Et `st-balance-p100` n'est plus un défaut à instruire** : son pire cas de 41,0
est celui de la teinte, pas celui de la Balance. Le noter évite qu'il soit
re-diagnostiqué une troisième fois.
