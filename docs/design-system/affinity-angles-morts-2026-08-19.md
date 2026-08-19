# Les angles morts — ce que cinq relevés n'avaient PAS vu chez Affinity

Relevé le 2026-08-19 au soir pour l'audit v2, par lecture INTÉGRALE des
22 773 identifiants de `Serif.Affinity.dll`
(`.scratch/affinity/research/serif-affinity-identifiants.txt`), en excluant
tout ce que les relevés précédents couvraient déjà. **Tout ce qui suit est au
niveau de preuve `[symbole]`** — des noms, qui prouvent l'existence, jamais la
qualité. La règle de la carte tient : regarder dans l'app avant d'écrire du
code, et un candidat n'ouvre un ticket que sur un geste nommé chez nous.

Classement par intérêt pour NOTRE hybride Photoshop/Lightroom.

---

## Intérêt MAXIMAL — le cœur de la moitié Lightroom

### 1. Le persona Develop (RAW) est entièrement cartographié

Six pages — Basic, Tones, Details, Lens, Mask, Overlays — plus snapshots.
Catégories relevées : profil, balance des blancs (`WhiteBalanceKelvin` avec
min/max, `AutoWhiteBalance`, `EstimateFromImage`, `Daylight`), exposition,
ombres/hautes lumières, enhance, courbe tonale (`RAWToneCurve`,
`ToneCurveType`) ; réduction ET addition de bruit ; correction d'objectif
(`LensProfile` — **un DOSSIER UTILISATEUR de profils** + favoris
synchronisés, pas une base fermée), aberration chromatique, defringe,
vignette d'objectif et post-recadrage ; moteur : `RAWEngine`, `Demosaic`,
`DemosaicMethod`, `CFAFormat`, `SubtractBlackLevel`, `CommitDevelop`.
**Les corrections locales du Develop sont des « overlays » INDEXÉS avec
modèles de masque typés** (plage de teinte, plage d'intensité) et opacité
par overlay.
*Pour nous* : c'est la carte de référence du jour où la moitié Lightroom se
construit — et la partie non-RAW (WB, exposition, courbe, ombres/hautes) est
déjà mesurée au pixel dans
[`02-ajustements-mesures.md`](../../.scratch/affinity/research/02-ajustements-mesures.md).
Le RAW lui-même (dématriçage) est un AUTRE métier — à ne pas confondre avec
« développer un JPEG », qui est notre cas et ne demande rien de tout ça.

### 2. Métadonnées : XMP, IPTC, EXIF — le plus gros manque de tous nos relevés

`LoadXmpSidecarMetadata`, `ImportFromXmpCommand`/`ExportToXmpCommand`,
`XmpCrs` (les réglages Camera Raw !), IPTC complet (vingt champs relevés),
`ExifPage` avec données brutes/détail/résumé, `StripAllExifCommand`,
`StripGpsLocationCommand`, `Keywords`, dates, `DocumentID`/`InstanceID`,
`PiiWarning`.
*Pour nous* : notre export est muet — un JPEG sans EXIF ni copyright. Pour un
photographe, PRÉSERVER les métadonnées de la photo source à l'export (et
pouvoir retirer le GPS) n'est pas un luxe, c'est le contrat de base. Candidat
concret et borné : recopier les blocs EXIF/XMP de la source dans l'export,
avec une case « retirer la géolocalisation ». Bien plus petit que « faire un
DAM ».

### 3. Analyse d'image : scopes vidéo, statistiques, échantillonneurs

`Waveform` (RGB et intensité), `Vectorscope`, `RGBParade` ; histogramme avec
`Mean`/`Median`/`StandardDeviation`/`Kurtosis`/`Skewness` et « générer
l'histogramme fin » ; échantillonneurs de couleur PERSISTANTS multiples
(`Samplers`, `AddNewSampler`) ; `FocusPeaking` et `ShowAutoFocusRegions`
(les collimateurs AF du boîtier, lus des métadonnées !).
*Pour nous* : un panneau Histogramme est déjà une évidence de l'hybride ;
la waveform/parade est LE juge d'une correction tonale — et notre moteur
recompose en 23 ms, un scope temps réel est dans nos moyens. Candidat fort.

### 4. Fusions multi-images — HDR, focus stacking, panorama, astro

`NewHDRMergeDocumentDialog`, `NewFocusMergeDocumentDialog`,
`NewPanoramaDocumentDialog`, `NewStackDocumentDialog` (+ astro), alignement
automatique, anti-fantômes, méthodes d'empilement statistique
(`SigmaClipping`…), projection ÉQUIRECTANGULAIRE LIVE (retoucher une 360°
en vue rectilinéaire, re-projetée non destructivement).
*Pour nous* : hors périmètre v1, mais c'est la liste des chantiers que le
positionnement « hybride » finira par croiser. Noté, aucun ticket.

### 5. L'export peut produire une LUT 3D et un timelapse

`ExportLUTDialog`/`Export3DLutCommand` — **transformer la retouche en LUT
partageable** ; `ExportTimelapseDialog` — un film de la session d'édition.
Formats non relevés ailleurs : JPEG XL, WebP, EXR (avec modes de
compression exposés), TGA.
*Pour nous* : l'export LUT est le miroir du candidat « LUT 3D en entrée »
déjà listé — le PAIRE entrée/sortie ferait de nos looks un format
d'échange. Petit une fois la LUT d'entrée faite.

## Intérêt FORT — l'atelier

### 6. Vues : avant/après, points de vue nommés, profils de fenêtres

`SplitViewModeCommand` (+ synchronisation), `MirrorViewModeCommand`,
douze modes d'affichage, rotation de la vue ; **`NavigatorViewpoint` — des
points de vue NOMMÉS, enregistrés, navigables** (`Next/PreviousViewPoint`) ;
`WindowProfiles` persistés, `ApplyStudioPresetCommand1…9` (neuf dispositions
de panneaux au clavier).
*Pour nous* : l'avant/après est un manque RÉEL de notre app de retouche
(juger un réglage exige aujourd'hui de basculer l'œil du calque) ; les
points de vue nommés servent la retouche répétitive (zoom 100 % sur le
visage, retour au cadrage). Deux candidats bornés.

### 7. Softproof = calque d'ajustement, gamut check, point blanc en nits

`SoftProofAdjustment` empilable et masquable, `GamutCheck`, intentions de
rendu, `BlackPointCompensation`, `MonitorReferenceWhiteInNits`,
`MonitorProfile` PAR ÉCRAN.
*Pour nous* : rejoint le ticket 11 (16 bits / gestion couleur) — l'épreuvage
en CALQUE est architecturalement supérieur au mode global et cadre avec
notre modèle « tout est calque ». À ranger dans le chantier couleur.

### 8. Macros : le problème n° 1 des Actions Photoshop est résolu dans le nom

`MacroScaleMode`/`MacroAlignMode` — comment les coordonnées enregistrées se
réinterprètent sur un document d'une AUTRE taille ; `MacroSelectLayerDialog`
— la macro DEMANDE sa cible à la lecture ; paramètres d'étape éditables
après coup.
*Pour nous* : nos presets d'effet couvrent la recette ; si un jour une
« macro » naît, c'est CE cahier des charges (échelle, cible, éditabilité) —
pas celui de Photoshop.

### 9. Assistant : des POLITIQUES au lieu de dialogues modaux

`RasterisePolicy` (rasteriser d'abord / rien / demander),
`AutoLockBackground`, `AutoConvertProfiles`, actions de l'assistant
annulables séparément (`AutoUndoRedoAssistantActions`).
*Pour nous* : la leçon UX — quand un geste est impossible sur la cible
(poser un effet sur un calque verrouillé, peindre hors masque), une politique
configurable et une notification annulable battent la modale. À garder pour
le jour où nos verrous multiplient les refus.

### 10. Batch en file NON bloquante, Layer States, canaux de réserve

Batch : panneau persistant, compteur, statut par item — on travaille pendant
l'export. `LayerStates` : des variantes NOMMÉES de visibilité/propriétés
dans un document (comparer deux versions d'une retouche sans dupliquer le
fichier). Canaux de réserve : sélections persistées, sauvables en fichier,
rechargeables.
*Pour nous* : le batch rejoint le candidat export ; les Layer States sont un
cousin des presets de masque/d'effet — geste réel (« version N&B / version
couleur »), coût moyen. Candidats.

### 11. Performance : benchmark intégré, biais iGPU/eGPU, garde-fous

`BenchmarkDialog` (scores raster/vecteur, CPU/GPU, mono/multi),
`IntegratedGPUBias`/`ExternalGPUBias`, `RAMUsageLimit`, détection
d'overlays tiers (`RivaTuner` — qui cassent le rendu), politiques de
récupération fichier très fines (taxonomie d'erreurs CRC/décompression/
espace disque/permissions).
*Pour nous* : notre `perf-probe` est déjà un banc — l'idée « benchmark
self-service dans l'app » est son prolongement utilisateur. La détection
RivaTuner est un vrai piège de terrain WebView2 aussi. Notes d'outillage.

## Intérêt PARTIEL ou écarté — avec la raison

- **Liquify** : maillage sérialisable (`SaveMesh`/`LoadMesh`/`UseLastMesh` —
  réappliquer la dernière déformation), gel/dégel, ET disponible en LIVE
  filter. Notre `warp`/`meshWarp` n'existe pas en interactif — c'est un
  chantier d'outil sur toile (famille ticket 25), noté.
- **ToneMapping persona** : les courbes de stretch NOMMÉES (Arcsinh,
  Sigmoid, Logarithmic) et `ToneCompressionAdjustment` en calque — rejoint
  la mesure Filmic du relevé ajustements. Au chantier couleur/HDR.
- **Ratings/tags/favoris** : proto-DAM par document — pas de catalogue
  global chez eux non plus (le vrai DAM n'existe PAS dans Affinity : pas de
  base, pas de collections — notre relevé le confirme par l'absence).
- **Stock, contenu cloud, IA générative, personas astro/panorama en tant
  que produits** : autres produits. L'architecture des GÉNÉRATIONS (file de
  variations navigable ATTACHÉE au calque) est élégante — notée pour le
  principe, aucun usage chez nous sans IA.
- **Grilles isométriques 12 modes, plans de perspective, QR codes,
  Publisher entier (~30 % du fichier)** : hors périmètre photo — signalé
  pour que personne ne re-fouille.
- **P2P** : envoi de document à un pair AVEC l'historique (`SendWithHistory`)
  — curiosité remarquable, aucun geste chez nous.
- **MCP serveur intégré** (`PrefMCPPage`, permissions granulaires FS/réseau/
  scripts, inférence locale/distante) : c'est l'instrument même de nos
  mesures — stratégiquement notable (un éditeur photo pilotable par agents),
  et le modèle de PERMISSIONS est le bon patron si shaderlab expose un jour
  une surface d'automatisation.

## Tablette et entrées — pour le jour du stylet

`TabletPolicy` (CHOIX de la pile : WinTab / Windows Ink / Pointer API — la
source n° 1 des bugs de pression), `TouchForGesturesOnly` (le doigt navigue,
le stylet dessine), `PressureCurves` + presets, Surface Dial contextuel
(`UpdateDialForTool`), haptique. Notre pinceau de masque n'a AUCUNE gestion
de pression aujourd'hui ; le jour venu, la `TabletPolicy` est le piège à
connaître avant d'écrire une ligne.

## Ce que ce relevé ne dit pas

Une liste plate de noms : aucune plage, aucun défaut, aucun ordre d'écran,
et des identifiants tronqués par l'extraction (le rapport source note des
noms corrompus). Chaque item promu en ticket repasse par la règle : regarder
l'app, mesurer si mesurable, geste nommé chez nous.
