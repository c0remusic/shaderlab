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

Le compositing par calque se fait en **généralisant l'unique `mix()`** existant, sans
passe de compositing supplémentaire ni buffer d'accumulation :

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

`maskData: Uint8Array` devient `mask: MaskSource[]` — **liste ordonnée** de sources
ré-éditables. Chaque source :

```ts
interface MaskSource {
  id: string;
  type: 'brush' | 'gradient' | 'luminosity' | 'colorRange';
  combineMode: 'add' | 'subtract' | 'intersect';
  enabled: boolean;
  // paramétriques (gradient/luminosity/colorRange) :
  params?: Record<string, number | number[]>;   // + échantillons couleur pour colorRange
  // pinceau :
  raster?: Uint8Array;   // r8 pleine résolution, accumulation des strokes
}
```

- **Pinceau = cas raster** : garde **exactement** le chemin actuel (`MaskPainter` +
  `DirtyRect` + `maskUpload`) en peignant dans SON `raster`. On n'ouvre PAS le chemin
  fragile lié au crash 24MP — on l'encapsule comme une source parmi d'autres. Une
  source pinceau peut accumuler plusieurs strokes (comme aujourd'hui).
- **Sources paramétriques** = `params` seulement (minuscules), le masque est
  recalculé par une passe shader image→masque. Ré-éditables à tout moment (déplacer
  un dégradé, re-régler une tolérance couleur) — c'est ce qui rend le modèle
  non-destructif.
- **colorRange** : `params` porte une liste d'échantillons de couleur cumulés dans la
  MÊME source (échantillonnés en **linéaire**) + tolérance/dureté globales (décision
  PRD).

### 4. Pipeline de fold + refine edge (live)

Le masque final d'un calque = **fold des sources dans l'ordre** :

1. Pour chaque source `enabled`, produire sa contribution masque (r8) : paramétrique
   ⟹ passe shader ; pinceau ⟹ son `raster`.
2. Combiner dans un accumulateur selon `combineMode` : `add` = `max(acc, src)`,
   `subtract` = `clamp(acc - src, 0, 1)`, `intersect` = `min(acc, src)`. (Ordre =
   ordre de la liste ; la première source part d'un accumulateur à 0.)
3. Appliquer **refine edge** (feather / contracter-dilater / lisser) en passes shader
   sur le résultat foldé — **live** : ses params sont stockés à part
   (`mask.refineEdge`), ré-appliqués si on ajoute/modifie une source ensuite. Refine
   edge opère sur la **forme du masque** seulement (indépendant de l'image ; pas de
   décontamination couleur — écartée au PRD).

Budgets perf (planchers PRD) : un tweak de source paramétrique ou de refine edge peut
mettre ~100 ms ; **seul le pinceau doit tenir 60fps**, et il peint dans son `raster`
(chemin dirty-rect existant) puis re-fold — le fold des sources en amont du pinceau
est mis en cache et non recalculé pendant le stroke.

Sources de masque = modules autonomes eux aussi (`MaskSourceModule`, même esprit que
les effets : `{ id, type, name, params, wgsl? }`) ⟹ ajouter une source (les différés :
lasso, géométrique…) = un fichier.

### 5. Historique — extension naturelle

`History` continue de snapshotter des `LayerStack` entiers. Le champ `mask` devient
une liste de sources ; les **rasters de pinceau** (gros buffers) restent refcountés
buffer-par-buffer comme aujourd'hui (`history.ts` refcount), les sources
paramétriques sont négligeables (params). Le budget 512 Mo reste dominé par les
rasters ⟹ l'infra existante s'étend sans refonte de sa logique de bornage. Une entrée
d'historique par interaction (ajout/suppression/re-réglage de source, comme
aujourd'hui pour un slider).

### 6. UI — panneau Masques flottant (façon Lightroom)

- **Inspecteur droit** (ancré, existant) : pile de calques. Chaque ligne gagne
  **mode de fusion + opacité** (compacts) et un **badge masque** (demi-cercle
  safelight `--mask-overlay-color`) présent si le calque a ≥1 source. Sous la liste,
  les réglages **blend/effet** du calque sélectionné (le `ParamPanel` actuel étendu
  d'une sous-section Mélange).
- **Panneau Masques flottant** : ouvert en cliquant le badge masque. Contenu : bouton
  « Ajouter une source », **pile de sources** (chaque ligne : opérateur combine
  `+/−/∩`, icône de type, nom, visibilité), **réglages de la source sélectionnée**
  (dont le sélecteur combine et, pour colorRange, les échantillons couleur), et
  **Refine edge**. Comportement : **déplaçable par sa barre de titre, avec
  magnétisme** (snap aux bords/coins du canvas), et **escamotable** (repli pour voir
  le sujet dessous). Fil d'ariane « Masque · <nom du calque> ».
- **Aperçu du masque (détail repris de Lightroom, tout pattern confondu)** : survoler
  une ligne de source ⟹ overlay de CETTE source seule sur le canvas ; survoler
  l'en-tête du masque ⟹ overlay du composite foldé. Overlay = `--mask-overlay-color`
  à `--mask-overlay-opacity`.
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
2. **Masque non-destructif : refonte modèle + fold, pinceau porté à l'identique**
   (§3-5) — `maskData → mask: MaskSource[]`, pipeline de fold, extension History.
   Comportement pinceau **préservé** (chemin dirty-rect inchangé). Base pour les
   sources.
3. **Sources paramétriques** (§3-4) — dégradé, luminosité, range couleur, comme
   `MaskSourceModule` + **refine edge**.
4. **Panneau Masques flottant** (§6) — l'UX qui expose 2 + 3 (drag/magnétisme/repli,
   pile de sources, aperçu au survol).
5. **Groupes** (§7) — le plus lourd, en dernier, construit sur l'infra blend de la
   tranche 1.

Chaque tranche traverse UI → logique → rendu et finit par un checkpoint visuel humain.

## Sécurité crash (contrainte projet)

Le crash de peinture au masque à 24MP est **non résolu** après 3 tentatives de fix
(seuil systematic-debugging atteint — voir `2026-07-17-native-wgpu-decision.md`). Ce
design **n'y touche pas** : le pinceau conserve `MaskPainter` / `DirtyRect` /
`maskUpload` à l'identique ; la refonte masque **encapsule** ce chemin comme une
source raster sans en modifier le mécanisme d'upload. Aucune tranche ne doit
re-router le chemin de peinture sans en discuter (garde-fou systematic-debugging).

## Tests

Style existant (logique pure, aucun rendu React/WebGPU en test — cohérent avec
`test/` actuel) :

- **Fold de sources** : ordre, `add`/`subtract`/`intersect` (union max / soustraction
  clampée / min), sources désactivées ignorées, source unique = elle-même.
- **Modèle** : `MaskSource[]` — ajout/suppression/réordre/toggle, immutabilité (clone
  partage les rasters comme aujourd'hui pour maskData).
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

**Prochaine étape** : design validé → `superpowers:writing-plans` pour le plan
d'implémentation, **en commençant par la tranche 1** (blend + opacité par calque),
les tranches suivantes étant chacune leur propre plan.
