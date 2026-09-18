# Clarté est un GAIN de tone map piloté par un masque de détail — le binaire le dit

Status: ready-for-agent
Type: research

Miné le 2026-09-18 sur `C:\Program Files\Adobe\Adobe Lightroom Classic\CameraRaw.dll`
(14.5.1, 145 Mo), décodage `latin-1` + regex, jamais de boucle par octet.
Instruments : `assets/miner-clarte.py`, `assets/miner-tonemap.py`.

[`10`](10-clarte-l-espace-n-etait-pas-la-cause.md) conclut que **c'est la FORME de
notre Clarté qui est fausse, pas ses constantes** : le déplacement d'aplat de
Lightroom est maximal au mi-ton et s'éteint aux deux bouts, le nôtre fait
exactement l'inverse, et aucun réglage ne retourne une courbe. Elle renvoie à la
consigne permanente — le binaire donne la FORME, la mesure donne les AMPLITUDES.
Le binaire l'a donnée.

## La pièce

`uGlobalAmtClarity` ne vit pas dans un bloc à part. Il vit dans **`UniformsToneMap`**,
au milieu de `uGlobalAmtHighlights` et `uGlobalAmtShadows` — la machinerie que ce
dépôt a déjà calibrée (`rb_ligne_poids`, gain en `exp2`). Les trois familles, côte
à côte, telles qu'elles sortent du binaire :

| | montant global | a un local | pas du masque | LIGNE de luminance | POIDS de luminance |
|---|---|---|---|---|---|
| Hautes lumières | `uGlobalAmtHighlights` | `uHasLocalHighlights` | `uLocalHighlightsMask{Row,Col}Step` | `uLineHighlightOffset/Scale` | `uLumWeightHighlightOffset/Scale` |
| Ombres | `uGlobalAmtShadows` | `uHasLocalShadows` | `uLocalShadowsMask{Row,Col}Step` | `uLineShadowOffset/Scale` | `uLumWeightShadowOffset/Scale` |
| **Clarté** | `uGlobalAmtClarity` | `uHasLocalClarity` | `uLocalClarityMask{Row,Col}Step` | **AUCUN** | **AUCUN** |

Vérifié par recherche explicite : `u?Line[A-Za-z]*Clarity`,
`u?LumWeight[A-Za-z]*Clarity`, `u?Clarity[A-Za-z]*(Line|LumWeight|Offset|Scale|Pivot|Center)`
ne rendent **rien** dans les 145 Mo.

Et la chaîne qui fabrique son masque est nommée en entier :

```
cr_stage_localized_detail
cr_stage_localized_detail_blur_input
cr_stage_localized_detail_blur_temp
cr_stage_localized_detail_clarity_blur
cr_stage_localized_detail_clarity_mask
cr_stage_localized_detail_sharpness_mask
cr_stage_localized_detail_processed
dummy_clarity_mask
```

plus `cr_clarity.cpp`, `cr_stage_local_contrast`, `cr_stage_LocalContrastY`,
`ComputeLocalContrastMask`, `ComputeOutputLocalContrastMask`, `LocalClarity2012`.

## Ce que ça dit, et ce que ça CORRIGE chez nous

**1. Clarté est le TROISIÈME membre de la famille Hautes lumières / Ombres.**
Même étage (le tone map), même structure d'uniformes : un montant GLOBAL, un
drapeau de présence d'un masque, et les pas de lecture de ce masque. Pas un
opérateur de contraste local rangé à part.

**2. Clarté n'a AUCUNE pondération par la luminance.** Hautes lumières et Ombres
en ont deux chacune (une ligne, un poids) ; Clarté n'en a zéro. Toute sa
modulation spatiale vient de son MASQUE, et ce masque est fabriqué par l'étage
`localized_detail` — c'est-à-dire par la **présence de détail**, exactement ce que
[`07`](07-portee-des-operateurs-locaux.md) avait déduit de la mire PORTAIL et ce
que le troisième canal de notre pyramide mesure depuis
[`09`](09-le-canal-de-detail.md).

**3. Et c'est ce qui explique enfin le profil inversé du `10`.** Hautes lumières
et Ombres s'appliquent chez nous comme un **gain en `exp2`** sur la lumière
linéaire (`gainTon = exp2(dLogSh + dLogHl)`). Un gain multiplicatif déplace un
aplat d'autant moins que l'aplat est sombre — près du noir, la luminance
elle-même est minuscule — et d'autant moins qu'il est clair, la courbe sRGB y
étant plate. **Son déplacement en niveaux est maximal au mi-ton**, ce qui est
précisément la signature de Lightroom (−2,66 / −19,59 / +2,68 aux bases
32 / 128 / 224). Notre Clarté, elle, est un terme ADDITIF en `(pixel − flou)`,
nul au mi-ton et maximal aux extrêmes : l'autre famille, l'autre courbe.

Nous n'avons donc pas un mauvais rayon ni un mauvais espace. **Nous avons rangé
Clarté dans la mauvaise famille.**

## La forme à écrire

```
dLogClarte = (clarity / 100) * CLARITY_AMT * masqueDetail
gainTon    = exp2(dLogSh + dLogHl + dLogClarte)
```

— au même endroit que Hautes lumières et Ombres, avant Exposition et Contraste,
et **sans** pondération par `blurLuma` (le binaire est formel : Clarté n'en a
pas). Le `masqueDetail` est la présence de détail au grand rayon : le canal `b`
de la section profonde de la pyramide.

Les deux pièces existent déjà et sont livrées :

- le **troisième canal** (écart-type local de `y`), mesuré à 0,00 sur un aplat et
  50/255 sur un réseau au même ton ([`09`](09-le-canal-de-detail.md)) ;
- la section moyenne **exposée** en `auxPass` (`1254ade`), qui laisse la chaîne
  descendre plus profond sans emporter la profondeur calibrée de Texture.

Il manque la section profonde (écrite, mesurée et retirée deux fois — voir `10` —
mais pour la formule qu'elle alimentait, pas pour elle-même) et la calibration de
`CLARITY_AMT` et de la normalisation du masque.

⚠️ **Ce qui reste INDÉTERMINÉ, et qu'il ne faut pas inventer :** le signe. À
Clarté +100, Lightroom ASSOMBRIT les bases 32 et 128 mais ÉCLAIRCIT la base 224
(+2,68). Un gain unique ne change pas de signe ; il y a donc soit un masque
signé, soit une normalisation du masque par sa moyenne, soit un second terme. Le
binaire ne le dit pas dans les noms d'uniformes, et les quatre doses × trois
aplats de la campagne de présence sont au disque pour le trancher par le fit —
c'est une AMPLITUDE (et un signe), donc c'est à la mesure de répondre, pas au
binaire.

## ⚠️ Le masque mesuré NE SUFFIT PAS — mesuré le jour même

La forme ci-dessus se teste avant de s'écrire : si le gain est proportionnel au
masque de détail, alors le masque doit varier aux trois aplats comme le gain de
Lightroom. Mesuré par `assets/masque-aux-aplats.mjs` — section profonde ajoutée
**dans la page** (`mod.passes`, aucun fichier touché), sortie détournée sur le
retour final, mire de présence :

| sortie | base 32 | base 128 | base 224 |
|---|---|---|---|
| détail MOYEN (`auxPass.b`) | **0,00** | **0,00** | **0,00** |
| détail PROFOND (`prevPass.b`) | 6,75 | **4,00** | 4,60 |
| luminance profonde (`prevPass.r`) | 105,42 | 139,38 | 205,56 |
| témoin (`color`) | 32,00 | 128,00 | 224,00 |
| **gain visé (Lightroom, Clarté +100)** | **0,855** | **0,700** | **1,030** |

Deux lectures, et la seconde ferme la piste telle quelle :

✅ **Le canal se comporte exactement comme conçu.** Le détail MOYEN vaut zéro aux
trois aplats — un aplat n'a pas de détail local, et le canal le dit. Le détail
PROFOND, lui, ramasse le voisinage et vaut 4 à 7. C'est la confirmation
indépendante de [`09`](09-le-canal-de-detail.md).

❌ **Mais le masque ne peut pas porter le profil.** Il faudrait qu'il soit
MAXIMAL à la base 128, là où Lightroom agit le plus fort (gain 0,700) ; il y est
**MINIMAL** (4,00 contre 6,75 et 4,60). Et il est positif partout, donc il ne
peut produire aucun changement de signe. Un gain proportionnel à ce masque
donnerait l'ordre inverse de celui qu'on vise.

**Conclusion.** La FAMILLE est établie par le binaire — Clarté est un gain de
tone map, pas un terme additif de contraste. La MODULATION, elle, n'est pas
expliquée par le masque de détail au grand rayon : il existe une dépendance au
TON que les noms d'uniformes n'exposent pas. Deux hypothèses restantes, et
aucune n'est tranchée :

1. la pondération tonale est **cuite dans le shader du masque**
   (`cr_stage_localized_detail_clarity_mask`), donc sans uniforme à trouver — il
   faudrait lire le DXBC du noyau, pas ses noms ;
2. le déplacement des aplats ne vient pas du tone map mais de l'étage
   `cr_stage_local_contrast`, dont le voisinage de chaque aplat diffère sur cette
   mire — auquel cas la mire de présence n'est pas l'instrument, et il faut une
   mire où un aplat est ISOLÉ.

La seconde se teste à peu de frais : la mire BI-TONALE existe déjà (deux aplats,
aucun détail nulle part) et Lightroom n'y fait presque rien. Si le déplacement
d'aplat disparaît quand le voisinage n'a plus de détail, c'est l'hypothèse 2 ; la
mesure est au disque, elle n'a pas encore été lue sous cet angle.

## Ce qui ne bouge pas

Rien n'est livré par ce fichier ; `src/` est à `2d7fdb2`. La bande MOYENNE de
Clarté (notre terme actuel) reste en place : le binaire ne l'infirme pas — `07`
mesure bien une composante courte et absolue à côté de la large, et
`cr_stage_local_contrast` existe à côté du masque. Ce que ce fichier remplace,
c'est la **composante LARGE**, celle qui devait déplacer les aplats et n'y
arrivait que dans le mauvais sens.

## Reproduire

```
python .scratch/lightroom-develop/assets/miner-clarte.py symboles
python .scratch/lightroom-develop/assets/miner-clarte.py voisinage uGlobalAmtClarity 900
python .scratch/lightroom-develop/assets/miner-tonemap.py
```
