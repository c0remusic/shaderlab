# Design — Parité « calque photo » (Photoshop-like)

> Date : 2026-07-26 · Repo `C:\dev\shaderlab`, base `master@08c6d8c`.
> Type : design doc (le COMMENT). Le QUOI est tranché par l'utilisateur et
> n'est pas rediscuté ici.
> Modèle imposé (non rediscutable) : **la photo EST un calque de plein droit**,
> pas une ressource référencée par des calques.

## 1. Besoin (rappel, non négociable)

Un calque photo (feature « double exposure », `2026-07-25-shaderlab-double-exposure-design.md`)
doit se comporter comme un calque Photoshop :

1. Identité dans la pile : vignette + nom de fichier au lieu de « Passthrough ».
2. Barre contextuelle avec valeurs numériques éditables : X, Y, échelle %, angle °.
3. Actions : réinitialiser, ajuster à la toile, centrer, snap d'angle.
4. Flip horizontal / vertical.
5. Recadrage (crop) du calque.
6. Plusieurs photos (lever `MAX_PHOTO_LAYERS = 1`).

## 2. État des lieux (vérifié sur disque)

| Fait | Preuve |
|---|---|
| `LayerTransform = {x, y, scale, rotation}`, `scale` scalaire unique | `src/layers/types.ts:14-19` |
| `imageSource`/`transform` présents ou absents ENSEMBLE ; aucun champ `name` sur aucun calque | `src/layers/types.ts:21-41` |
| `MAX_PHOTO_LAYERS = 1`, gardé par `canAddPhotoLayer` | `src/layers/photoLayer.ts:9,15-17` |
| Import : nom de fichier connu (`pickImageFile()`) puis **jeté** | `src/App.tsx:309-331` |
| `addPhotoLayer` force `effectId: "passthrough"` | `src/layers/layerStack.ts:64-78` |
| `clampTransformScale` interdit tout scale ≤ `MIN_TRANSFORM_SCALE` → aucun flip par échelle négative possible | `src/ui/transform.ts:26-32` |
| Bornes/couverture calculées sur les bords **entiers** de la photo | `src/ui/transform.ts:60-65`, `src/render/photoLayerInput.ts:44-54` |
| Uniform de la pré-passe = `array<f32, 8>`, indexé `params[0..7]` | `src/render/photoLayerInput.ts:21,25-32,139-142` |
| Test « I3 » existant : réplique la formule en TS et compare à du TS — **ne lit jamais `PHOTO_LAYER_INPUT_WGSL`** | `test/render/photoLayerInput.test.ts:123-160` (la chaîne WGSL n'apparaît que lignes 112-113, sur le feather) |
| Cible de résolution = **une** texture persistante partagée, justifiée par « au plus un calque photo » | `src/render/photoLayerInput.ts:64-70` (commentaire), champ `cachedTarget` ligne 71 |
| Chemin de readback GPU déjà en place (`exportFrame` réexécute `runPipeline` hors-écran, RGBA tassé, R/B corrigé) | `src/render/renderer.ts:281-292`, `src/render/frameReadback.ts:33-87` |
| Uniform d'effet tassé (`array<f32, 11>` écrit en 44 octets) accepté en production sur cette cible | `src/render/shaderCompose.ts:6,109` + `src/render/effectPassRunner.ts:157-160` |
| `clone()` recopie `params` et les conteneurs de masque, **pas `transform`** (partagé par référence entre snapshots) | `src/layers/layerStack.ts:262-280` |
| Le commit d'historique d'une transform est armé par une comparaison **énumérée champ par champ** | `src/App.tsx:333-345` (`handleTransformChange`), `:347-351` (`handleTransformCommit`) |
| `updateLayerTransform` n'a **aucun appelant de production** ; son `paramsEqual` fait `Object.is` sur chaque valeur | `src/layers/layerStack.ts:83-89` + `:24-37` ; seul écrivain réel = `replaceLiveLayers` (`src/App.tsx:340`) |
| `App.tsx` = **1417 lignes** ce jour, contre 727 documentées dans `ARCHITECTURE.md` §7 R6 | `wc -l src/App.tsx` |
| Extraction en hook déjà appliquée aux presets, pas à la double exposure | `src/hooks/usePresets.ts` (211 lignes) |
| Poignées : 4 coins (échelle uniforme) + 1 rotation ; `PointerEvent.shiftKey` déjà disponible sans listener clavier | `src/components/TransformHandles.tsx:64-70` |
| Handles montés sur SÉLECTION, sans mode ni exclusion de `maskPaintMode` | `src/App.tsx:1082-1092,1123-1132` |
| Précédent barre contextuelle poussant le canvas | `src/components/BrushToolbar.tsx`, `src/App.tsx:1082-1092` |
| Précédent visibilité pilotée par la sélection | `src/ui/contextualPanel.ts:31-43` |
| Précédent nettoyage d'état par calque à la suppression | `src/App.tsx:376-393` (`maskPaintersRef.current.delete`) ; `presets.clearActive()` y est aussi appelé, comme dans `handleAdd` (`:353-359`) |
| Presets : calque photo EXCLU à la capture, jamais recréé à l'apply | `src/presets/presetDocument.ts:16-20,83-91` |
| Round-trip Lightroom coupé dès `hasPhotoLayer(layers)` | `src/App.tsx:1047` |
| Nom de calque affiché = `getEffect(layer.effectId).name` | `src/components/LayerPanel.tsx:105-107` |
| Aucune UI ne change l'`effectId` d'un calque existant (`addEffectOptions` ne sert qu'à `onAdd`) | `src/components/LayerPanel.tsx:42,174-178` |
| Le handler clavier global ignore déjà les cibles éditables (pas de collision Ctrl+Z avec un champ) | `src/App.tsx:665-681` |
| Précédent de test d'interaction clavier sur un composant React réel (Storybook) | `src/components/PresetPanel.stories.tsx:82-95` |
| Le moteur route déjà la photo transformée comme entrée d'effet du calque | `src/render/framePipelineExecutor.ts:214-262` |
| Aucun test n'exécute **deux** calques photo dans une frame | `test/render/framePipelineExecutor.test.ts:214,242` (un seul `imageSource` par scénario) |

## 3. Décisions

### 3.1 Modèle de données

```ts
// src/layers/types.ts
export interface CropRect {
  /** Coin haut-gauche et dimensions, en PIXELS de la photo source, entiers. */
  x: number; y: number; width: number; height: number;
}

/** IMMUABLE par convention : un `LayerTransform` (et le `CropRect` qu'il
 *  contient) est toujours REMPLACÉ, jamais muté en place — même discipline
 *  que les rasters de masque (`layerStack.ts:267-272`). Voir §3.1 « Propriété
 *  et clone() ». */
export interface LayerTransform {
  x: number;            // inchangé — centre de la BOÎTE VISIBLE (= centre du crop), en pixels du fond
  y: number;
  scale: number;        // inchangé — UNIFORME, TOUJOURS > 0
  rotation: number;     // inchangé — radians
  flipX?: boolean;      // nouveau, défaut false
  flipY?: boolean;      // nouveau, défaut false
  crop?: CropRect;      // nouveau, absent = photo entière
}

export interface LayerState {
  // ...inchangé...
  name?: string;        // nouveau — voir §3.3
}
```

**Pourquoi `flipX`/`flipY` booléens et PAS `scaleX`/`scaleY` signés.**
Le besoin est le miroir, pas l'étirement non uniforme. Passer à un couple
signé (a) rendrait le verrouillage de ratio conventionnel au lieu de
structurel, (b) obligerait à réécrire `clampTransformScale`
(`src/ui/transform.ts:30-32`), garde qui empêche aujourd'hui une division par
zéro produisant des UV NaN côté GPU (`photoLayerInput.ts:133-137` documente
ce cas comme atteignable par import de preset), (c) forcerait le champ
numérique « échelle % » demandé au §1.2 à afficher un nombre signé dont le
signe ne veut pas dire « échelle ». Deux booléens sont orthogonaux, triviaux
à sérialiser, triviaux à annuler. *Réouverture : l'utilisateur demande un
étirement non uniforme → alors `scaleX`/`scaleY` signés et le flip devient le
signe.*

**Pourquoi `crop` en PIXELS source et pas en UV.** Le crop est édité
numériquement et doit se caler exactement sur des bords de pixels ; en UV,
chaque aller-retour saisie→stockage→affichage dérive. La validation devient
un invariant entier trivial (`0 ≤ x`, `x + width ≤ photoWidth`, `width ≥ 1`).
Objection écartée : « pixels couple `LayerTransform` à `photoSize` » — ce
couplage existe déjà, `compositeUvToPhotoUv` prend `photoSize` en argument
(`src/ui/transform.ts:43-48`).

**Pourquoi les trois champs sont OPTIONNELS.** Aucune migration de
l'historique de session ni des presets existants, et aucun défaut à réécrire
dans les fixtures des tests actuels. Le risque « deux chemins de code » est
neutralisé par un unique résolveur pur :

```ts
// src/ui/transform.ts
export function resolveCrop(t: LayerTransform, photoSize: PixelSize): CropRect;
// absent → { x: 0, y: 0, width: photoSize.width, height: photoSize.height }
```

appelé par le CPU **et** par l'écrivain d'uniform. Personne ne lit
`transform.crop` directement en dehors de lui.

**Propriété et `clone()` — travail obligatoire, pas automatique.**
`LayerStack.clone()` (`layerStack.ts:262-280`) recopie explicitement `params` et
tous les conteneurs de masque, mais **pas `transform`** : l'objet est partagé
par référence entre tous les snapshots de `History`. C'est inoffensif
aujourd'hui uniquement parce que les deux seuls écrivains remplacent l'objet
entier (`layerStack.ts:87` ; `App.tsx:340`). Un mode crop qui drague 8 poignées
est précisément la situation qui invite à muter `transform.crop.width` en
place — une seule mutation réécrirait le crop dans chaque snapshot déjà empilé,
et l'undo ramènerait le crop courant. Même classe de bug que l'invariant
d'immutabilité des rasters, déjà payée une fois sur ce repo.
→ **T3** (première tranche qui touche `LayerTransform`) : `clone()` recopie
`transform` et son `crop` (`{ ...l.transform, crop: l.transform.crop ? { ...l.transform.crop } : undefined }`),
et la convention d'immutabilité est écrite en commentaire sur `LayerTransform`
(`src/layers/types.ts`), au même titre que la convention raster.

**Déclenchement de l'entrée d'historique — travail obligatoire aussi.** Le
contenu du snapshot est bien automatique ; son *déclenchement* ne l'est pas.
`handleTransformChange` (`App.tsx:333-345`) arme `paramDirtyRef` par une
comparaison **énumérée en dur** sur `x`/`y`/`scale`/`rotation`, et
`handleTransformCommit` (`App.tsx:347-351`) sort immédiatement si le drapeau
est faux. Un Miroir H (change `flipX` seul) ou une validation de crop (change
`crop` seul) ne produirait donc **aucune entrée d'undo** — les preuves promises
en T3 et T4 tomberaient au premier essai, et la régression se diagnostiquerait
trois tranches plus tard comme « l'undo est cassé ». Viole l'invariant
`ARCHITECTURE.md` §2.6.
→ **T3** : remplacer la comparaison énumérée par une fonction pure
`transformsEqual(a, b): boolean` dans `src/ui/transform.ts` (égalité
structurelle sur les 7 champs, `crop` comparé champ par champ), testée en
Node. Elle devient aussi le prédicat de no-op partout où un transform est
comparé.

**Code mort à retirer dans le même geste.** `updateLayerTransform`
(`layerStack.ts:83-89`) n'a aucun appelant de production — le seul chemin réel
est `replaceLiveLayers` (`App.tsx:340`), remplaçant déjà en place et
opérationnel — et son `paramsEqual` (`layerStack.ts:24-37`) fait `Object.is`
sur chaque valeur : deux `crop` structurellement identiques y seraient toujours
« différents », donc détection de no-op HS et une entrée d'historique par frame
de drag pour quiconque le rebrancherait. **T3 le supprime**, avec ses tests
(`test/layers/layerStack.test.ts`).

**Sérialisation.** Ces champs vivent dans `LayerState`, donc ils entrent
automatiquement dans le *contenu* des snapshots d'historique (undo/redo).
**Presets : inchangés**, le calque photo reste exclu
(`presetDocument.ts:16-20`). Raison : un preset est portable entre documents,
un `sourceId` ne l'est pas, et embarquer les pixels de la photo dans un JSON
de preset est un autre chantier. → §7 Différé.

### 3.2 Uniform et propagation jusqu'au WGSL

L'`array<f32, 8>` actuel devient une **struct nommée** de 4 `vec4<f32>`
(64 octets, alignement `std140`-propre) :

```wgsl
struct PhotoInputParams {
  placement : vec4<f32>,  // x, y, scale, rotation
  sizes     : vec4<f32>,  // bgWidth, bgHeight, photoWidth, photoHeight
  crop      : vec4<f32>,  // cropX, cropY, cropWidth, cropHeight (px source)
  flags     : vec4<f32>,  // flipX (0|1), flipY (0|1), 0, 0
}
```

**Une seule raison, et elle suffit : 14 valeurs utiles ne tiennent plus dans 8.**
L'argument « la struct évite un risque de *stride* d'array uniform » a été
retiré : le codebase y répond déjà. `shaderCompose.ts:109` déclare
`var<uniform> params: array<f32, MAX_EFFECT_PARAMS>` (= 11,
`shaderCompose.ts:6`) sur le chemin de rendu principal, et
`effectPassRunner.ts:157-160` écrit un `Float32Array(11)` **tassé à 44
octets**. Si la règle de stride 16 octets s'appliquait ici, tout paramètre
d'effet d'indice ≥ 1 lirait à côté et glow/grain/warp/duotone seraient faux
depuis le premier jour. Le layout tassé est donc empiriquement accepté sur
cette cible : la migration vers la struct est un choix de lisibilité et de
capacité, **pas** une mise en conformité. Bénéfice collatéral : `params[6]`
devient `p.sizes.z`.

#### Ordre canonique des transformations — énoncé UNE fois, référencé par les deux implémentations

C'est le contrat de parité. Toute divergence entre `src/ui/transform.ts` et
`PHOTO_LAYER_INPUT_WGSL` est un défaut, jamais un arbitrage local.

**Sens direct** (pixel source → composite ; c'est le sens dans lequel se pense
la feature, il n'est implémenté nulle part tel quel) :

```
c = s − centre(crop)            (1) recadrage : origine au centre du crop
c.x = flipX ? −c.x : c.x        (2) miroir, dans l'espace local du calque
c.y = flipY ? −c.y : c.y
c = c × scale                   (3) échelle uniforme
c = R(rotation) · c             (4) rotation autour du centre de la boîte visible
p = (x, y) + c                  (5) translation
```

**Sens inverse** (composite → pixel source ; c'est ce que CPU et WGSL
calculent réellement, en appliquant (5)→(1) à l'envers) :

```
d  = p − (x, y)
r  = R(−rotation) · d
l  = r / scale
l.x = flipX ? −l.x : l.x        (le miroir est une involution : même opération)
l.y = flipY ? −l.y : l.y
srcX = crop.x + (l.x + crop.width  × 0.5)
srcY = crop.y + (l.y + crop.height × 0.5)
```

Puis, dans l'ordre :

- **Test de bornes sur le CROP**, pas sur la photo :
  `0 ≤ l.x + crop.width/2 < crop.width` (idem Y). Hors → transparent
  (`null` côté TS, `coverage = 0` côté WGSL) — comportement inchangé.
- **Feather** : `edgeDistPx` mesuré sur les bords du crop, puis
  `coverage = clamp(edgeDistPx * scale, 0, 1)` — la multiplication par
  `scale` (invariant I2, `photoLayerInput.ts:48-54`) est conservée telle
  quelle.
- **UV d'échantillonnage** : `srcX / photoWidth`, `srcY / photoHeight`
  (division par la photo ENTIÈRE — le crop restreint la zone visible, il ne
  redimensionne pas la texture).

**Coïncidence avec le code actuel quand `crop` est absent.** `resolveCrop`
rend alors `{x: 0, y: 0, width: photoWidth, height: photoHeight}`, donc
`srcX = 0 + (l.x + photoWidth × 0.5)` = exactement `photoLayerInput.ts:44` et
`transform.ts:60` ; et le test de bornes devient
`0 ≤ l.x + photoWidth/2 < photoWidth` = exactement `transform.ts:62`. Avec
`flipX = flipY = false` les deux branches de miroir sont des no-op. La
formule proposée est donc une **généralisation stricte** de l'existant :
aucun cas actuellement rendu ne change de résultat.

#### Ancre : `(x, y)` reste le centre de la BOÎTE VISIBLE, et le crop compense

L'ordre ci-dessus place `(x, y)` sur le centre du **crop**. Pris seul, ce choix
ferait **sauter** le calque à la validation d'un crop non centré (« je garde la
moitié haute ») : le contenu restant se re-centrerait sur la position du calque
et se translaterait de `(centrePhoto − centreCrop) × scale` à l'écran. Photoshop
ne fait pas ça — recadrer **rogne**, ça ne déplace pas les pixels restants. Et
comme la boîte et le contenu bougeraient *ensemble*, un œil humain validerait
sans rien voir.

**Décision : ancre au centre du crop + compensation de `transform.x/y` au
commit du crop.** L'alternative (ancrer sur le centre de la photo et décaler
le test de bornes) résoudrait le saut mais casserait tout le reste : `(x, y)`
ne serait plus le centre de la boîte visible, donc la rotation ne tournerait
plus autour du centre visible, « Centrer » ne centrerait plus, et
`computeHandleGeometry` devrait porter un décalage permanent. La compensation
concentre le problème en **une fonction pure testable** au lieu de le disperser
dans toute la géométrie.

```ts
// src/ui/transform.ts
/** Nouveau (x, y) tel qu'aucun pixel source visible dans les DEUX crops ne
 *  bouge à l'écran quand le crop passe de `from` à `to`. */
export function recenterForCrop(
  t: LayerTransform, from: CropRect, to: CropRect,
): { x: number; y: number };
// d = centre(to) − centre(from), en pixels source
// x' = t.x + t.scale * (d.x * cos(rot) − d.y * sin(rot))
// y' = t.y + t.scale * (d.x * sin(rot) + d.y * cos(rot))
```

Appelée **une seule fois**, au commit du mode crop (§3.4), dans la même entrée
d'historique que le crop lui-même. Le flip n'a besoin d'aucune compensation :
il est un miroir autour du centre du crop, qui est déjà l'ancre.

**Conséquence dans la géométrie d'écran** : la boîte englobante et les
poignées se dimensionnent sur le CROP, plus sur la photo. Donc
`computeHandleGeometry` (`transform.ts:81-83`) et la demi-diagonale de
`scaleFromCornerDrag` (`transform.ts:106`) prennent `resolveCrop(...)` au
lieu de `photoSize`. La boîte rétrécit, le contenu ne bouge pas — c'est le
comportement Photoshop revendiqué.

#### Moyen de preuve du WGSL — le test « I3 » actuel n'en est pas un

**Constat.** `test/render/photoLayerInput.test.ts:123-160` compare
`replicateWgslFormula` (du TypeScript écrit à la main, lignes 124-144) à
`compositeUvToPhotoUv` (du TypeScript, `transform.ts:43-66`). La chaîne
`PHOTO_LAYER_INPUT_WGSL` n'apparaît nulle part dans ce bloc ; les deux seules
assertions du fichier qui la touchent sont les `toContain`/`not.toContain` des
lignes 112-113, et elles ne portent que sur le feather. On peut donc inverser
le signe de la rotation dans le shader, oublier la branche de flip ou mettre le
crop à l'envers : I3 reste vert. **Étendre I3 ne fait que multiplier les cas
d'un test qui ne prouve rien du GPU.** Un checkpoint humain ne rattrape pas ça
non plus : un flip autour du mauvais centre sur une photo grossièrement centrée
est invisible à l'œil, et une erreur de sous-pixel ou d'ordre de transformation
l'est toujours.

Trois moyens ont été évalués. **Deux sont retenus, cumulativement, dans T3** ;
ils servent ensuite T4 sans coût supplémentaire.

**(a) Retenu — le WGSL devient un artefact ASSERTÉ, pas seulement compilé.**
La formule inverse est extraite dans une constante exportée unique,
`PHOTO_INVERSE_TRANSFORM_WGSL`, interpolée dans `PHOTO_LAYER_INPUT_WGSL`. Le
test (i) assère que le shader complet la contient bien (elle est donc réellement
utilisée), et (ii) assère **chaque ligne canonique** de la constante contre un
littéral exact : ligne de rotation inverse, ligne de division par `scale`, les
deux lignes de miroir, les deux lignes d'offset de crop, la ligne de test de
bornes. Coût : ~30 lignes de test, zéro infrastructure. Ce que ça attrape : tout
changement de convention (signe, pivot, ordre) dans l'un des deux fichiers sans
l'autre — l'auteur ne peut plus modifier le shader sans que le test le force à
regarder la formule CPU en face. Ce que ça n'attrape pas : une erreur commise
identiquement des deux côtés. D'où (b).

**(b) Retenu — harnais de parité pixel piloté par CDP, sur la vraie fenêtre.**
C'est le moyen de preuve DÉCLARÉ du projet (`CLAUDE.md` § Moyen de preuve,
`ARCHITECTURE.md` §2.8) et il est atteignable, parce que la chaîne de readback
existe déjà : `Renderer.exportFrame` réexécute `runPipeline` sur une cible
hors-écran et rend des octets RGBA tassés, alignement de lignes retiré et
canaux R/B déjà corrigés (`renderer.ts:281-292`, `frameReadback.ts:33-87`).
Il manque exactement trois choses, toutes petites :

1. un pont de debug **dev-only** exposant le renderer et le stack de calques à
   `Runtime.evaluate` (une poignée de lignes dans `App.tsx`, gardée par
   `import.meta.env.DEV`) — sans lui, rien n'est pilotable, l'import passe par
   le dialogue natif `pickImageFile()` ;
2. une image de test **synthétique et volontairement asymétrique**, générée
   dans la page (`OffscreenCanvas`, quatre quadrants de couleurs distinctes +
   un repère hors-centre), enregistrée par `photoSources.register(bitmap)` :
   aucune fixture sur disque, aucune dépendance au dialogue de fichier ;
3. un script Node `scripts/gpu-parity.mjs` qui se connecte en WebSocket brut à
   `ws://localhost:9222` (technique déjà documentée dans `CLAUDE.md` § Méthode),
   applique une liste de transforms connus, appelle `exportFrame`, et **assère
   la couleur d'un petit nombre de pixels dont la position est calculée par
   `compositeUvToPhotoUv`** — c'est-à-dire par la référence CPU. Toute
   divergence CPU↔GPU se manifeste alors comme un pixel de la mauvaise couleur.

Cas couverts au minimum : identité · flipX seul · flipY seul · rotation 90° ·
flipX + rotation + scale ≠ 1 · crop non centré avant/après compensation
(le même pixel source doit sortir aux mêmes coordonnées écran). Coût estimé :
~150-200 lignes au total, une fois, en T3. Lancé à la main
(`npm run test:gpu`), **pas** dans `npm run test` : il exige une fenêtre
WebView2 vivante avec CDP actif. Sans (b), T3 et T4 ne sont pas déclarables
terminées — le checkpoint humain reste en plus, pour le ressenti, pas comme
preuve de la formule.

**(c) Écarté — source unique CPU/WGSL par génération de code.** Rendre la
divergence structurellement impossible supposerait un mini-générateur produisant
les deux implémentations depuis une spec commune. C'est la seule option qui
supprime vraiment le problème, mais elle introduit une couche d'abstraction
spéculative pour une formule d'une quinzaine de lignes qui n'a bougé que deux
fois. (a) en capture le bénéfice utile — **un seul site textuel** pour la
formule GPU, assérté — pour un centième du coût. *Réouverture : une troisième
implémentation de la même géométrie apparaît (ex. un compute shader d'export).*

### 3.3 Identité du calque

**Nom.** Nouveau champ `name?: string` sur `LayerState` (pas seulement sur
les calques photo : le champ est générique et l'affichage retombe sur
l'effet). Source : le basename du chemin retourné par `pickImageFile()`,
déjà disponible et actuellement jeté (`App.tsx:316-324`) — même extraction
que celle déjà utilisée pour le titre de la Toolbar
(`sourcePath.split(/[\\/]/).pop()`, `App.tsx:1071`). Posé par
`LayerStack.addPhotoLayer(sourceId, transform, name)`.
Affichage : `layer.name ?? getEffect(layer.effectId).name`
(`LayerPanel.tsx:106`).
Survie à l'undo : automatique, c'est un champ scalaire de `LayerState`,
donc présent dans chaque snapshot. Presets : sans objet, le calque photo
n'y entre pas ; pour un futur calque non-photo nommé, `name` sera à ajouter
explicitement à `PresetLayer` — non fait ici (YAGNI).

**Vignette — mécanisme précis, et pourquoi il ne viole pas l'invariant OOM.**
Rien de nouveau n'entre dans le state React. La vignette est **possédée par
`PhotoSourceStore`**, clé `sourceId`, exactement comme la texture GPU :

1. `PhotoSourceStore.register(bitmap)` produit en plus, à partir du même
   `ImageBitmap` déjà décodé, une réduction ≤ 64×64 via `OffscreenCanvas`
   + `convertToBlob()`, puis `URL.createObjectURL(blob)`.
2. L'URL (une chaîne courte) est rangée dans une `Map<sourceId, string>`
   interne au store. **Elle n'est jamais copiée dans `LayerState`.**
3. Accesseur `thumbnailUrl(sourceId): string | null`, symétrique de
   `dimensions(sourceId)` déjà existant (`photoSourceStore.ts:48-50`).
4. `dispose()` révoque les URL en plus de détruire les textures.
5. `LayerPanel` la lit via une prop injectée depuis `App`, exactement comme
   `rendererRef.current?.photoSources?.dimensions(...)` est déjà lu au point
   de montage des handles (`App.tsx:1126`) — le précédent existe.

Aucun raster ne transite par `setLayers`, donc aucun snapshot d'historique ne
grossit, donc l'invariant `displayProjection.ts` est respecté par
construction plutôt que par filtrage.

**Fuite assumée, et nommée.** `register()` rend un `sourceId` frais à chaque
appel (`photoSourceStore.ts:22-24`, comportement voulu : deux imports de la
même photo sont deux sources). Une boucle importer/annuler accumule donc, en
plus de la texture (§3.5), **un blob et une object URL** par import, jusqu'au
changement de document. Les deux points de révocation utiles sont déjà les bons
et les seuls : `dispose()` est appelé au changement de document
(`renderer.ts:185`) et par `Renderer.dispose()` (`renderer.ts:332`) — y ajouter
`URL.revokeObjectURL` suffit pour ces chemins. Le cycle import/undo, lui, est
traité par le garde de §3.5, qui compte les sources et échoue explicitement :
c'est le même plafond qui borne texture, blob et URL.

`register()` devient `async`
(`convertToBlob` l'est) et est attendu **avant** `addPhotoLayer`, pour que
le re-render qui crée la ligne ait déjà sa vignette (pas d'apparition
différée sans re-render).

Note de conception : `PhotoSourceStore` devient « propriétaire de tout ce
qui n'est pas sérialisable d'une source photo » et plus seulement des
textures — son commentaire d'en-tête (`photoSourceStore.ts:3-10`) est à
réécrire dans la même tranche. Alternative écartée : un
`PhotoThumbnailStore` séparé, qui serait un module shallow à cycle de vie
jumeau qu'il faudrait disposer en lockstep.

### 3.4 Surface UI

**Barre de transform : sur SÉLECTION, pas sur mode explicite.** Les poignées
apparaissent déjà à la sélection sans mode (`App.tsx:1123`) ; imposer un mode
contredirait cette affordance et ajouterait un clic sur l'action la plus
fréquente. Mécanisme : `useContextualPanel(isPhotoLayerSelected, selectedId)`
(`src/ui/contextualPanel.ts:31-43`), qui donne en prime le repli manuel
mémorisé par sélection.
Montage : même emplacement que `BrushToolbar` — entre `ErrorBanner` et
`<main class="workspace">` (`App.tsx:1081-1092`), en **poussant** le canvas,
jamais en overlay au-dessus de l'image.

**Modes du canvas : une union, plus deux booléens.** Aujourd'hui
`maskPaintMode` (`App.tsx:94`) et l'affichage des handles ne s'excluent pas :
un calque photo sélectionné en mode peinture superpose la boîte de
déplacement (`pointerEvents: "auto"` sur toute la boîte,
`TransformHandles.tsx:112`) au geste de pinceau. C'est un conflit réel,
présent avant ce chantier, que le crop rendrait ingérable. Remplacement :

```ts
type CanvasMode =
  | { kind: "idle" }
  | { kind: "maskPaint" }
  | { kind: "crop"; layerId: string; original: CropRect | undefined };
```

Un seul état, états incompatibles inexprimables. Règles : entrer dans un mode
sort de l'autre ; la barre de transform et les poignées ne s'affichent qu'en
`idle` ; `crop` porte le crop capturé à l'entrée pour pouvoir annuler.

**`crop` porte `layerId`, et c'est structurel.** Sans lui, l'utilisateur qui
entre en crop sur A puis sélectionne B (ou supprime A) garde un mode `crop`
dont les poignées se dessinent sur B, et `Échap` restaurerait le crop de **A**
sur **B** — restauration silencieuse d'un état arbitraire, hors historique donc
non annulable. Règle explicite qui accompagne le champ : **tout changement de
`selectedId` et toute suppression de calque forcent `{ kind: "idle" }`**
(abandon, même sémantique que `pointercancel` dans
`TransformHandles.tsx:91-101`). Le précédent de nettoyage par calque existe déjà
au même endroit : `handleRemove` purge `maskPaintersRef` (`App.tsx:376-393`).
À écrire dans **T1**, la tranche qui introduit l'union.

**Crop = MODE avec validation/annulation.** Entrée par un bouton « Recadrer »
de la barre de transform. Pendant : les 4 poignées de coin deviennent 8
poignées de rect de crop, dessinées dans le repère tourné du calque ; le
reste de la photo est atténué. « Valider » committe **une seule** entrée
d'historique, contenant à la fois le nouveau crop et le `(x, y)` compensé par
`recenterForCrop` (§3.2) ; « Annuler » ou `Échap` restaure `original` sans
entrée d'historique. Même discipline `pointerup` = commit /
`pointercancel` = abandon que `TransformHandles.tsx:82-101`.

**Champs numériques et actions.** X, Y, échelle %, angle ° : aperçu live au
`change`, une entrée d'historique au commit (blur/Entrée) — même couple
`onTransformChange` / `onTransformCommit` que les poignées
(`App.tsx:333-351`). Rangée d'actions : Réinitialiser · Ajuster à la toile ·
Centrer · Miroir H · Miroir V · Recadrer.

**Snap d'angle : 15°.** Valeur retenue par défaut parce que c'est celle de
Photoshop, la référence explicite de tout ce chantier — pas une question à
poser. La *forme* du déclencheur (bascule persistante dans la barre, `Shift`
maintenu pendant le drag, ou les deux) reste ouverte (§8). Correction de coût
au passage : `PointerEvent.shiftKey` est déjà disponible dans
`handlePointerMove` (`TransformHandles.tsx:64-70`) sans aucun listener clavier —
la variante `Shift` fait une ligne, pas de la « plomberie ».

**Clavier et accessibilité.** Deux points, l'un déjà réglé, l'autre à trancher
ici :
- *Pas de collision avec l'undo* : le handler clavier global ignore déjà les
  cibles éditables (`App.tsx:665-681`), donc `Ctrl+Z` dans un champ numérique
  reste l'undo texte natif. Rien à faire — noté pour ne pas le ré-investiguer.
- *`Entrée` est surchargé* (commit de champ **et** validation du crop).
  Arbitrage : **`Entrée` dans un champ = commit de ce champ, jamais du crop ;
  la validation du crop est `Ctrl+Entrée`, ou `Entrée` quand le focus n'est
  dans aucun champ.** `Échap` annule le crop depuis n'importe où sauf pendant
  l'édition d'un champ, où il annule d'abord l'édition du champ.
- *Critère a11y minimal, inscrit aux preuves de T2 et T4* : ordre de tabulation
  cohérent avec l'ordre visuel, `aria-label` sur chaque `IconButton` d'action,
  focus visible sur les champs et les boutons.

**Ajuster à la toile = *contain*.** Le mot « ajuster » désigne la variante qui
rend toute la photo visible (bandes autour si les ratios diffèrent), pas
*cover*. Fait dur associé, à documenter et à couvrir en test : la pré-passe rend
dans une cible **bgWidth × bgHeight** (`photoLayerInput.ts:122-131`), donc tout
ce qui dépasse le fond est perdu par construction, à toutes les échelles — une
photo plus grande que le fond n'est jamais entièrement compositable, et
*contain* est précisément ce qui rend ce cas exploitable en un clic. Le cas
« photo > fond » entre dans les tests Node de T2.

**Toute la logique en fonctions pures dans `src/ui/transform.ts`** —
`resetTransform`, `fitToCanvas`, `centerTransform`, `snapAngle`,
`flipHorizontal`, `flipVertical`, `resolveCrop`, `clampCrop`,
`recenterForCrop`, `transformsEqual` — testables en
env Node sans rendre un composant (convention Vitest du repo). Les composants
ne font que traduire écran↔pixels du fond et déléguer, comme
`TransformHandles` le fait déjà (`TransformHandles.tsx:17-25`).

### 3.5 N photos

**Plafond : `MAX_PHOTO_LAYERS = 4`**, constante nommée conservée au même
endroit (`src/layers/photoLayer.ts:9`), avec le critère de révision écrit
dans son commentaire.

Base factuelle : la seule mesure disponible est ~1280 Mo avec 2 photos 26 MP et
3 calques dont un calque photo, sans `device.lost`
(`.claude/learning-log.md:1060-1072`). Ce nombre n'est **pas** décomposé, donc
aucune extrapolation linéaire n'est légitime. Ce que le code permet
d'affirmer : chaque calque photo supplémentaire ajoute **une** texture source
(`photoW × photoH × 4` ≈ 96 Mo à 24 MP, `photoSourceStore.ts:29-38`) et
**zéro** cible pleine taille supplémentaire, la cible de résolution étant
partagée (`photoLayerInput.ts:71`). Le coût marginal connu est donc d'environ
une texture source par photo. 4 est retenu comme pas mesurable (≈ +3 sources
sur la mesure existante) et non comme une limite théorique — T5 remplace
cette valeur par une mesure réelle avant de la figer.

Comportement au plafond : l'action d'import est déjà désactivée par
`canImportPhotoLayer` (`App.tsx:1079`) et le message d'erreur explicite
existant (`App.tsx:312`) est reformulé pour nommer le plafond effectif.

**Cible partagée avec N calques : correcte, mais pour une autre raison que
celle écrite.** Le commentaire I4 (`photoLayerInput.ts:64-70`) justifie la
texture unique par « au plus un calque photo existe ». Cette justification
tombe. Ce qui reste vrai : les passes enregistrées dans un même
`GPUCommandEncoder` s'exécutent dans l'ordre de soumission, donc les passes
du calque A lisent la cible avant que le `resolve` du calque B ne la
`clear`. Le commentaire doit être réécrit pour nommer **l'ordre des passes**
comme l'invariant, et interdire explicitement toute mise en cache d'un
résultat de `resolve` entre calques. Alternative écartée : une cible par
calque photo, soit +96 Mo par calque à 24 MP.

**Et cet invariant est testable en Node, pas seulement affirmable en
commentaire.** Aucun test n'exécute aujourd'hui deux calques photo dans une
frame — `test/render/framePipelineExecutor.test.ts` n'a que des scénarios à un
seul `imageSource` (lignes 214 et 242) — alors que le port est déjà mocké dans
ce fichier et que la propriété est purement structurelle. T5 ajoute donc un test
avec encodeur factice et **deux** calques portant `imageSource`, qui assère
(a) l'ordre `resolve(A) → passes(A) → resolve(B) → passes(B)` et (b) que
`PhotoLayerInputPort.resolve` rend bien **le même objet texture** aux deux
appels. C'est littéralement la propriété que le commentaire réécrit affirme :
elle cesse d'être une promesse.

**Libération des textures : pas de refcount, mais un garde chiffré.** Un calque
photo supprimé peut revenir par undo ; libérer sa texture à la suppression
casserait l'undo. On garde « les sources vivent jusqu'au changement de
document » (`photoSourceStore.ts:52-55`). Conséquence : une boucle
importer/annuler répétée fait croître texture + blob + object URL (§3.3)
jusqu'au changement de document. C'est déjà vrai aujourd'hui ; avec N c'est plus
facile à atteindre.

Ce n'est pas une question à remonter : `ARCHITECTURE.md` R1 prescrit déjà
l'endroit (« si un garde arrive, il se pose dans `PhotoSourceStore` (point
unique d'allocation), pas dispersé »). **Décision : compteur de sources
enregistrées dans `PhotoSourceStore.register()`, plafond
`MAX_REGISTERED_PHOTO_SOURCES = 4 × MAX_PHOTO_LAYERS`, erreur explicite au
dépassement** (fail-fast, `ARCHITECTURE.md` §2.5 — jamais un état qui se dit
fini sans l'être), remontée par `ErrorBanner` avec un message qui nomme la
cause et la sortie (« trop de photos importées dans cette session — ouvre à
nouveau le document pour libérer la mémoire »). Le facteur 4 est un pas
arbitraire assumé : il borne la fuite sans gêner un usage normal, et il est
révisé par la même mesure que `MAX_PHOTO_LAYERS` en T5. Livré dans **T5**, avec
le reste du plafonnement.

**Round-trip Lightroom : aucun changement.** `hasPhotoLayer` est un prédicat
booléen sur « ≥ 1 » (`photoLayer.ts:24-26`), consommé par un unique point de
vérité (`App.tsx:1047`). Passer de 1 à N photos ne change ni le prédicat ni
son sens.

### 3.6 Changement d'`effectId` sur un calque existant — DANS LE SCOPE

Justification liée au besoin, pas au confort : « les traiter indépendamment »
(§1) est **inatteignable** sans ça. `addPhotoLayer` fixe `effectId:
"passthrough"` en dur (`layerStack.ts:68`) et aucune UI ne le change ; un
calque photo est donc `passthrough` à vie. Le moteur, lui, sait déjà router
la photo transformée comme entrée d'effet du calque
(`framePipelineExecutor.ts:214-262`) — capacité entièrement morte tant que
l'UI n'expose pas le changement.

Forme minimale : un sélecteur d'effet sur le calque sélectionné (source :
`effectRegistry`, déjà mappé en options `LayerPanel.tsx:42`), avec remise à
zéro des params sur les défauts du nouvel effet et une entrée d'historique.
`passthrough` apparaît dans ce sélecteur **de changement** sous le libellé
« Aucun effet », tout en restant hors du sélecteur **d'ajout**
(contrat existant, `render/effects/registry.ts:14-18`).

**`setLayerEffect` appelle `presets.clearActive()`, comme ses voisins.**
`handleAdd` (`App.tsx:353-359`) et `handleRemove` (`App.tsx:376-393`) le font
déjà avant de muter la pile. Sans cette ligne, après un changement d'effet le
preset actif resterait marqué propre alors que la pile a divergé : la bannière
« Preset modifié » (`App.tsx:1154-1164`) ne s'afficherait pas, et « Mettre à
jour » écrirait autre chose que ce qui est affiché — régression silencieuse
d'un comportement existant. Le calcul de `presetIsDirty` est à revérifier dans
la même tranche.

Bénéfice non exclusif aux calques photo — c'est ce qui en fait une tranche
indépendante, parallélisable.

## 4. Carte des modules touchés

| Module | Interface visée | Profondeur |
|---|---|---|
| `src/ui/transform.ts` | + `resolveCrop`, `clampCrop`, `recenterForCrop`, `transformsEqual`, `resetTransform`, `fitToCanvas`, `centerTransform`, `snapAngle`, `flipHorizontal/Vertical` ; `compositeUvToPhotoUv`/`computeHandleGeometry`/`scaleFromCornerDrag` prennent le crop en compte | profond — toute la géométrie, testable en Node, aucune dépendance React/WebGPU |
| `src/render/photoLayerInput.ts` | signature `resolve()` inchangée ; + `PHOTO_INVERSE_TRANSFORM_WGSL` exportée ; WGSL + écriture d'uniform réécrits | profond — miroir GPU de `transform.ts` |
| `src/layers/types.ts` | + `CropRect`, `flipX/flipY/crop`, `name` + convention d'immutabilité de `LayerTransform` | modèle |
| `src/layers/layerStack.ts` | `addPhotoLayer(sourceId, transform, name)` ; `setLayerEffect(id, effectId)` ; `clone()` recopie `transform`/`crop` ; **`updateLayerTransform` supprimé** (aucun appelant de production, `replaceLiveLayers` est le remplaçant déjà opérationnel ; son `paramsEqual` casserait sur `crop`) | mutateurs no-op-aware, discipline existante |
| `src/layers/photoLayer.ts` | `MAX_PHOTO_LAYERS` révisé | inchangé en forme |
| `src/render/photoSourceStore.ts` | `register()` devient async, compte les sources et échoue au plafond ; + `thumbnailUrl(sourceId)` ; `dispose()` révoque les URL | propriétaire unique du non-sérialisable |
| `src/hooks/usePhotoLayer.ts` (nouveau) | possède `canvasMode`, `handleImportPhotoLayer`, `handleTransformChange/Commit`, puis les handlers d'action de T2/T3/T4 et `setLayerEffect` de T6 ; parle à `DocumentSession` | profond — modèle exact de `src/hooks/usePresets.ts` (211 lignes), remède prescrit par `ARCHITECTURE.md` §7 R6 |
| `src/components/PhotoLayerToolbar.tsx` (nouveau) | props = transform + callbacks, zéro logique | mince, assumé (traduction UI) |
| `src/components/TransformHandles.tsx` | + mode crop, + modificateur `Shift` (`shiftKey` déjà disponible, `:64-70`) | mince, assumé |
| `src/components/LayerPanel.tsx` | + vignette/nom, + sélecteur d'effet | mince, assumé |
| `scripts/gpu-parity.mjs` (nouveau) | harnais CDP de parité pixel (§3.2 b), lancé par `npm run test:gpu` | outillage, hors bundle |
| `src/App.tsx` | **perd** l'état et les handlers de calque photo au profit de `usePhotoLayer` ; ne garde que le câblage | orchestration — 1417 lignes aujourd'hui, à ne pas augmenter |

**Périmètre exact de `usePhotoLayer`, et pourquoi en T1.** `App.tsx` fait
**1417 lignes** ce jour contre 727 documentées dans `ARCHITECTURE.md` §7 R6, et
le remède que R6 prescrit — « chaque feature apporte son propre hook module
(ex. `usePhotoLayer`, `usePresets`) [...] pour qu'`App.tsx` gagne quelques
lignes de câblage et non ~150 » — a été appliqué aux presets et **pas** à la
double exposure. Or ce chantier y ajouterait sinon : `canvasMode`, les ~8
handlers d'action de la barre (reset / fit / center / snap / miroir H /
miroir V / entrée crop / commit-annulation crop), les 4 handlers de champs
numériques, l'injection de `thumbnailUrl` et `setLayerEffect`.

Migrent **dans T1**, à l'identique, sans changement de comportement :
`handleImportPhotoLayer` (`App.tsx:309-331`), `handleTransformChange`
(`:333-345`), `handleTransformCommit` (`:347-351`), plus le nouvel état
`canvasMode` qui remplace `maskPaintMode` (`App.tsx:94`). Restent dans
`App.tsx` : la sélection, l'historique, l'export, les presets — le hook ne
prend que ce qui est propre au calque photo. T2/T3/T4/T6 y déposent ensuite
leurs handlers au lieu d'en ajouter à `App.tsx`. En T1 et pas plus tard :
chaque tranche ultérieure augmente le coût de l'extraction, et T1 est la seule
tranche qui touche déjà ce câblage sans risque shader.

## 5. Tranches verticales

Chaque tranche traverse modèle → logique → UI et se démontre seule.
**Les tranches WGSL (T3, T4) sont les plus risquées.** Leur moyen de preuve est
le harnais de parité pixel de §3.2(b) — pas le checkpoint humain, qui ne
discrimine ni un sous-pixel ni un ordre de transformation. Elles sont placées
**après** T1/T2 pour deux raisons : T1/T2 livrent l'essentiel du ressenti
« Photoshop » à risque shader nul, et T3 sert délibérément de **spike de la
migration d'uniform** — la struct est migrée sur la feature la plus simple
(flip) avant d'être exploitée par la plus complexe (crop).

Nuance sur les preuves headless : « rien n'est automatisable » est vrai du
**canvas WebGPU**, pas de l'UI. Le repo pilote déjà de vrais composants React au
clavier en Storybook (`src/components/PresetPanel.stories.tsx:82-95`,
`userEvent.keyboard("{Escape}")`) — T2, qui est du DOM pur, en relève.

### T1 — Identité + hygiène de mode + extraction du hook
Livre : `src/hooks/usePhotoLayer.ts` (périmètre exact en §4) ; `name` sur
`LayerState` alimenté par le basename à l'import ; vignette possédée par
`PhotoSourceStore` ; ligne de `LayerPanel` = vignette + nom au lieu de
« Passthrough » ; `canvasMode` union (avec `layerId` sur `crop`) remplaçant
`maskPaintMode`, qui masque barre et poignées pendant la peinture de masque, et
retombe en `idle` sur tout changement de sélection ou suppression de calque.
Preuve : importer une photo → la ligne affiche `IMG_1234.jpg` + sa vignette ;
entrer en peinture de masque → les poignées disparaissent, le pinceau n'est
plus intercepté ; undo/redo conserve le nom ; `wc -l src/App.tsx` a baissé.
Unitaire : `addPhotoLayer` pose `name`, transitions de `canvasMode` (y compris
retour forcé en `idle` sur changement de sélection et sur suppression),
`toDisplayLayers` inchangé (aucun raster nouveau).
À énoncer dans l'UI au passage : le contournement recommandé par
`ARCHITECTURE.md` §4.5 pour le masque (« poser le transform d'abord, peindre
ensuite ») devient un **aller-retour de mode** et non plus une simple séquence,
puisque peinture et poignées deviennent mutuellement exclusives. Le libellé du
bouton de sortie de mode doit le rendre évident.
Bloqué par : rien. **Aucun WGSL.**

### T2 — Barre contextuelle + actions non destructives
Livre : `PhotoLayerToolbar` montée sur sélection via `useContextualPanel` ;
champs X / Y / échelle % / angle ° éditables ; Réinitialiser · Ajuster à la
toile (*contain*) · Centrer ; snap d'angle à 15° ; fonctions pures dans
`ui/transform.ts` ; arbitrage `Entrée`/`Échap` et a11y de §3.4.
Preuve : saisir 45 dans l'angle → l'image tourne ; « Ajuster à la toile » →
la photo entière tient dans le fond, y compris quand elle est plus grande que
lui ; chaque saisie commitée = exactement une étape d'undo ; tests Node sur
chaque fonction pure (dont le cas « photo > fond ») ; **story Storybook
d'interaction** sur `PhotoLayerToolbar` — saisie clavier, `Entrée`, `Échap`,
ordre de tabulation, `aria-label` présents.
Bloqué par : T1 (fournit `usePhotoLayer` et `CanvasMode`). **Aucun WGSL.**

### T3 — Flip horizontal / vertical + le filet du shader
Livre : `flipX`/`flipY` au modèle ; migration de l'uniform vers
`PhotoInputParams` (struct de 4 `vec4`) ; extraction de
`PHOTO_INVERSE_TRANSFORM_WGSL` et assertions ligne à ligne dessus (§3.2 a) ;
harnais `scripts/gpu-parity.mjs` + pont de debug dev-only (§3.2 b) ; branche de
flip CPU **et** WGSL ; boutons Miroir H / Miroir V ; **`transformsEqual`** en
remplacement de la comparaison énumérée de `handleTransformChange` (§3.1) ;
**`clone()` recopie `transform`/`crop`** (§3.1) ; suppression de
`updateLayerTransform`.
Preuve : `npm run test:gpu` vert sur identité · flipX · flipY · rotation 90° ·
flip+rotation+scale ; assertions de texte WGSL vertes ; Miroir H produit
**exactement une** entrée d'undo, et l'undo la défait ; test Node
`transformsEqual` (dont deux `crop` structurellement identiques =
égaux) ; checkpoint visuel humain **en plus**, pour le ressenti.
Bloqué par : T2 (la barre porte les boutons Miroir). **WGSL — risqué.**
Décision de comportement à énoncer dans l'UI : un masque déjà peint ne suit
PAS le flip (le masque vit en espace composite) — voir §8.

### T4 — Recadrage
Livre : `crop?` + `resolveCrop`/`clampCrop`/`recenterForCrop` ; bornes et
couverture calculées sur le crop, CPU et GPU ; boîte/poignées dimensionnées sur
le crop ; mode crop avec validation/annulation ; cas de crop ajoutés au harnais
de parité et aux assertions WGSL.
Preuve : recadrer à la moitié haute → seule la moitié haute se composite et
la boîte rétrécit ; **après validation d'un crop en haut à gauche, le sujet
n'a pas bougé d'un pixel** — assérté par le harnais (le même pixel source
ressort aux mêmes coordonnées écran avant et après le commit), pas par l'œil ;
test Node de `recenterForCrop` pour rotation ≠ 0 et scale ≠ 1 ; « Annuler »
restaure exactement le crop d'entrée sans étape d'undo ; « Valider » produit
exactement une étape, contenant crop **et** `(x, y)` compensé.
Bloqué par : T3 (partage la struct d'uniform et le harnais — les construire une
seule fois). **WGSL — la plus risquée.**

### T5 — N photos
Livre : `MAX_PHOTO_LAYERS` porté à la valeur mesurée ; commentaire I4
réécrit autour de l'ordre des passes ; test Node à deux calques photo (§3.5) ;
`MAX_REGISTERED_PHOTO_SOURCES` + erreur explicite dans `PhotoSourceStore` ;
révocation des object URL dans `dispose()` ; message d'erreur au plafond ;
mesure VRAM réelle consignée.
Preuve : importer 4 photos, chacune sélectionnable et transformable
indépendamment ; la 5ᵉ est refusée avec un message nommant le plafond ; test
Node vert sur l'ordre des passes et l'identité de la texture cible ; relevé
VRAM à 4 × 24 MP écrit dans ce document ; round-trip Lightroom toujours coupé.
Bloqué par : **rien**. WGSL touché en commentaire seulement.
Coordination : T5 modifie le message d'erreur de `handleImportPhotoLayer`, que
T1 **déplace** dans `usePhotoLayer`. C'est un conflit de merge d'une ligne, pas
une dépendance — T5 ne déplace aucun code, T1 le fait. Rebaser T5 sur T1 au
merge.

#### Mesure VRAM — À FAIRE (protocole exécutable, aucun chiffre inventé)

> **Statut : NON MESURÉE.** `MAX_PHOTO_LAYERS = 4` et
> `MAX_REGISTERED_PHOTO_SOURCES = 4 × MAX_PHOTO_LAYERS` sont posés sur la seule
> mesure existante (~1280 Mo dédiés avec **2 photos 26 MP et 3 calques**, dont
> un calque photo — `.claude/learning-log.md:1060-1072`, relevé du 2026-07-25 ;
> chiffre global, non décomposé, et pas dans les conditions du protocole
> ci-dessous) plus un
> raisonnement de coût marginal, PAS sur un relevé à 4 photos. La branche T5 a
> été implémentée en session headless, sans GPU : aucun chiffre n'a été
> produit, et aucun n'a été simulé. `ARCHITECTURE.md` R1 (« Mesure sur cas réel
> 24 MP + 24 MP AVANT de déclarer la feature terminée ») reste donc **ouvert**.
> La feature n'est pas « terminée » tant que l'encadré ci-dessous n'est pas
> rempli.

**Qui l'exécute** : un humain, sur la machine Windows cible, avec une vraie
fenêtre WebView2 (le rendu WebGPU est nul en headless — voir `CLAUDE.md`
§ « Moyen de preuve (UI) »).

**Images à utiliser** : 5 JPEG **distincts** d'au moins 24 MP chacun
(≈ 6000 × 4000). Distincts et non 5 copies du même fichier : chaque import
alloue sa propre texture source, un même fichier réimporté ne doit pas laisser
croire à un partage. 24 MP est le point de comparaison de la mesure existante —
ne pas descendre en dessous, sinon le relevé n'est pas comparable.

**Protocole, dans l'ordre** :

1. `npm run dev:debug` puis `npm run dev:monitor` (voir `CLAUDE.md` § Méthode).
   Vérifier qu'aucune autre instance `shaderlab` ne tourne avant
   (`Get-Process -Name shaderlab`).
2. Ouvrir l'image de FOND (24 MP). Relever la VRAM → **V0**.
3. Importer un calque photo (24 MP), attendre le rendu → **V1**.
4. Importer les calques photo 2, 3 puis 4 → **V2**, **V3**, **V4**. Après
   chaque import : la fenêtre rend toujours, aucun `device.lost` dans la
   console CDP.
5. Tenter un 5ᵉ import : l'action doit être refusée par `canAddPhotoLayer` avec
   le message nommant `MAX_PHOTO_LAYERS` (garde + message :
   `src/App.tsx:314-316`, « Limite atteinte : au plus 4 photos importées
   (double exposure) par document. »). Noter que le refus est bien applicatif,
   pas un crash.
6. Boucle importer/annuler (Ctrl+Z) répétée jusqu'à dépasser
   `MAX_REGISTERED_PHOTO_SOURCES` (= 16) : l'erreur explicite de
   `PhotoSourceStore.register()` (`src/render/photoSourceStore.ts:54-61`,
   « Trop de photos importées dans cette session (n/16)… ») doit apparaître
   dans `ErrorBanner`, sans crash. Relever la VRAM à ce point → **Vmax**.

**Comment lire la valeur (une seule méthode, la même à chaque relevé)** :
Gestionnaire des tâches → onglet Performance → GPU → « Mémoire GPU dédiée
utilisée », ou `nvidia-smi --query-gpu=memory.used --format=csv` sur GPU
NVIDIA. Noter la valeur **au repos, ≥ 3 s après la fin du rendu**, pas pendant
la passe. Consigner l'outil utilisé : les deux ne comptent pas la même chose,
les mélanger invalide les deltas.

**Valeurs à consigner ici** (tableau à remplir, ne rien écrire tant que ce
n'est pas mesuré) :

| Relevé | Attendu (raisonnement §3.5) | Mesuré | Machine / GPU / outil |
|---|---|---|---|
| V0 (fond seul) | — | _à faire_ | _à faire_ |
| V1 (fond + 1) | pas d'attendu chiffré — la mesure existante (~1280 Mo) a été prise à 26 MP avec 3 calques, conditions différentes : ne pas la traiter comme une cible | _à faire_ | _à faire_ |
| V2 | V1 + ≈ 96 Mo | _à faire_ | _à faire_ |
| V3 | V2 + ≈ 96 Mo | _à faire_ | _à faire_ |
| V4 | V3 + ≈ 96 Mo | _à faire_ | _à faire_ |
| Vmax (plafond de sources atteint) | — | _à faire_ | _à faire_ |

**Seuils de décision — ce qui déclenche quoi** :

- **`device.lost` observé, ou fenêtre qui cesse de rendre, à N ≤ 4 photos** →
  `MAX_PHOTO_LAYERS` descend à `N − 1`, et `MAX_REGISTERED_PHOTO_SOURCES` suit
  (il en dérive : `4 × MAX_PHOTO_LAYERS`). Bloquant : la feature ne se déclare
  pas terminée avec un plafond qui casse.
- **V4 > 80 % de la VRAM totale du GPU de test** → plafond trop haut pour cette
  classe de machine même sans crash (aucune marge pour le reste du système) :
  descendre `MAX_PHOTO_LAYERS` d'un cran et re-mesurer.
- **Delta par photo nettement supérieur à ≈ 96 Mo** (disons > 150 Mo) → le
  raisonnement « une texture source par photo, cible partagée » est faux quelque
  part : rouvrir §3.5 et l'invariant d'ordre des passes AVANT de toucher au
  plafond. C'est un bug d'allocation, pas un problème de constante.
- **V4 confortable (< 60 % de la VRAM) et aucun incident** → le plafond 4 peut
  être relevé, mais seulement avec une nouvelle mesure au nouveau plafond ; ne
  jamais extrapoler linéairement (c'est exactement l'erreur que §3.5 refuse).

Quand la mesure est faite : remplir le tableau, dater, et mettre à jour le
commentaire « CRITÈRE DE RÉVISION » de `src/layers/photoLayer.ts` pour qu'il
cite le relevé au lieu d'annoncer une mesure à faire.

#### Dépendance T1 → T5 à vérifier au merge : révocation des object URL

La ligne « révocation des object URL dans `dispose()` » de la liste T5 ci-dessus
**n'est pas livrée par la branche T5**, et c'est légitime : le code visé
n'existe pas sur cette branche. Preuve : `git grep -n
"createObjectURL\|revokeObjectURL" -- src test` sur `worktree-wf_d2c07cb5-8ed-2`
retourne **0 occurrence** sur **200 fichiers** balayés (témoin : le même grep sur
`blob` retourne des hits, le balayage n'est donc pas vide) ;
`src/render/photoSourceStore.ts:95-99` ne détient que des `GPUTexture`, il n'y a
aucune URL à révoquer.

Les object URL de vignettes arrivent avec **T1** (§3.3, identité du calque). À
faire **au merge T1 + T5**, pas avant :

1. Vérifier que `PhotoSourceStore` (ou le propriétaire retenu par T1) détient
   bien les object URL en plus des `GPUTexture`.
2. Ajouter `URL.revokeObjectURL(...)` dans `dispose()`, au même endroit que
   `texture.destroy()` — même cycle de vie, même point unique de libération.
3. Test Node : après `dispose()`, un `revokeObjectURL` mocké a été appelé une
   fois par source enregistrée.

Sans ce point, la fuite décrite en §3.5 (boucle importer/annuler) reste bornée
côté VRAM par `MAX_REGISTERED_PHOTO_SOURCES` mais **pas** côté mémoire
processus.

### T6 — Changement d'effet sur un calque existant
Livre : `setLayerEffect` (+ `presets.clearActive()`, §3.6) + sélecteur UI +
reset des params + `passthrough` libellé « Aucun effet » dans ce sélecteur
uniquement.
Preuve : sur un calque photo, choisir « glow » → le glow s'applique à la
silhouette et non au fond (c'est exactement ce que
`framePipelineExecutor.ts:214-262` garantit) ; une étape d'undo ; la bannière
« Preset modifié » apparaît après le changement ; sur un calque non-photo le
changement marche aussi.
Bloqué par : **rien**. Ne touche ni la géométrie ni le shader.

### DAG et vagues de parallélisation

Un lien n'existe que si une tranche a besoin d'un **artefact** qu'une autre
crée. Les liens de confort ont été retirés.

| Tranche | `bloqué_par` | Artefact réellement attendu | Type |
|---|---|---|---|
| T1 | — | — | HITL (jugement visuel sur la ligne de calque) |
| T2 | T1 | `usePhotoLayer`, type `CanvasMode` | HITL (barre = surface sensible) |
| T3 | T2 | `PhotoLayerToolbar` (porte les boutons Miroir) | AFK une fois le harnais posé |
| T4 | T3 | struct `PhotoInputParams`, `scripts/gpu-parity.mjs` | AFK |
| T5 | — | — | AFK |
| T6 | — | — | AFK |

**Vague 1 = T1 · T5 · T6** (trois worktrees) · **Vague 2 = T2** ·
**Vague 3 = T3** · **Vague 4 = T4**.

Le lien T4 → T5 de la version précédente était un argument de confort
(« inutile de multiplier les calques avant que la géométrie soit figée ») : T5
ne consomme aucun artefact de T4, et le maintenir coûtait une vague entière sur
un chantier annoncé comme parallèle. Vague 5 = T5.

## 6. Bug adjacent, signalé et NON traité

`.transform-handles` est en `inset: 0` relatif à `.workspace`
(`src/components/TransformHandles.css:1-6`) alors que le canvas est centré
avec un `padding-right` (`src/components/Canvas.css:29`). Les entrées
pointeur passent par `getBoundingClientRect()` du canvas
(`TransformHandles.tsx:33-36`) et restent donc correctes, mais le **rendu**
des poignées peut être décalé du rectangle image. À traiter séparément :
c'est un défaut de positionnement CSS préexistant, pas une conséquence de ce
chantier, et le corriger à l'intérieur de T2/T4 mélangerait deux causes dans
la même preuve visuelle.

**Biais acté sur T4.** T4 dessine ses 8 poignées de crop dans ce **même**
conteneur `.transform-handles`, sur des poignées dont la position *est* le
sujet : le regard humain porté sur T4 se lit donc à travers ce décalage connu.
Ce n'est pas bloquant depuis que la preuve de T4 est le harnais de parité
pixel (§3.2 b), qui mesure des pixels **exportés** et n'est pas affecté par le
positionnement CSS de l'overlay. Formulation à retenir : la géométrie de T4 est
prouvée par le harnais ; le checkpoint humain sur T4 juge le ressenti
d'interaction, pas l'alignement, tant que ce bug CSS n'est pas corrigé.

## 7. Différé (avec trigger de réouverture nommé)

| Différé | Trigger de réouverture |
|---|---|
| Échelle non uniforme / étirement libre (`scaleX`/`scaleY` signés) | L'utilisateur demande d'étirer une photo hors ratio |
| Renommage manuel d'un calque par l'utilisateur | Demande explicite |
| Calques photo dans les presets (embarquer les pixels ou re-résoudre un chemin) | L'utilisateur tente de sauvegarder un preset contenant une photo et le juge bloquant |
| Libération refcountée des textures source (le plafond de §3.5 est le garde v1) | Le plafond de sources se révèle gênant dans un usage normal, ou une mesure montre un problème VRAM réel sous le plafond |
| Génération CPU+WGSL depuis une source unique (§3.2 c) | Une troisième implémentation de la même géométrie apparaît |
| Crop tourné indépendamment du calque | Demande explicite |
| Photo importée promue en photo de FOND / plusieurs fonds | Demande explicite |
| Migration du crop en UV (survie au remplacement de la photo source) | L'utilisateur demande à remplacer la source d'un calque en conservant son crop |
| Alignement/distribution multi-calques (guides, snap sur les bords du fond) | Apparaît dès que N > 2 devient un usage courant |

## 8. Points ouverts (non tranchés seul, volontairement)

Deux, et deux seulement. Les trois autres questions de la version précédente
étaient tranchables sur pièce et ont été tranchées : le layout d'uniform (§3.2,
répondu par `shaderCompose.ts:109` + `effectPassRunner.ts:157-160`), le plafond
de sources enregistrées (§3.5, prescrit par `ARCHITECTURE.md` R1), et l'angle de
snap (§3.4, 15° comme Photoshop).

1. **Le masque ne suit pas la transform de la photo — confirmer la
   recommandation `ARCHITECTURE.md` §4.5.** Le masque vit en espace composite
   (`MaskPainter` est alloué aux dimensions de l'image de base) ; après un
   déplacement, un flip ou un crop, un masque déjà peint reste en place. Ce
   n'est pas une découverte : `ARCHITECTURE.md` §4.5 recommande déjà une v1 et
   chiffre l'alternative. Ce qui est demandé est une confirmation, pas un
   arbitrage à zéro :
   - **(A) Assumer et documenter** — poser le transform d'abord, peindre
     ensuite. Coût nul, mais depuis T1 c'est un aller-retour de mode (peinture
     et poignées s'excluent), et un utilisateur qui recadre après avoir peint
     verra son masque glisser sans avertissement.
   - **(B) Faire suivre le masque** — exige un second espace de coordonnées
     traversant tout `mask/` (sources, fold, refine edge, résolution GPU) :
     un chantier à part entière, plus gros que les six tranches réunies, et
     qui touche tous les calques, pas seulement les calques photo.
   Recommandation : **(A)**, à confirmer avant T3.
2. **Forme du déclencheur de snap d'angle : bascule persistante dans la barre,
   `Shift` maintenu pendant le drag, ou les deux ?** L'angle (15°) est tranché ;
   il ne reste que l'interaction. Les deux variantes coûtent une ligne chacune
   (`shiftKey` est déjà disponible, `TransformHandles.tsx:64-70`), donc le choix
   est purement une question d'usage. **À poser avec un rendu de la barre en
   face, jamais en A/B/C textuel** — c'est une décision d'interaction, et un
   texte ne montre pas ce que « bascule persistante » fait au ressenti du drag.

## 9. Auto-vérification

| Affirmation de ce document | Preuve |
|---|---|
| `scale` est scalaire et strictement positif | `src/layers/types.ts:17` + `src/ui/transform.ts:26-32` (lu) |
| L'uniform est `array<f32, 8>` indexé 0..7 | `src/render/photoLayerInput.ts:21,25-32,139-142` (lu) |
| Le test « I3 » ne lit jamais `PHOTO_LAYER_INPUT_WGSL` | `test/render/photoLayerInput.test.ts:123-160` — `replicateWgslFormula` (TS) vs `compositeUvToPhotoUv` (TS) ; la chaîne WGSL n'est assérée qu'aux lignes 112-113, sur le feather (lu) |
| Un chemin de readback GPU existe déjà et rend du RGBA tassé | `src/render/renderer.ts:281-292` + `src/render/frameReadback.ts:33-87` (lu) |
| Un uniform tassé `array<f32, 11>` est en production sur le chemin principal | `src/render/shaderCompose.ts:6,109` + `src/render/effectPassRunner.ts:157-160` (lu) |
| `clone()` ne recopie pas `transform` | `src/layers/layerStack.ts:262-280` — `params` et `mask` explicitement recopiés, `transform` non (lu) |
| Le commit de transform est armé par une comparaison énumérée sur 4 champs | `src/App.tsx:333-345` + `:347-351` (lu) |
| `updateLayerTransform` n'a aucun appelant de production | `src/layers/layerStack.ts:83-89` ; seul écrivain réel `src/App.tsx:340` (lu) |
| `paramsEqual` compare par `Object.is` valeur par valeur | `src/layers/layerStack.ts:24-37` (lu) |
| `App.tsx` fait 1417 lignes, contre 727 dans `ARCHITECTURE.md` §7 R6 | `wc -l src/App.tsx` → `1417` ; `ARCHITECTURE.md:518` (lu) |
| `usePresets` est le modèle d'extraction prescrit et existe | `src/hooks/usePresets.ts`, 211 lignes (`wc -l`) |
| `ARCHITECTURE.md` prescrit déjà où poser un garde d'allocation | `ARCHITECTURE.md:513` (R1) : « il se pose dans `PhotoSourceStore` (point unique d'allocation), pas dispersé » (lu) |
| `ARCHITECTURE.md` recommande déjà une v1 pour l'espace du masque | `ARCHITECTURE.md:413-430` (§4.5), « v1 recommandée : assumer et documenter » (lu) |
| La cible de résolution est unique et partagée | `src/render/photoLayerInput.ts:71,122-132` (lu) |
| Aucun test n'exécute deux calques photo dans une frame | `test/render/framePipelineExecutor.test.ts:214,242` (lu) |
| Le nom de fichier est disponible puis jeté à l'import | `src/App.tsx:309-331` (lu) |
| Aucune UI ne change l'`effectId` d'un calque existant | `src/components/LayerPanel.tsx:42,174-178` — `addEffectOptions` n'alimente que le Select « Ajouter un effet » (lu) |
| `presets.clearActive()` précède déjà toute mutation de pile | `src/App.tsx:354` (`handleAdd`), `:378` (`handleRemove`) (lu) |
| `maskPaintMode` est un `useState` booléen à remplacer par l'union | `src/App.tsx:94` (lu) |
| Les presets excluent les calques photo | `src/presets/presetDocument.ts:16-20,83-91` (lu) |
| `maskPaintMode` n'exclut pas les poignées de transform | `src/App.tsx:1082-1092,1123-1132` (lu) |
| Le handler clavier global ignore déjà les champs éditables | `src/App.tsx:665-681` (lu) |
| `shiftKey` est déjà disponible sans listener clavier | `src/components/TransformHandles.tsx:64-70` (lu) |
| Un précédent de test d'interaction clavier sur composant réel existe | `src/components/PresetPanel.stories.tsx:82-95` (lu) |
| `PhotoSourceStore` est propriétaire GPU exclusif, expose `dimensions()`, et rend un id frais à chaque `register` | `src/render/photoSourceStore.ts:3-10,22-24,48-50` (lu) |
| `PhotoSourceStore.dispose()` est appelé aux deux chemins utiles | `src/render/renderer.ts:185` (changement de document), `:332` (`Renderer.dispose`) (lu) |
| Le moteur route déjà la photo comme entrée d'effet du calque | `src/render/framePipelineExecutor.ts:214-262` (lu) |

## 10. Historique de revue

**2026-07-26 — revue adverse sur `master@08c6d8c`.** 5 BLOQUANT · 11 IMPORTANT ·
4 MINEUR. Résultat : **20 findings, 20 corrigés, 0 réfuté, 0 accepté en
l'état.**

### Bloquants

- **B1** (le test I3 ne lit pas le WGSL) — *corrigé en §3.2, « Moyen de preuve
  du WGSL »*. Le design revendiquait à tort une détection de divergence de
  convention. Deux moyens retenus cumulativement en T3 : assertions ligne à
  ligne sur `PHOTO_INVERSE_TRANSFORM_WGSL` extraite, **et** harnais de parité
  pixel CDP (`scripts/gpu-parity.mjs`) adossé à `Renderer.exportFrame`. La
  génération CPU+WGSL depuis une source unique est écartée avec sa raison et son
  trigger de réouverture (§7).
- **B2** (ancre du crop) — *corrigé en §3.2, « Ancre »*. Ancre maintenue au
  centre du crop, saut supprimé par `recenterForCrop` appliquée au commit ;
  coïncidence avec le code actuel quand `crop` est absent démontrée
  (`photoLayerInput.ts:44`, `transform.ts:60,62`) ; critère de preuve inscrit
  en T4.
- **B3** (aucun flip/crop ne produirait d'entrée d'historique) — *corrigé en
  §3.1, « Déclenchement de l'entrée d'historique »*, inscrit en **T3** :
  `transformsEqual` remplace la comparaison énumérée d'`App.tsx:333-345`.
- **B4** (`clone()` ne copie pas `transform`) — *corrigé en §3.1, « Propriété et
  `clone()` »*, inscrit en **T3** : recopie de `transform`/`crop` + convention
  d'immutabilité écrite sur le type.
- **B5** (mode `crop` sans identité de calque) — *corrigé en §3.4* :
  `{ kind: "crop"; layerId; original }` + retour forcé en `idle` sur changement
  de sélection et sur suppression, inscrit en **T1**.

### Importants

- **I1** (stride uniform présenté comme question ouverte) — *corrigé* : §8.3
  supprimé, réponse intégrée en §3.2 et au tableau §2/§9.
- **I2** (faux lien T4 → T5) — *corrigé en §5, « DAG et vagues »* : T5 sans
  bloqueur, vagues recalculées, point de coordination de merge nommé.
- **I3** (invariant de T5 testable en Node) — *corrigé en §3.5* : test à deux
  calques photo ajouté à T5.
- **I4** (fuite object URL / blob non assumée) — *corrigé en §3.3, « Fuite
  assumée, et nommée »*, bornée par le garde de §3.5.
- **I5** (plafond de sources tranchable) — *corrigé en §3.5* :
  `MAX_REGISTERED_PHOTO_SOURCES` dans `PhotoSourceStore`, fail-fast ; retiré des
  points ouverts.
- **I6** (snap : angle tranchable, coût du `Shift` surestimé) — *corrigé en
  §3.4* : 15° tranché avec sa raison, coût rectifié, et la seule question
  restante (forme du déclencheur) marquée « avec un visuel en face » en §8.
- **I7** (masque : recommandation `ARCHITECTURE.md` §4.5 ignorée) — *corrigé en
  §8.1* : reformulé en confirmation d'une recommandation existante, deux options
  avec conséquence, recommandation nommée ; conséquence de T1 sur le
  contournement énoncée dans T1.
- **I8** (`usePhotoLayer` manquant, et manquant en T1) — *corrigé en §4 et en
  T1* : périmètre exact des handlers migrés, justification du timing.
- **I9** (photo > fond, « Ajuster » non défini) — *corrigé en §3.4* : *contain*,
  perte hors-fond documentée, cas ajouté aux tests de T2.
- **I10** (T6 oublie `presets.clearActive()`) — *corrigé en §3.6* et dans la
  preuve de T6.
- **I11** (a11y et collision `Entrée`) — *corrigé en §3.4* : arbitrage
  `Entrée`/`Ctrl+Entrée`/`Échap`, critère a11y inscrit aux preuves de T2 et T4,
  non-collision Ctrl+Z notée pour ne pas être ré-investiguée.

### Mineurs

- **M1** (dérives de `fichier:ligne`) — *corrigé* : toutes les citations des §2
  et §9 relues sur disque et rafraîchies (`App.tsx:309-331`, `:333-351`,
  `:1071`, `:1079`, `:1123-1132` ; `registry.ts:14-18` ;
  `photoLayerInput.ts:64-70` + champ ligne 71 ; `LayerPanel.tsx:105-107`,
  `:42,174-178`).
- **M2** (`updateLayerTransform` mort, `paramsEqual` casserait sur `crop`) —
  *corrigé en §3.1 et §4* : suppression inscrite en T3, remplaçant
  (`replaceLiveLayers`) déjà en place et opérationnel.
- **M3** (« aucune preuve headless » trop général) — *corrigé en §5* : preuve
  Storybook donnée à T2, checkpoint humain réservé au GPU.
- **M4** (le bug CSS §6 biaise la preuve de T4) — *corrigé en §6* : biais acté
  par écrit, neutralisé par le fait que la preuve géométrique de T4 est le
  harnais pixel et non l'overlay.

### Réfuté

- **Aucun finding n'a été réfuté.** Le seul point du rapport corrigé *à
  décharge* est interne à **I6** : la revue avait raison contre le design sur le
  coût du modificateur `Shift` (`TransformHandles.tsx:64-70` — `shiftKey` est un
  champ de `PointerEvent`, aucune plomberie clavier requise), et le design a été
  corrigé dans son sens.
