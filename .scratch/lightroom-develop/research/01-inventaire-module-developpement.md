# Inventaire du module Développement de Lightroom Classic 14.5.1 — face à shaderlab

Mesuré le 2026-09-11 sur l'installation locale
(`C:\Program Files\Adobe\Adobe Lightroom Classic`, version `14.5.1
(202508231203-c2638d01)`) :

- **Libellés français** : `Resources/fr/TranslatedStrings.txt` (15 994 lignes ;
  207 entrées `AgCameraRawNamedSettings/CameraRawSettingMapping` = clé → libellé,
  123 entrées `AgDevelop/CameraRawPanel`, 24 `AgDevelop/Panel`).
- **Clés** : 973 presets XMP intégrés (`Resources/Settings/Adobe/Presets/`,
  dix familles : B&W, Color, Creative, Curve, Defaults, Grain, Optics, Portraits,
  Sharpening, Vignetting) → **541 clés `crs:` distinctes**, dont ~330 sont des
  tables de profil (`Table_<hash>`, `RGBTable`) hors sujet. Table brute :
  `assets/lr-crs-keys.txt` (clé, occurrences, valeurs vues).
- **Bornes** : ⚠️ **NON mesurées** — ni dans les XMP, ni dans le binaire. Les
  colonnes « borne » ci-dessous sont les plages USUELLES du SDK
  (`LrDevelopController`), à REMPLACER par la sortie du plugin
  `assets/shaderlab-dump.lrdevplugin` (voir README). Une borne écrite de tête
  est exactement le genre de chiffre que ce dépôt a déjà payé.
- **Colonne « nous »** : mesurée sur `src/render/effects/registry.ts` (26
  effets) le 2026-09-11. ✅ = existe et couvre ; 🟡 = un morceau existe, pas la
  même chose ; ❌ = rien.

Le module en mode **JPEG** (le nôtre) : pas de profil d'appareil, balance des
blancs RELATIVE, pas de RAW. Les lignes « RAW seulement » sont marquées.

## 1. Réglages de base (`Panel/BasicAdjustments` = « Réglages de base »)

| Clé `crs:` | Libellé fr | Borne usuelle | Nous |
|---|---|---|---|
| `WhiteBalance` | Balance des blancs (Tel quel / Auto / Personnalisé en JPEG) | choix | ❌ |
| `IncrementalTemperature` | Température (JPEG : relatif) | −100..100 | ❌ (`channelMixer` peut teinter, pas une BdB) |
| `IncrementalTint` | Nuance | −100..100 | ❌ |
| `Exposure2012` | Exposition | −5..+5 IL | 🟡 `curves` (courbe maître, pas un gain linéaire) |
| `Contrast2012` | Contraste | −100..100 | 🟡 `curves` |
| `Highlights2012` | Hautes lumières | −100..100 | 🟡 `curves.tonalRangeControl` (plage), pas l'opérateur |
| `Shadows2012` | Ombres | −100..100 | 🟡 idem |
| `Whites2012` | Blancs | −100..100 | 🟡 point blanc de `curves` |
| `Blacks2012` | Noirs | −100..100 | 🟡 point noir de `curves` |
| `Texture` | Texture (« Présence ») | −100..100 | 🟡 `nettete` bande fine |
| `Clarity2012` | Clarté | −100..100 | 🟡 `nettete` bande large |
| `Dehaze` | Correction du voile | −100..100 | ❌ |
| `Vibrance` | Vibrance (non linéaire, protège les peaux) | −100..100 | ❌ (ticket 10 : « seule la vibrance ne l'est pas ») |
| `Saturation` | Saturation | −100..100 | 🟡 `channelMixer` (matrice) |
| `ConvertToGrayscale` | Convertir en noir et blanc (« Traitement : Couleur / N&B ») | bool | 🟡 `duotone`, `channelMixer` |
| `AutoTone`, `AutoBrightness`… | Auto | — | ❌ (analyse d'image) |
| `ProfileAmount`, `CameraProfile`, `Look*` | Profil + Niveau du profil | 0..200 | ❌ — RAW/profils, hors sujet en JPEG sauf les profils CRÉATIFS (LUT) |

## 2. Courbe des tonalités (`TargetName/ToneCurve`)

| Clé | Libellé fr | Borne | Nous |
|---|---|---|---|
| `ToneCurvePV2012` (+ `Red`/`Green`/`Blue`) | Courbe à points, 4 canaux | points 0..255 | ✅ `curves` (4 canaux, 3 points mobiles — Lightroom : points libres, N points) |
| `ParametricShadows/Darks/Lights/Highlights` | Tonalité des ombres / teintes sombres / teintes claires / hautes lumières (courbe PARAMÉTRIQUE) | −100..100 | ❌ (autre modèle : 4 régions) |
| `ParametricShadowSplit/MidtoneSplit/HighlightSplit` | Séparations (3 curseurs de région) | 10..70 / 20..80 / 30..90 | ❌ |
| `CurveRefineSaturation` | Affiner la saturation | −100..100 | ❌ |

## 3. Couleur — HSL / Mélange N&B (`Mixer`)

| Clé | Libellé fr | Borne | Nous |
|---|---|---|---|
| `HueAdjustment{Red,Orange,Yellow,Green,Aqua,Blue,Purple,Magenta}` | Variation de la teinte … (8 bandes) | −100..100 | ❌ |
| `SaturationAdjustment{…8}` | Variation de la saturation … | −100..100 | ❌ |
| `LuminanceAdjustment{…8}` | Variation de la luminance … | −100..100 | ❌ |
| `GrayMixer{…8}` | Niveau de gris … (mélange N&B) | −100..100 | ❌ (`channelMixer` mono ≠ 8 bandes) |
| `PointColor*` (`PointColorSettings`) | Couleur du point (LR 13+ : teinte cible + plage) | — | 🟡 `colorRange` en SOURCE DE MASQUE, pas en réglage |
| Outil cible (glisser sur la photo) | `HueOnTooltip`… | — | ❌ |

## 4. Color Grading (`Panel/ColorGrading`) et Virage partiel (`Panel/SplitToning`, hérité)

| Clé | Libellé fr | Borne | Nous |
|---|---|---|---|
| `ColorGrade{Shadow,Midtone,Highlight}{Hue,Sat,Lum}` | Teinte / Saturation / Luminance des ombres, tons moyens, hautes lumières (3 roues) | hue 0..360, sat 0..100, lum −100..100 | 🟡 `gradientMap` (rampe à 3 arrêts, sur le ton) et `duotone` — ni roues ni luminance par plage |
| `ColorGradeGlobal{Hue,Sat,Lum}` | Teinte / Saturation / Luminance globale | idem | ❌ |
| `ColorGradeBlending` | Fusion | 0..100 | ❌ |
| `ColorGradeBalance` | Balance | −100..100 | ❌ |
| `SplitToning{Shadow,Highlight}{Hue,Saturation}`, `SplitToningBalance` | Virage partiel (ancien) | idem | 🟡 `duotone` |

## 5. Détail (`Panel/Detail`)

| Clé | Libellé fr | Borne | Nous |
|---|---|---|---|
| `Sharpness` | Netteté — Gain | 0..150 | 🟡 `nettete` (2 bandes, pas les 4 curseurs) |
| `SharpenRadius` | Accentuer le rayon | 0,5..3 | 🟡 |
| `SharpenDetail` | Accentuer le détail | 0..100 | ❌ |
| `SharpenEdgeMasking` | Masque de contour | 0..100 | ❌ |
| `LuminanceSmoothing` | Réduction du bruit de luminance | 0..100 | ❌ |
| `LuminanceNoiseReductionDetail` / `…Contrast` | Détail / Contraste de luminance | 0..100 | ❌ |
| `ColorNoiseReduction` / `…Detail` / `…Smoothness` | Bruit chromatique / Détail / Lissage | 0..100 | ❌ |
| `AIDenoise` (« Réduire le bruit… ») | débruitage IA (ModelZoo) | — | ❌ hors périmètre (modèle) |

## 6. Corrections de l'objectif (`Panel/LensCorrections`)

| Clé | Libellé fr | Borne | Nous |
|---|---|---|---|
| `LensProfileEnable`, `LensProfile*`, `LensProfileDistortionScale`, `…VignettingScale` | Profil d'objectif (par marque/modèle) | 0..200 | ❌ RAW/base de profils — hors sujet ; version MANUELLE ci-dessous |
| `AutoLateralCA` / `RemoveChromaticAberration` | Supprimer l'aberration chromatique | bool | 🟡 `lensDistortion` AJOUTE de l'aberration ; la RETIRER est l'inverse |
| `Defringe{Purple,Green}{Amount,HueLo,HueHi}` | Supprimer la frange (violet / vert : quantité, plage de teinte) | 0..20, 0..100 | ❌ |
| `LensManualDistortionAmount` | Distorsion (manuel) | −100..100 | 🟡 `lensDistortion` (fisheye signé) |
| `VignetteAmount` / `VignetteMidpoint` | Vignettage (manuel, AVANT recadrage) | −100..100 / 0..100 | ❌ |
| `CropConstrainToWarp` | Contraindre le recadrage | bool | ❌ |

## 7. Transformation (`CameraRawPanel/Transform`, Upright)

| Clé | Libellé fr | Borne | Nous |
|---|---|---|---|
| `PerspectiveUpright` (Off / Auto / Level / Vertical / Full / Guided) | Upright | choix | ❌ (Auto/Guided = détection de lignes, ML) |
| `PerspectiveVertical` / `Horizontal` | Perspective verticale / horizontale | −100..100 | ❌ |
| `PerspectiveRotate` | Rotation | −10..10 | 🟡 `LayerTransform.rotation` d'un calque photo |
| `PerspectiveScale` | Échelle | 50..150 | 🟡 idem (scale) |
| `PerspectiveAspect` | Aspect | −100..100 | 🟡 `scaleX/scaleY` |
| `PerspectiveX` / `Y` | Décalage X / Y | −100..100 | 🟡 `x/y` |
| Recadrage (`CropTop/Left/Bottom/Right`, `CropAngle`, `CropConstrainAspectRatio`) | Recadrage et redressement | — | ✅ ticket 32 (cadre non destructif, ratios) ; ❌ l'ANGLE (redressement) |

## 8. Effets (`Panel/Effects`)

| Clé | Libellé fr | Borne | Nous |
|---|---|---|---|
| `PostCropVignetteAmount` | Vignettage après recadrage — Quantité | −100..100 | ❌ |
| `PostCropVignetteMidpoint` | Milieu | 0..100 | ❌ |
| `PostCropVignetteRoundness` | Arrondi | −100..100 | ❌ |
| `PostCropVignetteFeather` | Contour progressif | 0..100 | ❌ |
| `PostCropVignetteHighlightContrast` | Hautes lumières | 0..100 | ❌ |
| `PostCropVignetteStyle` | Style (Priorité hautes lumières / couleur / Incrustation) | choix | ❌ |
| `GrainAmount` / `GrainSize` / `GrainFrequency` (« Rugosité ») | Grain : Niveau / Taille / Rugosité | 0..100 | ✅ `grain` (luminance-dépendant, 5 params) |

## 9. Étalonnage (`Panel/Calibration` = « Etalonnage »)

| Clé | Libellé fr | Borne | Nous |
|---|---|---|---|
| `ShadowTint` | Nuance foncée | −100..100 | ❌ |
| `{Red,Green,Blue}{Hue,Saturation}` | Teinte / Saturation du rouge, vert, bleu primaire | −100..100 | 🟡 `channelMixer` approche (matrice) — mais l'étalonnage tourne les PRIMAIRES, effet très différent d'un mélange |
| `CameraProfile`, `CameraProfileDigest` | Profil de l'appareil | — | ❌ RAW |

## 10. Flou de l'objectif (`Panel/LensBlur`, LR 13+)

| Clé | Libellé fr | Borne | Nous |
|---|---|---|---|
| `LensBlur/Amount`, `BokehShape`, `BokehShapeDetail`, `BokehAspect`, `BokehRotation`, `CatEyeAmount`, `CatEyeScale`, `SphericalAberration`, `HighlightsBoost`, `FocusRange` | Flou de l'objectif (carte de profondeur IA + bokeh paramétré) | — | 🟡 `lensBlur` (bokeh à N lames, courbure, champs Iris/Tilt) — sans carte de profondeur (ML) |

## 11. Masques et réglages LOCAUX (`Localized/Mask*`, 95 + 36 + 27 chaînes)

Chaque réglage global existe en version LOCALE (`Local*` : `LocalExposure2012`,
`LocalContrast2012`, `LocalHighlights2012`, `LocalShadows2012`, `LocalWhites2012`,
`LocalBlacks2012`, `LocalClarity2012`, `LocalDehaze`, `LocalTexture`,
`LocalSaturation`, `LocalSharpness`, `LocalLuminanceNoise`, `LocalMoire`,
`LocalDefringe`, `LocalTemperature`, `LocalTint`, `LocalHue`, `LocalToningHue`/
`Saturation`, `LocalGrain`, `LocalCurveRefineSaturation` — 38 clés vues), posé
sur un masque : pinceau, dégradé linéaire, dégradé radial, plage de couleur, plage
de luminance, plage de profondeur, **Sélectionner le sujet / le ciel /
l'arrière-plan / les personnes (parties du corps, `PersonParts`) / les objets /
`LandscapeFeatures`** (ML). Chez nous : ✅ pinceau, dégradé linéaire ET radial,
luminosité, plage de couleur, forme géométrique ; ❌ profondeur, sujet, ciel,
personnes, objets (modèles — voir `docs/ROADMAP.md` « embarque-t-on un modèle
de vision ? », recherche rendue, décision non).

## 12. Outils (barre sous l'image)

Recadrer et redresser (✅ recadrage, ❌ redressement/angle, ❌ règle), Supprimer
(retouche des taches, contenu génératif — ❌, hors règle d'Antoine « ce qui ne se
crée pas en postproduction se dit »), Yeux rouges (❌ hors sujet), Masquage (🟡
ci-dessus), Suppression des distractions (❌ ML).

## 13. Ce qui entoure le module, et que l'énoncé « complet » touche peut-être

Histogramme avec écrêtage (`BlackClipping`/`WhiteClipping`, `Histogram/*`, 14 +
8 chaînes) — ❌ ; Avant/Après (`Menu/View`, 126 chaînes) — ❌ ; Instantanés et
Historique nommé — 🟡 undo de session seulement ; Presets avec QUANTITÉ
(`PresetAmount`, 0..200) — 🟡 presets sans dose ; Copier/Coller les réglages par
sous-ensemble (`SaveNamedDialog`, 63 chaînes) — ❌ ; Synchroniser — sans objet
(un document).

## Comptes

| | Curseurs / choix globaux (hors RAW, hors ML) | Nous ✅ | Nous 🟡 | Nous ❌ |
|---|---|---|---|---|
| Réglages de base | 15 | 0 | 8 | 7 |
| Courbe | 9 | 1 | 0 | 8 |
| HSL / N&B | 33 | 0 | 1 | 32 |
| Color Grading | 14 | 0 | 2 | 12 |
| Détail | 9 | 0 | 2 | 7 |
| Optique (manuel) | 8 | 0 | 2 | 6 |
| Transformation | 8 | 1 | 5 | 2 |
| Effets | 9 | 3 | 0 | 6 |
| Étalonnage | 7 | 0 | 6 | 1 |
| **Total** | **112** | **5** | **26** | **81** |

Comptés sur les tables ci-dessus, hors masques locaux (qui doublent la
plupart) et hors flou de l'objectif. **Cinq curseurs sur cent-douze existent
tels quels.** Les 🟡 sont pour moitié `curves` et `channelMixer` : des
opérateurs voisins, pas les mêmes — un « Exposition » de Lightroom est un gain
en linéaire avec un genou aux hautes lumières, pas une courbe.

## Trois faits qui gouvernent la carte

1. **La postérisation en 8 bits.** Six curseurs de ton (Exposition, Contraste,
   Hautes lumières, Ombres, Blancs, Noirs) puis une courbe, puis HSL, puis
   Color Grading, chacun un aller-retour sRGB↔linéaire quantifié sur 256
   niveaux : à mesurer sur `mireRampe` AVANT de concevoir (histogramme de
   sortie, nombre de niveaux distincts). Si ça casse, le chantier commence par
   le 16 bits ou par un SEUL effet qui fait tout le ton en une passe flottante
   interne.
2. **Un effet par panneau OU un calque de réglage.** Lightroom = un seul jeu de
   réglages ordonnés ; nous = une pile. Un effet « Réglages de base » qui porte
   15 curseurs, un « HSL » qui en porte 33, etc., garde notre modèle et se
   masque comme les autres. Un « calque Lightroom » unique de 112 curseurs
   sectionnés est plus proche de la référence et impose l'ordre interne. Ça se
   tranche au grilling, pas ici.
3. **Ce qui n'est pas de la retouche : rien.** Tout ce module est de la
   RETOUCHE — sans ancrage sur la toile (`canvasControls` absent, critère
   d'Antoine du 2026-08-21) : pas de Déplacer, pas de poignées. Cohérent avec un
   calque de réglage Photoshop.
