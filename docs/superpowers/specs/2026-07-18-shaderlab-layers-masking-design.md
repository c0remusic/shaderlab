# Design (COMMENT) — Système de calques & masquage de shaderlab

> Produit par `superpowers:brainstorming` à partir du PRD full-scope
> `2026-07-18-shaderlab-layers-masking-prd.md` (le QUOI). Ce document est le
> COMMENT : architecture, modèle de données, pipeline, UI, découpage en tranches.
> Brainstorming réel avec Antoine, 2026-07-18, nourri par une cartographie du code
> existant (agent Explore) et une recherche sur les logiciels de référence
> (Lightroom, Photoshop, Capture One, Affinity, DaVinci Resolve, Krita).
>
> Validation finale = checkpoint visuel humain dans la vraie fenêtre WebView2 (CDP) —
> Playwright headless rend noir sur canvas WebGPU (règle projet).

## Contexte code (état réel, vérifié)

- `LayerState` (`src/layers/types.ts:1-11`) = `{ id, effectId, params, enabled,
  maskData: Uint8Array | null }`. **Ni `opacity` ni `blendMode`** (grep global :
  zéro occurrence de blend dans `src/`).
- Compositing actuel (`src/render/renderer.ts:256-290`) = **effect-chain
  séquentielle** : chaque calque lit le résultat du précédent, applique son effet
  masqué, et **écrase** l'entrée du suivant. Le seul mélange est
  `mix(color, effected, maskValue)` **par passe** (`src/render/shaderCompose.ts:44`)
  — l'effet dosé par le masque contre son image d'entrée, PAS un blend inter-calques.
  (Ironie notée : c'est le modèle « effect chain » critiqué chez DASCA.)
- Effets = modules statiques `EffectModule { id, name, params, wgsl, passes? }` dans
  `src/render/effects/registry.ts:8`, validés fail-fast, bindings explicites.
- Masque = `Uint8Array` r8 pleine résolution ; peinture via `MaskPainter`
  (`src/mask/maskPainter.ts`) → `DirtyRect`, upload GPU scopé au rect
  (`src/render/maskUpload.ts`) — ce chemin est le fix du crash OOM 2026-07-15.
- History (`src/layers/history.ts`) = snapshots `LayerStack` entiers, budget 512 Mo
  par **refcount de buffers de masque**.
- UI (`src/components/`) : inspecteur droit = `LayerPanel` (liste) + `ParamPanel`
  (disclosures Effet / Masque). Masque piloté au **pinceau seul** aujourd'hui.

## Décisions de conception (tranchées au brainstorming)

### 1. Compositing par calque (blend + opacité) — généralisation d'une ligne

Le compositing **couleur** par calque se fait en **généralisant l'unique `mix()`**
existant, sans passe de compositing couleur supplémentaire ni buffer d'accumulation
couleur (le `maskValue` de cette ligne provient, lui, du fold masque décrit en §4, qui
ajoute bien ses propres passes r8 en amont — le « une seule ligne » ne vaut que pour le
**blend couleur**, pas pour la production du masque) :

```
out = mix(input, blend(input, effected, blendMode), opacity * maskValue)
```

- `input` = composite courant sous le calque (ce que la passe lit déjà).
- `effected` = sortie de l'effet du calque (inchangé).
- `blend(base, top, mode)` = fonction de mélange (voir §2).
- Mode **Normal** ⟹ `blend(input, effected) = effected` ⟹ `out = mix(input,
  effected, opacity*maskValue)` = **exactement le comportement actuel** quand
  opacité = 1. **Rétro-compatible**, se greffe dans le fragment wrapper
  (`shaderCompose.ts`), reste dans la passe par calque déjà en place.

`LayerState` gagne deux champs : `opacity: number` (0..1) et `blendMode: string`
(id d'un module de blend). Défauts : `opacity: 1`, `blendMode: "normal"` — un calque
existant (sans ces champs, chargé d'un ancien état) prend ces défauts ⟹ rendu
identique à avant.

### 2. Blend modes — registry + linéaire/gamma ciblé

Chaque mode de fusion = un module `BlendMode { id, name, wgsl }` dans un registry
calqué sur `effectRegistry` (même pattern : liste statique typée, validée
fail-fast). Ajouter un mode = un fichier, zéro modif moteur/UI.

**Espace colorimétrique** (tension PRD tranchée) : **conversion ciblée par mode**,
pas de toggle exposé.

- Modes **séparables** corrects en linéaire (`normal`, `multiply`, `screen`, `add`,
  `darken`, `lighten`) : calculés directement dans les textures de travail
  (linéaires).
- Modes **définis en gamma** par Photoshop (`overlay`, `soft-light`, `hard-light`,
  `color-burn`, `color-dodge`) : le WGSL du mode **encode sRGB → applique la formule
  → redécode**, localement au calcul du blend. Le pipeline reste **linéaire strict**
  (la conversion est interne au shader du mode, aucune texture n'est stockée en
  gamma).
- Justification recherche : parmi 6 logiciels de référence, le SEUL toggle
  gamma/linéaire exposé à l'utilisateur est « Blend RGB Colors Using Gamma 1.0 »
  (Photoshop) — il ne touche qu'opacité/masques (pas curves/gradients) et **casse le
  rendu** sur certaines versions. ⟹ ne pas exposer de toggle, imposer le linéaire
  silencieusement. Affinity et DaVinci compositent en linéaire nativement.

Chaque module gamma porte le encode/decode dans son WGSL ; les modules linéaires ne
le portent pas ⟹ le coût sRGB n'est payé que par les modes qui en ont besoin.

### 3. Masque non-destructif — liste de sources (modèle Capture One / Lightroom)

`maskData: Uint8Array` devient `mask: LayerMask` — un **conteneur** portant une liste
ordonnée de sources ré-éditables **plus** les propriétés du masque entier
(inversion, désactivation, refine edge) exigées par le PRD (invert / disable / copie,
PRD §Masques) :

```ts
interface LayerMask {
  sources: MaskSource[];          // liste ordonnée, foldée dans l'ordre
  invert: boolean;                // inverse le masque ENTIER (1 - fold), PRD:68
  enabled: boolean;               // désactive le masque ENTIER sans le perdre, PRD:68
  refineEdge: RefineEdgeParams;   // feather / contract-dilate / smooth, live (§4)
}

interface MaskSource {
  id: string;
  type: 'brush' | 'gradient' | 'luminosity' | 'colorRange';
  combineMode: 'add' | 'subtract' | 'intersect';
  enabled: boolean;               // désactive CETTE source (distinct de mask.enabled)
  // paramétriques (gradient/luminosity/colorRange) :
  params?: Record<string, number | number[]>;   // + échantillons couleur pour colorRange
  // pinceau :
  raster?: Uint8Array;   // r8 pleine résolution, accumulation des strokes
}

interface RefineEdgeParams {
  feather: number;                // px, flou du bord
  contract: number;               // px signé, contracter(-)/dilater(+)
  smooth: number;                 // itérations de lissage
  edgeAware: boolean;              // §4bis — guided filter, ajouté 2026-07-19
  edgeRadius: number;              // px, rayon du box-filter guidé
  edgeStrength: number;            // 0..1, interpolation masque brut ↔ masque affiné
}
```

- **Copie de masque vers un autre calque** (PRD:63-66, indépendante figée) = **deep
  copy** du `LayerMask` à l'instant de la copie (sources clonées, rasters copiés) →
  aucun lien synchronisé, chacun vit sa vie. Distinct du partage de référence de
  `clone()` (qui reste pour l'historique, masques immuables par convention).
- **Pinceau = cas raster** : le **mécanisme d'upload dirty-rect est préservé**
  (`MaskPainter` + `DirtyRect` + `maskUpload` inchangés) — le pinceau peint dans SON
  `raster`, écrit seulement la région touchée. ⚠️ Mais le pinceau n'est plus la
  texture masque finale : voir §4 (le rendu gagne une passe de fold ; l'affirmation
  « chemin de peinture totalement inchangé » de la première version de ce design
  était FAUSSE — cf. revue adverse 2026-07-18).
- **Sources paramétriques** = `params` seulement (minuscules), la contribution masque
  est calculée par une passe shader image→masque. Ré-éditables à tout moment (déplacer
  un dégradé, re-régler une tolérance couleur) — c'est ce qui rend le modèle
  non-destructif.
- **colorRange** : `params` porte une liste d'échantillons de couleur cumulés dans la
  MÊME source (échantillonnés en **linéaire**) + tolérance/dureté globales (décision
  PRD).

### 4. Pipeline de fold + refine edge — GPU résident (résolution du bloquant)

**Le point load-bearing du design, corrigé après revue adverse.** Aujourd'hui la
preview live du pinceau uploade le raster brut comme LA texture masque et le renderer
échantillonne **une** texture masque par calque (`App.tsx:196-200`, `shaderCompose.ts`
binding 3). Sous `mask: LayerMask` avec plusieurs sources, la texture que lit l'effet
doit contenir le **fold** (sources combinées + invert + refine edge), pas un raster
brut. Deux voies rejetées : re-folder en CPU par sample (casse le 60fps) ; re-uploader
un buffer plein par sample (c'est précisément le crash OOM 2026-07-15). Voie retenue :
**fold sur GPU sur des textures résidentes.**

Modèle de textures (toutes r8, hors chaîne couleur) :

- **Chaque source a sa texture GPU résidente** :
  - pinceau ⟹ texture mise à jour par le **dirty-rect existant** (`maskUpload` /
    `writeTexture` scopé, **mécanisme inchangé** — c'est ce qui a résolu l'OOM) ;
  - paramétrique ⟹ texture rendue depuis `params` par une passe shader, **régénérée
    seulement au changement de params** (budget ~100 ms, pas 60fps).
- **Passe de fold GPU** (par frame ou à invalidation) → **texture masque finale** du
  calque, que l'effet échantillonne (même binding 3, `shaderCompose.ts` inchangé) :
  1. Seed = contribution de la **1ère source `enabled`** directement (son `combineMode`
     est **ignoré** — l'accumulateur ne part PAS de 0, sinon une 1ère source en
     `subtract`/`intersect` donnerait un masque nul partout ; l'UI marque la 1ère
     source « base »).
  2. Pour chaque source `enabled` suivante : `add` = `max(acc, src)`, `subtract` =
     `clamp(acc - src, 0, 1)`, `intersect` = `min(acc, src)`.
  3. `mask.invert` ⟹ `acc = 1 - acc`.
  4. **Edge-aware** (`mask.refineEdge.edgeAware`, §4bis) — le bord du masque foldé
     épouse les contours de contraste de l'image du calque, **avant** l'étape 5.
  5. **Refine edge forme-seule** (feather / contracter-dilater / lisser) = passes
     shader sur le résultat de l'étape précédente, **live** (`mask.refineEdge`,
     ré-appliqué à chaque changement). Indépendant de l'image (décontamination
     écartée, PRD) — ordre volontaire : edge-aware d'abord (comme Photoshop Select
     and Mask, qui applique la détection de contour avant feather/smooth), sinon le
     feather effacerait ce que l'edge-aware vient de préciser.
  `mask.enabled === false` ⟹ pas de fold, l'effet est appliqué sans masque. **Idem si
  AUCUNE source n'est `enabled`** (pas de seed possible) ⟹ masque plein, effet non
  masqué (jamais de comportement indéfini / masque nul silencieux).

**Impact honnête sur le crash 24MP** : le dirty-rect d'upload ne change pas, MAIS le
**rendu gagne des passes de fold GPU** sur exactement le chemin qui **avait** le
crash 24MP (déclencheur documenté : `setLayers()` / render résident en fin de stroke,
`2026-07-17-native-wgpu-decision.md`). C'est un **ajout de travail GPU sur ce chemin**
— corrigé après revue adverse Codex 2026-07-19, cette phrase disait encore « non
résolu », stale par rapport au §Sécurité crash (crash **résolu** `e3c7584`, gate
**levé**). La contrainte qui en découle n'est plus un blocage mais une règle de
conception : garder les gros buffers/textures de masque hors du state React (déjà
respecté par ce design, source de vérité en ref + textures GPU résidentes).

**Optimisation 60fps** : pendant un stroke de pinceau, seule la texture de la source
active change ; on met en **cache l'accumulateur foldé des sources en amont** de la
source active, et on ne recompose par frame que `[cache amont] ∘ [source active] ∘
[sources en aval] ∘ refine edge`. Le fold amont n'est pas recalculé pendant le stroke.
⚠️ Cette optimisation s'applique aux sources amont, PAS au refine edge lui-même :
feather/contract/smooth/edge-aware restent dans la portion « sources en aval + refine
edge » de la chaîne et se **recomposent à chaque frame de fold** — donc à chaque
frame de peinture pendant un stroke actif si le refine edge est en aval de la source
peinte (cas normal, une seule source active à la fois). Le §4bis en tient compte
explicitement (l'edge-aware n'a PAS le budget "recalculé seulement au changement de
paramètre" des sources paramétriques — corrigé après revue adverse Codex 2026-07-19,
la version précédente de ce document affirmait l'inverse, à tort).

Sources de masque = modules autonomes (`MaskSourceModule`, même esprit que les
effets : `{ id, type, name, params, wgsl? }`) ⟹ ajouter une source (différés : lasso,
géométrique…) = un fichier.

### 4bis. Edge-aware refine — guided filter GPU séparable

**Ajouté 2026-07-19** (cadré avec Antoine — cf. référence Adobe Lightroom/Photoshop
"Select and Mask"/edge detection, initialement listé **différé** dans
`2026-07-18-shaderlab-layers-masking-prd.md:123-125`, réintégré à la vague 1 sur
demande explicite plutôt que d'attendre le trigger de réouverture). **Corrigé après
revue adverse Codex 2026-07-19** : invalidation, budget VRAM, format, placement de
tranche, aperçu live pendant un stroke, et tests — voir les points marqués ci-dessous.

**Placement de tranche — corrigé (finding Codex MOYENNE)** : la v1 plaçait l'edge-
aware en **Tranche 2**, contredisant le découpage faisant autorité (§Découpage plus
bas) qui range le refine edge dans la **Tranche 3** (« Sources paramétriques » —
dégradé/luminosité/range couleur + refine edge, §3-4), aux côtés du refine edge
forme-seule déjà prévu — la Tranche 2 ne fait que le modèle non-destructif + fold
GPU, sans aucune source encore branchée à l'UI. **Edge-aware ships en Tranche 3**,
pas 2 : il opère sur le résultat du fold (disponible dès la Tranche 2) mais son
implémentation/UI arrive avec le reste du refine edge, cohérent avec l'ordre déjà
acté §4 étape 5 (edge-aware avant feather/contract/smooth, même tranche).

**Objectif** : le bord du masque foldé s'aligne sur les contours de contraste réels
de la photo (silhouette contre fond, bords nets) — pas juste une forme géométrique
abstraite. **Portée assumée** : approxime le comportement de Photoshop sur bords nets/
silhouettes, ne vise PAS le matting fin cheveux/fourrure (alpha-matting global type
Select and Mask complet — écarté pour le coût de calcul et le risque sur le budget
temps réel, cf. question posée à Antoine pendant le brainstorming).

**Algorithme retenu (guided filter séparable, He et al. 2010)** — même famille que
le dual-filter bloom déjà dans le moteur (`docs/superpowers/changes/2026-07-12-
shaderlab-mvp/design.md`, Task 13). **Précision complexité (nuance ajoutée après
revue adverse Codex 2026-07-19)** : la séparabilité réduit le coût par pixel d'un
box-filter de `O(edgeRadius²)` (2D naïf) à `O(edgeRadius)` (deux passes 1D) — ce
n'est **pas** indépendant du rayon comme la v1 le laissait entendre, juste
linéaire au lieu de quadratique. Reste nettement moins cher qu'un bilatéral joint
non séparable pour un `edgeRadius` significatif ; le budget ≤100 ms visé pour les
sources paramétriques (§4) est **à vérifier à l'implémentation**, pas garanti par
la seule séparabilité. Guide `I` = luminance de l'image du calque.
Les deux sont livrés dans la **même Tranche 3** (voir placement corrigé ci-dessus),
donc l'ordre d'implémentation à l'intérieur de la tranche décide qui introduit la
passe couleur→luminance en premier — pas de dépendance inter-tranches à gérer.

Passes (chaînées via le même mécanisme `EffectModule.passes`-like que le bloom) :

1. Box-filter séparable (H puis V) sur `I`, `p` (masque foldé courant), `I·I`, `I·p`
   → `mean_I`, `mean_p`, `corr_I`, `corr_Ip`. Rayon = `edgeRadius`.
2. Passe simple : `var_I = corr_I - mean_I²`, `cov_Ip = corr_Ip - mean_I·mean_p`,
   `a = cov_Ip / (var_I + eps)`, `b = mean_p - a·mean_I` (`eps` = petite constante
   fixe anti-division-par-zéro, pas un paramètre exposé).
3. Box-filter séparable sur `a`, `b` → `mean_a`, `mean_b`.
4. `q = mean_a·I + mean_b` — masque affiné.
5. Résultat final = `lerp(p, q, edgeStrength)` (`edgeStrength` = curseur d'intensité
   exposé à l'utilisateur, 0 = désactivé visuellement sans changer `edgeAware`,
   1 = affiné à fond).

**Textures et budget VRAM — corrigé (finding Codex HAUTE ×2)** : la v1 sous-comptait
le pic (annonçait ~4 textures) et proposait `r8` pour `a`/`b`, un format invalide —
corrigés tous les deux ici.

- **Format** : `a = cov_Ip / (var_I + eps)` et `b = mean_p - a·mean_I` ne sont **pas**
  bornés dans `[0,1]` (peuvent être négatifs ou `> 1`) — les stocker en `r8unorm`
  clamperait et fausserait l'algorithme (bords à faible contraste/inversés mal
  suivis). `a`/`b`, et les accumulateurs `corr_I`/`corr_Ip` qui les nourrissent,
  utilisent donc **`r16float`** (signé). `I`, `p` et la sortie finale `q` restent
  `r8unorm` (bornés par construction/clamp explicite sur `q` seulement).
- **Pic simultané réel** : à l'étape de calcul de `a`/`b`, `mean_I`/`mean_p`/
  `corr_I`/`corr_Ip` doivent coexister (4), et `I`/`p` doivent rester vivants pour
  `q` et le `lerp` final (2 de plus) ⟹ **pic ≈ 6 textures simultanées**, pas 4 —
  `I·I`/`I·p` peuvent en revanche être libérées dès que `corr_I`/`corr_Ip` sont
  calculées (réutilisation ping-pong possible sur CES deux-là uniquement, même
  pattern `pendingDestroy` que Task 13). En comptant 2× `r8` (24 Mo, `I`/`p`) +
  4× `r16f` (48 Mo, `mean_I`/`mean_p`/`corr_I`/`corr_Ip`) : **pic de l'ordre de
  200-350 Mo, transitoire** (alloué pour la durée du calcul, libéré via
  `pendingDestroy` après `submit()`, pas résident en continu — mais dans une même
  passe WebGPU une sortie ne peut pas aliaser son entrée, donc les intermédiaires
  H/V de `mean_a`/`mean_b` peuvent encore ajouter à ce pic). **Ce chiffre reste une
  estimation d'ordre de grandeur, pas un budget figé** — corrigé deux fois de suite
  en revue adverse (96-192 Mo → 240 Mo → cette fourchette élargie), signe que
  l'arithmétique à la main atteint sa limite de fiabilité ici. **La seule mesure qui
  compte est celle prise à l'implémentation** (§Tests requis ci-dessous, condition
  de sortie de tâche non négociable) — cf. §5, la VRAM 24MP est le risque ouvert du
  projet. Si la mesure dépasse le budget disponible pendant un stroke actif, voir la
  mitigation ci-dessous.

**Coût/déclenchement — corrigé (finding Codex HAUTE + MOYENNE)** : la v1 affirmait à
tort « recalculé seulement au changement de `mask.refineEdge` ». C'est faux : `q`
dépend de `p` (le masque foldé), qui change à **chaque frame pendant un stroke
actif** (§4, Optimisation 60fps) — le guided filter suit donc la **même cadence que
le refine edge forme-seule existant**, pas une cadence réduite.

**Mitigation — corrigée (finding Codex MOYENNE, la v1 gelait l'aperçu du trait, ce
qui contredit le PRD « ajustement live sur le masque combiné final »,
`prd.md:91-99`)** : pendant un stroke actif, c'est **seulement le guided filter
edge-aware** qui est suspendu — le **fold brut `p` courant reste affiché en live**
(feather/contract/smooth, peu coûteux, continuent de s'appliquer normalement à
chaque frame comme aujourd'hui). L'edge-aware se **réapplique au relâchement**
(stroke-end), même granularité que le commit d'historique existant (un commit par
stroke, Task 11b) : le trait reste visible et interactif pendant qu'on peint, seul
le « collage aux contours » a un temps de latence d'une frame au relâchement — pas
un gel du masque entier. **Nuance PRD assumée** (relevée en revue adverse, MOYENNE) :
au sens strict, le PRD demande le résultat edge-aware lui-même en live pendant le
geste, pas seulement le fold brut — cette mitigation ne le respecte pas à la lettre
pendant le stroke actif, seulement au relâchement. **Décision produit assumée, pas un
oubli** : un guided filter à 6 textures par frame de peinture sur le chemin déjà
sensible au crash 24MP (paragraphe précédent) n'est pas un compromis acceptable pour
gagner cette dernière frame de fidélité — à rouvrir seulement si l'usage réel montre
que le lag d'une frame au relâchement est gênant (ex. via un aperçu basse résolution
pendant le stroke, non designé ici, YAGNI tant que non demandé). Choix de perf explicite pour ne pas ajouter un guided
filter à 6 textures à chaque frame de peinture sur le chemin GPU déjà sensible.

**UI (Inspector, panneau Masques)** : toggle `edgeAware` + slider `edgeRadius` (px,
défaut ~10, borné par la même règle que les autres rayons du projet) + slider
`edgeStrength` (0..1, défaut 1) — 3 nouveaux contrôles dans le même bloc que
feather/contract/smooth, pas un panneau séparé.

**Tests requis (finding Codex MOYENNE — absents de la v1)**, en plus de la
couverture standard §Tests :
- `edgeStrength = 0` ⟹ sortie **identique** à `p` (pas de dérive numérique) ;
- guide `I` constant (image plate) ⟹ pas de NaN / division instable (`var_I + eps`
  protège, à vérifier par un test dédié, pas juste supposé) ;
- sortie `q` toujours bornée dans `[0,1]` après clamp, quel que soit `edgeRadius` ;
- invalidation correcte après ajout/suppression d'une source de masque (le fold `p`
  change ⟹ `q` doit refléter le nouveau `p`, pas un résultat périmé) ;
- mesure perf/VRAM réelle à 24MP (temps de la chaîne de passes, pic VRAM mesuré, pas
  seulement le budget théorique ci-dessus) — condition de sortie de tâche, pas
  optionnelle.

**Hors scope (rappel, différé PRD)** : détection sémantique sujet/ciel/arrière-plan
(segmentation ML — cf. Lightroom "Select Sky"/"Select Subject", Adobe Sensei) reste
**différée**, même famille que le depth mask (`prd.md` §Différé) — modèle local ONNX/
WebGPU, chantier à part avec son propre spike, pas dans cette tranche.

### 5. Historique + budgets mémoire (CPU **et** VRAM)

**Historique (CPU, 512 Mo)** : `History` continue de snapshotter des `LayerStack`
entiers. Le refcount actuel est **clé par un unique `Uint8Array` par calque**
(`history.ts:32-53`) — il faut l'**étendre pour refcounter chaque `raster` de source
pinceau** dans `mask.sources` (plusieurs buffers possibles par calque, contre un seul
avant). Ce n'est PAS un « s'étend naturellement » gratuit : un calque peut désormais
porter **N sources pinceau**, chacune un raster plein (~24 Mo à 24MP en r8), ×
entrées d'historique ⟹ le budget 512 Mo se remplit plus vite. Mitigations : dédup par
refcount (déjà là), et **cap du nombre de sources pinceau par masque** si le budget le
justifie (à mesurer). Une entrée d'historique par interaction.

**VRAM (le vrai risque, non budgété dans la v1 de ce design)** — sur le matériel qui
**avait OOM à 24MP** (crash **résolu** `e3c7584`, gate levé — corrigé après revue
adverse Codex 2026-07-19, ce paragraphe disait encore « crash non résolu », stale
par rapport au §Sécurité crash), le fold GPU (§4) ajoute des textures r8
résidentes. Par calque **en cours d'édition** : N textures de sources + accumulateur +
ping-pong refine-edge + texture masque finale (chacune ~24 Mo en r8 à 24MP). C'est en
plus de la chaîne couleur (ping-pong rgba ≈ 96 Mo/texture). Règles de budget VRAM :

- **Seul le calque en cours d'édition** garde ses textures **de sources** résidentes ;
  les autres calques ne gardent que leur **texture masque finale** foldée (source
  textures libérées, re-générées à la ré-édition). Borne le pic VRAM à 1 calque
  « épais » à la fois.
- **Pooler** accumulateur + ping-pong refine-edge (réutilisés entre calques, le fold
  est séquentiel).
- r8 = 1/4 d'un rgba ⟹ le coût masque reste minoritaire devant la chaîne couleur, mais
  il s'ajoute sur un budget déjà tendu. **À mesurer à l'usage réel** (pas de budget
  théorique figé — cohérent avec la note VRAM du CLAUDE.md).

### 6. UI — panneau Masques flottant (façon Lightroom)

- **Inspecteur droit** (ancré, existant) : pile de calques. Chaque ligne gagne
  **mode de fusion + opacité** (compacts) et un **badge masque** (demi-cercle
  safelight `--mask-overlay-color`) présent si le calque a ≥1 source. Menu contextuel
  de ligne : **dupliquer / renommer** (nécessite `LayerStack.duplicateLayer` +
  `LayerState.name?`, absents aujourd'hui — `layerStack.ts` n'a ni l'un ni l'autre),
  **copier le masque vers…** (deep copy, §3). Sous la liste, les réglages
  **blend/effet** du calque sélectionné (le `ParamPanel` actuel étendu d'une
  sous-section Mélange).
- **Panneau Masques flottant** : ouvert en cliquant le badge masque. En-tête : fil
  d'ariane « Masque · <nom du calque> », toggle **inverser** (`mask.invert`), toggle
  **désactiver le masque** (`mask.enabled`). Contenu : bouton « Ajouter une source »,
  **pile de sources** (chaque ligne : opérateur combine `+/−/∩`, icône de type, nom,
  visibilité par source `source.enabled`), **réglages de la source sélectionnée** (dont
  le sélecteur combine et, pour colorRange, les échantillons couleur), et **Refine
  edge**. Comportement : **déplaçable par sa barre de titre, avec magnétisme** (snap
  aux bords/coins du canvas), et **escamotable** (repli pour voir le sujet dessous).
- **Aperçu du masque (détail repris de Lightroom, tout pattern confondu)** : survoler
  une ligne de source ⟹ overlay de CETTE source seule sur le canvas ; survoler
  l'en-tête du masque ⟹ overlay du composite foldé. Overlay = `--mask-overlay-color`
  à `--mask-overlay-opacity`.
- **Overlay de masque EN MODE PEINTURE (exigence confirmée 2026-07-18, checkpoint
  Antoine)** : dès qu'on est en mode masque, le canvas montre le masque courant en
  **overlay safelight rouge** (convention Lightroom : rouge = zone où l'effet
  s'applique, c.-à-d. mask>0), sinon on ne VOIT pas qu'on peint un masque et ça
  ressemble à « peindre l'effet directement ». ⚠️ **Gap actuel** : les tokens
  `--mask-overlay-color/-opacity/-edge` (`src/design/semantic.css:47-49`) existent
  mais ne sont **utilisés nulle part au rendu** — l'overlay n'est PAS implémenté (le
  masque part de blanc=effet-partout, puis noir+traits au 1er stroke, sans rien
  montrer du masque). À implémenter comme une **passe de rendu overlay** gated par le
  mode masque (échantillonne le masque du calque sélectionné, teinte rouge).
- **Curseur pinceau custom type Adobe (nouvelle exigence 2026-07-18, checkpoint
  Antoine)** : en mode masque, remplacer le `cursor: crosshair`
  (`src/components/Canvas.css`) par un **cercle qui suit la souris, dimensionné au
  rayon du pinceau** (converti image→écran via l'échelle du canvas), avec la
  **dureté** visualisée (anneau interne au rayon de dureté). Donne le contrôle
  visuel de la taille/dureté avant de peindre, comme Photoshop. UI pure, sans lien
  avec le modèle de masque — implémentable indépendamment des tranches.
- Calé sur les tokens `darkroom-balanced` (`docs/design-system/tokens.md` :
  inspecteur 288px, safelight `#e63c46`, surfaces neutres chaudes).

### 7. Groupes (conteneur) — réutilise le primitif de compositing

Un groupe aplati ses enfants dans une texture off-screen (sous-render en ping-pong),
puis composite ce résultat via le **même** primitif `out = mix(input, blend(input,
flattened, blendMode), opacity * maskValue)` — le groupe a donc opacité + blendMode +
masque propres, appliqués au résultat aplati des enfants (modèle Photoshop/Affinity/
Krita). Réutilise toute l'infra §1-6, avec juste une cible de rendu imbriquée. (Le
mode « Pass Through » des références n'est PAS retenu en v1 — YAGNI ; trigger de
réouverture : si le besoin d'un groupe transparent au compositing apparaît.)

## Découpage en tranches verticales (chacune démontrable seule)

1. **Blend + opacité par calque** (§1-2) — étend `LayerState`, généralise le `mix()`,
   registry de blend modes, UI (opacité + sélecteur de mode par ligne de calque).
   Indépendant du masque. **Sûr, haute valeur, livrable/validable en premier.**
   ✅ **TERMINÉE le 2026-07-19** (plan `docs/superpowers/plans/2026-07-18-
   shaderlab-layers-blend-opacity.md`, commits `4642ffd..421eece` + `631e6bf`
   config + `c070cfc` doc, revue finale whole-branch clean, 2 checkpoints
   visuels humains confirmés). Voir `.claude/learning-log.md` pour le détail.
2. **Masque non-destructif : refonte modèle + fold GPU** (§3-5) — `maskData → mask:
   LayerMask`, pipeline de fold GPU résident, extension History (refcount multi-raster).
   Le **mécanisme d'upload dirty-rect est préservé** ; le rendu gagne une passe de
   fold GPU. ✅ Le gate crash est **levé** (crash 24MP résolu, `e3c7584`) — règle
   de conception héritée : garder les gros buffers de masque hors du state React
   (voir §Sécurité crash). Base pour les sources.
3. **Sources paramétriques** (§3-4) — dégradé, luminosité, range couleur, comme
   `MaskSourceModule` + **refine edge** (feather/contract/smooth **et** edge-aware
   guided filter, §4bis — placement confirmé ici après revue adverse Codex
   2026-07-19, la Tranche 2 ne fait que le modèle + fold GPU).
4. **Panneau Masques flottant** (§6) — l'UX qui expose 2 + 3 (drag/magnétisme/repli,
   pile de sources, aperçu au survol).
5. **Groupes** (§7) — le plus lourd, en dernier, construit sur l'infra blend de la
   tranche 1.

Chaque tranche traverse UI → logique → rendu et finit par un checkpoint visuel humain.

## Sécurité crash (contrainte projet) — ✅ GATE LEVÉ le 2026-07-18

> **Le crash 24MP est RÉSOLU** (`e3c7584`). Root cause trouvée par A/B live :
> ce n'était pas le GPU mais le **buffer `maskData` 26 Mo transitant par le state
> React** (voir `2026-07-17-native-wgpu-decision.md`, bandeau RÉSOLU). Fix :
> `maskData` hors du state React (`layersRef` complet + projection d'affichage
> `toDisplayLayers`). **Contrainte qui en découle pour les tranches 2-5** : garder
> les gros buffers/textures de masque HORS du state React — ce que ce design vise
> déjà (source de vérité en ref, textures GPU résidentes, fold sur GPU). Le fold
> GPU (§4) ne ré-introduit pas de gros buffer dans React. **Le gate sur la
> tranche 2 est levé** ; la contrainte ci-dessous devient une règle de conception,
> pas un blocage.

Le crash de peinture au masque à 24MP **était non résolu** au moment de la 1ère
rédaction de ce design (3 tentatives de fix échouées, seuil systematic-debugging —
voir `2026-07-17-native-wgpu-decision.md`, déclencheur : `setLayers()` en fin de
stroke). Il est **désormais résolu** (bandeau ci-dessus).

**Correction d'une affirmation fausse de la v1 de ce design** (revue adverse
2026-07-18) : le fold GPU (§4) ajoute une passe de rendu masque **sur ce même chemin**.
Le mécanisme d'upload dirty-rect ne change pas, mais on **ajoute du travail GPU** là où
ça crashe déjà. Donc « le design n'y touche pas » était **faux**.

Conséquence — **la tranche 2 est explicitement GATED** :

- La **tranche 1** (blend + opacité, §1-2) ne touche PAS le chemin de peinture masque
  et n'est PAS concernée par ce gate → planifiable et livrable immédiatement.
- La **tranche 2** (fold GPU) ne démarre PAS avant une décision explicite avec Antoine
  sur le crash 24MP (garde-fou systematic-debugging : pas de 4e manipulation à
  l'aveugle de ce chemin). Options non tranchées ici : (a) comprendre/résoudre le crash
  d'abord ; (b) prototyper le fold GPU sur une petite image pour isoler s'il aggrave ;
  (c) réduire la résolution du masque (r8 downscalé) pour sortir de la zone de crash.
  À décider AVANT le plan de la tranche 2, pas dans ce document.

## Interaction avec la feature sœur pan/zoom (conflit de fichier signalé)

Les deux features modifient **le même fichier et la même fonction** :
`toImageCoords` (`src/components/Canvas.tsx:37-44`). Le pan/zoom
(`2026-07-18-shaderlab-canvas-pan-zoom-prd.md`) EXIGE d'y **inverser la transform CSS**
pour rester pixel-exact ; ce design suppose le chemin de peinture stable. **Dès que le
pan/zoom atterrit, `toImageCoords` change** — les deux chantiers ne sont donc pas
indépendants sur ce point. Séquencement à acter : livrer l'un, puis adapter l'autre à
la nouvelle signature de `toImageCoords` (le second chantier doit relire ce fichier,
pas supposer l'ancien mapping). Risque secondaire : si la transform CSS est posée sur
un **wrapper** plutôt que sur le `<canvas>`, `getBoundingClientRect()` du canvas change
aussi → à vérifier au moment de l'implémentation croisée.

## Tests

Style existant (logique pure, aucun rendu React/WebGPU en test — cohérent avec
`test/` actuel) :

- **Fold de sources** : ordre, `add`/`subtract`/`intersect` (union max / soustraction
  clampée / min), sources désactivées ignorées, source unique = elle-même.
- **Modèle** : `LayerMask` / `MaskSource[]` — ajout/suppression/réordre/toggle source,
  `mask.invert` / `mask.enabled`, copie de masque (deep copy figée), immutabilité
  (clone partage les rasters comme aujourd'hui pour maskData).
- **1ère source seed** : une 1ère source en `subtract`/`intersect` ne doit PAS donner un
  masque nul (son `combineMode` est ignoré au seed) — test explicite.
- **History étendu** : refcount des rasters de pinceau dans une liste de sources
  (buffer partagé compté une fois), budget/éviction inchangés.
- **Registry blend + registry sources** : contrat, validation fail-fast (comme
  `registry.test.ts`).
- **Rendu (blend linéaire vs gamma-converti, aperçu masque, groupes)** = checkpoint
  visuel humain WebView2/CDP (jamais affirmé sans avoir été vu).

## Points laissés ouverts (non bloquants)

- **Comportement au resize fenêtre** du panneau flottant (re-snap ?) — détail UI à
  régler à l'implémentation de la tranche 4.
- **Ordre exact pinceau-vs-paramétrique** dans le fold : la liste est ordonnée par
  l'utilisateur (drag), donc l'ordre est explicite ; à confirmer visuellement qu'il
  n'y a pas de piège de commutativité sur `intersect`.
- **Groupes imbriqués récursifs** (groupe dans un groupe) : supporté par construction
  (sous-render récursif) mais à valider en perf sur la tranche 5.

---

**Prochaine étape** : la **tranche 1 est terminée** (voir §Découpage ci-dessus). Le
**gate crash 24MP est levé** (`e3c7584`) : les tranches 2-5 ne sont plus bloquées,
sous la règle de conception « gros buffers de masque hors du state React »
(§Sécurité crash) et avec le budget VRAM du fold à mesurer à l'usage (§5).
Prochaine étape réelle : `superpowers:writing-plans` sur la **tranche 2** (masque
non-destructif), puis exécution, puis séquencer 3→4→5.
