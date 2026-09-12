# 09 — Audit sémantique de l'étage contre le binaire de Lightroom

Type: research
Status: ready-for-human
Blocked by: none

**What to build :** Antoine, 2026-09-12, après le fix présence (`b725e6c`, prouvé
par minage de CameraRaw.dll) : « tu peux faire ça pour tous les paramètres ? »
Pour CHAQUE curseur des quatre modules de l'étage (`reglagesDeBase` 20, `hsl` 33,
`colorGrading` 14, `etalonnage` 7) : retrouver dans le binaire l'étage Adobe qui
le porte (fichier `cr_*.cpp`, noms `cr_stage_*`, pipelines GPU), en déduire
ESPACE de travail et CANAL, comparer à notre implémentation, verdict
CONFORME / DIVERGENT / INDÉTERMINÉ avec la pièce. Corriger les divergences
prouvées ET mesurables ; consigner le reste.

Trouvailles déjà acquises (fix `b725e6c`) : Texture = `cr_stage_texture_direct_gf_ycc`
(log-YCC, filtre guidé sur Y seul) ; Clarté = `cr_clarity.cpp` / pipeline
`LocalContrastY` ; le log-YCC rend l'opération multiplicative en linéaire.
Vu aussi : `cr_tone_map_stage.cpp` (texturePool/highlights/shadows/clarity),
`cr_noise.cpp` (wavelet), 293 blobs DXBC (kernels compilés — leurs chunks RDEF
portent des noms d'uniforms lisibles), `Develop.lrmodule` (Lua, noms UI).

- [x] Inventaire binaire : `cr_*.cpp` (138), `cr_stage_*` (412), pipelines/uniforms GPU, rangés par panneau (§ Recherche 2026-09-12).
- [x] Tableau curseur par curseur (74) : étage LR, espace, canal, notre implémentation, verdict + pièce (§ Recherche).
- [x] Divergences prouvées et mesurables : la SEULE qui passait les deux barres (Texture/Clarté désaturaient — offset par canal au lieu d'un facteur de luminance) était DÉJÀ corrigée par `b725e6c`, le commit qui a motivé ce ticket. Aucune autre divergence ne réunit « prouvée par le binaire » ET « corrigeable + validable sur une mesure existante » (détail et raison par ligne).
- [x] Indéterminés / arbitrages : listés avec ce qui manque (§ Recherche, bloc Arbitrages).

---

## Recherche — 2026-09-12 (audit binaire des 74 curseurs)

Source : `C:\Program Files\Adobe\Adobe Lightroom Classic\CameraRaw.dll` (14.5.1,
145 Mo), miné par regex sur le dump `latin-1` (jamais de boucle par octet). Les
« pièces » ci-dessous sont les chaînes extraites verbatim. Espaces confrontés aux
146 mesures boîte-noire (`research/mesures/*.json`, `research/03`, `research/04`).

### Prémisses du brief vérifiées sur pièce

- **Le brief liste `colorGrading` (14) dans l'étage** ; CLAUDE.md ne cite que trois
  modules au 2026-09-11 (`etalonnage`, `reglagesDeBase`, `hsl`). Sur disque,
  `developRegistry.ts:46` porte bien `colorGrading` dans `developApplyOrder` :
  la prémisse du BRIEF est juste, c'est CLAUDE.md qui est en retard (ticket 06
  livré depuis). Les quatre modules existent, 20 + 33 + 14 + 7 = **74** confirmé
  (compte des `params[]` sur disque).
- **« notre normalisation de luminance est une divergence CONNUE »** (Température/
  Nuance) : confirmée mesurable (voir la ligne WB) — c'est un arbitrage, pas un bug.

### Inventaire binaire (rangé par panneau)

Chaîne racine des sources : `C:\workspace\release\14.5.1\lr-win-inst\classic-new\imported\adobe\acr\camera_raw\cr_sdk\source\cr_*.cpp`.

| Panneau | Fichiers `cr_*.cpp` | Stages `cr_stage_*` / pipelines | Espace de travail |
|---|---|---|---|
| Balance des blancs | `cr_params.cpp` (clés) | `ABCtoRGB_local_Temp`, `ABCtoRGB_local_Tint`, `ABCtoRGB_local_WB_Only_{Temp,Tint}`, `white_balance_3` | **ABC caméra** (tristimulus natif) → RGB |
| Ton (expo/contraste/HL/ombres/blancs/noirs + courbe param.) | `cr_exposure_stage.cpp`, `cr_tone_map_stage.cpp`, `cr_tone_stage.cpp`, `cr_tone_map.cpp`, `cr_tone_curve.cpp`, `cr_tone_utils.cpp` | `simple_exposure`→`LinearToLog2`→`rgb_tone`(`UniformsRGBTone`: curveId/scale/offset)→`Log2ToLinear` ; `tone_map_1a..1d`, `upsample_tone_map_1/2` (pyramide=local), `local_whites`, `local_blacks`, `local_whites_blacks`, `fill_light`, `curve_tone_map` | expo = **linéaire** ; courbe de ton = **log2** (RGBTone) ; HL/ombres/blancs/noirs = **locaux** (pyramide) |
| Présence — Texture | `cr_texture.cpp` | `texture_direct_gf_ycc`, `guided_filter_ycc`, `DoGpuEncodeYCC` | **Y en log-YCC**, filtre GUIDÉ (edge-aware) |
| Présence — Clarté | `cr_clarity.cpp` | `LocalContrastY` (`UniformsLocalContrastY`), `local_contrast` | **Y** seul, rayon moyen |
| Présence — Voile | `cr_dehaze.cpp` | `dehaze`, `dark_channel`, `min_filter_plus_darkchannel_and_preprocess`, `DehazeMin1Pass1PlanePlusDarkChannelPreprocessRadius1/2` | **canal sombre** (min RGB + min spatial) + lumière atmosphérique |
| Présence — Vibrance/Saturation | `cr_hsl_tuner.cpp` | `UniformsHSLTuner` (champ **`vibrance`**), `RGBtoYCC`/`YCCtoRGB` | **YCC** (mêmes uniforms que le HSL) |
| TSL (8 bandes) | `cr_hsl_tuner.cpp` | `HSLTuner_saturation`, `HSLTuner_luminance`, `HSLTuner_contrast`, `HSLTuner_mmhg`, `LocalHue`, `LuminanceTuner`, `RGBtoYCC`/`YCCtoRGB` | **YCC**, sélection par teinte |
| Noir et blanc | `cr_gray_mixer.cpp` | `GrayMixer`, `RGBToGray`, `gray_rgb`, `InvertGray` | mélange **RGB→gris** pondéré par teinte |
| Color Grading | `cr_split_tone.cpp`, `cr_color_stages.cpp` | `SplitTone` (`UniformsSplitTone`: `balanceMapAlpha`, `blending`), `LocalColorToning_blueYellow`, `LocalColorToning_magentaGreen`, `ColorMap` | **SplitTone** (axes bleu-jaune / magenta-vert) |
| Étalonnage | `cr_color_stages.cpp`, `cr_misc_stages.cpp` | `CameraToRGB`, `matrix3by3`, `ABCtoRGB` ; clés `*Calibration` | **matrice caméra**, rotation HSV des primaires (raw) |

### Tableau des 74 — étage LR → espace/canal → notre impl → verdict + pièce

Verdicts : **CONFORME** = même intention, et le rendu mesuré est reproduit dans les
résidus documentés ; **DIVERGENT** = espace/mécanisme différent, prouvé par le
binaire ; **CALIBRÉ** = notre forme diffère de la sienne mais est ajustée aux
mesures (écart chiffré au ticket) ; **ARBITRAGE** = divergence délibérée à
trancher par Antoine.

#### `reglagesDeBase` (20)

| # | Curseur | Étage LR (pièce) | Espace/canal LR | Notre impl (`reglagesDeBase.ts`) | Verdict |
|---|---|---|---|---|---|
| 1 | Température | `IncrementalTemperature` ; `cr_stage_ABCtoRGB_local_Temp` | gain en espace **ABC caméra**, luminance NON préservée (mesuré : temperature-p100 Δlum **+0,190**, m100 **+0,234** — les deux extrêmes ÉCLAIRCISSENT) | gain linéaire R+/B− **renormalisé au blanc** (Δlum≈0), `wbTempK=0.3` NON fitté | **ARBITRAGE** (espace + normalisation) |
| 2 | Nuance | `IncrementalTint` ; `cr_stage_ABCtoRGB_local_Tint` | gain vert↔magenta en ABC caméra (nuance-p100 Δlum +0,195) | gain R+B+/G− renormalisé, `wbTintK=0.15` NON fitté | **ARBITRAGE** (idem) |
| 3 | Exposition | `cr_stage_simple_exposure` ; chaîne `SimpleExposure→LinearToLog2→…→Log2ToLinear` | gain **2^EV linéaire** puis genou par la courbe de ton en **log2** (blanc lâché à −2 IL : 255→197) | gamma perceptuel ancré `1−(1−s)^γ` calibré sur la rampe (fusionne expo+genou) | **CALIBRÉ** (écart moyen ~2,4 niv. ; résidu blanc noté) |
| 4 | Contraste | `cr_stage_rgb_tone`/`UniformsRGBTone` (`cr_tone_stage.cpp`) | courbe en **log2**, pivot ~0,58 | gamma double pivoté ancré, `contrastPivot=0.62`, calibré | **CALIBRÉ** (−100 : 51,4→3,3 niv.) |
| 5 | Hautes lumières | `cr_tone_map_stage.cpp`, `upsample_tone_map_1/2` (pyramide) | **local** (luminance floutée grand rayon), log2 | cloche bêta sur luminance floutée (`prevPass`), amt par signe, calibré | **CONFORME** (local + calibré) |
| 6 | Ombres | idem (pyramide de ton) | **local**, log2 | idem, `shadowAmt{Pos,Neg}` | **CONFORME** |
| 7 | Blancs | `cr_stage_local_whites` / `local_whites_blacks` | **local** (le nom dit `local_`) | cloche PONCTUELLE au ras du blanc | **DIVERGENT** (nous ponctuel, LR local — non mesurable sur rampe) |
| 8 | Noirs | `cr_stage_local_blacks` / `local_whites_blacks` | **local** | cloche PONCTUELLE au ras du noir | **DIVERGENT** (idem ; amplitudes calibrées) |
| 9 | Texture | `cr_stage_texture_direct_gf_ycc`, `guided_filter_ycc` | **Y log-YCC**, filtre GUIDÉ | facteur `(L+g)/L`, bande fine = tente 3×3 (non edge-aware) | **CONFORME** canal (fix `b725e6c`) ; filtre simplifié noté |
| 10 | Clarté | `cr_clarity.cpp`, `cr_stage_LocalContrastY` | **Y** seul, rayon moyen | facteur `(L+g)/L`, bande moyenne (pyramide) | **CONFORME** (fix `b725e6c`) |
| 11 | Correction du voile | `cr_dehaze.cpp`, `dark_channel`, `DehazeMin1Pass1PlanePlusDarkChannel…` | **canal sombre** (min RGB + min spatial) + composante GLOBALE (voile-p100 déplace fort la rampe PLATE) | contraste LOCAL `(lp−blurLuma)` → **inerte sur un ton plat**, `DEHAZE_AMT=0.35` non calibré | **DIVERGENT** (mécanisme + inerte là où LR agit) |
| 12 | Vibrance | `UniformsHSLTuner` champ **`vibrance`** ; `cr_hsl_tuner.cpp` | **YCC**, non linéaire, protège la peau (vibrance-m100 Δsat −0,385 ; p100 ≈0 sur mire saturée) | OKLab (a,b), falloff + `SKIN_DIR`, éteinte >0,20 chroma | **CONFORME** (comportement) ; espace YCC≠OKLab noté |
| 13 | Saturation | `HSLTuner` (`CurveRefineSaturation`, enum `…saturation vibrance…`) | **YCC**, uniforme (saturation-m100 Δsat −0,999) | OKLab chroma ×(1+k) | **CONFORME** ; espace noté |
| 14 | Courbe param. — Hautes lumières | `ParametricHighlights` ; `ToneCurvePV2012` | région de la courbe de ton, **log2** | lift perceptuel cosinus par région, calibré | **CALIBRÉ** (résidu param-lights +100 : 16,5 niv.) |
| 15 | Courbe param. — Teintes claires | `ParametricLights` | idem | idem | **CALIBRÉ** |
| 16 | Courbe param. — Teintes sombres | `ParametricDarks` | idem | idem | **CALIBRÉ** (résidu 13,3 niv.) |
| 17 | Courbe param. — Ombres | `ParametricShadows` | idem | idem | **CALIBRÉ** (résidu 8,4 niv.) |
| 18 | Séparation ombres | `ParametricShadowSplit` | frontière de région, log2 | frontière smoothstep, défaut 25 | **CONFORME** |
| 19 | Séparation tons moyens | `ParametricMidtoneSplit` | idem, défaut 50 | idem | **CONFORME** |
| 20 | Séparation hautes lumières | `ParametricHighlightSplit` | idem, défaut 75 | idem | **CONFORME** |

#### `hsl` (33) — mode + 8 bandes × {teinte, saturation, luminance} + 8 niveaux de gris

Bandes (clés, ordre LR) : `Red Orange Yellow Green Aqua Blue Purple Magenta`.
Stage commun : `cr_stage_HSLTuner*` en **YCC** (`cr_stage_RGBtoYCC`/`YCCtoRGB`).
Les 8 curseurs de chaque famille partagent la pièce et le verdict.

| # | Groupe | Étage LR (pièce) | Espace/canal LR | Notre impl (`hslDevelop.ts`) | Verdict |
|---|---|---|---|---|---|
| 1 | Traitement (Couleur/N&B) | `ConvertToGrayscale` ; `isGrayMixerMeaningful` | drapeau de mode | param `mode` (choices), garde d'identité | **CONFORME** |
| 2–9 | Teinte × 8 | `HueAdjustment{Red…Magenta}` ; `cr_stage_LocalHue` | rotation de teinte en **YCC** | rotation 2×2 (a,b) OKLab, poids gaussien sans `atan2`, calibré (`research/04`) | **CONFORME** ; espace YCC≠OKLab noté |
| 10–17 | Saturation × 8 | `SaturationAdjustment{…}` ; `cr_stage_HSLTuner_saturation` | chroma **YCC** par bande | chroma ×(1+Σ poids·satK) OKLab | **CONFORME** ; espace noté |
| 18–25 | Luminance × 8 | `LuminanceAdjustment{…}` ; `cr_stage_HSLTuner_luminance`, `LuminanceTuner` | luminance **YCC** par bande | L ×(1+Σ poids·lumK) OKLab (k unique, LR asymétrique) | **CONFORME** ; réserve lumK notée dans `hslBandes.ts` |
| 26–33 | Niveau de gris × 8 | `GrayMixer{Red…Magenta}` ; `cr_gray_mixer.cpp`, `cr_stage_RGBToGray` | **mélange RGB→gris** pondéré par teinte | L ×(1+Σ poids·grayK) OKLab, chroma→0 | **DIVERGENT** (nous modulons L OKLab, LR mélange RGB) ; grayK « bruité » noté |

#### `colorGrading` (14) — 4 roues × {teinte, sat, lum} + fusion + balance

Stage : `cr_split_tone.cpp` / `cr_stage_SplitTone` (`UniformsSplitTone`:
`balanceMapAlpha`, `blending`) + `LocalColorToning_{blueYellow,magentaGreen}`.
⚠️ Les clés `ColorGrade*Hue`/`*Sat` des ombres/HL, `ColorGradeBalance`, `Blending`
coexistent avec les clés héritées `SplitToning*` que Lightroom lit à leur place —
d'où l'impossibilité de les mesurer dans les exports (noté `colorGradingTable.ts`).

| # | Curseur(s) | Étage LR (pièce) | Espace/canal LR | Notre impl (`colorGrading.ts`) | Verdict |
|---|---|---|---|---|---|
| 1–3 | Ombres teinte/sat/lum | `ColorGradeShadow{Hue,Sat,Lum}` / `SplitToningShadow*` | virage SplitTone, poids sur les ombres | vecteur chroma OKLab · poids(L), `lumK`/`chromaK` calibrés (médians) | **CALIBRÉ** ; teinte ombres non mesurable |
| 4–6 | Tons moyens teinte/sat/lum | `ColorGradeMidtone{Hue,Sat,Lum}` | SplitTone, cloche médians (MESURÉ) | idem, `midCenter`/`midSigma` calibrés | **CALIBRÉ** (roue mesurée) |
| 7–9 | Hautes lumières teinte/sat/lum | `ColorGradeHighlight{Hue,Sat,Lum}` / `SplitToningHighlight*` | SplitTone, poids HL | idem | **CALIBRÉ** ; teinte HL non mesurable |
| 10–12 | Globale teinte/sat/lum | `ColorGradeGlobal{Hue,Sat,Lum}` | SplitTone partout (MESURÉ) | vecteur global (poids chroma 1) | **CALIBRÉ** (roue mesurée) |
| 13 | Fusion | `ColorGradeBlending` (`UniformsSplitTone` `blending`) | recouvrement des plages | `softBase`+`softSpread`·(β−0,5) | **DIVERGENT** modélisé (non mesurable) |
| 14 | Balance | `ColorGradeBalance` / `SplitToningBalance` (`balanceMapAlpha`) | bascule ombres↔HL | `balanceShift`·bal sur les centres | **DIVERGENT** modélisé (non mesurable) |

#### `etalonnage` (7)

Stage : `cr_stage_CameraToRGB` / `cr_stage_matrix3by3` — appliqué à la conversion
**caméra→RGB** (rotation HSV des primaires, calibration raw). Clés `*Calibration`.

| # | Curseur | Étage LR (pièce) | Espace/canal LR | Notre impl (`etalonnage.ts`) | Verdict |
|---|---|---|---|---|---|
| 1 | Nuance foncée | `ShadowTintCalibration=Calibration Shadow Tint` ; `blackBias=Tint` | teinte du **point noir caméra** (raw) — INERTE sur mire JPEG (etal-nuance ±100 : rampe et teinte à 0) | décalage vert↔magenta pondéré `(1−luma)²` — ACTIF sur ombres JPEG | **ARBITRAGE** (LR inerte JPEG, nous actif — sinon curseur mort) |
| 2 | Teinte primaire rouge | `RedHueCalibration=Calibration Red Hue` | rotation HSV de la primaire R en **espace caméra** | rotation 2×2 (a,b) OKLab de la colonne R, renorm. au blanc | **DIVERGENT** espace (caméra HSV≠OKLab) ; calibré planche |
| 3 | Saturation primaire rouge | `RedSaturationCalibration` | dosage sat primaire R, caméra | ×k chroma colonne R | **DIVERGENT** espace ; calibré planche |
| 4 | Teinte primaire verte | `GreenHueCalibration` | idem primaire V | idem colonne V | **DIVERGENT** espace |
| 5 | Saturation primaire verte | `GreenSaturationCalibration` | idem | idem | **DIVERGENT** espace |
| 6 | Teinte primaire bleue | `BlueHueCalibration` | idem primaire B | idem colonne B | **DIVERGENT** espace |
| 7 | Saturation primaire bleue | `BlueSaturationCalibration` | idem | idem | **DIVERGENT** espace |

### Résumé par verdict (74)

- **CONFORME** : 15 — HL, Ombres, Texture, Clarté, Vibrance, Saturation, 3
  séparations param., + HSL mode/teinte×8/sat×8/lum×8 (comportement ; espace YCC noté).
  (En comptant les 24 bandes HSL individuellement : 24 CONFORME.)
- **CALIBRÉ** (forme ≠ LR, ajustée aux mesures) : Exposition, Contraste, 4
  régions param., + les 12 curseurs des 4 roues de Color Grading = **18**.
- **DIVERGENT prouvé** : Blancs, Noirs (locaux LR / ponctuels chez nous),
  Voile (canal sombre + global), 8 niveaux de gris N&B, Fusion, Balance CG, +
  6 teintes/sat primaires de l'étalonnage = **~19** (espace ou mécanisme).
- **ARBITRAGE** (divergence délibérée à trancher) : Température, Nuance
  (normalisation de luminance), Nuance foncée de l'étalonnage = **3**.

### Corrections faites

**Aucune nouvelle.** La seule divergence qui réunissait les deux barres du brief
— prouvée par le binaire ET corrigeable/validable sur une mesure existante — était
**Texture/Clarté qui désaturaient** (offset égal par canal au lieu d'un facteur de
luminance). Elle a été corrigée par `b725e6c` (le commit d'Antoine qui a motivé ce
ticket) : facteur `(L+g)/L`, twin + WGSL jumeaux, mesure LR à l'appui (dSat max
0,017 à Texture ±100), une seule référence bougée. Le « geste » est donc DÉJÀ
appliqué partout où il s'appliquait — aucun autre curseur n'utilise un offset par
canal sur une opération de luminance seule (HSL, Color Grading et étalonnage
travaillent tous proprement dans le plan chromatique d'OKLab).

Je n'ai fabriqué aucune correction pour « en avoir une » (CLAUDE.md : un ticket
« corriger X » commence par prouver que X est cassé). Les divergences restantes sont
soit des choix d'espace/mécanisme DÉJÀ calibrés pour reproduire les pixels mesurés
dans les résidus documentés, soit des mécanismes (canal sombre du Voile, WB en
espace caméra, localité Blancs/Noirs, filtre guidé de Texture) qui NE SONT PAS
validables sur les rampes existantes et exigeraient de nouvelles mesures ou de
nouvelles passes — présentés ci-dessous.

### Arbitrages restants (pour Antoine)

1. **Balance des blancs — normalisation de luminance.** LR applique Température/
   Nuance en espace caméra (ABC) SANS préserver la luminance : les DEUX extrêmes
   de température éclaircissent la rampe grise (Δlum +0,190 à +100, +0,234 à −100
   — signature d'un opérateur non linéaire en espace caméra, qu'aucun gain linéaire
   symétrique ne reproduit). Nous renormalisons au blanc (Δlum≈0), plus propre pour
   un éditeur relatif. Trancher : garder la normalisation (choix actuel) ou imiter
   la dérive de LR ? Un simple refit des amplitudes NE reproduit PAS la forme (les
   deux extrêmes éclaircissent) ; imiter LR demanderait un modèle en espace caméra.

2. **Correction du voile — mécanisme.** LR = canal sombre (min RGB + min spatial)
   + composante GLOBALE : sur une rampe PLATE (voile-p100) LR déplace fortement le
   ton, tandis que notre voile (contraste local `lp−blurLuma`) est INERTE sur un
   ton lisse. C'est la divergence la plus proche d'un vrai défaut (curseur presque
   mort sur ciel/brume uniforme). Corrigeable : ajouter un terme de ton GLOBAL
   calibré sur la rampe voile-p100/m100 (mesure existante). Non fait ici : c'est un
   changement de MÉCANISME (pas un fix de canal), il touche la référence
   `developpement-reglages-presence`, et son dosage se juge à l'œil sur une vraie
   photo (brume) — donc un arbitrage + planche, pas une retouche silencieuse.

3. **Étalonnage — Nuance foncée sur JPEG.** LR : `blackBias` tinte le point noir
   caméra (raw) et est INERTE sur notre mire JPEG (etal-nuance ±100 = rampe et
   teinte à 0). Nous tintons les ombres JPEG. Rendre inerte pour coller à LR
   créerait un curseur mort (proscrit) ; garder actif diverge de LR. Choix produit
   à confirmer.

4. **Blancs / Noirs — localité.** LR les fait LOCAUX (`cr_stage_local_whites_blacks`,
   pyramide). Nous les faisons ponctuels. Non mesurable sur rampe (une rampe n'a pas
   de structure locale) ; les amplitudes sont calibrées. À revoir seulement si l'œil
   le demande sur une vraie photo.

### Corrections 02b — « go pour tout » (Antoine, 2026-09-12)

Les trois arbitrages MESURABLES ont été exécutés dans `reglagesDeBase`, calibrés par
`assets/calibrer-ton.py` (constantes dans `reglagesDeBaseTable.ts`, twin + WGSL
jumeaux). Détail chiffré et références bougées : ticket 02, section « Parité 02b ».

- [x] **Arbitrage 1 — Balance des blancs.** Renormalisation au blanc RETIRÉE. Gains
  linéaires par canal, PAR SIGNE, fittés sur `rampe_rgb` (`wbTempPos/Neg`,
  `wbTintPos/Neg`), appliqués tels quels → les deux extrêmes éclaircissent, comme LR.
  Modèle diagonal (le seul possible sur un JPEG déjà rendu, sans profil caméra) :
  résidu par canal aux extrêmes assumé et chiffré au ticket — la réponse en S de la
  courbe de ton caméra de LR n'est pas reproductible par un gain diagonal. Verdict :
  ARBITRAGE → **exécuté**.
- [x] **Arbitrage 2 — Voile.** Composante GLOBALE ajoutée par canal (`veilOp` /
  `rb_veil`) : récupération ancrée type canal sombre en retrait (d>0), écran vers
  airlight en ajout (d<0), plus une désaturation OKLab des couleurs en ajout
  (`dehazeDesatK`, calibrée sur la colonne sat du `balayage`). Le voile DÉPLACE
  désormais une rampe plate là où il était inerte. Verdict : DIVERGENT → **corrigé**.
- [x] **Arbitrage 3 — Nuance foncée de l'étalonnage.** RESTE ACTIVE (choix produit :
  un curseur inerte est proscrit ici ; `blackBias` de LR est raw-only). Note d'extension
  assumée ajoutée à l'en-tête de `etalonnage.ts`. Verdict : ARBITRAGE → **tranché (garder), documenté**.
- [x] **Arbitrage 4 — Blancs / Noirs.** Leurs cloches pèsent désormais sur la
  luminance FLOUTÉE (`sBlur`), LOCALES comme `local_whites_blacks`. Sur une rampe
  `sBlur = s`, donc l'écart de calibration est INCHANGÉ (la localité ne se voit que
  sur une vraie image) ; re-vérifié ≤ l'actuel. Verdict : DIVERGENT → **corrigé (localité)**.

### Indéterminés (structure invisible dans les strings / mesure manquante)

- **Filtre guidé de Texture** (`guided_filter_ycc`) vs notre tente 3×3 : le
  caractère edge-aware ne se lit pas sur une rampe plate — mesure sur cible texturée
  requise pour trancher un éventuel raffinement.
- **Domaine log-YCC de Texture/Clarté** : LR calcule le détail en LOG (additif en
  log = ×en linéaire) ; notre détail est en luminance LINÉAIRE. Réponse différente
  dans les ombres, non mesurable sur les rampes actuelles (texture ~inerte sur mire
  plate).
- **Color Grading — Fusion, Balance, teintes Ombres/HL** : non mesurables (LR lit
  les clés héritées `SplitToning*`, pas `ColorGrade*Hue`). Nos modèles sont
  provisoires. Il faudrait piloter LR par SDK avec les clés effectives et relire les
  pixels.
- **Contraste local de la Clarté vs rayon exact de LR** : rayons LR jamais chiffrés
  dans les strings ; calibré à l'œil/planche.
