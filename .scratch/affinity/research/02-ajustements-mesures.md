# Les ajustements d'Affinity, mesurés au pixel — la spec du lot « développement »

Relevé le 2026-08-19 au soir, pour l'audit v2. **Tout est mesuré**, rien n'est
déduit d'un nom : mire synthétique posée par `PixelBuffer` (escalier de gris
16 niveaux + nuancier 24 teintes × 4 rangées S/V + rampe de gris 8), ajustement
posé en NŒUD LIVE, paramètres par
`DocumentCommand.createSetXxxAdjustmentParameters(selection, params)` — la
SEULE voie qui écrit vraiment (le setter `node.parameters = p` échoue EN
SILENCE sur plusieurs types, c'est aussi ce qui avait bloqué le
`screenType` du Halftone), `flatten`, lecture `PixelBuffer`, undo.

Objectif : quand le lot « développement » (WhiteBalance, Vibrance, HSL,
SplitToning…) s'implémentera chez nous, la CIBLE comportementale est ici — pas
à re-deviner.

## 1. WhiteBalance `{whiteBalance, tint}` ∈ [−1, 1]²

**Des gains multiplicatifs PAR CANAL (von Kries RGB), constants sur toute la
rampe, sans offset — le noir reste noir, pas de préservation de luminance.**

Rampe de gris, ratios sortie/entrée mesurés (constants de 43 à 250) :

| Réglage | R | G | B |
| --- | --- | --- | --- |
| `whiteBalance +0,5` (chaud) | ×1,145 | ×0,982 | ×0,740 |
| `whiteBalance −0,5` (froid) | ×0,890 | ×1,018 | ×1,190 |
| `tint +0,5` | ×0,945 | ×1,028 | ×0,927 |

Deux faits non devinables :
- **L'asymétrie chaud/froid est réelle** : −0,5 n'est PAS la réciproque de
  +0,5 (1/0,740 = 1,35, mesuré 1,19 — le froid pousse le bleu moins fort que
  le chaud ne le coupe). Une implémentation symétrique naïve ne matchera pas.
- Le vert bouge aussi sur l'axe température (×0,982 à chaud) — l'axe n'est
  pas purement R/B.
- ⚠️ Gain multiplicatif constant en encodé ⇔ constant en linéaire : les deux
  hypothèses rendent le même ratio 8 bits — l'ESPACE du gain reste
  indéterminé par cette mesure. Chez nous : linéaire (la chaîne l'impose), et
  recalibrer les courbes de gain pour matcher ces ratios ENCODÉS.

## 2. Vibrance `{vibrance, saturation}` ∈ [−1, 1]²

**Deux opérateurs distincts dans le même ajustement, et la mesure les sépare
nettement :**

- `saturation` = saturation BRUTE, uniforme : à +1, le rouge S=0,5
  [179,89,89] part à [228,8,63] (poussé à fond, avec dérive de teinte), les
  tons peau [217,163,163] partent à [252,146,149]. Aucune protection.
- `vibrance` = saturation PROTÉGÉE deux fois :
  1. **par teinte — l'axe rouge-orange est quasi exempté** (protection des
     peaux) : à vibrance +1, le rouge S=0,5 [179,89,89] est LITTÉRALEMENT
     INCHANGÉ pendant que le vert S=0,5 [89,179,89] bondit à [0,186,47] ; les
     tons peau S=0,25 bougent à peine ([217,163,163] → [217,163,163] au
     patch rouge) ;
  2. **par saturation existante** : plus c'est déjà saturé, moins ça pousse
     (les rangées S=1 bougent moins en proportion que S=0,5).
- Les NEUTRES sont exactement intacts dans les deux sens (escalier au bit
  près), y compris à vibrance −1.
- `vibrance −1` désature SANS atteindre le gris (le rouge S=1 [230,0,0]
  descend à [181,88,64], pas à [128,128,128]) — un plancher de saturation.

## 3. SplitToning `{highlightsHue, highlightsSaturation, shadowsHue, shadowsSaturation, balance}`

Mesuré à hi=jaune 50°/0,8, sh=bleu 220°/0,8, balance 0,5, sur l'escalier :

- **Noir ET blanc purs INTACTS** ([0,0,0] et [255,255,255] au bit près) — le
  toning est en CLOCHE par bande, pas en rampe jusqu'aux extrêmes.
- Ombres bleuies fort et vite : entrée 17 → [7,15,57] (l'écart bleu est
  massif dès les premières valeurs, +40 sur B pour une entrée à 17 — la
  saturation du toning ne se réduit PAS proportionnellement à la luminance).
- Croisement neutre vers l'entrée ~136 (balance 0,5 → milieu).
- Hautes lumières jaunies doucement : 221 → [227,223,194].

Chez nous : `gradientMap` et `duotone` ne couvrent PAS ça (ils REMPLACENT la
couleur ; le split toning TEINTE en gardant l'image). C'est un effet distinct
et petit (une passe, deux teintes, une balance).

## 4. ShadowsHighlights — l'AJUSTEMENT (2 curseurs) est purement tonal

`{shadows: +1}` : lift des ombres à pivot ~120 — 17→32, 51→66, 85→89,
119→119, et STRICTEMENT rien au-dessus de 136. Courbe douce bornée, aucune
composante locale (sur une mire à grandes cases, un opérateur local serait
inerte au centre — ici il n'y a QUE du tonal). La version LOCALE est le
FILTRE `ShadowsHighlights` (7 champs dont `shadowsRadius`/`highlightsRadius`
et `version: Default|V16`) — deux produits distincts sous un même nom, à ne
pas confondre le jour où on s'en inspire.

## 5. ToneCompression — méthode Filmic (une des HUIT)

`{method: Filmic, exposure: 1, gamma: 1, colour: 1}` sur l'escalier :
17→18, 51→76, 102→138, 153→172, 204→192, 238→201, 255→**205**.
Épaule filmique classique : les hautes lumières COMPRESSENT (204 ressort plus
BAS que l'entrée) et plafonnent à ~205 à cette exposition. L'enum complet :
`Basic · Natural · Bright · Contrast · Filmic · Punchy · PBRNeutral · Log` —
un module de tone mapping de l'industrie, pas un curseur de contraste.

## Non mesuré, et pourquoi

- **Levels** : `createSetLevelsAdjustmentParameters` rejette la structure
  construite côté JS (`Cannot read properties of undefined (reading
  'handle')`) — la forme attendue n'est pas documentée. Sans enjeu : un
  levels est un remap trivial et `curves` le couvre chez nous.
- **Clarity / MultiBandSharpen / Denoise** : opérateurs LOCAUX — l'escalier et
  le nuancier sont aveugles à leur propriété. Mire à structure requise
  (protocole à écrire le jour où on s'y attaque).
- **HSLShift par plage** : la structure porte une **enveloppe trapézoïdale à
  quatre points par bande de teinte** (`rampUpBegin/rampUpEnd/rampDownBegin/
  rampDownEnd`, en radians) — l'architecture est déjà documentée par le SDK,
  la mesure fine attendra l'implémentation.
