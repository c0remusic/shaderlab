# La forme est une pente en lumière linéaire, plus un point noir séparé

Mesuré le 2026-09-21. [research/17](17-la-luminance-des-roues-n-est-ni-lineaire-ni-une-amplitude.md)
avait fermé deux hypothèses et laissé une seule piste ouverte — « une COURBE
portant un terme de point noir séparé », nommée par le brevet B220 du binaire.
Ce document l'éprouve et **l'identifie**. Aucun changement dans `src/` : ce qui
manque pour livrer est nommé au bas de page, et c'est une mesure, pas une décision.

## Ce que les relevés précédents ne pouvaient pas faire

Les trois comparaisons de research/17 posent toutes le poids de plage récupéré du
code en service, puis ajustent une amplitude par-dessus. C'est légitime pour
mesurer l'amplitude du modèle EN SERVICE — le poids récupéré est exactement sa
fonction de plage, et le contrôle d'instrument le prouve à 5,7 × 10⁻¹⁴ niveau.
Ça ne l'est pas pour départager deux FORMES : la table de calibration dit
elle-même de `rangeContrast` que « ce n'est donc pas la forme du binaire, c'est
une forme qui reproduit sa mesure ». Une forme éprouvée à travers le poids d'une
autre éprouve les deux à la fois.

**Premier essai, et il a échoué pour cette raison exacte** : le modèle courbe
monté sur le poids en service rend 1,782 niveau de résidu contre 0,970 au modèle
OKLab ajusté — il PERD, avec deux paramètres contre un
(`assets/courbe-lum-ombres.mjs`). Ce résultat ne dit rien de la forme ; il dit que
la forme et le poids ne sont pas séparables par cette voie.

## 1. Un test qui ne suppose aucun poids

La roue des ombres a été mesurée aux DEUX signes. Quelle que soit la fonction de
plage `w(n)` — inconnue, quelconque — tout opérateur de la forme « quantité Q
décalée de `dose · k · w(n)` » vérifie, à chaque niveau :

```
Q(n, +50) − Q(n)      +k·w(n)
────────────────  =  ────────  =  CONSTANTE, indépendante de n
Q(n, −50) − Q(n)      −k·w(n)
```

`w(n)` se simplifie. Le rapport est donc constant si et seulement si `Q` est la
bonne quantité, et aucun modèle n'y gagne quoi que ce soit à avoir plus de
paramètres. Mesuré sur les 186 niveaux où les deux signes bougent d'au moins un
niveau (`assets/espace-sans-poids.mjs`) :

| quantité Q | rapport moyen | dispersion |
|---|---|---|
| L (OKLab) — en service | −1,034 | 61,9 % |
| lumière linéaire | −1,482 | 119,1 % |
| niveau sRGB | −1,215 | 121,3 % |
| log de la lumière | −0,907 | 46,2 % |
| racine carrée du linéaire | −1,119 | 73,6 % |

**Aucun espace ne rend le rapport plat.** L'opérateur n'est donc pas « un décalage
pondéré », nulle part — et le profil dit comment il dérive : −5,20 au niveau 2,
−1,03 au niveau 48, −0,68 au niveau 200. À dose positive le bas de rampe bouge
cinq fois plus qu'à dose négative ; au milieu les deux s'équilibrent ; en haut le
négatif l'emporte légèrement.

## 2. Notre opérateur ne produit pas cette asymétrie

Contrôle qui manquait au constat ci-dessus : `appliqueLum` est SATURANT
(`h = 1−L` en montant, `h = L` en descendant), donc il produit déjà une asymétrie
de ce sens-là. Le même rapport calculé sur la sortie du twin
(`assets/asymetrie-twin.mjs`) :

| | rapport moyen | écart-type |
|---|---|---|
| Lightroom | −1,0335 | **0,6401** |
| nous | −1,0149 | **0,0336** |

**Notre opérateur est quasi symétrique ; Lightroom dérive d'un facteur 7.** La
saturation exponentielle va dans le bon sens et vaut 19 fois trop peu. C'est une
propriété de forme, et aucune amplitude ne l'achète — ce qui explique pourquoi
tous les ajustements à un paramètre plafonnent autour d'un niveau de résidu.

## 3. La forme, lue au lieu d'être ajustée

`assets/forme-lum-ombres.mjs` imprime la transformation mesurée sous trois
lectures et laisse la forme se désigner. À dose NÉGATIVE :

| niveau | 1 | 2 | 3 | 4 | 6 | 8 | 12 | 16 | 32 |
|---|---|---|---|---|---|---|---|---|---|
| `lin_sortie / lin_entrée` | 0,5318 | **0,5000** | 0,5341 | **0,5000** | **0,5000** | 0,5102 | 0,5115 | 0,5170 | 0,5547 |

Exactement 0,5000 aux niveaux 2, 4 et 6 — les écarts de 1 et 3 sont de la
quantification sur un niveau de sortie sous 2. **C'est une PENTE en lumière
linéaire.** Et à dose POSITIVE le niveau 0 sort à 14,33, ce qu'une pente ne peut
pas faire : il y a un second terme, un LIFT. Deux termes, une pente et un point
noir — ce que le brevet B220 nomme « color curve slopes ».

⚠️ **Le témoin a été contrôlé avant tout ça** : la campagne Détail avait mesuré
une dérive de ×1,004 sur les exports de Lightroom. Sur cette rampe, le témoin
s'écarte au plus de **0,032 niveau** (au niveau 8). La forme lue n'est pas une
dérive d'export.

## 4. L'extraction suppose une forme — alors on la retourne contre elle

Une pente laisse le poids se lire directement, à une constante près :
`w(n) = (rapport(n) − 1) / (g − 1)`. Mais un OFFSET en lumière linéaire le
laisserait tout autant, avec un profil différent. Les deux extractions sont donc
faites sur la même rampe, et c'est **la monotonie du profil obtenu qui départage** :
un poids de plage décroît, et celui qui remonte a été extrait sous la mauvaise
forme (`assets/courbe-verdict.mjs`).

| hypothèse sur le signe négatif | remontées | w(4) | w(48) | w(128) |
|---|---|---|---|---|
| **pente** : `lin·(1 + w(g−1))` | **15** | 1,0000 | 0,7677 | 0,1138 |
| offset : `lin − w·c` | 113 | 0,0360 | 0,6737 | 0,7293 |

L'extraction sous offset rend un profil **croissant** — donc pas un poids. La
pente est retenue, et la constante vaut `g = 0,5000` à poids 1.

### Le poids réel de Lightroom est une sigmoïde

| niveau | 4 | 8 | 16 | 32 | 48 | 64 | 96 | 128 | 187 |
|---|---|---|---|---|---|---|---|---|---|
| **Lightroom** | 1,000 | 0,980 | 0,966 | 0,891 | 0,768 | 0,599 | 0,264 | 0,114 | 0,032 |
| en service | 0,941 | 0,886 | 0,783 | 0,609 | 0,471 | 0,365 | 0,223 | 0,144 | 0,068 |

**Plat jusqu'au niveau 16, chute raide entre 32 et 96, queue plus maigre.** Le
nôtre est une puissance : il décroît dès le premier niveau et traîne. Écart
maximal **+0,30 au niveau 48**. C'est un résultat qui dépasse la luminance —
`ws` et `wh` portent aussi la chroma des deux roues de plage.

## 5. Les trois gardes qui ont tué les modèles précédents

**Validation croisée.** Le poids est extrait du signe NÉGATIF seul ; le modèle est
ensuite ajusté et lu sur le signe POSITIF, qui n'a servi à rien dans l'extraction.
Résidu **0,578 niveau contre 3,735** au modèle en service, sur le même domaine.

⚠️ Et le résidu de **0,000** que le signe négatif affiche n'est PAS un résultat :
le poids vient de cette rampe-là, sous cette forme-là. Elle est reproduite par
construction. Seul le signe positif dit quelque chose.

**Écrasement** — le critère qui a fait refuser `k = 0,177`, et qui ne s'achète
avec aucun paramètre. Extrapolation sur la dose : un gain se compose, un lift
s'additionne.

| dose | modèle | niveaux distincts | collés à 0 | plus grand trou |
|---|---|---|---|---|
| +100 | en service | 243 | 0 | **8** |
| +100 | **courbe** | 223 | 0 | **2** |
| +50 | en service | 249 | **1** | 4 |
| +50 | **courbe** | 235 | **0** | 2 |
| −50 | en service | 250 | **2** | 2 |
| −50 | **courbe** | 244 | **1** | 2 |
| −100 | en service | 246 | **4** | 2 |
| −100 | **courbe** | 237 | **2** | 3 |

**La courbe écrase moins que le modèle en service à toutes les doses**, et son
plus grand trou est divisé par quatre à +100. Elle passe la garde qui a refusé la
correction précédente.

**Le bas de rampe**, parce que le résidu moyen est le mauvais objectif —
research/17 l'a établi en refusant `k = 0,177`. On ajuste donc sur les niveaux 0
à 32 et on lit l'erreur sur le haut, qui n'a servi à rien
(`assets/courbe-bas-de-rampe.mjs`).

⚠️ **Une erreur d'instrument corrigée ici** : le domaine d'ajustement venait du
signe négatif, où le niveau 0 ne bouge pas. **Le point qui porte toute la question
depuis le début était exclu de l'ajustement.**

| ajusté sur | g | b | résidu BAS (0-32) | résidu HAUT |
|---|---|---|---|---|
| le BAS | 1,690 | 4,73 × 10⁻³ | **0,357** | 2,276 |
| toute la rampe | 1,405 | 6,98 × 10⁻³ | 1,720 | **0,413** |
| en service | — | — | **8,891** | 2,827 |

| niveau | 0 | 1 | 2 | 4 | 8 | 16 | 32 |
|---|---|---|---|---|---|---|---|
| Lightroom | **14,33** | 15,36 | 16,55 | 18,73 | 23,26 | 30,75 | 45,63 |
| en service | **0,16** | 3,59 | 5,68 | 9,20 | 14,60 | 22,29 | 37,30 |
| **courbe (bas)** | **14,87** | 16,14 | 17,33 | 19,55 | 23,23 | 30,31 | 46,19 |

Aucun arbitrage à rendre : **le compromis ajusté sur le bas bat le modèle en
service sur les DEUX domaines** (0,357 contre 8,891, et 2,276 contre 2,827). Le
niveau 0 passe de 0,16 à 14,87 pour 14,33 mesuré.

## Ce qui manque pour livrer, et c'est une mesure

Trois choses, et aucune n'est une décision à prendre :

1. **Le haut de rampe demande `g` = 1,405, le bas 1,690** — 20 % d'écart. Une
   affine ne tient pas les deux bouts exactement. Le brevet dit « slopes », au
   pluriel : la pente varie probablement, et une seule rampe par signe ne dira pas
   comment.
2. **`g(+50)` et `g(−50)` ne sont pas réciproques.** Imposer `g(+) = 1/g(−)` coûte
   **3,594 niveaux** de résidu. Ce sont donc deux constantes, ou un terme de plus.
3. ⚠️ **Et surtout : trois roues sur quatre n'ont qu'UN signe mesuré.** Le poids
   ne s'extrait que du signe NÉGATIF — c'est là que le lift est nul et que la
   pente se lit seule. Les roues moyens, hautes lumières et globale n'ont que leur
   `+50`. Poser ce modèle sur les quatre roues en n'ayant mesuré le poids que des
   ombres serait exactement le geste que ce dossier refuse depuis le début.

**La campagne qui débloque est donc précise** : `Luminance` **−50** sur les roues
moyens, hautes lumières et globale, sur la MIRE. Trois mesures, et elles rendent
trois profils de poids que rien d'autre ne peut donner. À armer quand la campagne
Détail aura rendu ses exports — `shaderlab-mesures-go.txt` ne tient qu'une photo,
et la campagne Détail porte `DSCF5171.JPG`.

⚠️ **Rien n'est posé dans `src/` avant ces trois mesures.** Le modèle est
identifié et il domine sur la roue des ombres ; l'appliquer aux trois autres avec
le poids des ombres substituerait une forme mesurée sur une roue à une forme
modélisée sur quatre, ce qui n'est pas un progrès mesuré. Les quatre références de
pixels `developpement-grading-*` ne bougent pas aujourd'hui.

## Ce que ce relevé ferme

La question « quelle FORME » est close pour la roue des ombres : **pente en
lumière linéaire, plus un point noir séparé qui ne sert qu'à la montée**, sur un
poids de plage en sigmoïde et non en puissance. Elle n'est plus une piste, elle
est mesurée, discriminée contre son alternative et validée en croisé.

Reste la roue des HAUTES LUMIÈRES, toujours dehors pour la raison déjà connue :
ses deux mesures d'amplitude donnent 0,1798 et 0,0148, son poids est non monotone,
et son signe négatif est justement l'une des trois mesures qui manquent.
