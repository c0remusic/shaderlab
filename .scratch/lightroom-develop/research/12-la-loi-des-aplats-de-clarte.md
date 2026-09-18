# La loi du déplacement d'aplat de Clarté — et pourquoi la mire de présence pouvait seule la donner

Status: ready-for-agent
Type: research

Lu le 2026-09-18 dans les relevés existants (`research/mesures-presence/bit-*.json`,
et les déplacements d'aplat de `assets/comparer-presence.py`). Aucun rendu neuf :
tout était au disque, sous un autre angle.

[`11`](11-clarte-est-un-gain-de-tone-map.md) établit par le binaire que Clarté est
un GAIN de tone map (famille de Hautes lumières / Ombres) piloté par un masque de
DÉTAIL, sans pondération par la luminance — puis mesure que ce masque, seul, ne
peut pas porter le profil des aplats. Il laisse deux hypothèses. Les deux sont
maintenant tranchées.

## Hypothèse 2 : CONFIRMÉE — la gâchette est le détail, pas le ton

Mire BI-TONALE : deux aplats, 96 et 160, **aucun détail nulle part**. Lightroom,
Clarté **+100** (`bit-clarte-p100.json` contre `bit-temoin.json`) :

| | témoin | Clarté +100 | déplacement |
|---|---|---|---|
| aplat 96 | 96,000 | 95,815 | **−0,185** |
| aplat 160 | 160,000 | 160,000 | **0,000** |

**Sans détail dans l'image, Clarté ne déplace RIEN** — deux dixièmes de niveau,
soit le bruit de l'instrument. Sur la mire de PRÉSENCE, dont les aplats sont
entourés de réseaux, la même dose déplace de −2,66 / −19,59 / +2,68.

C'est la preuve directe de ce que `07` déduisait et que le binaire nommait
(`cr_stage_localized_detail_clarity_mask`) : **le déplacement d'aplat est
conditionné à la présence de détail dans l'image**, et il ne dépend pas du seul
ton du pixel. Un aplat isolé est inerte ; le même aplat au milieu de matière
bouge.

⚠️ **Et c'est pourquoi la mire bi-tonale ne pouvait pas donner la loi** : elle
éteint l'opérateur. Seule la mire de présence, qui met des aplats DANS de la
matière, pouvait la faire apparaître. C'est le même piège que « une marche entre
deux aplats ne mesure pas un opérateur gaté par le détail » (07) — payé une
seconde fois, dans l'autre sens.

## La loi, ajustée sur les quatre doses et les trois aplats

Déplacements convertis en gain LINÉAIRE puis en `log2(gain)`, et rapportés à la
forme `−s(1−s)` (`s` = ton sRGB de l'aplat) :

| dose | base | octets | gain | log2(gain) | `−s(1−s)` | rapport |
|---|---|---|---|---|---|---|
| **+100** | 32 | −2,66 | 0,8669 | −0,2061 | −0,1097 | **1,878** |
| **+100** | 128 | −19,59 | 0,7003 | −0,5139 | −0,2500 | **2,056** |
| +100 | 224 | +2,68 | 1,0272 | +0,0388 | −0,1068 | −0,363 |
| **+50** | 32 | −1,34 | 0,9315 | −0,1023 | −0,1097 | **0,932** |
| **+50** | 128 | −10,13 | 0,8373 | −0,2562 | −0,2500 | **1,025** |
| +50 | 224 | +1,39 | 1,0141 | +0,0202 | −0,1068 | −0,189 |
| −50 | 32 | +1,62 | 1,0866 | **+0,1198** | −0,1097 | −1,091 |
| −50 | 128 | +4,65 | 1,0804 | **+0,1115** | −0,2500 | −0,446 |
| −100 | 32 | +2,71 | 1,1472 | **+0,1981** | −0,1097 | −1,805 |
| −100 | 128 | +7,77 | 1,1364 | **+0,1844** | −0,2500 | −0,738 |

Trois lectures, et elles sont nettes.

**1. Clarté POSITIVE suit une parabole du ton, linéaire en dose.**

```
log2(gain) = −K · (clarte / 100) · s · (1 − s)     avec K ≈ 2,0
```

Le rapport vaut 1,878 et 2,056 à +100, puis 0,932 et 1,025 à +50 — c'est-à-dire
**exactement la moitié**, sur deux bases très éloignées. La dose est linéaire et
la forme est la même aux deux. `s(1−s)` s'annule au noir et au blanc et culmine
au mi-ton : c'est la courbe que `10` cherchait, et c'est l'inverse exact d'un
terme en `(pixel − flou profond)`.

**2. Clarté NÉGATIVE n'a PAS cette forme — elle est un gain UNIFORME.** À −50,
`log2(gain)` vaut +0,1198 à la base 32 et +0,1115 à la base 128 : deux tons dont
`s(1−s)` diffère d'un facteur 2,3, et le gain est le même à 7 % près. À −100 :
+0,1981 et +0,1844. **Le côté négatif est une simple levée, pas une cloche.**
L'asymétrie par signe est courante dans ce module — Blancs et Noirs en portent
déjà une (`RB_BLACK_AMT_NEG/POS`).

**3. La base 224 est hors loi dans les DEUX sens** (rapports −0,363 et −0,189 à
dose positive, +0,406 et +0,705 à dose négative) : son déplacement a le signe
opposé aux deux autres. Elle est à 0,73 de luminance linéaire, donc près de
l'écrêtage, et son gain n'est même pas linéaire en dose (+0,0202 à +50 contre
+0,0388 à +100, soit 1,9× pour 2× de dose — mais dans l'autre sens, +0,0494
calculé à mi-dose sur une autre conversion). **À traiter comme un effet de
rolloff de hautes lumières, pas comme un terme de Clarté**, et à ne PAS ajuster
tant qu'une mesure dédiée ne l'aura pas isolé.

## Ce que ça donne à écrire

```
// GÂCHETTE : rien sans détail dans l'image (mire bi-tonale, −0,185 niveau).
// FORME    : parabole du ton à dose positive, gain uniforme à dose négative.
dLogClarte = select(
  kClarte * RB_CLARITY_LIFT,                      // dose < 0 : levée uniforme
  -kClarte * RB_CLARITY_BELL * s * (1.0 - s),     // dose > 0 : cloche du ton
  kClarte >= 0.0);
gainTon = exp2(dLogSh + dLogHl + dLogClarte * gateDetail);
```

avec, d'après ce tableau, `RB_CLARITY_BELL ≈ 2,0` et `RB_CLARITY_LIFT ≈ 0,19`
(les deux à |dose| = 1), et `gateDetail` la présence de détail — le canal `b` de
la pyramide, qui vaut **0,00 sur un aplat isolé** et 4 à 7 quand du détail
l'entoure ([`11`](11-clarte-est-un-gain-de-tone-map.md)).

⚠️ **La normalisation de `gateDetail` n'est PAS déterminée par ces chiffres.**
La loi ci-dessus est ajustée sur une seule image, où la présence de détail est
à peu près constante ; elle dit la FORME en ton et l'AMPLITUDE à ce niveau de
détail, pas comment le gain varie quand le détail change. Deux jeux existent pour
le mesurer et n'ont pas été lus sous cet angle : la zone PORTAIL (détail d'un
seul côté, même ton) et la mire bi-tonale (détail nul, gain nul — le seul point
d'ancrage certain). C'est le prochain chiffre à prendre, avant toute ligne de
shader.

## Ce qui ne bouge pas

`src/` est à `bfe5dd9`. Rien de cette loi n'est implémenté. Ce qui est livré et
le reste : le troisième canal ([`09`](09-le-canal-de-detail.md)) et la section
moyenne exposée (`1254ade`) — les deux bit-exacts, et les deux nécessaires à la
forme ci-dessus.

Ce qui est définitivement ÉCARTÉ, et il ne faut pas y revenir sans mesure neuve :
le flou profond comme référence de contraste pour la composante large de Clarté
([`10`](10-clarte-l-espace-n-etait-pas-la-cause.md), deux fois écrit, deux fois
retiré).
