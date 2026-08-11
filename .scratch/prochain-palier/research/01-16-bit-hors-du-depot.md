# Ce dont le 16-bit a besoin hors du dépôt — findings

Réponse au ticket [01-ce-dont-le-16-bit-a-besoin-hors-du-depot](../issues/01-ce-dont-le-16-bit-a-besoin-hors-du-depot.md).
Source amont : `PRD-print-export.md`, § « Annexe — Choix techniques déduits (à valider) ».

**Ce document n'arbitre rien.** Il établit des faits pour
[02-cout-d-attendre-le-16-bit](../issues/02-cout-d-attendre-le-16-bit.md). Là où
une réponse manque, elle est écrite `[INDÉTERMINÉ]` plutôt que comblée.

Date des mesures : 2026-08-11.

## Les trois réponses, courtes

1. **`rgba16float` est disponible, et le filtrage linéaire ne coûte aucune
   feature.** Cible de rendu, blending, `copyTextureToBuffer` + `mapAsync`,
   échantillonnage linéaire : tout passe sur un device demandé **sans aucune
   feature optionnelle**. Établi trois fois — spécification, source de Dawn,
   mesure sur cette machine. `float32-filterable` ne concerne que les formats
   **32 bits** ; elle est par ailleurs disponible ici, mais inutile en 16 bits.
   ⚠️ Mesuré dans Edge 151.0.4129.72, **pas** dans le WebView2 de shaderlab —
   trou déclaré et refermable en un collage (§ Reproduire les mesures).
2. **Deux crates Rust écrivent réellement un TIFF 16 bits/canal avec ICC
   embarqué, et les deux passent le gate licence** : `image` **0.25.10**
   (`MIT OR Apache-2.0`) — **déjà une dépendance de ce dépôt** — et `tiff` 0.11.3
   (`MIT`). L'activer coûte un flag de feature et **une** transitive. Un candidat
   a bien été écarté par le gate (`libtiff-sys`, licence `"non-standard"`).
3. **La matrice sRGB → Adobe RGB n'a que 4 coefficients non triviaux**, parce que
   les deux espaces **partagent exactement leurs primaires rouge et bleue** et
   leur point blanc D65 — donc aucune adaptation chromatique, et le canal vert
   est identique. Calculée deux fois par deux voies indépendantes.

**Trois faits qui ne se déduisent d'aucune des trois questions telles que posées**,
et qui pèsent sur la suite :

- `rgba16float` n'est **pas** 16 bits uniformes : ~11 bits utiles près du blanc,
  **32 à 64× plus grossier qu'un 16 bits entier** au-dessus de 0.5 — alors que la
  sortie visée *est* un TIFF 16 bits entier (§1.6).
- **Aucun format flottant n'a de variante `-srgb`.** L'invariant « sRGB par le
  FORMAT, jamais un gamma manuel » du CLAUDE.md, sur lequel reposent 7 modules de
  `src/render/`, **ne peut pas s'appliquer** à une cible `rgba16float` (§1.7).
- Le plafond `MAX_CANVAS_PIXELS = 64 Mpx` (ADR-0007) **dépasse les limites par
  défaut** du device en 16 bits ; elles sont relevables, mais doivent être
  demandées explicitement (§1.5).

## Comment lire ce document

Chaque affirmation porte son étiquette de provenance, parce que le ticket exige
précisément qu'on ne confonde pas « la spécification le permet » avec « Dawn
l'expose ici » :

| Étiquette | Sens |
|---|---|
| `[SPEC]` | Lu dans une spécification normative. Se lit, ne se mesure pas. |
| `[DAWN]` | Lu dans le code source de Dawn. Dit ce que l'implémentation *code*. |
| `[MESURÉ]` | Exécuté sur cette machine le 2026-08-11. Dit ce que l'implémentation *fait*. |
| `[CALCULÉ]` | Produit par un calcul reproductible, script et sortie donnés. |
| `[INDÉTERMINÉ]` | Non établi. |

Les trois premières ne sont pas interchangeables, et elles ont divergé au moins
une fois dans ce document — voir §1.8, où une lecture du seul code source de Dawn
aurait donné une conclusion **fausse** que la mesure a corrigée.

---

## Conditions de la mesure — et le trou qui reste

Ce qui a été mesuré, et sur quoi exactement :

| | |
|---|---|
| Runtime WebView2 installé | **151.0.4129.78** (aussi .72 et .59 présents) `[MESURÉ]` |
| Hôte des mesures | **Microsoft Edge 151.0.4129.72** (`Edg/151.0.4129.72` rapporté par CDP) `[MESURÉ]` |
| Adaptateur | `vendor: nvidia`, `architecture: turing` `[MESURÉ]` |
| Implémentation WebGPU | Dawn — les messages d'erreur citent `third_party\dawn\src\dawn\native\` `[MESURÉ]` |
| `getPreferredCanvasFormat()` | **`bgra8unorm`** `[MESURÉ]` — confirme le CLAUDE.md § Stack |

**Le trou, énoncé franchement : les mesures ont été prises dans Edge, pas dans le
processus WebView2 de shaderlab.** Aucun binaire `shaderlab.exe` n'existait sur
disque (`src-tauri/target/**/shaderlab.exe` : aucun résultat), et construire
l'app pour cette question aurait coûté un `cargo build` complet.

Ce qui rend le report défendable, et ses limites :

- WebView2 et Edge partagent le moteur de rendu. Microsoft l'écrit : « The
  WebView2 control uses Microsoft Edge as the rendering engine to display the web
  content in native apps »
  ([learn.microsoft.com/microsoft-edge/webview2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/)).
- Les deux versions installées sont sur la **même branche Chromium 151.0.4129**
  (runtime .78, Edge .72) — un écart de patch, pas de branche.
- **Mais ce n'est pas une preuve, c'est une inférence.** La mesure directe dans le
  WebView2 de shaderlab n'a pas été faite.

Ce trou se referme en un collage — voir § « Reproduire les mesures » en fin de
document. Tant qu'il n'est pas fait, tout ce qui est marqué `[MESURÉ]` ci-dessous
vaut pour Edge 151.0.4129.72 sur un GPU NVIDIA Turing, et pour rien d'autre.

Autres inconnues de la mesure :

- **Backend graphique : `[INDÉTERMINÉ]`.** `GPUAdapterInfo.backend` est
  `undefined` dans cette version ; le backend D3D12 n'a **pas** été mesuré. Seul
  indice concordant : `getPreferredCanvasFormat()` rend `bgra8unorm`, ce que le
  CLAUDE.md associe à D3D12.
- Un seul GPU testé (NVIDIA Turing). Rien n'est établi pour un Intel/AMD
  intégré, où les limites de la §1.5 pourraient différer.

---

## 1. `rgba16float` comme cible de rendu hors écran

### 1.1 Ce que dit la spécification `[SPEC]`

Source : **W3C WebGPU, Candidate Recommendation Draft**, mise à jour du
**2026-08-10**, § 26.1.1 « Plain color formats » —
<https://www.w3.org/TR/webgpu/>

La table a été extraite **cellule par cellule en respectant les `colspan`**. Ce
n'est pas de la coquetterie : les cellules `<td>` y sont **non fermées** et
plusieurs portent `colspan="2"`, donc une lecture naïve décale les colonnes et
attribue une capacité à la mauvaise. Ligne `rgba16float` :

| Colonne | Valeur |
|---|---|
| Required Feature | **(vide — aucune)** |
| `GPUTextureSampleType` | **`"float"`, `"unfilterable-float"`** |
| `RENDER_ATTACHMENT` | **✓** (inconditionnel) |
| blendable | **✓** (inconditionnel) |
| multisampling + resolve | si `"core-features-and-limits"` |
| `STORAGE_BINDING` write-only / read-only | ✓ / ✓ |
| `STORAGE_BINDING` read-write | si `"texture-formats-tier2"` |
| Texel block copy footprint + Render target pixel byte cost | **8 octets** |

Deux points décisifs : la colonne « Required Feature » est **vide**, et le type
d'échantillonnage contient **`"float"`** — qui est, dans le vocabulaire de la
spécification, le type *filtrable*.

Autres points normatifs utiles :

- **Formats de canvas** `[SPEC]` : « The supported context formats are the set of
  `GPUTextureFormat`s: « `"bgra8unorm"`, `"rgba8unorm"`, `"rgba16float"` ».
  These formats must be supported when specified as a
  `GPUCanvasConfiguration.format` regardless of the given
  `GPUCanvasConfiguration.device` » (§ 21.4). `rgba16float` est donc aussi un
  format de *présentation* légal, pas seulement hors écran.
- **Lecture par copie** `[SPEC]` : « `imageCopyBuffer.bytesPerRow` must be a
  multiple of 256 » (§ 11.2.3). Conséquence arithmétique pour `rgba16float`
  (8 o/texel) : la largeur doit être un multiple de **32** pour qu'une copie
  directe soit légale. Une photo de **6000** px de large ne l'est pas
  (6000 × 8 = 48 000, soit 187,5 × 256) : il faut arrondir `bytesPerRow` au
  multiple de 256 supérieur (48 128) et retirer le rembourrage après
  `mapAsync`. `[CALCULÉ]`

### 1.2 Ce que fait Dawn `[DAWN]`

Source : `src/dawn/native/Format.cpp`, dépôt `google/dawn`, épinglé au commit
**`3b9c9abb40c6ba290a2f3277776b7fb32bf27606`** (2026-07-28) —
<https://github.com/google/dawn/blob/3b9c9abb40c6ba290a2f3277776b7fb32bf27606/src/dawn/native/Format.cpp>

Trois emplacements se répondent :

- **Capacités, l. 294-296** : `InitialCapsAddedBy(std::nullopt, {RGBA16Float},
  Cap::Renderable | Cap::StorageROnly | Cap::StorageWOnly | Cap::Resolve |
  Cap::Blendable)`.
- **Sens de `std::nullopt`, l. 208-210** : `const bool supported =
  !feature.has_value() || device->HasFeature(*feature);` — un `std::nullopt`
  signifie donc **aucune feature requise, toujours supporté**.
- **Type d'échantillonnage, l. 599-600** : `DefineColorFormat(RGBA16Float,
  ByteSize(8u), kAnyFloat, ...)`, avec `kAnyFloat = SampleTypeBit::Float |
  SampleTypeBit::UnfilterableFloat` (l. 409-410). **Écrit en dur, derrière aucune
  condition.**

À comparer avec le traitement des formats 32 bits, l. 488-490 :

```cpp
SampleTypeBit sampleTypeFor32BitFloatFormats = device->HasFeature(Feature::Float32Filterable)
                                                   ? kAnyFloat
                                                   : SampleTypeBit::UnfilterableFloat;
```

C'est **cette** famille qui est conditionnée, pas la 16 bits.

> ⚠️ Réserve honnête : ce commit est `main` au 2026-08-11, **pas** la révision de
> Dawn embarquée dans WebView2 151.0.4129.78. Le lien entre les deux n'est pas
> établi ici — c'est la mesure de la §1.3 qui couvre ce trou, pas cette lecture.

### 1.3 Ce qui a été mesuré `[MESURÉ]`

Sonde WebGPU exécutée dans Edge 151.0.4129.72, device demandé **sans aucune
feature optionnelle** (c'est la ligne de base honnête : si ça passe là, ça passe
sans rien négocier) :

| Test | Résultat |
|---|---|
| `createTexture` `rgba16float` en `RENDER_ATTACHMENT \| TEXTURE_BINDING \| COPY_SRC` | **OK**, aucune erreur |
| `createTexture` `rgba16float` en `STORAGE_BINDING` | **OK** |
| `createRenderPipeline` avec cible `rgba16float` | **OK** |
| Même pipeline **avec blending** (`src-alpha` / `one-minus-src-alpha`) | **OK** |
| Passe de rendu réelle puis `copyTextureToBuffer` + **`mapAsync`** | **OK** |
| `ctx.configure({format:'rgba16float'})` sur un canvas | **OK** |

Le contenu relu après `mapAsync` a été vérifié, pas seulement le fait que l'appel
réussisse. Rampe rendue : `v = 0.25 + x/2048` sur 256 texels.

| Mesure | Valeur |
|---|---|
| Valeurs distinctes relues sur 256 | **256** |
| Valeurs distinctes si le même signal avait été quantifié en 8 bits | **33** |
| Erreur absolue max vs la valeur attendue | **0** (exactement) |
| 4 premières | 0.25, 0.25048828125, 0.2509765625, 0.25146484375 |

Le pipeline transporte donc bien plus de 8 bits, et le transport est **exact**,
pas approché.

### 1.4 Le filtrage linéaire — réponse directe

**Le filtrage linéaire d'une texture `rgba16float` ne demande aucune feature.**
Les trois provenances concordent :

- `[SPEC]` la ligne `rgba16float` porte `"float"` comme type d'échantillonnage,
  colonne « Required Feature » vide (§ 26.1.1).
- `[SPEC]` la feature `"float32-filterable"` est définie ainsi, § 25.14 :
  « Makes textures with formats `"r32float"`, `"rg32float"`, and `"rgba32float"`
  filterable. » — **trois formats 32 bits, `rgba16float` n'y est pas.**
- `[DAWN]` `kAnyFloat` en dur pour `RGBA16Float` (l. 599), condition
  `Float32Filterable` réservée aux formats 32 bits (l. 488-490).
- `[MESURÉ]` un `GPUBindGroup` associant un sampler `type: 'filtering'`
  (`magFilter`/`minFilter: 'linear'`) et une vue `rgba16float` déclarée
  `sampleType: 'float'`, puis un draw réel avec `textureSample` : **OK, sans
  aucune feature activée.**

Le contrôle négatif, sur le même device sans feature, prouve que ce résultat
n'est pas un hasard de validation permissive — `rgba32float` **échoue** :

```
None of the supported sample types (UnfilterableFloat) of
[Texture (unlabeled 4x4 px, TextureFormat::RGBA32Float)]
match the expected sample types (Float).
```

Et `"float32-filterable"` **est** annoncée par cet adaptateur ; demandée sur un
adaptateur non consommé, elle est accordée et débloque effectivement le bind
group ci-dessus `[MESURÉ]`. Elle n'est simplement pas nécessaire en 16 bits.

> Note de méthode : une première exécution avait conclu à tort que
> `float32-filterable` ne pouvait pas être obtenue. C'était un défaut de la sonde
> — l'adaptateur avait déjà servi à créer un device (`adapter is "consumed"`), pas
> une limite de l'implémentation. Corrigé sur adaptateur frais.

### 1.5 Limites et coûts mesurés `[MESURÉ]`

Ces chiffres portent sur la promesse « résolution native, aucun resampling » du
PRD.

| Limite | Défaut du device | Plafond de l'adaptateur |
|---|---|---|
| `maxTextureDimension2D` | **8 192** | **16 384** |
| `maxBufferSize` | **268 435 456** (256 Mio) | **2 147 483 648** (2 Gio) |
| `maxStorageBufferBindingSize` | 134 217 728 | 2 147 483 644 |
| `maxColorAttachmentBytesPerSample` | 32 | 128 |

Demander explicitement les plafonds de l'adaptateur **fonctionne** (`requestDevice`
avec `requiredLimits`) `[MESURÉ]`.

Deux conséquences chiffrées :

- **Une photo 24 Mpx (6000 × 4000) passe.** Texture `rgba16float` de
  **183,1 Mio** + buffer de relecture de même taille : créés sans erreur de
  validation **ni erreur `out-of-memory`** (les deux scopes ont été posés
  séparément et sont revenus vides).
- **Le plafond `MAX_CANVAS_PIXELS = 64 Mpx` (ADR-0007) ne tient pas sous les
  limites par défaut.** 64 Mpx × 8 o = **512 Mo**, au-delà des 256 Mio de
  `maxBufferSize` par défaut ; et une image plus large que 8 192 px dépasse
  `maxTextureDimension2D` par défaut. Les deux sont **relevables** jusqu'aux
  plafonds ci-dessus, mais cela doit être demandé explicitement à
  `requestDevice`. `[CALCULÉ]` + `[MESURÉ]`
- Coût par pixel de cible de rendu : **8 octets** contre 4 aujourd'hui `[SPEC]` —
  doublement des textures intermédiaires, à multiplier par le ping-pong et les
  masques (le CLAUDE.md § Risques ouverts chiffre déjà ~96 Mo par texture 24 Mpx
  en 8 bits).

### 1.6 Ce que `rgba16float` n'est pas : 16 bits uniformes

Point que la seule réponse « oui `rgba16float` marche » manquerait, et qui porte
directement sur le critère « aucun banding » du PRD, dont la **sortie est un TIFF
16 bits entier**.

`binary16` (IEEE 754) a 10 bits de mantisse **et un exposant**. Sa résolution
n'est donc pas constante sur [0, 1] : très fine dans les ombres, **plus grossière
que du 16 bits entier dans les hautes lumières**. `[CALCULÉ]`

| Valeur | Pas binary16 | vs pas 8 bits (3.92e-3) | vs pas 16 bits entier (1.53e-5) |
|---|---|---|---|
| 0.001 | 9.54e-7 | 4112× plus fin | 16× plus fin |
| 0.01 | 7.63e-6 | 514× plus fin | 2× plus fin |
| 0.05 | 3.05e-5 | 128× plus fin | **2× plus grossier** |
| 0.25 | 2.44e-4 | 16× plus fin | 16× plus grossier |
| 0.5 – 0.9 | 4.88e-4 | **8× plus fin** | **32× plus grossier** |
| 1.0 | 9.77e-4 | **4× plus fin** | **64× plus grossier** |

Le point de bascule est le binade `[2⁻⁶, 2⁻⁵)` ≈ **0.0156** : en dessous
`binary16` est plus fin que le 16 bits entier, au-dessus il est plus grossier.

Deux lectures, toutes deux factuelles :

- **Par rapport au 8 bits actuel**, `binary16` est plus fin **partout**, au pire
  d'un facteur 4 (au blanc) et d'un facteur 8 dans les tons moyens-hauts. C'est
  bien un gain de précision sur toute la plage.
- **Par rapport à un pipeline 16 bits entier**, `binary16` est plus grossier
  au-dessus de ~0.016, jusqu'à 64× au blanc : il porte environ **11 bits utiles**
  près de 1.0, pas 16.

Contrôles croisés de ce tableau (trois voies indépendantes concordantes) : ma
fonction d'ulp analytique, `Float16Array` du moteur (les 256 valeurs de la sonde
sont exactes en binary16 : `true`), et l'erreur nulle du relevé GPU de la §1.3.

Que ces ~11 bits suffisent ou non à tenir le critère « aucun banding visible »
n'est **pas tranché ici** : c'est une question empirique, et le PRD a déjà écrit
le test qui y répond (comparaison à une référence flottante avec tolérance
inférieure à l'erreur d'une quantification 8 bits).

### 1.7 Conséquence sur l'invariant « sRGB par le FORMAT »

Fait, pas arbitrage. `[SPEC]` + `[MESURÉ]`

L'énumération `GPUTextureFormat` compte **101 formats**, dont **23 variantes
`-srgb`** : `rgba8unorm-srgb`, `bgra8unorm-srgb`, et 21 formats compressés
(BC/ETC2/ASTC). **Toutes sont des `unorm`. Aucun format flottant n'a de variante
`-srgb` ; `rgba16float-srgb` n'existe pas.**

Or le dépôt repose aujourd'hui sur ce mécanisme, et pas seulement pour le canvas.
`src/render/gpuContext.ts` l. 10-15 le dit dans son propre commentaire : « All
OFF-SCREEN intermediate render targets (ping-pong buffers, mask textures) are
created directly with this format via `createTexture()` ». Le champ `srgbFormat`
est effectivement consommé comme format de cible dans **sept modules** de
`src/render/` (`effectPassRunner`, `imageFrameResources`, `textureLibraryStore`,
`photoLayerInput`, `photoSourceStore`, `presentPass`, `renderer`).

Donc : une cible en `rgba16float` **ne peut pas** recevoir l'encodage
linéaire→sRGB automatique par le format, puisqu'il n'existe pas de variante srgb
à lui attacher. Le CLAUDE.md § Stack verrouille « chaîne de couleur en sRGB par le
FORMAT, jamais par un gamma manuel en WGSL », et le PRD § Contraintes
d'inacceptable écrit que « le nouveau chemin 16-bit reste sur ce principe, il ne
le contourne pas ».

**Ces deux phrases et le fait ci-dessus ne peuvent pas être vrais ensemble.** Ce
document ne choisit pas lequel céder — c'est exactement le genre d'arbitrage
qu'il doit laisser à l'issue 02.

> Correction de référence au passage : le ticket et le CLAUDE.md renvoient à
> `gpuContext.ts:64-78` pour la configuration du canvas. À la révision courante,
> ces lignes contiennent `createGpuErrorReporter` ; le `context.configure()` est
> aux **lignes 152-167**, et la déclaration des deux formats aux lignes 6-16.

### 1.8 `rgba16unorm` — l'autre 16 bits, et une divergence spec/Dawn

Le PRD n'envisage que `rgba16float`. Un second format 16 bits existe, et il donne
la précision uniforme que la §1.6 montre manquante — d'où son intérêt factuel.

`[SPEC]` § 26.1.1, ligne `rgba16unorm` : Required Feature
**`"texture-formats-tier1"`** · sample type **`"unfilterable-float"`** ·
`RENDER_ATTACHMENT` ✓ · blendable ✓ · 8 octets.

`[DAWN]` `Format.cpp` l. 491-495 dit en apparence autre chose :

```cpp
SampleTypeBit sampleTypeForNorm16Formats =
    (device->HasFeature(Feature::Unorm16TextureFormats) ||
     device->HasFeature(Feature::Unorm16Filterable))
        ? kAnyFloat
        : SampleTypeBit::UnfilterableFloat;
```

Lu seul, ce code laisse croire qu'activer les formats unorm16 les rend
**filtrables**. `[MESURÉ]` dit le contraire. Device obtenu avec
`requiredFeatures: ['texture-formats-tier1']` (l'adaptateur annonce tier1 **et**
tier2) :

| Test | Résultat |
|---|---|
| `rgba16unorm` en `RENDER_ATTACHMENT` | **OK** |
| Pipeline avec cible `rgba16unorm` **et blending** | **OK** |
| `rgba16unorm` + sampler `filtering` | **ÉCHEC** — `supported sample types (UnfilterableFloat) ... match the expected sample types (Float)` |
| `rgba16float` + sampler `filtering`, même device | **OK** |

**C'est le comportement de la spécification qui l'emporte, pas la lecture du code
Dawn.** La feature W3C `texture-formats-tier1` ne s'adosse manifestement pas à la
même porte interne que `Unorm16Filterable`.

Retenir surtout la leçon de méthode : **conclure de ce seul code source aurait
produit un fait faux.** C'est le mode d'erreur déjà consigné dans la mémoire
projet (`conclusion-tiree-du-code-seul`). Seule la mesure a tranché.

Conséquence factuelle : `rgba16unorm` offre 16 bits uniformes mais **pas
d'échantillonnage linéaire** — or les effets de flou/bloom du dépôt
échantillonnent avec filtrage. Aucune recommandation n'est faite ici.

### Ce qui reste indéterminé sur la question 1

- **La mesure dans le processus WebView2 de shaderlab lui-même** — voir le trou
  déclaré en tête. Tout `[MESURÉ]` vaut pour Edge 151.0.4129.72.
- **Le backend graphique** (D3D12 ou autre) : non mesuré.
- **Le comportement sur un GPU non-NVIDIA** : non mesuré. Les limites de la §1.5
  sont des valeurs d'adaptateur, elles peuvent différer ailleurs.
- **La révision exacte de Dawn dans WebView2 151.0.4129.78** : non établie. Les
  citations `[DAWN]` portent sur `main` au 2026-08-11.
- **Le coût en VRAM à l'usage réel** du doublement 4→8 octets : non mesuré. Le
  CLAUDE.md impose de le mesurer sur le *Total Committed* du process GPU de
  WebView2, ce qui n'a pas été fait ici.
- **Si ~11 bits utiles près du blanc suffisent à éliminer le banding** : question
  empirique, non tranchée.

---

## 2. Écrire un TIFF 16 bits/canal avec profil ICC embarqué depuis Rust

### 2.0 Le numéro de tag, source primaire

`libtiff/tiff.h` l. 479 — <https://gitlab.com/libtiff/libtiff/-/raw/master/libtiff/tiff.h> :

```c
#define TIFFTAG_ICCPROFILE 34675 /* ICC profile data */
```

Type de champ déclaré par libtiff (`tif_dirinfo.c` l. 186) : **`TIFF_UNDEFINED`
(= 7)**, comptage variable sur `uint32`. Retenir ce 7 — il ressort en §2.3.
Référence ICC citée par les crates elles-mêmes :
<https://www.color.org/technotes/ICC-Technote-ProfileEmbedding.pdf>.

### 2.1 Réponse : deux crates font réellement les deux, et les deux passent le gate

Le ticket demande « pas *supporte le TIFF*, mais 16 bits par canal **ET** écriture
d'un bloc ICC ». Les deux capacités ont été vérifiées séparément.

| Crate | Version | 16 bits/canal | ICC embarqué | Licence | Verdict |
|---|---|---|---|---|---|
| **`image`** | **0.25.10** | **fait** | **fait** | **`MIT OR Apache-2.0`** | **fait — les deux** |
| **`tiff`** | 0.11.3 | **fait** | **fait** (une ligne manuelle) | **`MIT`** | **fait — les deux** |

**Ce qui rend ce résultat particulièrement peu coûteux ici : `image` est déjà une
dépendance de ce dépôt.** `src-tauri/Cargo.toml` l. 29 déclare
`image = { version = "0.25", default-features = false, features = ["jpeg", "png"] }`,
et `Cargo.lock` le résout en **0.25.10** — exactement la version qui apporte
l'écriture ICC en TIFF.

**Vérifié par moi-même sur la source vendorisée sur disque**
(`~/.cargo/registry/src/*/image-0.25.10/`), c'est-à-dire le code exact contre
lequel ce projet compilerait — pas une page de documentation :

| Fait | Emplacement vérifié |
|---|---|
| Licence `MIT OR Apache-2.0` | `Cargo.toml` l. 46 |
| 16 bits/canal | `src/codecs/tiff.rs` l. 599-600 : `ExtendedColorType::Rgb16 => self.write_tiff::<RGB16>(…)`, idem `Rgba16` |
| `set_icc_profile` **surchargé** | `src/codecs/tiff.rs` l. 612-615 : `self.icc = Some(icc_profile); Ok(())` |
| Le défaut du trait, lui, **échoue** | `src/io/encoder.rs` l. 53-61 : `Err(UnsupportedError… "ICC profiles are not supported for this format")` |
| Écriture effective du tag | `src/codecs/tiff.rs` l. 545 : `.write_tag(Tag::IccProfile, icc_profile.as_slice())` |

La distinction de l'avant-dernière ligne est exactement le piège que le ticket
redoutait : beaucoup d'encodeurs de `image` héritent du défaut qui renvoie
`UnsupportedError`. **Le TIFF, lui, surcharge réellement.**

**La version compte, et 0.25.4 ne suffit pas.** `ImageEncoder::set_icc_profile` est
né au trait en **0.25.4**, « and implemented it for WebP format » ; l'écriture ICC
**pour le TIFF** n'arrive qu'en **0.25.10** (« ICC profiles can now be written for
TIFF files (#2746) », `CHANGES.md`). Entre les deux, le TIFF retombait sur le
défaut en erreur. Mesuré, pas seulement lu au changelog : au tag `v0.25.9`,
`grep "set_icc_profile\|IccProfile\|icc:"` sur `src/codecs/tiff.rs` rend **zéro
ligne**, alors que `RGB16` y est déjà.
Sources : <https://raw.githubusercontent.com/image-rs/image/v0.25.10/CHANGES.md> ·
<https://raw.githubusercontent.com/image-rs/image/v0.25.9/src/codecs/tiff.rs>

### 2.2 Ce que cela coûte concrètement à ce dépôt

`[MESURÉ]` sur `Cargo.toml`/`Cargo.lock` de `src-tauri` :

- La fonctionnalité TIFF de `image` est derrière un flag : `tiff = ["dep:tiff"]`
  (`Cargo.toml` l. 120 du crate). Le dépôt compile aujourd'hui avec
  `default-features = false, features = ["jpeg", "png"]` — **le codec TIFF n'est
  donc pas compilé**.
- L'activer = ajouter `"tiff"` à cette liste. Cela tire **une** nouvelle
  dépendance transitive : `tiff` **`^0.11.2`** (`Cargo.toml` l. 222-224 du crate),
  absente du `Cargo.lock` actuel — vérifié, `grep '^name = "tiff"'` n'y rend rien.
- Licence de cette transitive : **`MIT`**. Aucune dépendance sans licence n'entre
  par ce chemin.

### 2.3 Le seul écart de conformité trouvé — et il est partagé

`image` passe `icc_profile.as_slice()` (donc `&[u8]`) à `write_tag`. Or, dans le
crate `tiff` v0.11.3, `impl TiffValue for [u8]` déclare
`const FIELD_TYPE: Type = Type::BYTE;` (`src/encoder/tiff_value.rs` l. 42-44,
**vérifié par moi-même sur la source brute**) — et le fichier ne contient **aucune**
occurrence de `UNDEFINED` (comptage : 0).

Donc le champ ICC est écrit avec le **type TIFF `BYTE` (1)** là où libtiff le
déclare en **`TIFF_UNDEFINED` (7)** (§2.0). Les deux crates partagent cet écart,
puisque `image` délègue à `tiff`.

Une voie publique vers `UNDEFINED` existe malgré tout, en trois pièces du crate
`tiff` : `write_entry_bytes(ty: Type, data: &[u8])` (`encoder/mod.rs` l. 405,
accepte `Type::UNDEFINED` déclaré à `tags.rs` l. 201), `Directory::empty()` /
`extend()` (`src/directory.rs` l. 32 et 62), et `extend_from(&Directory)`
(`encoder/mod.rs` l. 432). Il existe aussi `write_tag_buf`, dont la documentation
prévient que « the library will _not_ attempt to verify that the data type or the
count of the buffered value is permissible for the given tag ».

**Cet écart n'est pas arbitré ici.** Savoir si un lecteur réel (Photoshop, le RIP
d'un labo, `exiftool`) refuse un ICC typé `BYTE` est une question empirique qui se
mesure sur un fichier produit — pas un fait établi par lecture de source. Le fait
établi est double : l'écart existe, et un contournement par API publique existe.

### 2.4 Le gate licence a effectivement écarté un candidat

Le ticket rappelle que vérifier la licence est une règle, pas une politesse.
Elle a mordu une fois :

- **`libtiff-sys` 0.2.0** — seul binding libtiff sur crates.io, capable des deux
  par `TIFFSetField`. Son champ `license` sur crates.io vaut littéralement
  **`"non-standard"`** : le `Cargo.toml` déclare un `license-file` et **aucune
  chaîne SPDX opposable**. <https://crates.io/api/v1/crates/libtiff-sys> →
  **écarté**, même motif que `webgpu-image-filter`.
- **`fast-tiff-lib` 0.9.6** — licence **contradictoire selon la source** :
  `MPL-2.0` sur crates.io contre `GPL-3.0` sur l'API GitHub du dépôt. Écarté par
  ailleurs (pas d'ICC).
- **`zentiff` 0.1.2** — `AGPL-3.0-only OR LicenseRef-Imazen-Commercial`. Écarté
  par ailleurs (ICC en décodage seulement).

### 2.5 Les autres candidats, et pourquoi ils tombent

Balayage secondaire ; les licences des deux candidats servant de gate
(`libtiff-sys`, `tiff-writer`) et l'inexistence de `tiff-sys` ont été
re-vérifiées pièce par pièce.

| Crate | Pourquoi il tombe |
|---|---|
| `tiff-sys` | **N'existe pas** — <https://crates.io/api/v1/crates/tiff-sys> rend `crate 'tiff-sys' does not exist` |
| `zune-*` | **N'écrit pas de TIFF** (ne le décode pas non plus) — aucune variante TIFF dans `ImageFormat` |
| `rimage` 0.12.3 | TIFF **en lecture seule** (`README.md` : `Input only`) ; dépend de `tiff` de toute façon |
| `opencv` 0.100.1 | 16 bits oui, **ICC non** — zéro occurrence de `ICCPROFILE`/`34675` dans `grfmt_tiff.cpp` |
| `libvips` 2.3.0 | `tiffsave` n'a **aucune** option `profile` ; ICC seulement par FFI brute. ⚠️ son option `bitdepth` est documentée « max: 8 », elle ne sert pas au 16 bits |
| `magick_rust` 2.1.1 | ICC nommé (`profile_image()`) mais **16 bits `[INDÉTERMINÉ]`** — dépend d'une build ImageMagick Q16 présente sur la machine |
| `tiff-writer` 0.8.0 | Fait les deux (`MIT OR Apache-2.0`), mais l'ICC n'est pas outillé : 34675 à poser à la main |
| `gamut-tiff`, `oxideav-tiff` | 16 bits sans ICC (le premier déclare le 16 bits « deferred ») |
| `tiff-encoder` 0.3.2, `tiff-forge` 0.5.2 | Écrivains d'IFD bruts : les deux cases, mais tout à la main ; `tiff-encoder` n'a plus de sortie depuis **2019** |

### Ce qui reste indéterminé sur la question 2

- **Qu'un fichier réellement produit soit accepté** par Photoshop / `exiftool` /
  un RIP de labo : **non mesuré**. Rien n'a été écrit ni relu ici — toute la
  question 2 est établie par lecture de source, pas par production d'un TIFF.
  C'est le seul moyen de trancher l'écart `BYTE`/`UNDEFINED` de §2.3.
- **Le comportement 16 bits de `magick_rust`** : dépend de la build système,
  non mesuré.
- **La compression** (aucune / LZW / Deflate) et son interaction avec le 16 bits
  : hors du périmètre du ticket, non étudiée.

---

## 3. La matrice sRGB → Adobe RGB (1998)

### 3.1 Sources primaires effectivement lues

| Source | URL qui a répondu | Vérification |
|---|---|---|
| Spécification Adobe | <https://www.adobe.com/digitalimag/pdfs/AdobeRGB1998.pdf> | HTTP 200, 564 474 o, « Version 2005-05 », 20 p. L'URL historique ne 404 pas. |
| sRGB / ICC | <https://www.color.org/chardata/rgb/sRGB.pdf> → <https://registry.color.org/rgb-registry/files/sRGB.pdf> | HTTP 200, 183 192 o |
| W3C 1996 | <https://www.w3.org/Graphics/Color/sRGB.html> | HTTP 200, **marqué obsolète par le W3C** |
| CSS Color 4 | <https://www.w3.org/TR/css-color-4/> | CR Draft du 2026-08-06 |

Le PDF Adobe a été extrait en texte et **relu indépendamment** pour cette
synthèse (`pdftotext -raw`) : primaires aux lignes 313-316, gamma aux lignes
323-327, « does not include a linear segment » ligne 333. Aucun nombre de cette
section ne provient d'un résumé WebFetch.

> ⚠️ **IEC 61966-2-1 n'a pas été lu** — la norme est payante
> (<https://webstore.iec.ch/publication/6168>). Les constantes sRGB ci-dessous
> viennent de deux reformulations normatives concordantes (ICC et W3C), pas de la
> norme elle-même. C'est une limite réelle de ce document.

### 3.2 Adobe RGB (1998) `[SPEC]`

**Primaires et point blanc** — § 4.3.1.1, p. 10, cité mot pour mot : « The
chromaticity coordinates for the color space primaries and white point shall be
as follows: Red x=0.6400, y=0.3300 / Green x=0.2100, y=0.7100 / Blue x=0.1500,
y=0.0600 / White x=0.3127, y=0.3290 ».

| | x | y |
|---|---|---|
| Rouge | 0.6400 | 0.3300 |
| Vert | 0.2100 | 0.7100 |
| Bleu | 0.1500 | 0.0600 |
| Blanc | 0.3127 | 0.3290 |

**Précision imprimée : 4 décimales, pas davantage.** § 4.2.1 note que ces
coordonnées correspondent à l'illuminant D65 et fixe la luminance du blanc à
160.00 cd/m².

**Fonction de transfert** — § 4.3.1.2, p. 10 : « The inverse color component
transfer function shall be a simple power-law function using a **gamma value of
2.19921875** », avec la note explicite « **The transfer function does not include
a linear segment.** » Sens direct (§ 4.3.4.2, p. 12) : `R' = R^(1/2.19921875)`.

**Sur la fraction 563/256** : le nombre est exact, mais **la spécification Adobe
ne l'imprime pas sous cette forme**. Elle imprime le nombre mixte **2 + 51/256**
et l'hexadécimal **02.33**. La forme `563/256` apparaît en **Annexe A, p. 17**,
via le tag ICC (« a gamma value of 0233 », un `u8Fixed8Number`, soit 0x233 = 563
sur 256). Les trois formes sont le même nombre `[CALCULÉ]` :
`2 + 51/256 = 563/256 = 0x0233/0x0100 = 2.199218750000`.

**Conditions de visualisation de référence** — § 4.2.1 à 4.2.3 :

| Grandeur | Valeur |
|---|---|
| Luminance du blanc | 160.00 cd/m² (X 152.07 · Y 160.00 · Z 174.25) |
| Luminance du noir | 0.5557 cd/m² (X 0.5282 · Y 0.5557 · Z 0.6052) |
| Rapport de contraste | **287.9** |

**Température de couleur corrélée : `[INDÉTERMINÉ]`.** La spécification nomme D65
et **n'imprime jamais de valeur en kelvins** (aucune occurrence de « 6500 »,
« correlated » ou « color temperature » sur les 20 pages). La valeur 6504 K
circule mais vient de CSS Color 4, **pas d'Adobe**.

**Matrice imprimée par Adobe** — § 4.3.5.3, p. 13, RGB → XYZ (D65), 5 décimales,
avec la note « The matrix is derived from the color space chromaticity
coordinates » :

```
0.57667  0.18556  0.18823
0.29734  0.62736  0.07529
0.02703  0.07069  0.99134
```

### 3.3 sRGB `[SPEC]`

Source ICC (<https://registry.color.org/rgb-registry/files/sRGB.pdf>), § A.1 et
A.3 : primaires R (0.64, 0.33) · G (0.30, 0.60) · B (0.15, 0.06), « Note: These
are defined in ITU-R BT.709 » ; blanc x = 0.3127, y = 0.3290, « equivalent to the
chromaticity of CIE Illuminant D65 » ; luminance du blanc 80 cd/m².

**Fonction de transfert par morceaux**, § A.8 (encodage) et § B.1 (décodage, «
provided in IEC 61966-2-1 as follows ») :

```
encodage :  RL ≤ 0.0031308  ->  R = 12.92 × RL
            RL > 0.0031308  ->  R = 1.055 × RL^(1/2.4) − 0.055
décodage :  R  ≤ 0.04045    ->  RL = R / 12.92
            R  > 0.04045    ->  RL = ((R + 0.055) / 1.055)^2.4
```

Trois divergences connues, à ne pas confondre entre elles :

1. **Le document W3C de 1996 avait d'autres seuils** — 0.00304 et 0.03928 — que
   l'IEC a corrigés en 0.0031308 et 0.04045. Le W3C coiffe lui-même ce document
   d'un bandeau « This document is obsolete ».
2. **Le même document de 1996 se contredit sur le point blanc** : sa Table 0.1
   imprime y = 0.3291, sa Table 0.2 (celle qui sert à la colorimétrie) imprime
   y = 0.3290. C'est **0.3290** qui a été retenu par l'IEC, l'ICC et Adobe.
3. **Les constantes officielles ne sont ni continues ni C¹** `[CALCULÉ]` : au
   seuil 0.0031308, la branche linéaire donne 0.040449936 et la branche puissance
   0.040449907483 — un saut de **−2.85e-08** ; les pentes valent 12.92 contre
   12.7031. Les valeurs « à dérivée continue » parfois citées
   (a = 0.055010718947587, seuil 0.0030412825601275) sont une *autre* solution de
   la même famille, pas les constantes normatives.

### 3.4 Faut-il une adaptation chromatique ? Non `[SPEC]`

Adobe § 4.3.1.1 imprime `x=0.3127, y=0.3290` ; ICC § A.3 imprime
`x = 0.3127, y = 0.3290`. **Chiffre pour chiffre identiques**, tous deux rattachés
à D65.

**Aucune adaptation chromatique, aucun Bradford.** La conversion est un simple
produit de deux matrices 3×3. CSS Color 4 le dit dans ses commentaires de code
de référence : « using sRGB's own white, D65 (no chromatic adaptation) ».

⚠️ Nuance : Bradford **est** requis pour aller vers le PCS ICC en D50 — c'est ce
que font Adobe § 4.3.6/4.3.7. Ce n'est pas le cas ici, où l'on va d'un espace de
travail D65 à un espace de sortie D65.

### 3.5 La matrice `[CALCULÉ]`

Méthode standard : pour chaque espace, `P = (x/y, 1, (1−x−y)/y)` par primaire,
gains `S = [P_R P_G P_B]⁻¹ · W`, puis `M_RGB→XYZ = [P_R P_G P_B] · diag(S)` ; et
enfin `M = inv(M_Adobe→XYZ) · M_sRGB→XYZ`.

Statut de la méthode : Adobe **affirme** la dérivation (« derived from the color
space chromaticity coordinates », notes des § 4.3.4.1 et 4.3.5.3) sans en écrire
l'algèbre. La formulation vérifiable la plus autorisée est celle de **W3C CSS
Color 4**, qui publie ses matrices en rationnels exacts « calculated from first
principles from the chromaticity coordinates of R G B W ». Bruce Lindbloom, source
usuelle sur le sujet, **n'est pas une source primaire** et n'est pas utilisé ici.

**M : sRGB-linéaire → Adobe RGB-linéaire**

```
[ 0.715125606855624   0.284874393144376   0.000000000000000 ]
[ 0.000000000000000   1.000000000000000   0.000000000000000 ]
[ 0.000000000000000   0.041161948450118   0.958838051549882 ]
```

**M⁻¹ : Adobe RGB-linéaire → sRGB-linéaire**

```
[ 1.398355743960779  -0.398355743960778   0.000000000000000 ]
[ 0.000000000000000   1.000000000000000   0.000000000000000 ]
[ 0.000000000000000  -0.042928989294473   1.042928989294473 ]
```

Ce résultat a été obtenu **deux fois par deux voies indépendantes** : une fois en
arithmétique rationnelle exacte (`fractions.Fraction`), une fois en double
précision par une implémentation écrite séparément. Écart entre les deux :
**< 1e-15**. Les valeurs rationnelles exactes de M sont `47872228/66942405`,
`19070177/66942405`, `0` ; `0`, `1`, `0` ; `0`, `11512411/279685764`,
`268173353/279685764`.

**Contrôles de cohérence** `[CALCULÉ]` :

```
blanc (1,1,1)  -> (1.000000000000, 1.000000000000, 1.000000000000)   EXACT
gris  0.5      -> (0.500000000000, 0.500000000000, 0.500000000000)   EXACT
rouge (1,0,0)  -> (0.715125606856, 0.000000000000, 0.000000000000)
vert  (0,1,0)  -> (0.284874393144, 1.000000000000, 0.041161948450)
bleu  (0,0,1)  -> (0.000000000000, 0.000000000000, 0.958838051550)
sommes de lignes de M : 1.000000000000000  1.000000000000000  1.000000000000000
```

Le neutre est préservé **exactement** — en rationnels, les sommes de lignes
valent l'entier 1, ce n'est pas un « à 1e-15 près ».

**Trois structures à ne pas prendre pour des coïncidences**, car elles donnent un
contrôle gratuit à l'implémentation :

1. **sRGB et Adobe RGB partagent exactement leurs primaires rouge et bleue**
   (0.6400/0.3300 et 0.1500/0.0600). Seule la verte diffère (0.30/0.60 contre
   0.21/0.71). Les zéros de M sont donc **structurellement exacts**, pas
   arrondis.
2. **La ligne du milieu vaut exactement (0, 1, 0)** : le canal vert est
   identique dans les deux espaces.
3. **M n'a que 4 coefficients non triviaux**, pas 9. Une implémentation qui
   produirait 9 valeurs non nulles est fausse.

**Écart des matrices imprimées aux premiers principes** `[CALCULÉ]` :

| Matrice imprimée | Écart max |
|---|---|
| Adobe § 4.3.5.3, RGB→XYZ (5 déc.) | 4.98e-06 |
| Adobe § 4.3.4.1, XYZ→RGB (5 déc.) | 4.99e-06 |
| ICC § A.7, XYZ→sRGB (7 c.s.) | **3.44e-04** |
| W3C 1996 éq. 1.1, XYZ→sRGB (5 c.s.) | 4.49e-05 |

Les matrices Adobe sont cohérentes avec leur arrondi. **Celle de l'ICC ne l'est
pas** : elle affiche 7 chiffres significatifs mais dévie de 3.4e-04, soit ~1000×
son propre pas d'affichage — la matrice de 1996 à 5 chiffres est *plus* proche du
vrai que celle de l'ICC à 7. CSS Color 4 fait le même constat sur Adobe en
commentaire : sa matrice a98 « has greater numerical precision than section
4.3.5.3 ».

Fait utilisable tel quel : **dériver les matrices des chromaticités plutôt que
recopier celles imprimées dans les spécifications.**

### Ce qui reste indéterminé sur la question 3

- **IEC 61966-2-1 en texte intégral** : payant, non lu. Les constantes sRGB sont
  attestées par deux reformulations normatives concordantes, ce qui est solide
  mais n'est pas la norme elle-même.
- **CCT d'Adobe RGB** : jamais imprimée par Adobe.
- **Précision au-delà de 4 décimales sur les primaires** : aucune spécification
  n'en publie. Les 15 chiffres de M sont dérivés de ces 4 décimales — ils sont
  arithmétiquement exacts, ils ne mesurent pas une réalité physique plus fine.

---

## Reproduire les mesures

Les sondes vivent dans le scratchpad de session (hors dépôt) :
`…\scratchpad\webgpu-probe{,2,3}.html` + `drive-probe{,2,3}.mjs`, qui lancent
Edge avec `--remote-debugging-port` et relisent `window.__PROBE_RESULT` par CDP.

**Pour refermer le trou déclaré en tête** — c'est-à-dire mesurer dans le vrai
WebView2 de shaderlab plutôt que dans Edge — lancer l'app avec le port CDP
(`npm run dev:debug`) puis évaluer ceci dans sa page via
`scripts/cdp-console.mjs`. Le résultat attendu, d'après les mesures ci-dessus,
est `{renderAttachment: true, filtering: true, readback: true}` :

```js
(async () => {
  const a = await navigator.gpu.requestAdapter();
  const d = await a.requestDevice();               // aucune feature optionnelle
  const t = d.createTexture({ size: [256, 1], format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
  d.pushErrorScope('validation');
  const bgl = d.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } } ] });
  d.createBindGroup({ layout: bgl, entries: [
    { binding: 0, resource: d.createSampler({ magFilter: 'linear', minFilter: 'linear' }) },
    { binding: 1, resource: t.createView() } ] });
  const err = await d.popErrorScope();
  const buf = d.createBuffer({ size: 256 * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const e = d.createCommandEncoder();
  e.copyTextureToBuffer({ texture: t }, { buffer: buf, bytesPerRow: 256 * 8 }, [256, 1, 1]);
  d.queue.submit([e.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  return { renderAttachment: !!t, filtering: !err, filteringError: err && err.message,
           readback: buf.getMappedRange().byteLength === 2048,
           features: [...a.features].sort(), preferred: navigator.gpu.getPreferredCanvasFormat() };
})()
```
