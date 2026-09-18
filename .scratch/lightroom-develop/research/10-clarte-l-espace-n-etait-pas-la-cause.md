# Clarté profonde, seconde tentative — l'espace de travail n'était PAS la cause

Status: ready-for-agent
Type: research

Mesuré le 2026-09-18. Instruments : `assets/mesure-presence-shaderlab.mjs`,
`assets/comparer-presence.py`, mire de présence 2048 × 7584.

## Ce qui était à éprouver

[`07`](07-portee-des-operateurs-locaux.md) rapporte une première section
profonde, écrite le 2026-09-17 puis NON livrée : elle rendait le gain plat sur
toute l'échelle (écart 0,240 → 0,009) mais **écrasait les noirs** — l'aplat 32 se
déplaçait de −32 quand Lightroom rend −2,66. Et elle nommait une cause probable :

> Notre facteur est multiplicatif sur la luminance (`(lp + g)/lp`), donc quand le
> flou profond dépasse largement un pixel sombre, `g` devient assez négatif pour
> annuler le facteur. […] La retenue de leur opérateur dans les noirs vient donc
> d'ailleurs qu'une borne sur l'amplitude : **probablement de l'espace de travail,
> comme Texture qui travaille en racine et n'a pas ce problème.**

Hypothèse testable, et testée : même profondeur (jusqu'à 1/128, par la section
exposée de `1254ade`), Clarté réécrite en espace **racine** —
`dY = dose · k · (y − yProfond)`, retour par la dérivée `dy/dl = 1/(2y)`,
exactement la chaîne de Texture.

## Résultat : REFUTÉE, au chiffre près

| Clarté +100 | Lightroom | nous, profond LINÉAIRE (07) | nous, profond RACINE |
|---|---|---|---|
| aplat 32 | **−2,66** | −32 | **−32,00** |
| aplat 128 | −19,59 | — | −2,59 |
| aplat 224 | +2,68 | — | +18,65 |

Le même nombre, à la décimale. L'espace de travail ne change rien à ce défaut :
en racine comme en linéaire, l'aplat 32 est poussé à zéro. Le calcul le dit
d'ailleurs sans ambiguïté — à l'aplat 32, `y = 0,120` et le flou profond de la
mire vaut `yProfond ≈ 0,46`, donc `(y − yProfond) = −0,34` et
`2y·dY = −0,074` contre une luminance de `0,0144`. Le facteur part négatif quel
que soit l'espace, parce que **c'est l'ÉCART au flou profond qui est grand, pas
la façon de l'appliquer.**

Ce que la tentative confirme par ailleurs, et qui reste vrai : le gain devient
**plat sur toute l'échelle** (1,94 de la période 3 à 256, là où la version courte
tombe à 1,27 à 256), et le ton, Texture et le voile ne bougent pas — `auxPass`
leur rend bien la section moyenne intacte.

## Ce que la mesure dit à la place, et c'est neuf

Les quatre doses, côte à côte, sur les trois aplats :

| dose | aplat 32 | aplat 128 | aplat 224 |
|---|---|---|---|
| Clarté −100 | LR +2,71 / nous **+27,91** | LR +7,77 / nous +2,30 | LR −5,12 / nous **−20,83** |
| Clarté −50 | LR +1,62 / nous +16,16 | LR +4,65 / nous +1,19 | LR −2,96 / nous −10,07 |
| Clarté +50 | LR −1,34 / nous **−31,30** | LR −10,13 / nous −1,25 | LR +1,39 / nous +9,60 |
| Clarté +100 | LR −2,66 / nous **−32,00** | LR **−19,59** / nous −2,59 | LR +2,68 / nous **+18,65** |

⚠️ **LE PROFIL EST INVERSÉ, et c'est le vrai constat de cette campagne.**
Lightroom déplace **l'aplat MOYEN le plus** (−19,59) et les deux extrêmes très
peu (−2,66 et +2,68). Nous déplaçons **les extrêmes le plus** (−32 et +18,65) et
le moyen le moins (−2,59). Ce n'est pas une erreur d'amplitude ni de signe : les
deux opérateurs sont maximaux là où l'autre est minimal.

Et c'est exactement la signature de la FORME que nous employons. Un terme en
`(pixel − moyenne profonde)` vaut zéro là où le pixel vaut la moyenne — le mi-ton
— et croît vers les extrêmes. Le profil de Lightroom est l'opposé : maximal au
mi-ton, s'éteignant aux deux bouts, avec un changement de SIGNE entre 128 et 224.

**Conclusion : la composante large de Clarté chez Lightroom n'est PAS un
contraste contre un flou profond.** Aucun réglage d'amplitude, d'espace ou de
profondeur ne transformera une courbe maximale aux extrêmes en une courbe
maximale au centre. C'est la forme qui est fausse, pas ses constantes.

Ce que le profil évoque, et qui reste à éprouver : une pondération en CLOCHE sur
le ton, du genre que ce module porte déjà pour Hautes lumières / Ombres
(`rb_ligne_poids`) et Blancs / Noirs (`rb_bump`). Le changement de signe vers 224
suggère en plus un pivot. Deux pistes, dans cet ordre :

1. **Fitter la forme sur les trois aplats et les quatre doses** avant d'écrire une
   ligne de shader — huit points suffisent à distinguer une cloche d'une rampe, et
   la campagne est déjà au disque.
2. **Miner le binaire pour la pondération**, comme pour le reste du module :
   `cr_stage_localized_detail_clarity_mask` est nommé, son voisinage ne l'a pas
   encore été. La consigne permanente vaut ici plus qu'ailleurs — le binaire donne
   la FORME, la mesure donne les AMPLITUDES, et c'est précisément une FORME qui
   manque.

## État du code

**Rien n'est livré, et `src/` est revenu à `1254ade`.** Ce qui EST livré et le
reste :

- le **troisième canal** de la pyramide (écart-type local de `y`), posé et
  mesuré — 0,00 sur un aplat, 50 sur un réseau au même ton
  ([`09`](09-le-canal-de-detail.md)) ;
- la section moyenne **exposée** en `auxPass` (`1254ade`), qui lève la limite de
  structure : une section profonde peut désormais se poser sans emporter la
  profondeur calibrée de Texture.

Les deux sont bit-exacts et gardent leur valeur quelle que soit la forme qu'on
donnera à Clarté. Ce qui est écarté, c'est la seule chose qui l'était déjà à
moitié : **le flou profond comme référence de contraste**.

## Piège d'instrument

⚠️ La section profonde ne change RIEN au gain si on ne vérifie pas qu'elle
tourne : elle est conditionnée à `clarity !== 0` et, toutes passes sautées,
`prevPass` vaut la section moyenne. Le témoin qui l'atteste est le gain à la
période 256 — 1,27 sans la section, 1,94 avec. Un aplat déplacé ne le dit pas,
un réseau lointain si.
