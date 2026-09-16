# 02 — Réglages de base + courbe paramétrique : le TON en un seul effet

Type: task
Status: ready-for-human (livré le 2026-09-11 ; reste la validation esthétique d'Antoine côte à côte avec son Lightroom — planche 02)
Blocked by: — (03 livré, commit `fe5ae13`). Les paragraphes « GELÉ » ci-dessous qui parlent d'entrée `registry.ts`/`catalog.ts` et de compte 27 → 28 sont CADUCS : le module vit dans `developRegistry.ts` et est rendu par l'étage ; le compte des EFFETS ne bouge pas (26).

**What to build :** l'effet `reglagesDeBase` — le panneau « Réglages de base »
de Lightroom Classic 14.5.1 (inventaire `../research/01-…` § 1) PLUS la courbe
paramétrique (§ 2, 7 curseurs), en UN SEUL effet, parce que la mesure
`../research/02-huit-bits-mesure.md` dit qu'empiler des effets de ton en 8 bits
perd 25 % des niveaux et creuse des trous de 7, alors qu'un effet unique en
flottant, quantifié une fois, rend ce que Lightroom rend. Décision d'Antoine :
« fais comme tu peux » (2026-09-11) = 8 bits, ton d'un bloc.

## Les 22 curseurs, libellés français de Lightroom (mesurés), bornes usuelles

Sections dans l'ordre du panneau (l'ordre AFFICHÉ = l'ordre de `params[]`,
CLAUDE.md — donc déclarer `params[]` dans cet ordre dès le premier commit, les
index seront gelés par les presets et les références) :

**Balance des blancs** (JPEG : relative) — `Température` (`IncrementalTemperature`,
−100..100, bleu ↔ jaune), `Nuance` (`IncrementalTint`, −100..100, vert ↔ magenta).

**Tonalité** — `Exposition` (−5..+5 IL), `Contraste` (−100..100), `Hautes
lumières`, `Ombres`, `Blancs`, `Noirs` (−100..100 chacun).

**Présence** — `Texture` (−100..100), `Clarté` (−100..100), `Correction du
voile` (`Dehaze`, −100..100), `Vibrance` (−100..100), `Saturation` (−100..100).

**Courbe paramétrique** (« Courbe des tonalités » — région) — `Hautes lumières`,
`Teintes claires`, `Teintes sombres`, `Ombres` (`ParametricHighlights/Lights/
Darks/Shadows`, −100..100), et les trois séparations `ParametricShadowSplit`
(10..70, défaut 25), `ParametricMidtoneSplit` (20..80, défaut 50),
`ParametricHighlightSplit` (30..90, défaut 75). ⚠️ La courbe À POINTS reste
`curves` (existe, gelée) — ne pas la dupliquer.

⚠️ Bornes « usuelles » : à remplacer par `Documents/shaderlab-lightroom-ranges.txt`
(plugin `assets/shaderlab-dump.lrdevplugin`) dès qu'Antoine l'a produit.

## Mécanisme — ordre de Lightroom, en linéaire, une passe finale

Lightroom applique dans cet ordre (PV2012, mesurable dans son propre code de
présentation : les curseurs sont listés dans cet ordre et s'appliquent ainsi) :

1. **Balance des blancs** : gain par canal en linéaire — Température déplace
   le rapport B/R (bleu ↔ jaune), Nuance le rapport V/(R+B) (vert ↔ magenta),
   normalisé pour garder la luminance d'un gris moyen. Amplitude à calibrer sur
   planche (Lightroom ±100 en JPEG est franc mais pas caricatural).
2. **Exposition** : gain `2^EV` en linéaire avec un GENOU doux vers le blanc
   (Lightroom ne clippe pas sec : au-dessus de ~0,8 la courbe s'arrondit).
3. **Contraste** : S autour du gris moyen, en espace perceptuel (sRGB ou
   OKLab L), pas en linéaire.
4. **Hautes lumières / Ombres** : ⚠️ LOCAUX chez Lightroom (PV2012) — le poids
   dépend d'une luminance FLOUTÉE à grand rayon (≈ 2-4 % de la largeur), pas du
   pixel seul ; c'est ce qui les distingue d'une courbe et évite le look
   « HDR sale ». Donc UNE passe interne de pyramide (`blurChain`, 1/8 ou 1/16)
   qui produit la luminance floue, lue par la passe finale via `prevPass`
   (la passe finale voit `color` = source ET `prevPass`, comme `glow`).
   Poids ombres = `(1 − Lflou)²`, hautes lumières = `Lflou²`, appliqués sur le
   pixel en perceptuel.
5. **Blancs / Noirs** : déplacent les points blanc et noir (les extrêmes de la
   courbe), avec un poids serré aux extrémités.
6. **Texture / Clarté / Correction du voile** : Texture = contraste local à
   PETIT rayon (≈ 0,2 % largeur), Clarté = contraste local à MOYEN rayon
   (≈ 1 %), en perceptuel, sans halo (masque de contour doux comme `nettete` le
   fait déjà — RÉUTILISE `nettete`'s mécanisme à deux bandes ; c'est la même
   chose). Dehaze = estimation d'un voile (canal sombre flouté à grand rayon —
   la même pyramide que 4) soustrait puis renormalisé ; négatif = ajoute du
   voile. Les trois lisent des flous : la pyramide fournit 2-3 échelles.
7. **Vibrance / Saturation** : Saturation = dose de chroma uniforme (OKLCH ou
   sat HSL) ; Vibrance = dose NON linéaire, forte sur les couleurs peu
   saturées, faible sur les saturées, et protège les teintes de peau (bande
   orange 20-50°) — c'est l'opérateur que le ticket 10 disait manquant.
8. **Courbe paramétrique** : quatre régions séparées par les trois
   séparations, chaque curseur lève/baisse sa région avec des transitions
   douces (cosinus entre séparations), en perceptuel.
9. Encodage sRGB par le FORMAT à l'écriture — UNE quantification.

Défauts tous à 0 (séparations 25/50/75) → identité au bit près.

## Ce qui est GELÉ

- Un fichier `src/render/effects/reglagesDeBase.ts`, entrée `registry.ts`
  APRÈS `etalonnage`, catégorie de la retouche. Sans `canvasControls`.
  Sections : `Balance des blancs` (paire) · `Tonalité` (liste 6) · `Présence`
  (liste 5) · `Courbe paramétrique` (liste 4 + grille 3 pour les séparations —
  ou `figure` si un contrôle visuel de régions vaut le coup ; pas dans ce
  ticket). 22 params > `MAX_EFFECT_PARAMS` ? Non (48). Passes : la pyramide de
  flou (réutiliser `blurChain`), `enabled` quand HL/Ombres/Texture/Clarté/
  Dehaze sont tous à 0 (une passe sautée → `prevPass` = source).
- Compte du registre 27 → 28 et paramètres (`mesure-controles.ts`) dans
  CLAUDE.md et ROADMAP, MÊME commit. Garde de câblage.
- **Mires** : `mireRampe` (existe) pour le ton — références
  `effet-reglages-temoin` (tout à 0 = source au bit près),
  `effet-reglages-ton` (Exposition +1, HL −50, Ombres +50, Noirs −20, Blancs
  +20), `effet-reglages-courbe` (paramétrique HL −60 / Ombres +60, séparations
  déplacées), et sur une mire COLORÉE (celle du ticket 01, `mirePrimaires`, ou
  la commune) `effet-reglages-couleur` (Température +40, Nuance −30, Vibrance
  +60) et `effet-reglages-presence` (Texture +60, Clarté +60, Dehaze +40 — se
  juge en crop 1:1). Scénario + `ATTENDU`, même commit.
- **Preuve du « une seule quantification »** : un test unit sur la fonction
  pure TS (miroir de la WGSL, comme `aperture.ts`) qui rejoue la chaîne du
  ticket 02 de recherche et compte 132 niveaux, pas 109 — le gate qui dit que
  l'effet tient sa raison d'être.
- Planche pour Antoine sur ses deux photos : témoin · Exposition ±1 · HL −80 ·
  Ombres +80 · Blancs/Noirs · Texture +80 · Clarté +80 · Dehaze ±60 · Vibrance
  +80 vs Saturation +80 (la différence doit se voir sur la peau) · Température
  ±50 · le look « paramétrique ». Il compare à SON Lightroom, mêmes valeurs.

- [x] `reglagesDeBase.ts` : **20** params (pas 22 — voir décision) dans l'ordre du panneau, pyramide de luminance (moyen-large) + tente fine, chaîne dans l'ordre de Lightroom, identité à 0 (garde + saut de l'étage).
- [x] Module dans `developRegistry.ts` (l'étage, PAS `registry.ts`) : application `etalonnage`→`reglagesDeBase`, affichage `reglagesDeBase`→`etalonnage`. Compte des EFFETS inchangé (26). CLAUDE.md/ROADMAP (références 133→139). Câblage vert (20 params lus), `test:wgsl` vert, `gpu-shaders` vert (7 passes + composite).
- [x] **6** références + ATTENDU, `test:render` zéro écart sur les 133 existantes, +6 (139).
- [x] Test « 132 niveaux » : mesuré **130 niveaux d'un bloc / trou 3**, contre **104 empilé** (`reglagesDeBase.test.ts`). Vibrance ≠ saturation prouvée sur la peau.
- [x] Planche sur les deux photos d'Antoine (`planche-02-reglages-{rendu,assemble}.mjs` → `planche-02-reglages.html`) + capture du panneau CDP (`etage-02-panneau.png`), `frameSignature` change à Exposition +1 et revient au bit près à 0.
- [ ] Bornes réelles du plugin : `Documents/shaderlab-lightroom-ranges.txt` ABSENT → bornes usuelles du ticket. À reprendre si Antoine produit le fichier.
- [ ] Validation esthétique d'Antoine côte à côte avec son Lightroom (planche 02).

## Décisions et écarts d'exécution (2026-09-11)

- **20 curseurs, pas 22.** Le « 22 » comptait les 15 LIGNES du panneau Basic de
  `research/01 § 1` + 7 de courbe. Deux de ces lignes ne sont pas des curseurs de
  ton continus de CE module : `WhiteBalance` (un CHOIX — en JPEG relatif,
  Température/Nuance suffisent) et `ConvertToGrayscale` (le N&B, module séparé).
  13 Basic + 7 courbe = 20.
- **Transport des flous : une seule pyramide + une tente fine.** La chaîne de
  passes est LINÉAIRE (un seul `prevPass`) — pas de transport de plusieurs
  textures floutées. `prevPass` porte le flou MOYEN-LARGE (pyramide `blurChain`,
  structure de la bande Clarté de `nettete`, 4 descentes + 3 remontées), lu par
  Hautes lumières/Ombres (poids), Clarté (contraste local) et Voile. La bande
  FINE de Texture se calcule dans la passe finale par une tente 3×3 à un texel sur
  `srcTexture`. Écart assumé à Lightroom (qui donne à Clarté un rayon plus serré
  qu'aux HL/Ombres) — en 8 bits et sur ses rayons descriptifs jamais chiffrés, le
  partage est acceptable ; les deux rayons sont bien SÉPARÉS (fin vs moyen-large)
  et calibrables sur la planche.
- **Amplitudes (`k` des constantes, ce qu'un +100 fait).** WB : R+0,30/B−0,30 à
  Température +100, R+B+0,15/G−0,15 à Nuance +100 (gains linéaires, renormalisés
  au blanc → luminance d'un gris préservée, vérifié sur photo : Température ±50
  garde la moyenne à 63,6). Exposition : 2^IL, clamp (PAS de genou — en 8 bits un
  genou sous 1.0 casse l'identité, au-dessus la quantification l'efface).
  Contraste : pente 1+k. HL/Ombres locaux : 0,5·poids·(1−s) à |100|. Blancs/Noirs :
  0,4·poids à |100|. Texture : gain additif 1,2·détail fin. Clarté : 0,9·détail
  moyen. Voile : 0,35. Courbe paramétrique : lift perceptuel max 0,35 par région,
  transitions cosinus (demi-largeur 0,15). Vibrance/Saturation : facteur OKLab
  1+k, vibrance éteinte au-delà de 0,20 de chroma et sur la direction peau (a,b).
- **`emboss`/`noise` non touchés.** Le module vit dans l'étage ; `mesure-controles.ts`
  ne compte QUE `effectRegistry`, donc les 20 params n'y entrent pas (compte
  effets/params inchangé).
- **Bug d'exécution corrigé (hors périmètre strict) :** `runDevelopStage`
  n'exécutait PAS les passes internes (`etalonnage`, seul module jusqu'ici, n'en a
  aucune) — un module de l'étage à pyramide n'aurait jamais eu son `prevPass`.
  Étendu à `runInternalPasses` comme la boucle des calques. `wgslNaga.test.ts` et
  `gpu-shader-check.mjs` composaient aussi l'étage sans `hasPrevPass` : corrigés.
- **Repli « Effet » de `ParamPanel` retiré pour l'étage** par une prop `flat`
  (pas un fork). `DevelopPanel` fait de chaque module un ACCORDÉON (`Disclosure`,
  Lightroom) — réponse ADR-0001 quand l'étage dépasse un écran ; on replie ce
  qu'on ne règle pas.


## Calibration — 2026-09-12 (« contraste et luminosité rendent un peu bizarre »)

Le ton du ticket datait d'AVANT le pont de mesure : formes plausibles, jamais
confrontées aux rampes. Calibré sur les 30 rampes `research/mesures/*.json`
(`assets/calibrer-ton.py`, table isolée `src/render/effects/reglagesDeBaseTable.ts`,
lue par le twin ET le WGSL). Écart moyen à Lightroom sur les rampes : **13,1 →
3,6 niveaux** (contraste −100 : 51,4 → 3,3 ; exposition ±2 : ~13 → ~2,4).

Changements de forme : exposition = gamma perceptuel ancré (le gain 2^EV nu n'a
pas le genou mesuré — blanc tenu à −2 IL) ; contraste = gamma double pivoté ancré
0/pivot/1 ; ombres/HL/noirs/blancs = cloches bêta par signe (Lightroom est
asymétrique). Résidus au-dessus de 5 niveaux : param-lights +100 (16,5),
param-darks +100 (13,3), param-ombres +100 (8,4), ombres +100 (8,0), noirs −50
(7,0) — formes de la courbe paramétrique à revoir si l'œil le demande.
Références : `developpement-reglages-ton` et `-courbe` régénérées (correction) ;
témoin et les 145 autres au bit près.

**Addendum présence (même jour)** : « texture et clarté change les couleurs » —
vérifié dans le BINAIRE de Lightroom (CameraRaw.dll 14.5.1) : Texture = étage
`cr_stage_texture_direct_gf_ycc` (log-YCC, filtre guidé sur Y seul), Clarté =
`cr_clarity.cpp` / pipeline GPU `LocalContrastY`. Chroma jamais touchée, et le
log rend l'opération MULTIPLICATIVE en linéaire. Notre offset égal par canal
désaturait ; remplacé par un facteur `(L+g)/L` (piédestal 1e-4). Mesure LR à
l'appui : Texture ±100 sur balayage, dSat max 0,017, dHue max 0,9°. Référence
`developpement-reglages-presence` régénérée (correction), 146 autres au bit près.

## Parité 02b — trois divergences de l'audit 09 (2026-09-12, « go pour tout »)

Corrigées dans `reglagesDeBase` (twin + WGSL jumeaux), constantes fittées par
`assets/calibrer-ton.py` (étendu) dans `reglagesDeBaseTable.ts`. Le fit reproduit
les constantes de TON au bit près (aucun churn dessus) et ajoute WB / voile / desat.

**1. Voile — composante GLOBALE (`veilOp` / `rb_veil`).** Le voile portait un
contraste LOCAL `(lp − blurLuma)`, inerte sur un ton plat, alors que LR estime un
canal sombre (composante globale). Ajout, par canal en sRGB : d>0 (retrait) =
récupération ancrée `s(1−ω)/(1−ω·s)` (ω=`dehazeOmega`=0,745) ; d<0 (ajout) = écran
vers airlight `1−(1−a)·(1−s)^g` (a=`dehazeAirlight`=0,275, g=`dehazeGamma`=2,9).
Écart moyen sur la rampe grise : `voile-p100` **54,5 → 5,1** ; `voile-m100`
**78,0 → 3,0** niveaux (AVANT = voile inerte = identité). Désaturation des couleurs
en ajout portée par un facteur de chroma OKLab `dehazeDesatK`=0,22, calibré sur la
colonne sat du `balayage` : **dSat −0,142 vs LR −0,139**. Le contraste LOCAL est
conservé (il agit sur une vraie image). Écart assumé : le lift de LUMINANCE des
couleurs saturées (dark-channel + min spatial) reste sous LR (per-canal ancré) — la
composante spatiale n'est pas mesurable sur rampe et attend les mesures fines /
une passe dédiée.

**2. Balance des blancs — espace caméra, sans renormalisation.** Renormalisation au
blanc RETIRÉE. Gains linéaires par canal, PAR SIGNE, fittés sur `rampe_rgb`
(`wbTempPos` [5,65 / 2,58 / 0,93], `wbTempNeg` [1,35 / 1,96 / 7,99], `wbTintPos`
[1,44 / 0,99 / 4,2], `wbTintNeg` [0,8 / 2,89 / 0,95]), combinés multiplicativement,
bornés. Les deux extrêmes éclaircissent : dLum linéaire émergent Température +100
**+0,25** (LR +0,19), −100 **+0,18** (LR +0,157), Nuance +100 +0,04 (LR +0,031),
−100 +0,18 (LR +0,140) — direction et signe reproduits. ⚠️ ÉCART ASSUMÉ, chiffré :
un gain DIAGONAL est le seul opérateur de WB possible sur un JPEG déjà rendu (pas de
profil caméra), il ne reproduit pas la réponse en S de la courbe de ton caméra de
LR ; résidu par canal aux extrêmes 5–23 niveaux (`errRGB` imprimé par le script).
Mesures fines à venir (±25, ±75, nuance ±50) : le fit s'y intègre sans réécriture
(gains linéaires en |curseur|, un axe/signe par mesure).

**3. Blancs / Noirs — locaux comme Lightroom.** Leurs cloches pèsent sur la
luminance FLOUTÉE `sBlur` (comme HL/Ombres, `local_whites_blacks`) au lieu du pixel
ponctuel ; ils réveillent la pyramide (`utile` élargi). Sur une rampe `sBlur = s`,
donc le fit est INCHANGÉ (garde-fou du brief : écart ≤ l'actuel) — `noirs-p100`
**0,5**, `blancs-m100` **2,7** niveaux, identiques ; la localité ne se voit que sur
une vraie image. Le twin « 132 niveaux » passe de 160 à **174 niveaux d'un bloc**
(trou 3) : porter les Noirs sur la luminance floutée redistribue leur lift.

**4. Nuance foncée (étalonnage) — note doc seule.** Reste ACTIVE (choix produit,
un curseur inerte est proscrit). Note d'extension assumée ajoutée à l'en-tête de
`etalonnage.ts`. Aucun changement de comportement.

**Références de rendu.** Bougées (corrections, `--update` + relues) :
`developpement-reglages-ton` (max 9, moy 3,13 — Blancs/Noirs locaux),
`developpement-reglages-couleur` (max 93, moy 16,6 — WB sans renorm),
`developpement-reglages-presence` (max 23, moy 7,26 — voile global à Dehaze +40).
INCHANGÉES au bit près : `-temoin` (module au défaut, sauté), `-courbe`
(paramétrique), `-saturation` (saturation seule), et les autres références du dépôt.
Compte de références inchangé (aucune ajoutée). Planche œil d'Antoine :
`planche-02b-{rendu,assemble}.mjs` → `planche-02b-reglages.html` (non versionné).

## Exploitation des mesures du 2026-09-15 — ce qui est livré, ce qui est retenu

Quatre analyses en parallèle, quatre contre-expertises adverses tenues de refaire
un chiffre clé à la main. **Les quatre propositions ont été réfutées comme
bloquantes**, et chacune a isolé un sous-ensemble validé. Seul ce sous-ensemble
est livré.

**Livré — balance des blancs, la loi du curseur par paliers mesurés.** Le gain
n'est plus proportionnel à la dose : `WbStep[]` par axe et par signe, interpolé
par `wbLerp` (twin) et son jumeau déroulé `wbFn` (WGSL, sans boucle ni tableau
indexé). Écart moyen aux dix mesures, recalculé par la session principale sur
`rampe_rgb` de `temoin3` : **10,07 → 8,62 niveaux**, le gain venant entièrement
des doses intermédiaires (nuance +50 : 11,1 → 4,0 ; nuance −50 : 8,2 → 2,6 ;
température +25 : 6,4 → 4,9). Une référence régénérée,
`developpement-reglages-couleur`.

**Retenu — la branche FROIDE de Température.** Les doses −25 et −75 sont mesurées
mais écartées : `temperature-m50` manque au milieu du retournement, la validation
croisée sort pire que le statu quo (18,1 contre 17,0), et le canal bleu de
`temperature-m100` est écrêté sur plus des deux tiers de la rampe — son gain
n'est pas identifiable (bassin plat de 25 à 40, là où la proposition écrivait
32,424). La branche garde donc sa loi linéaire, exprimée par un palier unique.

**Livré — voile, deux constantes.** `dehazeGamma` 2,9 → 2,65 (seule valeur dont
le réglage actuel tombe HORS de l'intervalle de la sonde) et `dehazeDesatK`
0,22 → 0,60 (direction confirmée par toutes les sondes, valeur refittée sur la
sonde propre et non sur la rampe). Aucune référence ne bouge : le gamma ne mord
qu'à voile négatif, la désaturation est inerte à voile positif — prédit, puis
vérifié.

**Retenu — voile, le changement de forme.** `dehazeAirlightExp` (airlight en
puissance de la dose) est refusé : l'exposant 7,7 ne vaut qu'à l'entrée 0, et le
rapport m50/m100 entrée par entrée le dément (7,5 à l'entrée 0, 0,7 à l'entrée
64). C'est la FORME (a, g) qui est fausse, pas la loi de dose. `dehazeOmega`
n'est pas touché non plus : 0,745 et 0,716 sont indiscernables par cette sonde.

**Défaut d'instrument à corriger avant toute recalibration du voile.** Les patchs
de la mire sont contigus (marge de 20 px) et la rampe monte par marches de 8 px :
aucune sonde de ce jeu n'est propre pour un opérateur LOCAL. Le même ω refait
colonne par colonne dans le patch gris 118 court de 0,675 à 0,745 — une dispersion
2,4 fois plus large que la correction proposée. Prochaine mire : des plateaux
d'au moins 200 px, chaque gris bordé de sa propre valeur.

## 2026-09-16 — la carte des écarts, mesurée curseur par curseur

**Retour d'Antoine** : « il y a un vrai problème avec les settings de
développement, je ne saurais pas te dire exactement quoi, mais on ne se retrouve
pas avec les résultats qu'on attend ». Symptôme sans cause — donc mesure avant
hypothèse. Instrument versionné : `assets/verifier-ton.mjs`, même patron que
`verifier-grading.mjs` (le VRAI twin bundlé à la volée, appliqué à la rampe
idéale, comparé à la rampe que Lightroom a rendue pour le même réglage).

Il manquait : `calibrer-ton.py` porte son PROPRE forward-model en Python, donc il
peut dériver du twin sans que rien ne le dise, et il ajuste au lieu de constater.

**55 mesures de ton, 4,50 niveaux d'écart moyen. Le classement, par écart moyen :**

| Curseur | écart moyen | pire | ce que le dossier en disait déjà |
| --- | --- | --- | --- |
| `temperature` (7 doses) | **10,96** (jusqu'à 17,0 à −75) | 95,9 | audit 09 : **ARBITRAGE** (espace ABC caméra) |
| `param-lights` +100 | 16,5 | 27,5 | ticket 02 : « résidu 16,5 niv. » — connu, jamais repris |
| `clarte` +100 | 14,1 | 26,2 | audit 09 : CONFORME (canal), filtre simplifié |
| `param-darks` +100 | 13,3 | 24,1 | — |
| `voile` (4 doses) | 12,1 au pire | 34,7 | audit 09 : **DIVERGENT** (mécanisme) |
| `nuance` (4 doses) | 10,0 au pire | 35,2 | audit 09 : **ARBITRAGE** |
| `ombres` +100 | 8,1 | 33,5 | — |
| `texture`, `vibrance`, `saturation` | **0,00** | 0,0 | inertes sur une rampe grise (voir ci-dessous) |

⚠️ **Un zéro ne vaut que pour ce que la mire traverse.** `vibrance` et
`saturation` rendent 0,00 parce qu'une rampe GRISE n'a pas de chroma à doser, et
`texture` 0,02 parce qu'une rampe LISSE n'a pas de détail à accentuer. Ces
trois-là ne sont pas prouvés justes, ils sont hors de portée de cette mire.

### Ce que la Température fait, et ce que Lightroom fait

L'écart n'est pas d'amplitude mais de FORME, et il mord dès les réglages modérés :

```
temperature −25   niveau 160 : nous [166, 176, 251]   Lightroom [147, 168, 199]
temperature −75   niveau  32 : nous [ 37,  44,  85]   Lightroom [  1,  45, 118]
temperature +50   niveau 160 : nous [255, 207, 155]   Lightroom [228, 197, 153]
```

**Nous saturons le canal poussé, Lightroom le compresse** — 52 niveaux d'écart sur
le bleu à −25, un réglage doux. Et au ras du noir, Lightroom écrase le canal
opposé bien plus fort que nous (1 contre 37). Notre modèle applique des gains
linéaires par canal puis ÉCRÊTE ; le sien passe par l'espace caméra et une courbe
de ton qui récupère les hautes lumières.

⚠️ **La renormalisation au blanc n'est PAS la cause** : elle a été retirée le
2026-09-12 et les gains sont fittés par signe. L'en-tête du module le dit ; c'est
la première hypothèse que la mesure a écartée.

**Contre-référence** : Affinity fait comme Lightroom sur ce point — gains
multiplicatifs par canal, aucune préservation de luminance
(`.scratch/affinity/research/02-ajustements-mesures.md` § WhiteBalance). Les deux
références s'accordent, donc l'écart est bien chez nous.

### Une forme essayée et RÉFUTÉE tout de suite

Comprimer la sortie par canal contre le blanc (saturation exponentielle, la forme
qui a marché le matin même sur la luminance du Color Grading) fait passer les sept
mesures de Température de **10,96 à 18,76 niveaux** : elle comprime aussi le bas
de la rampe, là où Lightroom ne comprime pas. La forme juste se mesure sur ses
rampes avant d'être posée — pas l'inverse.

### Reste à faire

1. Mesurer la FORME de la balance des blancs de Lightroom (gain par canal en
   fonction du niveau, sur les sept doses), au lieu d'ajuster une amplitude.
2. Reprendre `param-lights` / `param-darks` : le résidu de la courbe paramétrique
   est le deuxième poste, et il est connu depuis le 2026-09-11.
3. `voile` : mécanisme divergent, déjà écrit au 09, jamais repris.
4. Une mire qui PORTE de la chroma et du détail pour `vibrance`, `saturation` et
   `texture` — la rampe grise ne peut rien en dire.

## 2026-09-16 (2ᵉ passe) — la courbe paramétrique, et la dette qu'elle révèle

**Leur forme est une CLOCHE par région, pas un plateau.** Mesuré : à `Ombres` +100,
Lightroom lève le niveau 50 de +29,7 puis REDESCEND à zéro vers 128 — un plateau
tient jusqu'à la séparation, une cloche retombe. Et les quatre amplitudes de pic
sont toutes différentes (+29,7 / +55,8 / +71,4 / +36,2), ce qu'une amplitude unique
ne peut pas rendre.

**Les centres ne sont pas fittés.** Les quatre centres mesurés (0,17 / 0,39 / 0,65 /
0,81) sont les milieux des régions, à condition de prendre les bornes du noir et du
blanc à 0,10 et 0,90. Une seule constante (`curveEdge`) les produit tous les quatre,
et les séparations continuent de les déplacer — ce qui est leur rôle.

| mesure | plateaux | cloches |
| --- | --- | --- |
| `param-lights` +100 | 16,50 | **2,89** |
| `param-darks` +100 | 13,33 | **1,61** |
| `param-ombres` +100 | 8,39 | **1,14** |
| `param-hl` −100 | 6,48 | **1,31** |
| les 55 mesures de ton | 3,35 | **2,66** |

**Validation hors échantillon** : `param-splits-10-50-90` (séparations déplacées à
10/50/90) n'a servi à aucun ajustement — ni les amplitudes, ni les étroitesses, ni
les centres. Elle passe de **7,67 à 4,09** niveaux, pire cas 51,3 → 10,6. C'est le
lien centre ↔ séparation qui est validé là, et c'est la partie non fittée du modèle.

### ⚠️ Ce que le changement RÉVÈLE, et qui ne vient pas de lui

Le test de quantification (`reglagesDeBase.test.ts`, « 132 niveaux, pas 109 ») a
rougi : trou de 10 niveaux là où il exige 3. Attribué avant de toucher quoi que ce
soit :

| réglage | trou max |
| --- | --- |
| `exposure +1` + `shadows +60` seuls | **17** |
| le réglage du test SANS courbe paramétrique | **15** |
| le même AVEC la courbe en cloches | **10** |
| la courbe paramétrique SEULE | 2 |

Le trou ne vient donc pas de la courbe — **elle le réduit**. Il vient de deux
cloches dont l'exposant bas est inférieur à 1 (`shadowKappa · shadowCenter` = 0,30,
`highlightKappa · (1 − highlightCenter)` = 0,32), ce qui leur donne une **pente
infinie** au ras du bout. L'ancienne courbe à plateaux le MASQUAIT en ramenant le
bas à zéro ; le gate passait donc pour une mauvaise raison.

Correction mesurée et REFUSÉE pour l'instant : plancher les exposants de `bump` à 1
ramène le trou à 3, au prix de **2,66 → 4,70** niveaux d'écart de parité sur les 55
mesures. Hors périmètre de ce ticket, et trop cher tel quel — la vraie sortie est
de refitter les quatre cloches sous la contrainte « exposant ≥ 1 », ce qui demande
de rejouer `calibrer-ton.py` sur `ombres-*`, `hautes-lumieres-*`, `noirs-*`,
`blancs-*`. À faire avant de croire le seuil de quantification.
