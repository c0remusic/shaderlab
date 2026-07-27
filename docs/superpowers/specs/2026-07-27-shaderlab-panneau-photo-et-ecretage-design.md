# Design — Panneau « Photo » + écrêtage d'un calque d'effet sur une photo

> Date : 2026-07-27 · Repo `C:\dev\shaderlab`, base `master@1a09d8d`.
> Révision 2 (après revue adverse — voir §10 « Historique de revue »).
> Type : design doc (le COMMENT). Le QUOI est tranché par l'utilisateur et
> n'est pas rediscuté ici.
> **Amende** `docs/superpowers/specs/2026-07-26-shaderlab-photo-layer-parity-design.md`
> (voir §3.4) : la **barre contextuelle** qu'il prévoyait pour X/Y/échelle/angle/
> flip/crop est **remplacée** par le panneau Photo décrit ici. L'édition
> effective de ce fichier est un **livrable de P1** (§5) — sans elle, deux textes
> actifs se contrediraient.

## 1. Besoin (tranché, non négociable)

1. **« Je trouve bizarre que les images soient traitées comme des effets. »**
   Un calque photo n'a aujourd'hui aucun endroit où exposer SES propriétés
   (position, échelle, angle, recadrage, flip, image source) : il emprunte
   l'identité d'un effet (`passthrough`) et le panneau « Réglages » qui va avec
   affiche une section de paramètres vide.
2. **Option A retenue : un panneau « Photo » dans le dock.** 5ᵉ panneau
   contextuel, icône au rail, visible quand un calque photo est sélectionné,
   exactement comme « Réglages » l'est pour un calque d'effet. **Ni fenêtre
   flottante** (`FloatingPanel` a été supprimé du projet le 2026-07-21 — ne pas
   le réintroduire), **ni barre overlay**.
3. **« Appliquer des effets différents selon les photos… mais que ça puisse
   être linéaire et toucher toutes les photos si on le veut. »** → l'écrêtage
   est une **option par calque d'effet**, jamais un changement de régime.
   Défaut = comportement actuel (linéaire : l'effet s'applique au composite de
   tout ce qui est en dessous). Option = écrêté au calque photo situé en
   dessous.

## 2. État des lieux

| Fait | Preuve |
|---|---|
| `addPhotoLayer` force `effectId: "passthrough"` | `src/layers/layerStack.ts:68-83` |
| Le titre du panneau Réglages est toujours « Réglages · <nom de l'effet> » | `src/App.tsx:1016` |
| Un calque `passthrough` ouvre un `Disclosure "Effet"` dont le groupe de params est **vide** (aucun état vide rendu) | `src/components/ParamPanel.tsx:74-124` + `PASSTHROUGH_EFFECT.params = []` (`src/render/effectPassRunner.ts:6-11`) |
| La couverture d'un calque photo existe déjà et est déjà consommée : `effectInput.a` × poids de compositing | `src/render/shaderCompose.ts:76-101` |
| Le binding 6 (`imageSourceTexture`) n'est déclaré que sur le chemin `applyMask` | `src/render/shaderCompose.ts:73-79` ; layout : `src/render/effectPassRunner.ts:185,204` |
| Un calque d'EFFET n'a **aucune** couverture : `readTexture` est le composite complet, le shader suppose α ≡ 1 | `src/render/framePipelineExecutor.ts:204,262` + commentaire `shaderCompose.ts:96-100` |
| La texture résolue d'un calque photo est **une cible persistante PARTAGÉE**, re-`clear`ée par chaque `resolve()` ; ce qui rend le partage correct est **l'ordre des passes**, pas l'unicité | `src/render/photoLayerInput.ts:61-88` ; `src/render/framePipelineExecutor.ts:223-242` |
| `runEffectPass` reçoit déjà `imageSourceView` en option et ne l'exploite que si `applyMask` | `src/render/effectPassRunner.ts:153-156,164-165,204` |
| La boucle de frame itère `enabledLayers`, et en dérive **tout** : `isLast`, la cible finale, le ping-pong, `guideEpoch`, le compte remonté | `src/render/framePipelineExecutor.ts:158,206,209-212,271,276-279,314` |
| Le court-circuit « 0 calque activé » écrit bien `finalTargetView` via une passe `PASSTHROUGH_EFFECT` **sans masque ni passes internes** | `src/render/framePipelineExecutor.ts:163-201` |
| **L'isolation projette `enabled: false` sur tous les autres calques AVANT le rendu**, et seulement pour l'écran (`exportFrame` n'y passe pas) | `src/render/renderer.ts:262-268` (`projectIsolation`) ; `src/layers/isolation.ts:30-46` |
| L'isolation se donne pour règle explicite de ne jamais produire d'écran noir | `src/layers/isolation.ts:25-29` |
| `LayerPanel` dérive l'œil et son libellé de la visibilité EFFECTIVE (isolation comprise), pas de `layer.enabled` | `src/components/LayerPanel.tsx:295-296` ; `src/layers/isolation.ts:30-33,87-97` |
| `imageSource` n'est écrit qu'en **deux** endroits : `addPhotoLayer` (calque neuf) et `duplicateLayer` (copie) — aucun chemin ne transforme un calque d'effet existant en photo | `src/layers/layerStack.ts:78,178` (balayage `grep -rn imageSource src/layers src/hooks src/App.tsx`, 12 occurrences, dont 2 écritures) |
| `duplicateLayer` copie le calque par spread, donc **tout champ scalaire ajouté à `LayerState` est dupliqué sans code supplémentaire**, et insère la copie à `index + 1` (juste au-dessus de l'original) | `src/layers/layerStack.ts:166-182` |
| `applyPreset` **remplace la pile entière** par des calques reconstruits, tous sans `imageSource` | `src/App.tsx:930-933` ; `src/presets/presetDocument.ts:83-91` |
| `capture()` **exclut** les calques photo et le signale par `SkipNotice` ; `schemaVersion` est écrit inconditionnellement | `src/presets/presetDocument.ts:16-19,33` ; `src/presets/presetTypes.ts:27-31` |
| La validation d'import est le SEUL point de validation de schéma et refuse `schemaVersion > PRESET_SCHEMA_VERSION` | `src/presets/presetImportValidation.ts:3-14,30-35` |
| `PRESET_SCHEMA_VERSION = 1`, et `migratePresetDocument` documente que c'est la seule version ayant existé | `src/presets/presetTypes.ts:1` ; `src/presets/presetDocument.ts:97-103` |
| Ordre par défaut du dock : `[["presets", "layers", "params", "mask"]]` | `src/App.tsx:127` |
| Visibilité d'un panneau contextuel = `useContextualPanel(conditionMet, triggerKey)` ; Presets/Calques sont `(true, "static")`, Réglages/Masque sont `(selectedId !== null, selectedId)` | `src/ui/contextualPanel.ts:31-43` ; `src/App.tsx:1018-1021` |
| Un `override: "open"` posé par le rail rend le panneau visible **quelle que soit** `conditionMet`, tant que `triggerKey` ne change pas | `src/ui/contextualPanel.ts:18-29` |
| `panelVisibility` échoue **bruyamment** sur un id de panneau inconnu (fail-fast voulu) | `src/App.tsx:1030-1041` |
| Le rail est l'unique moyen de fermeture ; 4 items aujourd'hui | `src/App.tsx:1297-1304` |
| T1 et T6 du design 2026-07-26 sont **livrés** (`usePhotoLayer`, `CanvasMode`, vignette + nom dans la ligne, changement d'effet) | `src/hooks/usePhotoLayer.ts` ; `src/ui/canvasMode.ts` ; `src/App.tsx:1225-1243` |
| `CanvasMode` est un état EXCLUSIF, et `showsTransformHandles` ne concerne que les poignées **du canvas** | `src/ui/canvasMode.ts:22-53` |
| **`PhotoLayerToolbar` n'existe pas** : T2 (la barre) n'a jamais été implémentée — le remplacement ne détruit aucun code livré | `ls src/components` → 29 entrées, aucune `PhotoLayerToolbar.tsx` |
| Toute la géométrie pure vit déjà dans `src/ui/transform.ts`, sans React ni WebGPU | `src/ui/transform.ts:30-121` |
| Le seul moyen de preuve qui COMPILE le WGSL est `scripts/gpu-shader-check.mjs`, et il ne fait que **compiler** — aucune comparaison de valeur | `scripts/gpu-shader-check.mjs:55-65` ; cas `composite+photo` en `:83-84` |
| Le WGSL **composé** est en revanche asséré ligne à ligne en env Node, sur son TEXTE | `test/render/shaderCompose.test.ts:74-104` |
| **`scripts/gpu-parity.mjs` n'existe pas** : c'est un livrable planifié de T3 (2026-07-26), pas un outil disponible | `ls scripts/` → 6 entrées (`cdp-console.mjs`, `dev.ps1`, `gpu-shader-check.mjs`, `lint-tokens.mjs`, `monitor.ps1`, `parse-minidump.mjs`) |

## 3. Décisions

### 3.1 Modèle de données de l'écrêtage

```ts
// src/layers/types.ts
export interface LayerState {
  // ...inchangé...
  /** Écrêtage (clipping) : cet effet ne s'applique QUE là où le calque photo
   *  situé en dessous couvre l'image. Absent/false = comportement linéaire
   *  (défaut historique : l'effet s'applique au composite complet).
   *  INTERDIT sur un calque portant `imageSource` — garde en §3.2.
   *  Champ SCALAIRE : présent par construction dans chaque snapshot
   *  d'historique, aucun risque pour l'invariant OOM. */
  clipToBelow?: boolean;
}
```

**Pourquoi un booléen sur le calque d'EFFET et pas une référence `clipBaseId`.**
Une référence exigerait d'être maintenue à chaque réordonnancement, chaque
suppression et chaque undo — un état dénormalisé pouvant pointer vers un calque
disparu. Le booléen se résout à chaque rendu par la position dans la pile
(§3.2) : rien à maintenir, rien à réparer.

**Pourquoi optionnel.** Aucune migration : ni de l'historique de session, ni des
presets déjà écrits, ni des fixtures de test.

**Historique.** Automatique : champ scalaire de `LayerState`, donc dans chaque
snapshot. Le *déclenchement* de l'entrée d'historique ne l'est pas — la bascule
passe par `LayerStack.setLayerClip(id, clip): boolean` (§3.2), avec la discipline
no-op du fichier (`layerStack.ts:109-116` pour le modèle), et l'appelant commite
comme `handleEffectChange` le fait déjà.

**Duplication : rien à écrire.** `duplicateLayer` copie par spread
(`layerStack.ts:167`) et insère la copie à `index + 1`
(`layerStack.ts:182`), c'est-à-dire **au-dessus de l'original**. Un duplicata de
calque écrêté est donc écrêté, et sa descente traverse l'original (lui-même
écrêté) pour retrouver **la même base**. Aucun code, aucun cas particulier.

**Presets : `clipToBelow` n'est PAS sérialisé, et `PRESET_SCHEMA_VERSION` reste
à 1.** Décision retournée par rapport à la révision 1 — justification en §3.6.

### 3.2 Résolution de l'écrêtage — deux étapes, deux responsabilités

Une seule règle, écrite une seule fois, dans un module pur :

```ts
// src/layers/clipping.ts  (nouveau)

/** ATTACHEMENT — purement STRUCTUREL : ne dépend QUE de la position dans la
 *  pile, de `clipToBelow` et de `imageSource`. Ne regarde JAMAIS `enabled`.
 *  En descendant depuis le calque : on traverse les calques écrêtés
 *  consécutifs, et on s'arrête au premier calque qui est SOIT une photo
 *  (`imageSource` présent — terminal quoi qu'il porte), SOIT un calque non
 *  écrêté. Retourne l'id de ce calque, ou null (bas de pile).
 *  Retourne null aussi si `layer.clipToBelow` n'est pas vrai. */
export function clipBaseId(layers: LayerState[], layerId: string): string | null;

export type ClipResolution =
  | { kind: "none" }                        // clipToBelow absent/false
  | { kind: "active"; baseLayerId: string } // base photo, et elle est rendue
  | { kind: "inert" }                       // pas de base photo -> rendu linéaire
  | { kind: "suppressed"; baseLayerId: string }; // base photo, mais non rendue

/** EFFECTIVITÉ — dépend de ce qui est réellement encodé cette frame.
 *  `renderedIds` = les calques que la boucle va encoder (donc : après le
 *  filtre `enabled`, ET après la projection d'isolation). */
export function resolveClipping(
  layers: LayerState[],
  renderedIds: ReadonlySet<string>,
): Map<string, ClipResolution>;
```

**Pourquoi séparer attachement et effectivité — ce n'est pas de la décoration.**
L'attachement doit être **invariant par projection** : basculer un œil, ou
entrer en isolation, ne doit jamais changer *à quoi* un calque est écrêté, seulement
*s'il rend*. Sans cette invariance, l'isolation (§3.5) transformerait un calque
`inert` en `active` en masquant le calque d'effet qui le séparait de la photo —
l'isolation changerait le sens du document, ce que `isolation.ts:6-19` interdit
explicitement (« l'isolation est un ÉTAT D'INTERFACE TRANSITOIRE, pas une donnée
de document »). C'est aussi ce qui permet à `FramePipelineExecutor` de calculer
le plan **lui-même**, sur la pile qu'il reçoit déjà, sans qu'on ait à lui faire
passer une seconde pile depuis `Renderer`.

**La photo est TOUJOURS terminale — c'est ce qui tient l'invariant d'ordre des
passes.** L'ancienne formulation (« on s'arrête au premier calque non écrêté »)
laissait traverser un calque photo portant `clipToBelow`. Deux gardes rendent le
cas inexistant plutôt que rattrapable :

1. **`clipBaseId` s'arrête à tout calque portant `imageSource`**, quel que soit
   son propre `clipToBelow`. Écrit ci-dessus, testé.
2. **`LayerStack.setLayerClip(id, clip)` retourne `false` si le calque porte
   `imageSource`** — l'attribut n'est pas *refusé au rendu*, il est **imposable
   à poser**. C'est LÀ que vit la garde, et nulle part ailleurs : `setLayerClip`
   est l'unique chemin d'écriture, `imageSource` n'est écrit qu'en deux endroits
   (`layerStack.ts:78,178`, §2) dont aucun ne peut transformer un calque d'effet
   existant en photo, et `apply()` de preset ne pose ni l'un ni l'autre
   (§3.6). Un calque ne peut donc jamais acquérir les deux.
3. Corollaire ergonomique (pas une garde) : le contrôle d'écrêtage n'est pas
   rendu quand `selectedLayer.imageSource` existe (§3.4).

Conséquence voulue : l'exclusion mutuelle `hasImageSource` / `clipToCoverage`
dans `composeShader` (§3.3) redevient ce qu'elle doit être — **un assert
inatteignable**, pas un chemin utilisateur atteignable en un clic.

**Les trois états, et ce qu'ils font.**

- **`active`** : le rendu multiplie le poids de compositing par la couverture de
  la base (§3.3).
- **`inert`** (pas de base photo : base absente, ou base non-photo) : le calque
  **rend comme aujourd'hui**, linéairement. Justification : (a) perdre
  l'attribut au réordonnancement détruirait une donnée utilisateur ; (b) refuser
  le réordonnancement bloquerait le geste le plus courant de la pile ; (c) lever
  au rendu transformerait un état légal du modèle en crash. Le défaut restant —
  « mon écrêtage ne fait rien » — est payé par la signalisation de §3.7.
- **`suppressed`** (base photo attachée, mais absente de `renderedIds`) : le
  calque **ne contribue pas**. Sémantique de groupe : masquer la base masque ce
  qui lui est écrêté. Le rendre `inert` serait pire — l'effet s'appliquerait
  soudain à TOUTE l'image au moment précis où l'on masque sa base.

**Écrêtage en chaîne : supporté, sans mécanisme supplémentaire.** Plusieurs
calques d'effet consécutifs écrêtés à la même photo, c'est littéralement le
besoin §1.3. La traversée des écrêtés consécutifs le couvre, et §3.3 montre que
c'est gratuit côté GPU.

**Ce qu'un œil ne change jamais.** Masquer un calque d'effet **intercalé** ne
réattache pas ce qui est au-dessus à la photo d'en dessous : `[photo A, effet E
(masqué), écrêté C]` → C reste attaché à E, donc `inert`. C'est le prix direct
et assumé de l'invariance par projection ci-dessus, et c'est la règle la plus
prévisible qu'on puisse écrire : *un œil ne change jamais l'attachement, il ne
peut que faire cesser le rendu.* (Une alternative alignée sur un comportement
supposé de Photoshop a été écartée — voir §10, I5 : elle n'est pas observée, et
elle casse l'invariance.)

`clipBaseId` et `resolveClipping` sont testées en env Node (aucun composant
rendu) : chaîne, base non-photo, bas de pile, photo portant `clipToBelow`
(terminale), base désactivée, calque masqué intercalé, réordonnancement.

### 3.3 Propagation de la couverture jusqu'au WGSL

**Ce qui existe.** Pour un calque photo, `FramePipelineExecutor` appelle
`photoInputs.resolve(...)` et passe `imageSourceView` à `runEffectPass`
(`framePipelineExecutor.ts:223-242,254-274`) ; `composeShader` déclare alors le
binding 6 et bâtit `effectInput = textureSample(imageSourceTexture, ...)`, dont
`.a` sert **à la fois** d'entrée d'effet (RGB) et de couverture
(`shaderCompose.ts:76-101`). Pour un calque d'effet écrêté, il faut la couverture
**d'un autre calque**, et surtout **pas** son RGB comme entrée d'effet.

**Mécanisme retenu : rétention de la vue déjà résolue dans la boucle de frame.
Aucune passe supplémentaire, aucune texture supplémentaire, aucun readback.**

```ts
// framePipelineExecutor.ts, dans la boucle
let clipCoverageView: GPUTextureView | null = null;   // vue de la cible partagée
// calque photo        -> on RETIENT la vue résolue
// écrêté "active"     -> on la CONSOMME et on la CONSERVE (chaîne)
// tout autre calque   -> on la remet à null
```

Ce qui rend la rétention correcte est l'invariant déjà écrit et déjà testé dans
`photoLayerInput.ts:71-88` : la cible de résolution est partagée et re-`clear`ée
par chaque `resolve()`, mais les passes d'un même encoder s'exécutent dans
l'ordre de soumission. **La garde « la photo est terminale » (§3.2) est
exactement ce qui maintient cet invariant** : entre une base photo et le calque
écrêté qui la consomme, la pile ne peut contenir que des calques écrêtés
non-photo — donc aucun `resolve()` ne peut s'intercaler. C'est pour la même
raison que l'écrêtage vers une photo NON adjacente est différé (§8) : il
exigerait une seconde cible persistante, soit +96 Mo à 24 MP.

**Côté shader** — `ComposeOptions` gagne un drapeau distinct :

```ts
export interface ComposeOptions {
  applyMask: boolean;
  hasPrevPass: boolean;
  hasImageSource?: boolean;   // le calque EST une photo (existant)
  clipToCoverage?: boolean;   // le calque est ÉCRÊTÉ à la photo du dessous (nouveau)
  blendWgsl?: string;
}
```

- Les deux drapeaux partagent le **binding 6**, renommé `coverageTexture` — le
  nom actuel `imageSourceTexture` serait un mensonge sur le chemin écrêté.
  Fichiers touchés par le renommage, tous nommés (voir §10, M1) :
  `src/render/shaderCompose.ts` (déclaration + expressions),
  `src/render/effectPassRunner.ts:185,204` (layout), et **côté tests**
  `test/render/shaderCompose.test.ts:78,79,85,103` (assertions sur le littéral,
  qui échoueront) ; `test/render/effectPassRunner.test.ts:160` ne contient le
  littéral que dans un TITRE de test — il ne cassera pas, mais il devient
  trompeur et se met à jour dans la même passe.
- Ils sont **mutuellement exclusifs** : `composeShader` lève si les deux sont
  vrais. Assert inatteignable par construction (§3.2, garde 2).
- `hasImageSource` : inchangé — `effectInput = textureSample(coverageTexture,…)`,
  poids `compositing.x * maskValue * effectInput.a`.
- `clipToCoverage` : `effectInput = color` (**l'entrée d'effet reste le composite
  en dessous** — l'effet doit voir les pixels qu'il traite), et le poids devient
  `compositing.x * maskValue * textureSample(coverageTexture, srcSampler, in.uv).a`.

**Formule complète, et ce qu'elle implique.** Le poids du `mix` final est un
produit de bornes indépendantes :

```
poids = compositing.x   (opacité du calque)
      × maskValue       (masque peint du calque écrêté lui-même)
      × coverage.a      (silhouette de la photo de base)
```

Elles se **multiplient**, dans le même `mix`, sans branche de compositing
nouvelle (`shaderCompose.ts:93-101`). Trois conséquences à écrire noir sur
blanc :

- **Écrêtage × masque** : les deux bornes se composent par ET logique flou —
  l'effet n'apparaît que là où le masque ET la silhouette sont non nuls.
- **Écrêtage × mode de fusion** : aucun effet croisé. `blended =
  blend(color.rgb, effected.rgb)` est calculé partout ; hors silhouette le poids
  est nul, donc `color.rgb` ressort intact **quel que soit** le mode de fusion.
  Aucun mode n'a besoin d'un cas particulier.
- **Écrêtage × mode peinture** : en `maskPaint` sur un calque écrêté, un trait
  peint HORS de la silhouette est **invisible dans le rendu** alors que
  l'overlay de masque, lui, le montre (l'overlay est une passe séparée sur le
  composite, `framePipelineExecutor.ts:284-313`). Ce n'est pas un bug — c'est la
  conséquence directe du produit ci-dessus — mais c'est déroutant, et c'est le
  premier candidat à un retour de terrain (§8).

**Coût.** Une variante de pipeline supplémentaire par (effet × blend) réellement
écrêté, mise en cache par la clé de shader existante
(`effectPassRunner.ts:174-194`). Zéro passe, zéro allocation, zéro octet de VRAM.

**Ce que ça NE fait pas.** L'écrêtage borne **où** l'effet s'applique, il ne
restreint pas ce que l'effet **échantillonne**. Un effet multi-passe (glow)
écrêté continue de flouter le composite complet puis se voit découpé à la
couverture — le halo sortant de la silhouette est coupé net, pas recalculé.
C'est la seule version atteignable sans donner une couverture propre à chaque
calque d'effet (différé, §8).

### 3.4 Neutralisation d'un calque `suppressed` — sans toucher à l'arithmétique de la boucle

**Un calque `suppressed` n'est PAS retiré de la boucle.** L'instruction « sauter
les `suppressed` » de la révision 1 était fausse et cassait le rendu : la boucle
dérive **tout** de `enabledLayers` — `isLast` (`:235`), le choix
`finalTargetView` vs ping-pong (`:236-238`), `guideEpoch` (`:345`), l'avance du
ping-pong (`:351-352`), le court-circuit « 0 calque » (`:183`), le compte
remonté (`:388`) et l'index overlay (`:371`). Un `continue` fait que si le
DERNIER calque activé est supprimé, **plus aucune passe n'écrit
`finalTargetView`**.

**Règle : le calque reste dans la boucle, à son index, et est encodé sans
contribuer.** Concrètement, pour un calque dont la résolution est
`suppressed`, on substitue l'appel normal par la forme déjà utilisée par le
court-circuit « 0 calque activé » (`framePipelineExecutor.ts:185-193`) —
implémenté en `framePipelineExecutor.ts:251-267` :

```
runEffectPass(encoder, PASSTHROUGH_EFFECT, neutralPassLayer(),
              readTexture.createView(), targetView, {}, pendingDestroy)
```

- **Options `{}` ne veut PAS dire « chemin sans compositing ».**
  `runEffectPass` a `applyMask = true` **par défaut**
  (`effectPassRunner.ts:156`) : la passe neutre emprunte donc le chemin de
  compositing complet — bindings 3 (masque) et 5 (compositing), blend
  `normal`, `fsBody = mix(...)` (`shaderCompose.ts:125-134`), pas
  `return effected;`. Ce qui la rend neutre est **l'arithmétique**, pas
  l'absence de branche : `neutralPassLayer()` (`:16-26`) porte un masque par
  défaut (donc `maskValue ≡ 1`), `opacity: 1` et `blendMode: "normal"`, et
  `PASSTHROUGH_EFFECT` renvoie sa couleur d'entrée — soit
  `mix(color, color, 1) = color`, copie exacte de `readTexture` vers
  `targetView`. Le calque ne peut rien modifier, mais par annulation, pas par
  court-circuit du shader.
- **Pas de passes internes** (`runInternalPasses` n'est pas appelé) : un glow
  supprimé ne coûte pas ses passes de flou — le coût se réduit à une passe
  plein écran, sur un chemin déjà éprouvé.
- **Aucune résolution du masque PEINT du calque supprimé.** L'executor
  n'appelle pas `this.masks.resolve` pour lui ; c'est `runEffectPass` qui
  résout, en interne (`effectPassRunner.ts:206`), le masque du **descripteur
  neutre** — dont `planFold` est vide, d'où un retour immédiat sur la texture
  blanche partagée `getWhiteMask()` (`maskTextureResolver.ts:224`). Aucun
  fold, aucune passe de SAT, aucune entrée de cache touchée.
- **La couverture retenue est relâchée** : le branchement pose
  `clipCoverageView = null` (`framePipelineExecutor.ts:261`) avant de
  `continue` — une base photo non rendue ne laisse pas sa couverture en
  héritage à ce qui suit.
- `index`, `isLast`, le ping-pong, `guideEpoch` et `enabledLayerCount` sont
  **inchangés par construction** — c'est tout l'intérêt de ne pas filtrer.
  Aucun risque de régression sur la double-invalidation du cache SAT corrigée en
  `2bc8e6d`.

**Cas de l'overlay.** Si le calque en mode peinture est lui-même `suppressed`,
la passe d'overlay reste encodée : l'utilisateur voit toujours où il peint,
même si le résultat est masqué par la base. Voulu — et cohérent avec le point
« écrêtage × mode peinture » de §3.3.

### 3.5 Écrêtage × isolation — la règle, et où elle vit

L'isolation (`4f911b4`) projette `enabled: false` sur tous les calques sauf
l'isolé, **avant** le rendu (`renderer.ts:265` → `isolation.ts:40-46`). Sans
règle, isoler un calque écrêté masque sa photo de base → `suppressed` → **écran
vide** — exactement le piège que `isolation.ts:25-29` se donne pour règle
d'éviter.

**Décision : la règle vit dans la PROJECTION D'ISOLATION, pas dans la résolution
d'écrêtage.** Isoler un calque écrêté **rend aussi visible sa base photo** ; le
couple (base + calque) est isolé comme une unité.

Justification de l'emplacement, en trois points :

1. La résolution d'écrêtage doit rester **invariante par projection** (§3.2) —
   c'est ce qui garantit qu'entrer en isolation ne change pas le sens du
   document. Y injecter une exception d'isolation détruirait précisément cette
   propriété.
2. `isolation.ts` **possède déjà** la décision « quels calques sont
   effectivement visibles à l'écran », et possède déjà l'exception du même genre
   (le calque isolé est forcé visible même si `enabled === false`,
   `isolation.ts:30-33`). La règle d'écrêtage est le même geste, étendu d'un
   cran.
3. Elle se propage gratuitement à l'UI : `LayerPanel` dérive déjà l'œil et son
   libellé de cette visibilité effective (`LayerPanel.tsx:295-296`), donc l'œil
   de la base photo affichera « visible » pendant l'isolation, ce qui est vrai.
   Aucune réconciliation à écrire.

Forme :

```ts
// src/layers/isolation.ts  — clipping.ts est importé ; l'inverse est interdit
export function isolationVisibleIds(
  layers: LayerState[],
  isolatedLayerId: string | null,
): ReadonlySet<string> | null;   // null = pas d'isolation en cours
// = { isolé } ∪ { clipBaseId(layers, isolé) si ce calque porte imageSource }
```

`projectIsolation` et `isLayerVisible` consomment ce set (calculé une fois,
mémoïsé côté `App.tsx`, passé à `LayerPanel` au lieu de `isolatedLayerId` seul).
`exportFrame` ne passe toujours pas par la projection : ce qui sort du document
est le document.

**Cas traités explicitement :**

| Cas | Résultat |
|---|---|
| Isoler un calque écrêté `active` | Base photo rendue visible avec lui → reste `active`. Écran non vide. |
| Isoler un calque écrêté dont la base est masquée dans le modèle | Base rendue visible aussi (même logique que « le calque isolé est forcé visible ») → `active`. |
| Isoler un calque écrêté `inert` | Rien à tirer (la base n'est pas une photo) → reste `inert`, rend linéairement. Écran non vide. |
| Isoler le 2ᵉ d'une chaîne de deux écrêtés | Tire la base photo, **pas** le 1ᵉʳ écrêté. « Cet effet-là seul, sur sa photo. » |
| **Isoler la PHOTO** alors qu'un écrêté existe au-dessus | La photo seule. Les calques écrêtés au-dessus ne sont **pas** tirés. Pas de piège : la photo rend parfaitement seule, l'écran n'est pas vide. La règle n'étend la visibilité que **vers le bas** (un écrêté tire sa base), jamais vers le haut — c'est le minimum qui satisfait `isolation.ts:25-29`, et la lecture littérale du geste. **Point ouvert n°2 (§9)** : à confirmer sur rendu. |

### 3.6 Presets — pas de bump, `clipToBelow` non capturé, perte signalée

**Décision : `PRESET_SCHEMA_VERSION` reste à 1 et `capture()` ne sérialise pas
`clipToBelow`.** (Retournement par rapport à la révision 1.)

Le bump n'achète rien, et coûte cher :

- **Bénéfice nul, par construction.** `applyPreset` remplace la pile entière
  (`App.tsx:930-933`) et `apply()` ne reconstruit que des calques sans
  `imageSource` (`presetDocument.ts:83-91`) ; `capture()` exclut déjà les
  calques photo (`presetDocument.ts:16-19`). Un `clipToBelow` restauré depuis un
  preset serait donc `inert` **dans 100 % des cas** : il ne peut jamais être
  `active`. On restaurerait une pile entière marquée « écrêté · inerte » —
  du bruit qui ne décrit rien de vrai sur le document cible.
- **Coût plein tarif.** `capture()` écrit `schemaVersion: PRESET_SCHEMA_VERSION`
  **inconditionnellement** (`presetDocument.ts:33`) : avec un bump, **tout**
  preset enregistré après la tranche — même sans le moindre écrêtage — devient
  illisible par un build antérieur (`presetImportValidation.ts:30-35`).
- **L'alternative « v2 seulement si un calque est écrêté » est écartée** : elle
  fait dépendre la version de schéma du contenu du document. Deux presets
  produits par le même build porteraient des versions différentes, et
  `migratePresetDocument` devrait traiter un v1 qui aurait tout aussi bien pu
  être un v2. Versionner conditionnellement est un piège, pas une économie.

**Ce qui est livré à la place : la perte est signalée, jamais silencieuse.**
`capture()` émet un `SkipNotice` de raison nouvelle `"clipping"` pour chaque
calque dont l'écrêtage est abandonné (`presetTypes.ts:27-31` : le canal existe
déjà, il est déjà rendu, une valeur d'énumération suffit). Le projet interdit le
repli silencieux ; il n'interdit pas de renoncer à une donnée, à condition de le
dire.

**Le scénario « preset écrêté appliqué sur une pile sans photo » n'a pas à être
averti : il n'existe plus.** Aucun preset ne peut contenir de calque écrêté.
Éliminer le cas vaut mieux que l'avertir.

**Conséquences de bord, vérifiées :** `presetImportValidation.ts:3-14` reste
inchangé (aucun champ nouveau à valider) ; le commentaire de
`migratePresetDocument` (`presetDocument.ts:97-100`, « `PRESET_SCHEMA_VERSION
=== 1` is the only version that has ever existed ») **reste vrai** et n'a pas à
être touché.

**Trigger de réouverture** (§8) : le jour où un preset capturerait les calques
photo (déjà différé par le design du 2026-07-26), l'écrêtage redeviendrait
restaurable en `active` — c'est à ce moment-là, et pas avant, que la
sérialisation et le bump auront un sens.

### 3.7 Panneau « Photo » — contenu, et amendement du design du 2026-07-26

**Amendement, et son livrable.**
`2026-07-26-shaderlab-photo-layer-parity-design.md` §3.4 prévoyait une
`PhotoLayerToolbar` montée « entre `ErrorBanner` et `<main class="workspace">`,
en poussant le canvas ». **Cette décision est remplacée** par le panneau Photo
du dock. Rien n'est perdu : la barre n'a jamais été implémentée (§2).
**P1 porte l'édition effective de ce fichier** (§3.4, §4 module map, §5 T2, DAG)
— statut superseded sur ce seul point, renommage `PhotoLayerToolbar` →
`PhotoPanel`. Sans cette édition, un implémenteur recevant le brief T3 lirait
encore la barre.

Bénéfice collatéral : l'observation directe de Photoshop web
(`docs/design-system/photoshop-web-observations-2026-07-27.md` §3) établit que
le panneau d'options d'outil n'y **redimensionne jamais le canvas**. La barre
prévue faisait l'inverse. Le panneau supprime ce coût par construction. (Le même
défaut subsiste sur `BrushToolbar` — hors scope, §8.)

**Contenu du panneau Photo**, dans cet ordre :

1. **Source** — vignette + nom du fichier (`photoSources.thumbnailUrl(sourceId)` /
   `layer.name`, T1 livré). Lecture seule en v1.
2. **Placement** — X, Y (px du fond), échelle (%), angle (°), champs numériques
   éditables. **Le champ « Angle » NE SNAPPE PAS** : il est littéral, un angle
   tapé n'est jamais réécrit. Le snap d'angle à 15° (livrable explicite de T2,
   `2026-07-26-…-parity-design.md:735`, valeur tranchée avec sa raison
   `:507-510` — il ne doit pas disparaître dans le déménagement) vit sur le
   **geste de rotation au canvas**, déclenché par `Shift` maintenu pendant le
   drag (`TransformHandles.tsx:77`, `snapAngle` de `ui/transform.ts:77`).
   Pourquoi pas dans le champ : le snap est une aide au geste continu, où la
   valeur exacte n'est pas choisie mais subie ; réécrire une valeur que
   l'utilisateur a délibérément TAPÉE (saisir 20, lire 15) est un défaut
   d'usage, et rendrait tout angle non multiple de 15° insaisissable au
   clavier — la seule voie de saisie exacte. Les deux surfaces sont donc
   complémentaires, pas redondantes : le canvas cale, le champ obéit.

   **Pas d'aperçu live à chaque frappe — commit au blur/`Entrée` seulement.**
   Le champ tient un brouillon local ; `onTransformChange` /
   `onTransformCommit` (`usePhotoLayer.ts:115-133`) ne partent qu'au commit,
   en UNE entrée d'historique. C'est le contrat déjà en place pour le champ
   numérique de `LabeledSlider` (`components/ui/labeled-slider.tsx:164-170`
   pose le brouillon, `:114-123` committe au seul `onBlur`) — et c'est la
   même frontière que pour le snap ci-dessus : **l'aperçu live appartient au
   geste continu** (la poignée du slider, `labeled-slider.tsx:153` ; les
   poignées du canvas), **pas à la saisie clavier**. Reparser à chaque frappe
   rendrait tout état intermédiaire d'une saisie légitime — « 4 » puis « 45 »,
   ou le vide transitoire d'un `Ctrl+A` — visible comme un rendu, ferait
   sauter l'image sous les doigts, et donnerait un sens à des chaînes qui n'en
   ont pas encore (« - », « 1e »). Corollaire assumé : `Échap` peut abandonner
   l'édition sans rien à défaire, précisément parce que rien n'a été appliqué
   (`PhotoPanel.tsx:38-42,72-77`).
3. **Actions** — Réinitialiser · Ajuster à la toile (*contain*) · Centrer ·
   Miroir H · Miroir V (T3) · Recadrer (T4, entre en mode `crop`).

**État vide du panneau Photo — obligatoire.** Le rail peut ouvrir le panneau
alors qu'aucun calque photo n'est sélectionné : un `override: "open"` rend le
panneau visible **quelle que soit** `conditionMet`, tant que `triggerKey` ne
change pas (`contextualPanel.ts:18-29`). Le panneau affiche alors
« Sélectionne un calque photo. », sur le précédent existant
(`ParamPanel.tsx:75-77`).

**Comportement en `maskPaint` et en `crop` — tranché.** Le panneau **reste
visible et ses champs restent éditables dans les trois modes**. La règle du
2026-07-26 (« la barre de transform et les poignées ne s'affichent qu'en
`idle` », `:467-468`, désormais marquée CADUC pour la barre à son point
d'usage) visait les **poignées du canvas**, qui interceptent le
geste de pinceau — c'est exactement ce que `showsTransformHandles` gouverne
(`canvasMode.ts:47-53`), et ça reste vrai. Un champ numérique dans le dock
n'intercepte aucun geste de canvas et ne pousse plus le canvas (§3.7) : rien ne
justifie de le désactiver. Seule exception : l'action « Recadrer » reflète le
mode courant (état pressé quand `mode.kind === "crop"` sur ce calque), la
sortie de mode restant la mécanique de T4, non redécidée ici.

**Où vit le réglage d'écrêtage : dans « Réglages », pas dans « Photo ».**
C'est le **calque d'effet** qui porte l'attribut (§3.1) ; la photo ne fait que
le subir, et n'a aucun moyen de savoir combien de calques s'écrêtent sur elle
sans devenir un état dénormalisé. Le mettre dans le panneau Photo créerait un
contrôle qui édite un AUTRE calque que celui sélectionné. Il est donc rendu **en
en-tête du panneau Réglages**, au-dessus du `Disclosure "Effet"`, agissant sur
la sélection — **et il n'est pas rendu du tout quand le calque sélectionné porte
un `imageSource`** (§3.2, garde 3).

C'est l'application du principe posé le 2026-07-27 (« un contrôle qui se répète
sur chaque ligne d'une liste devient un contrôle unique en en-tête agissant sur
la sélection », `photoshop-web-observations-2026-07-27.md` §2) : l'écrêtage est
un attribut par calque, donc candidat naturel à une case sur chaque ligne — et
c'est précisément ce qu'il ne faut pas faire, la ligne de calque de shaderlab
étant déjà ~5,8× plus haute que la référence. Le principe **ne s'applique pas**
au panneau Photo lui-même : ses contrôles ne se répètent pas par ligne.

**Réglages, état vide.** Un calque `passthrough` ouvre aujourd'hui un
`Disclosure "Effet"` vide (`ParamPanel.tsx:74-124`). Le panneau affiche
désormais un état vide explicite — « Aucun effet appliqué à ce calque. » (ou
« Cet effet n'a pas de paramètres. » selon le cas) — au lieu d'un cadre vide.

### 3.8 Signalisation dans la pile

Trois états à rendre lisibles dans `LayerPanel` :

- **écrêté actif** : la ligne est **indentée** et porte une **flèche coudée
  pointant vers le calque du dessous** ;
- **écrêté inerte** : même indentation, flèche **atténuée**, plus un libellé
  court explicitant la raison (« pas de photo en dessous ») — c'est ce libellé
  qui rend l'état de §3.2 non silencieux ;
- **écrêté supprimé** (base non rendue) : **seul le STYLE de la ligne change**
  (même atténuation qu'une ligne masquée). Ni l'icône de l'œil, ni son
  `aria-label`, ni son `tooltip` ne bougent : ils sont dérivés de la visibilité
  RÉELLE du calque (`LayerPanel.tsx:295-296`, `isolation.ts:30-33,87-97`) et
  celle-ci n'a pas changé — le calque n'est pas masqué, sa base l'est. Un œil
  ouvert sur une ligne atténuée est exact, et la cause est lisible juste en
  dessous (l'œil barré de la base). Le libellé court porte la cause
  (« base masquée »).

**Statut de la convention indentation + flèche : NON OBSERVÉE.** Proposée comme
convention connue de Photoshop desktop, **pas** comme une observation — la
session du 2026-07-27 a porté sur Photoshop **web** et n'a rien relevé sur
l'écrêtage (`photoshop-web-observations-2026-07-27.md` §6 « NON OBSERVÉ »).
À valider en rendu (point ouvert n°1, §9).

Contraintes du rendu : ligne sélectionnée = lavis 24 % + barre 2 px + nom en
medium (décision produit en vigueur) ; l'indentation ne doit pas casser ce
marquage ; `npm run lint:tokens` reste à 0 (l'indentation est un token
d'espacement existant).

### 3.9 Ordre des panneaux du dock

```
[["presets", "layers", "photo", "params", "mask"]]
```

`photo` s'insère **entre `layers` et `params`**, aligné sur l'ordre observé chez
Photoshop web (l'objet au-dessus de ses propriétés,
`photoshop-web-observations-2026-07-27.md` §1) : inventaire (Calques) → ce que
le calque **est** (Photo) → ce qu'il **fait** (Réglages) → **où** il agit
(Masque).

Câblage, calqué sur le panneau Presets :

- `const photoPanel = useContextualPanel(isPhotoLayerSelected, selectedId);`
  où `isPhotoLayerSelected = selectedLayer?.imageSource !== undefined`. C'est le
  câblage de **Réglages/Masque** (condition liée à la sélection). Le rail reste
  l'unique moyen de fermeture, et peut donc l'ouvrir hors condition — d'où
  l'état vide obligatoire de §3.7.
- 5ᵉ entrée dans `panels` (`App.tsx:1190-1291`), 5ᵉ item dans `PanelRail`
  (`App.tsx:1297-1304`), et **ligne obligatoire** dans `panelVisibility`
  (`App.tsx:1030-1041`) — l'oublier lève, par conception.
- `dockLayout` par défaut (`App.tsx:127`) : seul point de vigilance de merge.

## 4. Carte des modules touchés

| Module | Interface visée | Profondeur |
|---|---|---|
| `src/layers/clipping.ts` (nouveau) | `clipBaseId(layers, id)` (structurel) + `resolveClipping(layers, renderedIds)` (effectif) — deux fonctions, toute la règle | profond : deux signatures d'une ligne, règle entière derrière, testable en Node sans React ni GPU |
| `src/layers/types.ts` | `+ clipToBelow?: boolean` | modèle |
| `src/layers/layerStack.ts` | `+ setLayerClip(id, clip): boolean` — **porte la garde « jamais sur un calque photo »** | mutateur + garde |
| `src/layers/isolation.ts` | `+ isolationVisibleIds(layers, isolatedId)` ; `projectIsolation`/`isLayerVisible` consomment le set | profond — importe `clipping.ts`, jamais l'inverse |
| `src/render/shaderCompose.ts` | `+ clipToCoverage` ; binding 6 renommé `coverageTexture` ; exclusion mutuelle fail-fast | profond — reste une fonction pure |
| `src/render/effectPassRunner.ts` | `runEffectPass` : option `clipCoverageView` ; layout du binding 6 étendu | inchangé en forme |
| `src/render/framePipelineExecutor.ts` | calcule `resolveClipping` sur la pile reçue ; rétention de `clipCoverageView` ; **neutralisation** des `suppressed` (§3.4), aucun filtre avant la boucle | orchestration |
| `src/presets/presetDocument.ts` · `presetTypes.ts` | `SkipNotice.reason` gagne `"clipping"` ; **aucun bump**, aucun champ sérialisé | modèle + notice |
| `src/components/PhotoPanel.tsx` (nouveau, **remplace** `PhotoLayerToolbar.tsx`) | props = transform + source + callbacks + état vide, zéro logique | mince, assumé |
| `src/components/ParamPanel.tsx` | en-tête d'écrêtage (masqué pour un calque photo) + état vide explicite | mince, assumé |
| `src/components/LayerPanel.tsx` | signalisation des trois états ; reçoit le set de visibilité au lieu de `isolatedLayerId` | mince, assumé |
| `src/hooks/usePhotoLayer.ts` | accueille les handlers du panneau Photo — **pas** `App.tsx` | profond, déjà en place |
| `src/App.tsx` | 5ᵉ panneau ; handler de bascule d'écrêtage ; mémoïsation du set de visibilité | câblage seulement |
| `test/render/shaderCompose.test.ts` · `test/render/effectPassRunner.test.ts` | mises à jour du littéral `imageSourceTexture` → `coverageTexture` (§3.3) + nouvelles assertions | tests |
| `scripts/gpu-shader-check.mjs` | + cas `composite+clip` par effet | outillage, hors bundle |
| `docs/superpowers/specs/2026-07-26-…-parity-design.md` | amendement §3.4/§4/§5/DAG (§3.7) | doc |

Toute la logique reste extractible en fonctions pures (`clipBaseId`,
`resolveClipping`, `isolationVisibleIds`, `composeShader`, `src/ui/transform.ts`) :
**aucun test ne rend de composant React**. Aucun buffer ni raster nouveau
n'entre dans le state React — `clipToBelow` est un booléen.

## 5. Tranches verticales

Découpage revu : la révision 1 livrait en P2 un contrôle « Écrêter » qui
indentait une ligne et **ne changeait rien à l'image** jusqu'à P3. Une tranche
qui expose un réglage dont le rendu ment n'est pas une tranche verticale, c'est
une tranche horizontale déguisée. L'écrêtage est donc livré **d'un bloc**, du
modèle au pixel.

### P1 — Panneau Photo (gain maximal, risque nul)
Livre : `PhotoPanel` + 5ᵉ entrée de dock/rail/`panelVisibility`/`dockLayout`
(§3.9) ; section Source ; champs X / Y / échelle % / angle ° **avec snap 15°** ;
actions Réinitialiser · Ajuster à la toile · Centrer ; **état vide du panneau
Photo** ; état vide explicite de « Réglages » ; **amendement du document
2026-07-26** (§3.7). Handlers dans `usePhotoLayer`, pas dans `App.tsx`.
Preuve : sélectionner un calque photo → le panneau apparaît, l'icône du rail
s'allume ; sélectionner un calque d'effet → il disparaît, le rail le rouvre
**sur son état vide** ; saisir 45° → l'image tourne, **exactement une** étape
d'undo ; tourner avec snap → l'angle se cale sur 15° ; le canvas ne bouge d'aucun
pixel à l'apparition/disparition du panneau ; le panneau reste utilisable en
mode peinture ; `npm run lint:tokens` à 0 ; story Storybook d'interaction
(saisie clavier, `Entrée`, `Échap`, ordre de tabulation, `aria-label`, état
vide). `grep -n PhotoLayerToolbar docs/superpowers/specs/2026-07-26-*.md` ne
renvoie plus que des mentions marquées superseded.
Bloqué par : rien. **Aucun WGSL.**

### P2 — Écrêtage de bout en bout (la tranche risquée)
Livre : `clipToBelow` ; `clipBaseId` + `resolveClipping` + tests Node ;
`setLayerClip` **avec sa garde photo** ; `clipToCoverage` dans `composeShader`
(binding 6 renommé, exclusion mutuelle) ; option `clipCoverageView` de
`runEffectPass` + layout ; rétention de la vue dans `FramePipelineExecutor` ;
**neutralisation des `suppressed`** (§3.4) ; **règle d'isolation** (§3.5) ;
contrôle d'écrêtage en en-tête de « Réglages » ; indentation de la ligne écrêtée
(signalisation minimale — les libellés d'état fins sont P3).
Ordre de travail interne, non négociable : **le shader et son harnais d'abord**
(preuve verte avant qu'une seule ligne d'UI soit écrite), puis le câblage, puis
l'UI. Le contrôle n'est exposé qu'une fois le rendu correct.
Preuve — voir §6 pour ce que chaque filet attrape réellement :
`test/render/shaderCompose.test.ts` étendu (binding déclaré, `let effectInput =
color;`, poids contenant `textureSample(coverageTexture, srcSampler, in.uv).a`,
et `composeShader` lève quand les deux drapeaux sont vrais) ;
`npm run test:gpu-shaders` vert avec un compte de cas **supérieur** à celui
d'avant la tranche — 28 → **35 shaders composés** (5 passes internes de glow
+ 3 variantes de compositing × 6 effets, `composite` / `+photo` / `+clip`
+ 11 modes de fusion + 1 passe neutre `passthrough`, celle qu'encode §3.4),
**plus 1 garde** non compilée : `hasImageSource` + `clipToCoverage` doit lever
(comptée à part, mais fait échouer le script si la levée disparaît) ;
tests Node sur `FramePipelineExecutor` (port
`PhotoLayerInputPort` déjà mocké dans `test/render/framePipelineExecutor.test.ts`)
assérant (a) un écrêté reçoit **la même** vue que la photo qui le précède,
(b) deux écrêtés consécutifs la reçoivent tous deux, (c) un `inert` n'en reçoit
aucune, (d) un `suppressed` **est encodé**, en `PASSTHROUGH_EFFECT` sans options
ni passes internes, (e) l'ordre `resolve(A) → passes(A) → passes(écrêtés de A) →
resolve(B)` est préservé, (f) la cible finale est écrite même quand le dernier
calque activé est `suppressed` ; test Node sur `isolationVisibleIds` (les cinq
cas du tableau §3.5) ; **checkpoint visuel humain sur la vraie fenêtre (CDP)** :
un glow écrêté ne déborde plus de la silhouette, le même glow non écrêté déborde
toujours, et Alt+clic sur l'écrêté ne produit pas d'écran vide.
Bloqué par : rien (P1 ∥ P2 — worktrees séparés, `App.tsx` seul point de merge).
**WGSL — la plus risquée.**

### P3 — Signalisation fine + notice de capture
Livre : les libellés d'état de §3.8 (« pas de photo en dessous », « base
masquée »), la flèche coudée et son atténuation, le traitement visuel du
`suppressed` (style seul, œil intact) ; `SkipNotice` de raison `"clipping"` à la
capture d'un preset (§3.6). Rendu **après** validation du mockup (point ouvert
n°1).
Preuve : glisser un calque écrêté au-dessus d'un calque d'effet → la ligne passe
visiblement en « inerte » avec sa raison, l'attribut n'est pas perdu (re-glisser
le remet actif, et l'image le confirme) ; masquer la photo de base → la ligne
s'atténue, **l'œil du calque écrêté reste ouvert et son libellé inchangé** ;
enregistrer un preset depuis une pile écrêtée → la notice énumère les calques
dont l'écrêtage est abandonné ; `npm run lint:tokens` à 0.
Bloqué par : P2. **Aucun WGSL.**

### P4 — Flip et recadrage dans le panneau Photo
Aucune décision nouvelle : ce sont **T3 et T4 du design 2026-07-26**, inchangées
(struct d'uniform `PhotoInputParams`, `PHOTO_INVERSE_TRANSFORM_WGSL` asséré
ligne à ligne, **création** du harnais de parité pixel `scripts/gpu-parity.mjs`
— qui n'existe pas encore, §2). Seul le contenant change.
Bloqué par : P1. **WGSL — risqué.**

**Vagues** : V1 = P1 ∥ P2 · V2 = P3 ∥ P4.

## 6. Moyens de preuve — ce que chaque filet attrape, et ce qu'aucun n'attrape

Une erreur de propagation de couverture est une erreur de **valeur**, pas de
compilation. Il faut donc dire précisément ce qui l'attrape :

| Filet | Attrape | N'attrape PAS |
|---|---|---|
| `test/render/shaderCompose.test.ts` (env Node, assertions sur le TEXTE du WGSL composé, `:74-104` pour le précédent) | **La couverture oubliée dans le poids** — c'est le défaut le plus probable, et c'est bien une assertion textuelle qui le prend. Aussi : binding manquant, mauvaise entrée d'effet, exclusion mutuelle non levée | Une erreur dans la formule *mathématique* (mauvais canal, `1 - a` au lieu de `a`) si elle est écrite conformément à l'assertion |
| `npm run test:gpu-shaders` (`gpu-shader-check.mjs:78-140`, GPU réel) | Uniquement la **compilation** : WGSL invalide, binding déclaré mais absent du layout — sur les 35 shaders composés, y compris `+clip` et la passe neutre de §3.4. Plus une **garde** (`:138`) : la levée sur `hasImageSource`+`clipToCoverage` disparue = échec du script | **Aucune valeur.** Un poids `compositing.x * maskValue` (couverture oubliée) compile parfaitement |
| Tests Node `FramePipelineExecutor` (port mocké) | L'**identité des vues** passées, l'ordre d'encodage, le fait qu'un `suppressed` soit encodé et que la cible finale soit écrite | Ce que le shader fait de ces vues |
| **Checkpoint visuel humain sur la vraie fenêtre (CDP)** | Tout le reste | — |

**À dire franchement : aucun filet automatisé de ce projet ne compare un pixel
sur ce chemin.** `scripts/gpu-parity.mjs` n'existe pas (§2) et, quand il
existera (P4), il portera sur la géométrie photo, pas sur la couverture. La
justesse visuelle finale de P2 **est** un checkpoint humain — c'est le moyen de
preuve UI déclaré du projet, pas un aveu de faiblesse, mais il ne doit pas être
présenté comme un filet automatisé.

Rappels : Playwright headless est inadapté (canvas WebGPU noir en WebView2
headless) ; l'UI **DOM pur** (panneau, champs, signalisation) relève de
Storybook (`src/components/PresetPanel.stories.tsx` comme précédent).
Invariants à ne pas violer : aucun gros buffer/raster dans le state React ; un
seul pipeline, résolution native ; format sRGB préféré de la plateforme, jamais
de gamma manuel en WGSL ; `npm run lint:tokens` à 0.

## 7. Ce que ce design ne casse pas (vérifications de non-régression)

| Fonctionnalité livrée | Pourquoi elle survit |
|---|---|
| Isolation (`4f911b4`) | §3.5 — règle explicite dans la projection ; cinq cas tabulés, testés en Node |
| Écriture de la cible finale / ping-pong / `guideEpoch` (dont le fix SAT `2bc8e6d`) | §3.4 — aucun filtre avant la boucle, l'arithmétique est inchangée par construction |
| Cible photo partagée (`photoLayerInput.ts:71-88`) | §3.3 — la photo terminale interdit tout `resolve()` intercalé |
| Interop des presets avec les builds antérieurs | §3.6 — aucun bump |
| Commentaire de `migratePresetDocument` | §3.6 — reste vrai, non touché |
| Duplication de calque (Ctrl+J) | §3.1 — le spread copie l'attribut, la copie reste au-dessus de la même base |
| Œil et `aria-label` de `LayerPanel` | §3.8 — seul le style de ligne change |

## 8. Différé (avec trigger de réouverture nommé)

| Différé | Trigger de réouverture |
|---|---|
| Écrêtage vers une photo **non adjacente** | Demande explicite — coûterait une seconde cible persistante (+96 Mo à 24 MP) ; l'adjacence maintient l'invariant d'ordre des passes (§3.3) |
| Un calque **photo** lui-même écrêté | Demande explicite — interdit par `setLayerClip` (§3.2) ; demanderait un 7ᵉ binding et une 2ᵉ vue retenue |
| Sérialisation de `clipToBelow` dans les presets + bump de schéma | **Le jour où les presets captureront les calques photo** (déjà différé par le design du 2026-07-26) : l'écrêtage redeviendrait restaurable en `active`, et le bump aurait alors un sens (§3.6) |
| Effet écrêté qui **échantillonne** la seule silhouette (halo recalculé, pas coupé) | L'utilisateur juge la coupe nette du halo inacceptable — chantier « couverture par calque d'effet », coûteux |
| Peinture de masque hors silhouette sur un calque écrêté (traits invisibles mais montrés par l'overlay, §3.3) | Retour de terrain : si le décalage overlay/rendu déroute à l'usage, borner l'overlay à la couverture |
| Remplacement de l'image source depuis le panneau Photo | Demande explicite |
| Écrêtage posé par un geste direct dans la pile (alt-clic entre deux lignes) | La bascule en en-tête de Réglages se révèle trop indirecte à l'usage |
| `BrushToolbar` sorti du flux | Chantier de hiérarchisation du dock — même cause que §3.7, autre surface |
| Calques photo dans les presets | Inchangé (déjà différé par le design du 2026-07-26) |

## 9. Points ouverts (deux, chacun tranché SUR RENDU)

1. **Convention visuelle de l'écrêtage** (indentation + flèche coudée vers le
   calque du dessous) — **NON OBSERVÉE**, proposée de mémoire.
   **À MONTRER avant de trancher** : mockup de la pile aux vrais tokens
   (`src/design/{primitives,semantic,components}.css`) montrant côte à côte les
   quatre lignes — normale, écrêtée active, écrêtée inerte (avec sa raison),
   écrêtée supprimée — dont **une sélectionnée**, pour vérifier que
   l'indentation ne casse pas le marquage de sélection (lavis 24 % + barre 2 px
   + nom medium). Aucune question de goût posée avant ce visuel.

2. **Isolation d'un calque PHOTO qui porte des écrêtés au-dessus** : la règle
   §3.5 n'étend la visibilité que vers le bas, donc isoler la photo la montre
   **seule**, sans les effets qui lui sont écrêtés. C'est la lecture littérale
   du geste, mais c'est un arbitrage de goût.
   **À MONTRER avant de trancher** : deux captures CDP de la vraie fenêtre sur
   le même document (photo + glow écrêté), l'une avec la règle actuelle (photo
   nue), l'autre avec la règle symétrique (photo + son glow). L'écart est
   visible immédiatement ; il ne se juge pas sur ce texte.

## 10. Historique de revue

Revue adverse du 2026-07-27 sur la révision 1 (`master@1a09d8d`), verdict
« à reprendre ». Traitement, un finding par ligne.

| # | Traitement |
|---|---|
| **B1** — le saut des `suppressed` casse l'écriture de la cible finale | **Corrigé** (§3.4). Un `suppressed` reste dans la boucle, à son index, encodé en `PASSTHROUGH_EFFECT` sans options ni passes internes. Aucun filtre, donc `isLast`/ping-pong/`guideEpoch`/`enabledLayerCount`/index overlay inchangés par construction — correction plus sûre que le re-dérivage sur une liste filtrée que proposait la revue. Preuve (f) ajoutée en P2. |
| **B2** — un calque photo peut porter `clipToBelow`, la chaîne le traverse | **Corrigé** (§3.2), avec une garde de plus que les deux demandées : (1) `clipBaseId` s'arrête à tout `imageSource` ; (2) `setLayerClip` refuse un calque photo — l'attribut est **imposable à poser**, pas seulement refusé au rendu ; (3) le contrôle n'est pas rendu pour une photo. Complétude vérifiée ce tour : `imageSource` n'a que deux écrivains (`layerStack.ts:78,178`), aucun ne transforme un calque d'effet en photo, et `apply()` de preset ne pose ni l'un ni l'autre. Le fail-fast `composeShader` redevient un assert inatteignable. |
| **B3** — l'écrêtage casse l'isolation | **Corrigé** (§3.5), et la place de la règle est justifiée : elle vit dans la **projection d'isolation**, pas dans la résolution d'écrêtage, parce que celle-ci doit rester invariante par projection (sinon isoler change le sens du document, `isolation.ts:6-19`), parce qu'`isolation.ts` possède déjà l'exception du même genre (`:30-33`), et parce que `LayerPanel` en dérive déjà l'œil (`:295-296`) — la cohérence UI est gratuite. Le cas inverse (isoler la photo) est tranché et tabulé, et remonté en point ouvert n°2 pour validation sur rendu. |
| **I1** — presets v2 : coût d'interop pour bénéfice nul | **Corrigé** (§3.6), en tranchant plus loin que la revue : **ni bump, ni sérialisation**. L'option « v2 seulement si un calque est écrêté » est explicitement écartée (la version dépendrait du contenu). La perte est signalée par un `SkipNotice` de raison `"clipping"`. Le scénario « preset écrêté appliqué sur une pile sans photo » est **éliminé**, pas averti. |
| **I2** — snap 15° et règle `idle` perdus dans le déménagement | **Corrigé** (§3.7) : le snap 15° est réintégré au contenu du panneau et au livrable P1 ; le comportement en `maskPaint`/`crop` est tranché explicitement (panneau utilisable dans les trois modes ; `showsTransformHandles`, `canvasMode.ts:47-53`, ne gouverne que les poignées du canvas, ce qui reste vrai). |
| **I3** — le document amendé n'est amendé par aucune tranche | **Corrigé** : l'édition de `2026-07-26-…-parity-design.md` est un **livrable explicite de P1** (§3.7, §4, §5), avec sa preuve (`grep -n PhotoLayerToolbar`). |
| **I4** — panneau Photo ouvert sans calque photo | **Corrigé** (§3.7) : état vide « Sélectionne un calque photo. », sur le précédent `ParamPanel.tsx:75-77`, ajouté aux preuves P1 et à la story Storybook. |
| **I5** — quelle liste est passée à `resolveClipping` | **Corrigé pour moitié, réfuté pour moitié.** Corrigé : la question « quelle liste » est désormais explicite — attachement sur la pile reçue (structurel, sans `enabled`), effectivité sur `renderedIds` (§3.2). **Réfuté** : la recommandation « ignorer les calques masqués non-photo lors de la descente » est écartée. Elle briserait l'invariance par projection dont dépend la correction de B3 (masquer un calque intercalé transformerait un `inert` en `active`, et l'isolation ferait de même — l'isolation changerait le sens du document). Elle s'appuyait de plus sur un comportement de Photoshop **non observé** : rien dans `photoshop-web-observations-2026-07-27.md` §6 ne documente l'écrêtage, et ce design ne s'autorise pas à affirmer un comportement de référence qu'il n'a pas vu. La règle retenue est plus prévisible : *un œil ne change jamais l'attachement, il ne peut que faire cesser le rendu.* |
| **I6** — rien ne teste la FORMULE générée | **Corrigé** (§5 P2, §6) : les trois assertions de `test/render/shaderCompose.test.ts:74-104` sont mirroitées pour `clipToCoverage`, plus l'assertion que `composeShader` lève quand les deux drapeaux sont vrais. Le tableau §6 dit explicitement ce que `test:gpu-shaders` n'attrape pas. |
| **M1** — « un seul fichier touché » est faux | **Corrigé** (§3.3), avec une précision que la revue amalgamait : `test/render/shaderCompose.test.ts:78,79,85,103` assère le littéral et **échouera** ; `test/render/effectPassRunner.test.ts:160` ne le contient que dans un **titre** de test — il ne cassera pas, mais devient trompeur et se met à jour dans la même passe. Les deux fichiers sont au module map §4. |
| **M2** — commentaire de `migratePresetDocument` rendu faux | **Réfuté par la décision I1.** Sans bump, `presetDocument.ts:97-100` (« `PRESET_SCHEMA_VERSION === 1` is the only version that has ever existed ») **reste vrai** et n'est pas touché. Noté en §3.6 et §7. |
| **M3** — P2 expose un contrôle qui ne fait rien jusqu'à P3 | **Corrigé par refonte du découpage** (§5), pas par un contrôle désactivé : l'écrêtage est livré d'un bloc, du modèle au pixel (P2), et seule la signalisation fine reste en incrément (P3). Ordre de travail interne imposé : shader + harnais verts avant toute UI. |
| **M4** — `suppressed` « comme un calque masqué » entre en conflit avec l'œil | **Corrigé** (§3.8) : seul le STYLE de la ligne change ; l'icône, l'`aria-label` et le `tooltip` restent dérivés de la visibilité réelle (`LayerPanel.tsx:295-296`, `isolation.ts:30-33,87-97`). La cause est portée par un libellé court et par l'œil barré de la base juste en dessous. |
| **M5** — masque × écrêtage non documenté côté usage | **Corrigé** (§3.3) : la formule complète du poids est écrite (`opacité × masque × couverture`), avec les trois conséquences — masque, mode de fusion, et le cas concret du mode peinture (traits hors silhouette invisibles alors que l'overlay les montre). Le cas est aussi entré au Différé avec son trigger. |

**Ce que la revue a confirmé et qu'il ne fallait pas défaire** : les ~30
citations `fichier:ligne` du §2 ont été rouvertes une par une par la revue et
aucune n'était fausse. Le §2 est conservé, corrigé uniquement par ajout (les
lignes isolation, écrivains d'`imageSource`, duplication, `applyPreset`,
absence de `gpu-parity.mjs`) — aucune ligne existante n'a été affaiblie.

## 11. Auto-vérification

Colonne « vérifié » : `ce tour` = ouvert par `awk`/`cat -n`/`grep`/`ls` pendant
la rédaction de cette révision. `revue §0` = vérifié par la revue adverse, qui a
rouvert chaque citation une par une et n'en a trouvé aucune fausse ; non rouvert
ce tour.

| Affirmation | Preuve | Vérifié |
|---|---|---|
| L'isolation projette `enabled` avant le rendu, écran seulement (`exportFrame` exclu) | `src/render/renderer.ts:262-268` ; `src/layers/isolation.ts:40-46` | ce tour |
| L'isolation se donne pour règle de ne pas produire d'écran noir, et force le calque isolé visible | `src/layers/isolation.ts:25-33` | ce tour |
| `LayerPanel` dérive l'œil de la visibilité effective | `src/components/LayerPanel.tsx:295-296` ; `src/layers/isolation.ts:87-97` | ce tour |
| La boucle dérive `isLast`, la cible, le ping-pong, `guideEpoch`, le compte et l'index overlay de `enabledLayers` | `src/render/framePipelineExecutor.ts:206,209-212,271,276-279,298,314` | ce tour |
| Le court-circuit « 0 calque » encode `PASSTHROUGH_EFFECT` sans options ni passes internes et écrit `finalTargetView` | `src/render/framePipelineExecutor.ts:163-201` | ce tour |
| `applyMask` absent ⇒ `fsBody = "return effected;"` (copie exacte) | `src/render/shaderCompose.ts:93,102` | ce tour |
| Le poids du mix est `compositing.x * maskValue [* effectInput.a]`, et `blended` est calculé indépendamment du poids | `src/render/shaderCompose.ts:84-101` | ce tour |
| La cible photo est partagée et l'invariant est l'ORDRE DES PASSES, pas l'unicité | `src/render/photoLayerInput.ts:64-88` | ce tour |
| `imageSource` n'a que deux écrivains, aucun ne convertit un calque existant | `grep -rn imageSource src/layers src/hooks src/App.tsx` → 12 occurrences, écritures en `layerStack.ts:78,178` | ce tour |
| `duplicateLayer` copie par spread et insère à `index + 1` | `src/layers/layerStack.ts:166-182` | ce tour |
| `applyPreset` remplace la pile entière ; `apply()` ne pose jamais `imageSource` | `src/App.tsx:930-933` ; `src/presets/presetDocument.ts:83-91` | ce tour |
| `capture()` exclut les photos via `SkipNotice` et écrit `schemaVersion` inconditionnellement | `src/presets/presetDocument.ts:16-19,33` ; `src/presets/presetTypes.ts:27-31` | ce tour |
| `PRESET_SCHEMA_VERSION = 1` ; le commentaire de `migratePresetDocument` l'affirme | `src/presets/presetTypes.ts:1` ; `src/presets/presetDocument.ts:97-103` | ce tour |
| `presetImportValidation` refuse `schemaVersion >` supporté ; son en-tête déclare être le SEUL point de validation de schéma | `src/presets/presetImportValidation.ts:3-14,16-20,30-35` | ce tour |
| Un `override: "open"` du rail rend le panneau visible hors condition | `src/ui/contextualPanel.ts:18-29` | ce tour |
| `panelVisibility` lève sur un id inconnu ; 4 panneaux aujourd'hui | `src/App.tsx:1030-1041` | ce tour |
| `showsTransformHandles` ne gouverne que les poignées du canvas | `src/ui/canvasMode.ts:47-53` | ce tour |
| `test:gpu-shaders` ne fait que COMPILER (aucune comparaison de valeur), et a un cas `composite+photo` | `scripts/gpu-shader-check.mjs:55-65,83-84` | ce tour |
| Le WGSL composé est asséré ligne à ligne sur son TEXTE, y compris le poids du mix | `test/render/shaderCompose.test.ts:74-104` (littéral `imageSourceTexture` en `:78,79,85,103`) | ce tour |
| `imageSourceTexture` n'apparaît dans `effectPassRunner.test.ts:160` que comme titre de test | `test/render/effectPassRunner.test.ts:159-160` | ce tour |
| **`scripts/gpu-parity.mjs` n'existe pas** | `ls scripts/` → 6 entrées, aucune `gpu-parity.mjs` (balayage non vide : `gpu-shader-check.mjs`, `lint-tokens.mjs`, etc.) | ce tour |
| Le snap d'angle à 15° est un livrable T2 tranché du 2026-07-26 | `docs/…/2026-07-26-…-parity-design.md:691,1036-1038` | ce tour |
| La règle « poignées seulement en `idle` » du 2026-07-26 vise les poignées de canvas | `docs/…/2026-07-26-…-parity-design.md:447-449` | ce tour |
| T2 du 2026-07-26 décrit encore `PhotoLayerToolbar` au présent | `docs/…/2026-07-26-…-parity-design.md:688-699` | ce tour |
| `addPhotoLayer` pose `effectId: "passthrough"` | `src/layers/layerStack.ts:68-83` | revue §0 |
| `setLayerEffect` : discipline no-op (modèle de `setLayerClip`) | `src/layers/layerStack.ts:109-116` | ce tour |
| Le titre du panneau Réglages nomme l'effet | `src/App.tsx:1016` | ce tour |
| Un effet sans paramètre rend un `Disclosure` vide, sans état vide ; précédent d'état vide en `:75-77` | `src/components/ParamPanel.tsx:74-124` ; `src/render/effectPassRunner.ts:6-11` | revue §0 |
| Le binding 6 n'existe que sur le chemin `applyMask` ; layout en `:185,204` | `src/render/shaderCompose.ts:73-79` ; `src/render/effectPassRunner.ts:185,204` | ce tour (shaderCompose) / revue §0 (effectPassRunner) |
| `runEffectPass` reçoit déjà `imageSourceView` en option | `src/render/effectPassRunner.ts:153-156,164-165` | revue §0 |
| Ordre par défaut du dock à 4 panneaux | `src/App.tsx:127` | revue §0 |
| `useContextualPanel` : Presets/Calques `(true,"static")`, Réglages/Masque `(selectedId !== null, selectedId)` | `src/App.tsx:1018-1021` ; `src/ui/contextualPanel.ts:31-43` | ce tour |
| Le rail compte 4 items | `src/App.tsx:1297-1304` | revue §0 |
| `PhotoLayerToolbar` n'existe pas sur disque | `ls src/components` → 29 entrées, balayage non vide | revue §0 |
| T1/T6 du 2026-07-26 livrés ; `usePhotoLayer` porte `handleTransformChange`/`Commit` | `src/hooks/usePhotoLayer.ts:115-133` ; `src/ui/canvasMode.ts` ; `src/App.tsx:1225-1243` | revue §0 (usePhotoLayer/App) / ce tour (canvasMode) |
| La géométrie pure vit dans `src/ui/transform.ts` | `src/ui/transform.ts:30-121` | revue §0 |
| Photoshop web : pas de redimensionnement du canvas ; écrêtage **NON OBSERVÉ** | `docs/design-system/photoshop-web-observations-2026-07-27.md` §1, §2, §3, §6 | revue §0 |
