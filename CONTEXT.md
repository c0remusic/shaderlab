# CONTEXT — shaderlab

App desktop **Windows** (Tauri v2 + React/TS + WebGPU/WGSL brut) d'effets visuels
"shader" temps réel sur photos JPEG : effets empilables en calques, masque au
pinceau par calque, undo/redo en session. **Éditeur autonome** — le round-trip
Lightroom d'origine est déposé (ADR-0002, code retiré le 2026-07-30). Domaine =
édition d'image en calques non destructive.
Sources : `CLAUDE.md`, `AGENTS.md`, `docs/INDEX.json`, `docs/design-system/*`, `src/`.

> Glossaire de langage partagé. Chaque terme est ancré sur une source réelle du
> repo (fichier cité). Le maintenir via le skill `interview` (il tient ce fichier
> en direct pendant le cadrage d'une feature).

## Glossaire

**shaderlab** — nom de code provisoire du projet, jamais tranché. Source :
`CLAUDE.md:3`.

**Calque** (`LayerState`) — unité empilable de l'édition : porte un `effectId`, ses
`params`, un flag `enabled`, une `opacity` (0..1), un `blendMode`, et un masque.
Les calques forment une pile ordonnée (bas = sous, haut = dessus). Source :
`src/layers/types.ts`, `src/layers/layerStack.ts`. _Avoid_ : "filtre", "layer".

**Effet** (`EffectModule`) — traitement shader appliqué par un calque. Quatre
effets réels : **glow**, **chromatic bleed**, **warp**, **grain**. Un effet est un
module autonome ; en ajouter un = un nouveau fichier dans `src/render/effects/`,
zéro modif moteur/UI. Source : `src/render/effects/registry.ts`,
`src/render/effects/types.ts`. _Avoid_ : "filtre".

**Barre de qualité** — exigence produit : pas de rendu "filtre Photoshop 2005".
Chaque effet a une version pipeline (naïve) PUIS un upgrade qualité obligatoire
(dual-filter bloom, aberration radiale, warp FBM, grain luminance-dépendant). Un
effet qui rend cheap n'est pas terminé. Source : `CLAUDE.md:45-48`.

**Mode de fusion** (`BlendMode`, `blendMode`) — façon dont la sortie d'effet d'un
calque se combine avec le calque du dessous. `"normal"` = remplacement. Onze modes
réels : normal, multiply, screen, add, darken, lighten (séparables, en linéaire) +
overlay, hard-light, soft-light, color-burn, color-dodge (définis-gamma). Module
autonome comme les effets (`src/render/blend/`). Source : `src/render/blend/modes.ts`,
`src/render/blend/types.ts`. _Avoid_ : "blend mode" (anglais), "mélange".

**Opacité** (`opacity`) — force du calque, 0..1 (1 = effet à pleine force).
Combinée au masque : `opacity * maskValue`. Source : `src/layers/types.ts:6-7`.

**Masque** (`maskData`) — dose l'effet d'un calque pixel par pixel (r8, 1 octet/px,
taille de l'image), ou `null` (calque plein). Peint au pinceau. Principe produit :
"le masque dose un effet", il ne modifie jamais l'image elle-même. Source :
`src/layers/types.ts:10-14`. _Avoid_ : "sélection" (voir ci-dessous).

**Pinceau** (`MaskPainter`) — outil de peinture du masque à falloff radial
(diamètre/dureté/flow), plancher 60fps. Source : `src/mask/maskPainter.ts`,
`docs/superpowers/specs/2026-07-16-shaderlab-interview-prd.md`.

**Masque non-destructif / Source de masque / Fold** (design cible, pas encore
livré) — modèle où un masque = liste ordonnée de **sources** ré-éditables
(pinceau raster, dégradé, luminosité, range couleur) combinées par un **fold**
add/subtract/intersect (modèle Lightroom/Capture One). Source :
`docs/superpowers/specs/2026-07-18-shaderlab-layers-masking-design.md`,
`...-masking-prd.md`. _Avoid_ : "sélection" tant qu'on parle de masque (la sélection
géométrique rect/ellipse/lasso est un différé distinct, même doc).

**Refine edge** — ajustement du bord du masque combiné final, indépendant de
l'image : feather / contracter-dilater / lisser, + variante **edge-aware**
(accroche-contours, guided filter). Source :
`...-masking-design.md` §4bis, `docs/INDEX.json`.

**Historique** (`History`) — pile undo/redo de session uniquement (pas de
persistance disque), bornée à 512 Mo. Une interaction de slider = une entrée.
Source : `src/layers/history.ts`, `docs/superpowers/specs/2026-07-13-shaderlab-standalone-v1-design.md`.

**Éditeur externe Lightroom / Round-trip** — TERME HISTORIQUE, ne plus employer
au présent. Lightroom exportait une copie → lançait l'app avec le chemin en
argument → l'app **écrasait ce même fichier** → Lightroom réimportait (modèle
type Dehancer). Déposé : décision [ADR-0002](.claude/decisions/ADR-0002-abandon-round-trip-lightroom.md)
(2026-07-27), code retiré le 2026-07-30. _Avoid_ : « le round-trip » au présent,
« éditeur externe » pour décrire shaderlab.

**Ouverture par argument de lancement** — l'app reçoit un chemin en `args[1]`
et ouvre ce fichier (« Ouvrir avec » de Windows, double-clic sur un JPEG
associé). C'est le RESTE vivant de l'ancien round-trip, et il ne faut pas
confondre les deux : ouvrir un fichier passé au lancement est supporté,
l'écraser à l'export ne l'est plus — un tel document s'exporte en copie comme
tous les autres. Source : `src/launch.ts` (`getLaunchPath`),
`src-tauri/src/lib.rs` (`get_launch_path`).

**Export / Exporter sous** — écriture du rendu vers un fichier JPEG (écriture
atomique tmp+rename). Source : `src/export/exportImage.ts`, `docs/design-system/patterns.md`.

**Dossier d'export dédié** (design cible, pas encore livré) — dossier fixe
(`Images/shaderlab-export`) où atterrit l'export manuel par défaut, au lieu
d'à côté de la photo source. Depuis la dépose du round-trip (ADR-0002), c'est
le SEUL comportement d'export : plus aucun chemin n'écrit par-dessus un
fichier existant.
Override ponctuel via un bouton séparé "Exporter sous..." pour choisir un
autre dossier au cas par cas, sans changer le défaut. Source :
`PRD-export-folder.md`.

**Pan / zoom** (PRD, feature cadrée) — navigation du canvas : zoom molette centré
curseur, plafond 100% (pixel natif), pan borné, **fit-to-screen** à l'ouverture,
**minimap** au-delà du fit. Source :
`docs/superpowers/specs/2026-07-18-shaderlab-canvas-pan-zoom-prd.md`.

**Pipeline linéaire strict / sRGB** — toutes les textures couleur au format sRGB
préféré plateforme ; conversion sRGB↔linéaire automatique, JAMAIS de gamma manuel
en WGSL. Un seul pipeline, résolution native (pas de distinction preview/export).
Source : `CLAUDE.md:56-67`.

**Export pour impression** (design cible, pas encore livré) — second point
d'export, distinct de l'« Exporter sous » JPEG existant : produit un fichier
TIFF 16-bit/canal, Adobe RGB (1998), profil ICC embarqué, résolution native
(jamais d'upscale). Destiné à un tirage physique réalisé par un labo externe
— pas de soft-proofing dans l'app. Source : `PRD-print-export.md`. _Avoid_ :
confondre avec "Export / Exporter sous" (JPEG) — les deux coexistent, aucun ne
remplace l'autre.

**Pipeline 16-bit (print)** — mode de calcul dédié à l'export print :
textures internes en `rgba16float` au lieu du `bgra8unorm-srgb` du rendu
écran temps réel, pour éliminer le banding sur les dégradés d'effets
(bloom, halation, courbes). Reste sur le principe pipeline linéaire strict
(pas de gamma manuel) — n'ajoute qu'une profondeur de calcul plus grande, ne
change pas l'espace de calcul. Source : `PRD-print-export.md`.

**Preset** (livré 2026-07-26) — suite de calques
sauvegardée (effet + params + opacity + blendMode + ordre), SANS les masques
(spécifiques à chaque photo). Se sauvegarde/s'applique via une carte dockée
dédiée (première de la colonne, avant Calques). Appliquer un preset sur une
pile non vide demande confirmation avant de remplacer. Modifier les params
après application propose "mettre à jour le preset" ou "créer une copie".
Transportable par export/import de fichier (JSON), pas de réseau. Source :
`docs/wireframes/presets.html`, session 2026-07-24 ; implémentation
`src/presets/`, session 2026-07-26.
_Avoid_ : « profil », « style », « filtre enregistré » — on dit **preset**.

**Preset actif** (`activePresetId`, livré 2026-07-26) — le preset dont la pile
courante est issue. Posé à l'application, il sert à détecter la **dérive** et à
proposer « mettre à jour ». Il est effacé dès que la pile cesse d'être celle du
preset : autre preset appliqué, nouveau document, ajout ou suppression de
calque, ou annulation qui change la STRUCTURE de la pile. Il survit
délibérément à la sélection d'un calque et à la modification d'un paramètre —
sans quoi la dérive serait indétectable, la sélection étant remise à zéro à
l'application.
_Avoid_ : « preset courant », « preset sélectionné » (ambigu avec la ligne
surlignée dans la liste).

**Dérive** (livré 2026-07-26) — écart entre la pile courante et le preset actif,
comparé sur les valeurs (params, opacity, blendMode, activation). Distincte de
la comparaison STRUCTURELLE (nombre de calques + suite des `effectId`), qui sert
elle à décider si le preset actif doit être effacé après une annulation. Les
deux ne doivent pas être confondues : une dérive de valeurs se répare en
mettant à jour le preset, une divergence de structure signifie qu'on ne
travaille plus sur ce preset du tout.
_Avoid_ : « preset modifié » comme terme technique (c'est le libellé affiché à
l'utilisateur, pas le concept).

**Double exposure** (cadré 2026-07-24, livré 2026-07-25 ; plafond porté à 4
calques photo en T5, 2026-07-26) — une ou plusieurs **silhouettes** (sujet
isolé, fond effacé) posées sur un **fond** (la photo de base du document),
avec position/échelle/rotation manuelles. La
silhouette devient un **calque de photo** — même modèle que les calques
d'effet actuels (effets/masque/blend applicables dessus), mais porte une
**source d'image propre** au lieu de traiter la photo de base du document
(rupture avec l'hypothèse "un seul document = une seule photo source").
Isolation du sujet en v1 = pinceau manuel (`MaskPainter` existant) — la
segmentation automatique ML locale est un différé (voir ci-dessous).
Le masque peint sur un calque de photo vit dans l'espace de coordonnées de
la photo de FOND, pas de la photo importée elle-même — déplacer le calque
après avoir peint ne fait PAS suivre le masque (comportement assumé v1, pas
un bug ; poser le transform avant de peindre). Source : ARCHITECTURE.md §4.5.
Le round-trip Lightroom coupait l'écrasement en place dès qu'un calque photo
était présent (prédicat `hasImportedPhotoLayer`) : ce croisement n'existe plus,
le round-trip a été retiré le 2026-07-30 (ADR-0002). Tout export est une copie,
quel que soit le contenu de la pile. **Le prédicat, lui, reste** — il sert
désormais de frontière à l'avis « calque photo exclu » d'un preset
(`presets/presetDocument.ts`), un usage sans rapport avec l'export. Source :
ARCHITECTURE.md §4.6.
**Limite dure : `MAX_PHOTO_LAYERS` calques photo par document, valeur 4 depuis
T5** (`src/layers/photoLayer.ts`) — soit au plus 5 photos sources à l'écran
(le fond + 4). La photo de FOND n'est pas un calque et ne compte pas dans ce
plafond. Limite atteinte : l'import est refusé côté application par
`canAddPhotoLayer`, avec un message d'erreur nommant le plafond dans
`ErrorBanner` — jamais un crash ni un import silencieusement ignoré. Un second
plafond distinct, `MAX_REGISTERED_PHOTO_SOURCES` (= `4 × MAX_PHOTO_LAYERS`,
`src/render/photoSourceStore.ts`), borne les sources GPU encore vivantes
après des boucles importer/annuler (pas de refcount : une source n'est libérée
qu'au changement de document). La valeur 4 est une **borne de sécurité VRAM
non encore mesurée** : critère de révision écrit sur la constante, protocole de
mesure dans `docs/superpowers/specs/2026-07-26-shaderlab-photo-layer-parity-design.md`.
Source : sessions 2026-07-24 et 2026-07-26.

## Concepts différés (nommés, pas encore construits)

- **Motion blur** (effet créatif) — flou directionnel ou radial simulant un
  mouvement de caméra/sujet ("low-shutter"), à cadrer par interview dédiée au
  moment du chantier effets. Source : session 2026-07-20.
- **Étage color grade** (effet créatif) — courbe de contraste + bleach bypass
  + split-tone highlights, distinct des 4 effets actuels. Même trigger que
  motion blur. Source : session 2026-07-20.
- **Segmentation auto de sujet** (isolation silhouette par ML locale, ex.
  MediaPipe Selfie Segmentation / U²-Net / BiRefNet — pas encore choisi) —
  fast-follow de **Double exposure** ci-dessus, écarté du v1 par incertitude
  technique (poids du modèle, vitesse réelle 24MP non benchmarkée). Trigger de
  réouverture : spike technique validant un temps de segmentation acceptable
  sans casser le flux d'exploration. Distinct de **Depth mask / segmentation
  sémantique** (sujet/ciel/fond, MiDaS/Depth-Anything) déjà listé plus bas —
  même famille technique, cette entrée-ci est spécifiquement liée au besoin
  double exposure. Source : session 2026-07-24.

- **Groupe** — conteneur de calques avec opacité/blend/masque propres sur le
  résultat aplati des enfants (compositing imbriqué). Tranche 5.
- **Pellicule de session / workspace multi-photo** — bande de vignettes de la
  session. Source : `...-standalone-v1-design.md`.
- **Depth mask** / **segmentation sémantique** (sujet/ciel/fond) — masques par
  vision ML locale (MiDaS/Depth-Anything ; PAS un LLM). Différés à trigger nommé.
- **Sélection géométrique** (rect/ellipse/lasso/pen Bézier) — différée, distincte
  du masque. Source : `...-masking-prd.md`.

## Relations / cardinalités

- Un **calque** a exactement : un **effet**, ses **params**, une **opacité**, un
  **mode de fusion**, et zéro-ou-un **masque**. (`src/layers/types.ts`)
- La **pile de calques** ordonnée = le document en cours d'édition ; le compositing
  descend bas→haut via `opacity * maskValue` + blend mode. (`...-masking-design.md`)
- **Effets** et **modes de fusion** sont extensibles par module autonome (registry) :
  un nouveau = un fichier, sans toucher le moteur ni l'UI. (`effects/registry.ts`,
  `blend/registry.ts`)
- Un **masque** (modèle cible) = une liste ordonnée de **sources** repliées par un
  **fold** ; **refine edge** s'applique au masque combiné final.
- **Historique** partage par référence les masques immuables des calques (copie au
  remplacement, jamais de mutation en place). (`src/layers/types.ts:10-14`)

- **Pasteboard** (`.pasteboard`, `src/components/Canvas.tsx`) — la surface sur
  laquelle repose la **toile**, et tout ce qui l'entoure : le pourtour sombre
  visible autour de l'image. Nommé le 2026-08-01 (avant, il n'avait aucun nom —
  on disait « la zone autour du canvas »). Terme repris d'InDesign/Photoshop,
  où il désigne la même chose (**table de montage** en français, mais on garde
  l'anglais : « table de montage » se confondrait avec la **toile de montage**,
  qui est le document lui-même).
  Ce n'est PAS un décor : deux gestes lui appartiennent en propre — cliquer
  dedans **désélectionne** (seule sortie de sélection quand une photo couvre
  toute la toile), et `Espace` maintenu + glisser **déplace la vue** depuis
  n'importe où, pas seulement au-dessus de l'image.
  Ne pas confondre avec la **zone visible** (`.pasteboard__view`), qui est la
  fenêtre de clipping du viewport à l'intérieur du pasteboard, ni avec la
  **toile** (`.pasteboard__canvas`), qui est le document.
- **Panneau flottant** (`FloatingPanel`) — ⚠️ **N'EXISTE PLUS** : supprimé le
  2026-07-20/21, remplacé par `PanelColumn`/`DockedPanelCard`
  (`src/components/dockedPanel/`). Les trois entrées qui suivent (rail d'icônes,
  dock virtuel, magnétisme de panneau) décrivent ce chantier abandonné et sont
  conservées comme HISTORIQUE, pas comme vocabulaire courant — voir CLAUDE.md
  § Stack pour l'état réel. Description d'époque : module UI déplaçable/repliable, pas dockée
  dans une barre latérale FIXE au sens de l'ancien `Inspector.tsx` (remplacé).
  Trois instances prévues : Calques, Réglages, Masques (Tranche 4). Peut être
  **docké** dans le **rail d'icônes** (voir ci-dessous, PRD cadré 2026-07-20,
  pas encore implémenté) — "docké" ici désigne cet état spécifique, pas
  l'ancien Inspector. Source : `...-floating-panels-design.md`.
- **Rail d'icônes** (design cible, pas encore livré) — colonne fixe d'icônes
  (une par panneau) qui bascule l'affichage/masquage de CHAQUE panneau
  indépendamment (plusieurs dockés visibles empilés en même temps, pas des
  onglets à un seul actif). Un panneau docké peut être sorti en flottant par
  drag (et redocké pareil, ou en cliquant son icône qui reste visible même
  flottant). État par défaut au lancement. Vérifié le 2026-07-20 : PAS un
  système de fusion en onglets (piste explorée puis écartée par Antoine après
  vérification en direct sur photoshop.adobe.com). Source : `PRD-floating-panel-rail.md`.
- **Dock virtuel** — zone occupée par défaut par Calques + Réglages empilés au
  démarrage, PAS une colonne dessinée/délimitée (§5 : l'ancrage lui-même suit le
  premier panneau posé, pas une position fixe ; §8 : sa largeur par défaut sert de
  constante statique `DEFAULT_PANEL_COLUMN_WIDTH` pour le centrage du canvas —
  deux usages du même dock, à ne pas confondre). Source :
  `...-floating-panels-design.md` §5+§8.
- **Magnétisme** — accrochage automatique d'un panneau à un AUTRE PANNEAU
  uniquement (jamais au bord du canvas, retiré 2026-07-20 après retour Antoine)
  au RELÂCHEMENT d'un drag (pas de recalcul continu). Bidirectionnel (horizontal
  ET vertical). Source : `...-floating-panels-design.md` §5.
