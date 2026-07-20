# CONTEXT — shaderlab

App desktop **Windows** (Tauri v2 + React/TS + WebGPU/WGSL brut) d'effets visuels
"shader" temps réel sur photos JPEG : effets empilables en calques, masque au
pinceau par calque, undo/redo en session. Fait aussi office d'**éditeur externe
Lightroom** (round-trip). Domaine = édition d'image en calques non destructive.
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

**Éditeur externe Lightroom / Round-trip** — Lightroom exporte une copie → lance
l'app avec le chemin en argument → l'app **écrase ce même fichier** → Lightroom
réimporte (modèle type Dehancer). Phase 2, gate empirique propre. Source :
`CLAUDE.md:37-39`, `AGENTS.md`.

**Export / Exporter sous** — écriture du rendu vers un fichier JPEG (écriture
atomique tmp+rename). Source : `src/export/exportImage.ts`, `docs/design-system/patterns.md`.

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
confondre avec "Export / Exporter sous" (JPEG, round-trip Lightroom) — les
deux coexistent, aucun ne remplace l'autre.

**Pipeline 16-bit (print)** — mode de calcul dédié à l'export print :
textures internes en `rgba16float` au lieu du `bgra8unorm-srgb` du rendu
écran temps réel, pour éliminer le banding sur les dégradés d'effets
(bloom, halation, courbes). Reste sur le principe pipeline linéaire strict
(pas de gamma manuel) — n'ajoute qu'une profondeur de calcul plus grande, ne
change pas l'espace de calcul. Source : `PRD-print-export.md`.

## Concepts différés (nommés, pas encore construits)

- **Motion blur** (effet créatif) — flou directionnel ou radial simulant un
  mouvement de caméra/sujet ("low-shutter"), à cadrer par interview dédiée au
  moment du chantier effets. Source : session 2026-07-20.
- **Étage color grade** (effet créatif) — courbe de contraste + bleach bypass
  + split-tone highlights, distinct des 4 effets actuels. Même trigger que
  motion blur. Source : session 2026-07-20.

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

- **Panneau flottant** (`FloatingPanel`) — module UI déplaçable/repliable, pas dockée
  dans une barre latérale fixe. Trois instances prévues : Calques, Réglages,
  Masques (Tranche 4). _Avoid_: "panneau docké"/"sidebar" pour désigner le nouveau
  modèle — ces termes décrivent l'ancien `Inspector.tsx` fixe, remplacé.
  Source : `...-floating-panels-design.md`.
- **Dock virtuel** — position par défaut où les panneaux flottants s'accrochent au
  démarrage (ancré au premier panneau posé, pas une colonne dessinée/délimitée).
  Source : session 2026-07-20.
- **Magnétisme** — accrochage automatique d'un panneau à un autre panneau ou au bord
  du canvas au RELÂCHEMENT d'un drag (pas de recalcul continu). Bidirectionnel
  (horizontal ET vertical). Source : `...-floating-panels-design.md`.
