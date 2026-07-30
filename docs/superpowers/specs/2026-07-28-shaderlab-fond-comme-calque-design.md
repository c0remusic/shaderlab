# Le fond devient un calque — design d'architecture

> Statut : **proposition d'architecture, non implémentée.** Aucun code n'a été
> modifié pour produire ce document.
> Date : 2026-07-28. Branche observée : `master`.
> Décisions amont : ADR-0002 (abandon du round-trip, débloque « toutes les
> images sont des calques »), ADR-0003 (sens d'affichage Photoshop, déjà en place).
>
> Convention de durabilité : les `fichier:ligne` cités sont des **preuves d'état
> observé le 2026-07-28**, pas des instructions « éditer ici plus tard ».

---

## 0. Ce que le besoin exige exactement

Verbatim d'Antoine : « on devrait pouvoir choisir où les photos qu'on ajoute se
trouvent dans la chaîne » et « elles pourraient avoir leurs propres effets ».

| Besoin | État réel aujourd'hui | Preuve |
|---|---|---|
| Une photo importée a ses propres effets | **déjà vrai** | `src/layers/layerStack.ts:109-116` |
| Une photo importée se place où on veut | **déjà vrai** entre calques importés | `src/layers/layerStack.ts:238-246` |
| Un effet ne touche qu'une photo précise | **déjà vrai** (écrêtage) | `src/layers/clipping.ts:37-46` |
| Le **fond** se place où on veut | **impossible** | `src/components/LayerPanel.tsx:486-512` |
| Un effet passe **sous** le fond | **impossible** | `src/render/framePipelineExecutor.ts:230` |
| Le fond se remplace sans perdre le travail | **impossible** | `src/App.tsx:276-277` |
| Le fond porte un effet écrêté à lui seul | **impossible** | `src/layers/clipping.ts:43` |

Les trois dernières lignes sont le chantier.

---

## 1. Faisabilité et forme

### 1.1 Verdict

**Faisable, sans nouveau type de calque, sans nouveau champ sur `LayerState`.**
Le fond devient un `LayerState` ordinaire portant `imageSource` + `transform` —
ce que produit déjà `LayerStack.addPhotoLayer` (`src/layers/layerStack.ts:68-83`).
Aucun flag `isBackground`, aucun type `BackgroundLayerState`.

Raison : tout le code qui distingue « photo » de « effet » teste
`layer.imageSource !== undefined` et rien d'autre — 13 sites convergents
(`src/layers/clipping.ts:43,86`, `src/layers/isolation.ts:50`,
`src/layers/photoLayer.ts:30`, `src/layers/layerStack.ts:137,203,216`,
`src/layers/duplicateLayer.ts:57`, `src/presets/presetDocument.ts:17`,
`src/hooks/usePresets.ts:16`, `src/components/ParamPanel.tsx:97`,
`src/components/LayerPanel.tsx:134,203`, `src/render/renderer.ts:223`,
`src/render/framePipelineExecutor.ts:278,312`). Un marqueur « arrière-plan »
rouvrirait dans le modèle le statut spécial que cette décision supprime.

### 1.2 Que devient `sourceTexture`

**Elle ne disparaît pas. Elle change de sens : « la photo » → « la toile ».**
Texture aux dimensions du document, effacée une fois, **jamais uploadée**. Le nom
doit suivre (`baseTexture`/`canvasTexture`) — c'est ce nom qui a produit les
trois commentaires affirmant « le document n'est pas un `LayerState` »
(`src/layers/documentName.ts:5-7`, `src/layers/photoLayer.ts:3-5`,
`src/components/LayerPanel.tsx:42-45`).

Pourquoi la garder : la passe de compositing lit inconditionnellement
`srcTexture` au binding 0 et **en tire son alpha de sortie**
(`src/render/shaderCompose.ts:152` puis `:133`). La supprimer obligerait
l'exécuteur de frame à savoir si son premier calque est une photo à couverture
pleine — information leakage, et un cas particulier dans la boucle la plus
sensible du projet.

**Contrainte dure : la toile est effacée en `alpha = 1`.** La chaîne propage
`color.a` de bout en bout (`shaderCompose.ts:133`) ; l'export encode via
`putImageData` + `convertToBlob` (`src/export/exportImage.ts:48-55`). Une toile à
alpha 0 produirait un **JPEG entièrement noir**, silencieusement.

### 1.3 D'où part le pipeline

De la toile. `readTexture = baseTexture` (`framePipelineExecutor.ts:230`), boucle
inchangée. Le calque de fond, étant photo, passe par la pré-passe existante
(`framePipelineExecutor.ts:278-297` → `src/render/photoLayerInput.ts:128-178`) et
se compose avec `poids = opacité × masque × couverture`
(`shaderCompose.ts:109-113`). Couverture ≡ 1 quand le fond couvre la toile → rendu
identique au pixel près.

Conséquence voulue : **la pile vide n'affiche plus la photo mais la toile**
(court-circuit `framePipelineExecutor.ts:183-214`). Masquer le fond montre la
toile. Comportement Photoshop.

### 1.4 Une dimension explicite, plus jamais dérivée de la texture

Aujourd'hui la taille de toile est lue sur la texture source :
`this.photoInputs.resolve(encoder, layer, sourceTexture.width, sourceTexture.height, …)`
(`framePipelineExecutor.ts:294`). Elle doit passer par les dimensions explicites
du document, qui existent déjà (`src/render/imageFrameResources.ts:8-9,17-18`).
Correction d'un mot, mais structurante : elle rend possible l'optimisation
« toile 1×1 » (§8) et, plus tard, une toile indépendante de toute photo.

### 1.5 Profondeur de module

Aucun module nouveau. Le chantier **retire** de la surface :

| Élément | Devenir |
|---|---|
| `documentName.ts` | absorbé par `LayerState.name` (`layerStack.ts:68-83`, `types.ts:54-60`) ; reste utile au titre de la barre d'outils |
| `LayerPanel` prop `backgroundName` + `<li>` dérivé | supprimés |
| `hasPhotoLayer` (`photoLayer.ts:42`) | toujours vrai → mort avec le round-trip (ADR-0002) |
| `ImageFrameResources.loadImage(bitmap)` | devient « allouer + effacer une toile W×H » ; l'upload part dans `PhotoSourceStore.register` |

La forme visée a **moins** de concepts que l'actuelle.

---

## 2. Ce qui casse — inventaire avec preuves

### 2.1 CRITIQUE — Les masques paramétriques deviennent aveugles
`MaskTextureResolver` reçoit `() => this.imageResources.sourceTexture!`
(`src/render/renderer.ts:214`) et **toutes** les sources paramétriques
(luminosité, plage de couleur, dégradé) s'échantillonnent dessus
(`src/render/maskTextureResolver.ts:146`, `:458`, binding 0 du pipeline
`parametric:*`). Avec une toile vide, un masque de luminosité lirait du noir.
Correctif obligatoire dans la même tranche : `sourceColor()` rend la texture du
calque photo **le plus bas**, via `PhotoSourceStore`. Comportement identique à
aujourd'hui tant que le fond est en bas.

### 2.2 CRITIQUE — Alpha de la toile et export
Voir §1.2. `shaderCompose.ts:133` + `export/exportImage.ts:48-55`. Test de
non-régression naturel : comparaison d'export avant/après sur la même photo.

### 2.3 CRITIQUE — Appliquer un preset détruirait le fond
`applyPreset` remplace la pile **entière** (`src/App.tsx:993-996` :
`const stack = new LayerStack(); stack.layers = newLayers; commit(stack);`).
L'application doit préserver les calques photo (au minimum le plus bas).
Effet annexe : `capture` émet un `SkipNotice` « photo-layer » pour tout calque
photo (`src/presets/presetDocument.ts:16-20`) — il se déclencherait
systématiquement à cause du fond. Le format de preset, lui, ne change pas.

### 2.4 HAUTE — Ouverture de document
`openFile` (`src/App.tsx:268-288`) doit enregistrer le bitmap dans
`PhotoSourceStore` **après** `Renderer.createLoaded` (le store est créé dans
`loadImage`, `src/render/renderer.ts:217-218`) et **avant** le premier `render`,
puis pousser le calque de fond dans la pile initiale. La transaction actuelle
(candidat validé avant de toucher l'existant, `App.tsx:242-266`) doit être
préservée : un échec d'enregistrement ne doit pas laisser un document sans fond.

### 2.5 HAUTE — `MAX_PHOTO_LAYERS` : le fond compte désormais
`countPhotoLayers` compte tout calque portant `imageSource`
(`src/layers/photoLayer.ts:29-31`). Sans changement, la capacité tombe de
« 4 imports + fond » à « 3 imports + fond ». Proposé : **4 → 5**, avec re-mesure
(§4). `MAX_REGISTERED_PHOTO_SOURCES` en dérive (`4 × MAX`,
`src/render/photoSourceStore.ts:51`) et passe à 20. Le commentaire de la
constante (« la photo de FOND n'en fait pas partie », `photoLayer.ts:3-7`)
devient faux.

### 2.6 HAUTE — Guide edge-aware : l'hypothèse « index 0 = guide stable » tombe
`guideEpoch: index === 0 ? 0 : this.runGeneration`
(`src/render/framePipelineExecutor.ts:345`, miroir `:376-378`), formalisé par
`docs/adr/0002-overlay-guide-epoch-invariant.md`. Après le changement, l'index 0
est le fond, dont l'entrée d'effet est la texture résolue par la pré-passe (elle
change avec son transform) ; et le calque juste au-dessus passe d'epoch 0 à epoch
variable → reconstruction SAT à chaque frame (coût décrit
`maskTextureResolver.ts:121-129`). Régression de **performance**, pas de
justesse : ne bloque pas T1, mais ne doit pas être découverte à l'usage.

### 2.7 MOYENNE — Panneau des calques
`backgroundName` + `<li>` dérivé (`src/components/LayerPanel.tsx:40-46`,
`:486-512`) disparaissent. Le fond gagne poignée, œil, sélection, suppression,
duplication, vignette (il sera enregistré dans `PhotoSourceStore`, contrairement
au commentaire `LayerPanel.tsx:491-495`). Il perd le cadenas. **Arbitrage, §7.**

### 2.8 MOYENNE — Round-trip Lightroom
`roundTripActive = isLaunchFile && !hasPhotoLayer(layers)` (`src/App.tsx:1174`)
devient définitivement faux. Sans conséquence produit (ADR-0002), mais le
prédicat devient un mensonge : il part avec la tranche ADR-0002, ou est redéfini
en « au moins un calque photo **importé** ».

### 2.9 MOYENNE — Undo/redo
Aucun mécanisme à changer. `History` snapshotte `LayerStack`
(`src/application/documentSession.ts:48-52`) et `PhotoSourceStore` ne libère
jamais une source au retrait d'un calque, précisément pour que l'undo la
retrouve (`src/render/photoSourceStore.ts:148-156`). Supprimer le fond devient
annulable comme le reste — acquis, pas à construire.

### 2.10 MOYENNE — `imageSize`
Change de **sens** (taille de toile, non plus taille de la photo de fond) sans
changer de valeur en v1 (`src/App.tsx:83`, posé `:268`). Il alimente
`MaskPainter` (ARCHITECTURE.md §1.4) et l'export (`App.tsx:827-828`) : les deux
veulent la taille de toile. Rien à corriger, le nom mérite de suivre.

### 2.11 BASSE — Ce qui ne casse PAS, vérifié
- **Invariant d'ordre des passes** (`framePipelineExecutor.ts:302-311`) : intact.
  Le fond, étant photo, **pose** la couverture (`:312`) au lieu de la consommer ;
  la levée ne peut viser qu'un calque `active` sans base retenue, ce que la
  terminalité de la photo garantit toujours (`clipping.ts:37-46`).
- **Cible partagée du resolver** (`photoLayerInput.ts:72-87`) : la correction du
  partage est l'**ordre d'encodage**, pas le nombre de calques photo.
- **Garde `setLayerClip`** (`src/layers/layerStack.ts:134-141`) : reste
  nécessaire et correcte. Le fond ne pourra pas être écrêté ; en revanche un
  effet **écrêté sur le fond** devient exprimable sans une ligne de plus,
  `clipBaseId` acceptant tout calque portant `imageSource` (`clipping.ts:43`).
- **Sérialisation de document** : je n'ai trouvé aucune persistance de document
  dans `src/` — la seule sérialisation est celle des presets (`JSON.parse`/
  `JSON.stringify` uniquement dans `src/presets/presetStore.ts:75,86,90,106,113`).
  Portée : `src/`, 138 fichiers `.ts`/`.tsx`, motifs
  `JSON.stringify|JSON.parse|schemaVersion|serialize`.
- **Stories/tests indexant des lignes** : ADR-0003 a déjà posé la règle
  (`rows[0]` = `layers[length-1]`) ; seuls les comptes attendus changent.

---

## 3. Le cas « effet sous la photo de fond »

### 3.1 Ce qu'il rend, techniquement
Un effet sous le fond compose sur la **toile**. Sur une toile noire opaque :
`glow` sur du noir donne du noir, `grain` donne du grain visible. Puis le fond,
opaque et à couverture pleine, se compose en mode normal à opacité 1 et
**recouvre tout** — le calque du dessous ne rend rien de visible.

Ce n'est pas incohérent : c'est ce que fait Photoshop. Le calque redevient
visible dès que le fond a une opacité < 1, un masque, un mode de fusion
non-normal, ou ne couvre plus toute la toile (fond déplacé/réduit — que ce
chantier rend possible). **Aucun cas particulier à écrire.**

### 3.2 La question de sens produit
Elle porte sur **la toile** : *que voit-on là où aucun calque ne couvre ?* Elle
décide aussi ce que l'export écrit.
- **Noir opaque** — cohérent avec l'alpha actuel, export inchangé, coût nul.
- **Damier de transparence** (+ noir à l'export) — attendu venant de Photoshop,
  mais suppose un alpha réellement propagé, ce que la chaîne ne fait pas
  (`shaderCompose.ts:128-133`, court-circuit assumé).
- **Blanc** — arbitraire.

**Recommandation initiale : noir opaque en v1.** Le damier exige de revoir la
propagation d'alpha dans toute la chaîne — chantier à part, sans rapport avec le
besoin.

**TRANCHÉ le 2026-07-28 : damier de transparence.** Antoine a choisi le damier
après avoir vu les trois options rendues côte à côte, en connaissance du coût
annoncé. **Conséquence directe : la propagation d'alpha sort de la section
« Différé » et devient un PRÉALABLE**, la tranche T0 du §6. La recommandation
ci-dessus n'a pas été suivie ; elle reste écrite pour que la raison du surcoût
soit lisible plus tard.

L'export reste opaque : le damier est un rendu d'écran, pas un contenu. Un JPEG
n'a pas de canal alpha — les zones non couvertes sortent en noir à l'export,
comme aujourd'hui. Le damier ne doit JAMAIS être écrit dans le fichier exporté.

### 3.3 Faut-il signaler un calque caché ?
Aucune preuve qu'il le faille **maintenant** : différé, §8.

---

## 4. Coût VRAM

### 4.1 La mesure de référence, relue
`docs/superpowers/specs/2026-07-26-shaderlab-photo-layer-parity-design.md:803-843`,
2026-07-27, RTX 2060 6144 Mo, photos 6240×4160 (26 MP, 99 Mo/texture) :

| Étape | VRAM | Delta |
|---|---|---|
| V0 aucun document | 1341 Mo | — |
| V1 fond chargé | 1808 Mo | +467 |
| V2 +photo 1 | 2129 Mo | +321 |
| V3 +photo 2 | 2289 Mo | +160 |
| V4 +photo 3 | 2375 Mo | +86 |
| V5 +photo 4 (plafond) | **2461 Mo** | +86 |

Pic **40,1 %**, aucun `device.lost`. Le premier import coûte +321 parce qu'il
alloue en plus la cible partagée de `PhotoLayerInputResolver` ; coût marginal
stabilisé **+86 Mo/photo**.

### 4.2 Ce que le changement ajoute
Le fond passe de « texture de base uploadée » à « texture enregistrée dans
`PhotoSourceStore` », **et** la toile reste allouée à sa place :
- Document **sans photo importée** : toile + texture du fond + cible du resolver
  désormais toujours allouée → **+~185 Mo**, V1 ≈ 1993 Mo (~32 %).
- Document **au plafond** : seul le fond est en double → **+~86 Mo**, soit
  ~2547 Mo à 5 calques photo ≈ **41,5 %**.

Ce sont des **estimations arithmétiques sur des deltas mesurés, pas une mesure**.
Le design du 2026-07-26 pose la règle : « jamais extrapolé, toujours re-mesuré »
(`…parity-design.md:834-835`).

### 4.3 Le plafond doit-il bouger ?
**Oui, vers le haut : 4 → 5**, pour ne rien retirer à l'utilisateur. Aucun des
quatre seuils de révision n'est approché (41,5 % contre 80 % ; delta marginal
86 Mo contre 150). Le passage à 5 doit être **mesuré** au protocole existant
avant d'être déclaré acquis — d'où une tranche à part (T4), qui exige la vraie
machine. L'option « ne pas bouger » (4 fond compris, donc 3 imports) est plus
sûre et gratuite mais retire une capacité existante : non recommandée.

### 4.4 Mesure VRAM — FAITE le 2026-07-29 (tranche T4)

> **Statut : MESURÉE. Le plafond `MAX_PHOTO_LAYERS = 5` est validé, il ne
> bouge pas.** L'estimation de §4.2 (~2547 Mo, ≈ 41,5 % au plafond) est
> **confirmée** : mesuré **2597 Mo en moyenne, 42,2 %**.
>
> Relevé par `nvidia-smi --query-gpu=memory.used` (valeur au repos, ≥ 4 s après
> la fin du rendu), sur la machine d'Antoine, **NVIDIA GeForce RTX 2060,
> 6144 Mo** — la MÊME machine et le même outil que le relevé du 2026-07-27,
> donc les deux tableaux sont comparables. App = binaire `tauri dev` déjà
> compilé (`src-tauri/target/debug/shaderlab.exe`) lancé avec
> `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, Vite du
> worktree sur 1420 ; scénario exécuté par le pont de debug dev-only
> (`window.__shaderlabDebug`, `src/App.tsx`) — donc par les MÊMES handlers que
> l'interface.
> Photos : **6 fichiers RÉELLEMENT distincts**, `6240×4160 = 26,0 MP`
> (99 Mo/texture RGBA8), `~/Pictures/2018/2018-01-22/DSCF5152…5157.JPG`. ⚠️ Les
> 6 fichiers de `~/Pictures/vram-test/` et `~/Pictures/shaderlab-export/` ont
> tous le MÊME MD5 (`B99088A6…`) : ce sont six copies d'une seule photo, elles
> ne satisfont pas l'exigence « distincts » du protocole. Ne pas les utiliser.
>
> Rappel de sémantique : depuis T1 le fond EST un calque photo. « V1 fond
> chargé » = 1 calque photo, « V5 » = **5 calques photo** = le plafond.
>
> | Étape | passe 1 | passe 2 | passe 3 | passe 4 | Delta moyen |
> |---|---|---|---|---|---|
> | V0 aucun document | 1316 | 1267 | 1229 | *(invalide)* | — |
> | V1 fond chargé (1 photo) | 2111 | 2108 | 2100 | 2043 | +835 |
> | V2 +photo 1 | 2238 | 2204 | 2095 | 2149 | +81 |
> | V3 +photo 2 | 2307 | 2302 | 2188 | 2246 | +89 |
> | V4 +photo 3 | 2504 | 2520 | 2373 | 2421 | +200 |
> | V5 +photo 4 (**plafond, 5 calques photo**) | **2604** | **2619** | **2483** | **2597** | +96 |
>
> **Pic moyen 2576 Mo = 41,9 % de la VRAM. Aucun `device.lost` sur aucune des
> quatre passes** (guetté par le handler `device.lost` de `gpuContext.ts:48`,
> qui journalise en console, console lue par CDP sur toute la durée) ; aucune
> exception WebView2 ; la fenêtre rend après chaque import.
>
> **Reproductibilité — l'écart entre passes, dit franchement.** Les quatre pics
> V5 s'étalent sur **136 Mo** (2483 à 2619), soit **2,2 points de VRAM**. C'est
> **du même ordre que le coût marginal d'une photo** (~100 Mo). Conséquences
> honnêtes :
> - Le **pic en % est solide** : 40,4 % à 42,6 %, quelle que soit la passe. La
>   comparaison au seuil de 80 % ne dépend pas du bruit.
> - Le **delta par étape n'est PAS résolu** par cette méthode : `nvidia-smi`
>   compte aussi le reste du système, et la ligne de base a dérivé de 87 Mo
>   entre la passe 1 et la passe 3, sans que l'app y soit pour rien. Un
>   raffinement du type « +86 contre +100 Mo par photo » n'est pas mesurable
>   ici et ne doit pas être écrit.
> - Le coût du document au plafond, hors ligne de base (V5 − V0), vaut
>   1288 / 1352 / 1254 Mo sur les trois passes à V0 valide : **1300 Mo ± 50**.
> - La colonne « delta moyen » est une moyenne des quatre passes ; la bosse à
>   V4 (+200) se reproduit sur les QUATRE passes, ce n'est pas du bruit — une
>   allocation paresseuse survient à ce palier. Elle est compensée au pas
>   suivant : sur les 4 imports, le coût marginal moyen est de **96 à 128 Mo
>   par photo** selon la passe, sous le seuil de 150.
> - Passe 4 : sa ligne V0 est **invalide** (le rechargement de page n'avait pas
>   encore démonté le document de la passe précédente — `state()` rendait
>   1 calque là où il en fallait 0). V1→V5 restent cohérents avec les autres
>   passes et sont conservés ; V0 est écarté plutôt que rattrapé.
>
> **Les quatre seuils de révision (§…parity-design.md:911-926), un par un** :
> 1. `device.lost` ou fenêtre qui cesse de rendre à N ≤ 5 photos →
>    **NON franchi.** Aucun sur 4 passes, ni pendant la saturation ci-dessous.
> 2. V5 > 80 % de la VRAM totale → **NON franchi**, et de loin : 42,2 % contre
>    80 %. Marge ≈ 2,3 Go.
> 3. Delta par photo > 150 Mo → **NON franchi** en moyenne sur les imports
>    (96 à 128 Mo/photo). ⚠️ Le pas V3→V4 dépasse ponctuellement (185 à
>    218 Mo) sur les quatre passes ; il est compensé au pas suivant et le total
>    reste conforme. Signalé, pas ignoré : voir « ce que la mesure ne couvre
>    pas ».
> 4. V5 < 60 % et aucun incident → **atteint** (42,2 %) : le plafond POURRAIT
>    encore monter. Il ne monte pas dans cette tranche — la règle est « jamais
>    extrapolé, toujours re-mesuré », et monter à 6 exigerait une nouvelle
>    mesure à 6.
>
> **Décision : `MAX_PHOTO_LAYERS` reste à 5**, `MAX_REGISTERED_PHOTO_SOURCES`
> reste à `4 × 5 = 20`. Aucune constante ne change : la mesure confirme
> l'estimation à ~1 point près (41,5 % estimé, 42,2 % mesuré).
>
> **Étape 6 du protocole — saturation de `MAX_REGISTERED_PHOTO_SOURCES`,
> jamais mesurée jusqu'ici.** Document au plafond, puis remplacements d'image
> successifs sur le calque du haut (chaque remplacement enregistre une source
> neuve sans ajouter de calque — même mécanisme d'accumulation que la boucle
> importer/annuler du protocole, et pilotable par le pont de debug qui n'expose
> pas l'undo) :
> - la garde lève **exactement à 20/20**, au 16ᵉ remplacement (5 sources du
>   document + 15 remplacements acceptés), par le bandeau d'erreur : « Trop de
>   photos importées dans cette session (20/20)… ». Pas de crash.
> - **Vmax = 4168 Mo = 67,8 % de la VRAM.** Aucun `device.lost`.
> C'est le VRAI pire cas atteignable dans les gardes actuelles, et il est bien
> plus haut que le pic du plafond de calques (42 %). Sous 80 %, donc conforme,
> mais **sans grande marge sur un GPU de 6 Go, et hors budget sur un GPU de
> 4 Go**. À rouvrir si le plafond de calques monte : `MAX_REGISTERED_PHOTO_
> SOURCES` en dérive, donc 6 calques feraient 24 sources ≈ 5 Go.
>
> Scripts : `scratchpad/mesure-vram-t4.mjs` et `mesure-vram-t4-vmax.mjs` (hors
> dépôt, jetables — le pont de debug, lui, est dans le dépôt et réutilisable).

### 4.5 Mesure VRAM à TOILE ≠ PHOTO — FAITE le 2026-07-30 (tranche T3 du design 2026-07-29)

> **Statut : MESURÉE. Aucune constante ne bouge — `MAX_PHOTO_LAYERS = 5`,
> `MAX_REGISTERED_PHOTO_SOURCES = 20`, `MAX_CANVAS_PIXELS = 64 Mpx.** Mais ce
> n'est pas le même « rien ne bouge » qu'en §4.4 : là, la marge était large ;
> ici, elle est presque épuisée, et la hausse que §4.4 laissait ouverte est
> **réfutée**, pas seulement non prouvée.
>
> **Pourquoi une mesure de plus.** §4.4 mesurait toile ≡ photo. Depuis la tranche
> T2 du design 2026-07-29, la toile peut être plus grande que la photo, et c'est
> elle qui porte la majorité des textures pleine taille (§5.1 de ce design-là).
> Toutes les mesures antérieures mesuraient donc un autre produit.
>
> **Machine, scénario, photos.** Même machine que §4.4 — **NVIDIA GeForce
> RTX 2060, 6144 Mo** (`nvidia-smi --query-gpu=name,memory.total`). Toile
> **libre 8000 × 8000 = 64,0 Mpx**, le plafond nommé, donc strictement plus
> grande que les photos ; la dimension de toile est relevée à chaque étape sur le
> vrai `<canvas>` du document, elle ne fait pas partie des hypothèses. Photos
> **6240 × 4160 = 26,0 Mpx**, toutes **distinctes vérifiées par MD5 du contenu**
> (le script dédoublonne et journalise ce qu'il écarte) : `DSCF5152…5160` de
> `~/Pictures/2018/2018-01-22`, `DSCF5161…5172` de `…/2018-01-25`, plus
> `vram-test/photo-1.jpg`. Écartés parce que doublons : `DSCF5169-edited.JPG`
> (= `-edited-2`), et `photo-2/3/4.jpg` (tous `B99088A6…`, cf. l'avertissement de
> §4.4). **Le vivier de contenus réellement distincts de la machine est de 24,
> pas plus** — cette limite a une conséquence, dite plus bas.
>
> **⚠️ L'INSTRUMENT A DÛ CHANGER, et c'est le fait le plus important de cette
> mesure.** `nvidia-smi --query-gpu=memory.used` compte le GPU entier. Pendant
> cette session, d'autres applications d'Antoine en tenaient 1,6 à 3,5 Go
> (Chrome seul : 1710 Mo, relevé par `\GPU Process Memory(*)\Dedicated Usage`) —
> contre ~1250 Mo de ligne de base en §4.4. La première passe l'a rendu visible
> au lieu de le cacher : elle a mesuré **V4 = 4123 Mo contre V3 = 4379 Mo, en
> AJOUTANT une photo**. Un document qui grossit ne peut pas consommer moins ;
> c'était l'instrument, pas le produit — WDDM évinçait sous la pression.
> Instrument retenu à la place, pour la part de l'application :
> `\GPU Process Memory(pid_<gpu-process WebView2>)\Total Committed`, qui compte
> ce que le process a alloué, résident ou paginé. `Dedicated Usage` a été essayé
> et **rejeté** : il ne compte que le résident, et il a rendu 1203 puis 2348 Mo
> pour le MÊME document à quatre minutes d'intervalle. `Total Committed`, lui,
> rend 2644 à 2648 Mo sur cinq relevés d'un état figé (± 3 Mo).
>
> **L'instrument neuf est raccordé à l'ancien, sinon les deux mesures ne seraient
> pas comparables.** Passe de contrôle exécutée le même jour, même script, seule
> la toile changée pour la ramener à ≡ photo (6240 × 4160) : coût du document à
> 5 calques = **1275 Mo**. §4.4 mesurait **1300 Mo ± 50** pour cette même
> configuration, à `nvidia-smi`. Les deux instruments concordent ; les tableaux
> ci-dessous sont donc lisibles avec le seuil de §4.4.
>
> | Scénario | toile | calques photo | sources | app `Total Committed` | coût du document (− V0) |
> |---|---|---|---|---|---|
> | Contrôle (raccord à §4.4) | 26,0 Mpx | 5 | 5 | 1452 | **1275** |
> | A, passe 3 | 64,0 Mpx | 5 | 5 | 2723 | 2597 |
> | A, passe 4 | 64,0 Mpx | 5 | 5 | 2475 | 2393 |
> | B, passe 1 — pire cas | 64,0 Mpx | 5 | **20/20** | 4108 | 4004 |
> | B, passe 2 — pire cas | 64,0 Mpx | 5 | **20/20** | 4108 | 4000 |
> | C, nominal à 6 calques | 64,0 Mpx | **6** | 6 | 2576 | 2475 |
> | C, pire cas à 6 calques | 64,0 Mpx | **6** | 23/24 | 4386 | 4285 |
>
> **Ce que ça dit, dans l'ordre d'importance.**
> 1. **La toile double le coût du document.** 1275 Mo à 26 Mpx, 2393 à 2597 Mo à
>    64 Mpx (2,5× la surface). Le facteur de sûreté ×1,5 du calibrage de
>    `MAX_CANVAS_PIXELS` n'était ni de trop ni excessif.
> 2. **Le pire cas des sources est reproductible au mégaoctet** : 4108 Mo sur les
>    deux passes B, garde levée **exactement à 20/20**, au 16ᵉ remplacement, par
>    le bandeau « Trop de photos importées dans cette session (20/20)… ». Même
>    comportement qu'en §4.4, coût presque doublé (4004 contre ~2900 Mo).
> 3. **Le cas nominal à 6 calques ne coûte presque rien : +82 Mo.** C'est le
>    piège de ce plafond, et la raison pour laquelle une mesure qui s'arrête au
>    plafond de CALQUES ne prouve rien.
> 4. **C'est le pire cas des sources qui décide**, parce que
>    `MAX_REGISTERED_PHOTO_SOURCES` dérive du plafond de calques : 6 calques ⇒ 24
>    sources ⇒ **4386 Mo**, mesuré à 23 sources sur 24.
>
> **Rapporté au seuil de §4.4** (V5 en % de la VRAM totale). La ligne de base
> système de §4.4 vaut ~1170 Mo (son V0 de 1229–1316 Mo, moins ~100 Mo
> d'application au repos, mesurés ici) :
> - A, nominal 5 calques : 1170 + 2495 ≈ 3665 Mo ≈ **60 %**.
> - **B, pire cas 5 calques : 1170 + 4002 ≈ 5172 Mo ≈ 84 %** — contre 67,8 % à
>   toile ≡ photo.
> - C, nominal 6 calques : ≈ 3645 Mo ≈ **59 %**.
> - **C, pire cas 6 calques : 1170 + 4285 ≈ 5455 Mo ≈ 89 %.**
>
> **Les quatre seuils de révision, un par un.**
> 1. `device.lost` ou fenêtre qui cesse de rendre → **NON franchi**, sur aucune
>    des sept passes, ni à 6 calques, ni sources saturées. Guetté par le handler
>    de `gpuContext.ts:48`, console lue par CDP sur toute la durée ; aucune
>    exception WebView2 non plus.
> 2. > 80 % de la VRAM → **NON franchi dans le cas nominal** (60 %),
>    **FRANCHI dans le pire cas des sources** : ~84 % à 5 calques, ~89 % à 6.
> 3. Delta par photo > 150 Mo → **FRANCHI à 64 Mpx** : (V5 − V1) / 4 vaut 162 à
>    223 Mo/photo selon la passe, contre 96 à 128 Mo à toile ≡ photo. La bosse à
>    V4 se reproduit sur toutes les passes, comme en §4.4.
> 4. < 60 % et aucun incident → le cas nominal y est tout juste (60 %), mais le
>    pire cas ne l'est pas. **« Le plafond pourrait encore monter », que §4.4
>    laissait ouvert, est donc RÉFUTÉ** — et il l'est par une mesure à 6, pas par
>    un raisonnement.
>
> **Décision.** `MAX_PHOTO_LAYERS` **reste 5** — décidé par le pire cas à 6
> calques (~89 %), pas par le cas nominal, qui passait.
> `MAX_REGISTERED_PHOTO_SOURCES` **reste 20**, il dérive. `MAX_CANVAS_PIXELS`
> **reste 64 Mpx** : son critère écrit dit « descend au-delà de 90 %, peut monter
> sous 70 % » et le pire cas mesuré vaut ~84 % — ni l'un ni l'autre.
> **Corollaire acquis, qui est le vrai gain de cette tranche** : les deux
> plafonds sont désormais COUPLÉS par le pire cas des sources. Aucun des deux ne
> peut monter sans que l'autre descende, et ça se mesure, ça ne se calcule pas.
>
> **Ce que la mesure NE couvre PAS, dit franchement.**
> - **Le pire cas absolu à 6 calques n'a pas été atteint** : 23 sources sur 24,
>   parce que la machine ne contient que 24 contenus JPEG distincts et que 6
>   servaient déjà de calques. La 24ᵉ source aurait ajouté ~99 Mo (une texture
>   26 Mpx), soit ~90 % au lieu de ~89 % — mais **c'est un calcul, pas une
>   mesure**, et le verdict ne repose pas sur lui : 89 % dépasse déjà 80 %.
> - **Les pourcentages sont DÉRIVÉS, pas relevés.** La part de l'application est
>   mesurée ; la ligne de base système est celle de §4.4, reprise parce que la
>   machine était trop chargée ce jour-là pour en produire une comparable. Aucune
>   passe n'a été faite sur une machine au repos, et ça n'a pas été tenté : les
>   applications qui tenaient la VRAM étaient celles d'Antoine (Blender, Chrome,
>   Photos), tuer un process qu'on n'a pas lancé n'est pas à la main de l'agent.
>   **À refaire sur une machine au repos si un jour la décision se joue à
>   quelques points** — ici elle se joue à quatre points au-dessus d'un seuil,
>   dans le sens qui ne change pas la conclusion.
> - **Aucun masque n'a été peint** pendant ces mesures, comme en §4.4 : les
>   allocations résidentes de `MaskTextureResolver` restent non dénombrées, et
>   elles sont proportionnelles à la TOILE, donc 2,5× plus grosses qu'avant T2.
>   C'est le premier endroit où chercher si un incident VRAM apparaît à l'usage.
> - Le pont de debug ouvre et importe par les MÊMES handlers que l'interface,
>   mais il n'exerce ni l'export, ni l'undo, ni un enchaînement de documents.
>
> Script : `scratchpad/mesure-vram-t3.mjs` (hors dépôt, jetable). Il porte le
> `openByPath(path, canvasFormat)` du pont de debug, qui est la seule pièce de
> ce dispositif à vivre dans le dépôt (`src/App.tsx`) : sans le paramètre de
> format, aucun scénario toile ≠ photo n'est atteignable sur la vraie fenêtre.

---

## 5. Migration

- **Documents.** Aucune persistance n'existe (§2.11). Rien à migrer.
- **Presets.** **Format intact** — un preset n'a jamais contenu de calque photo
  (`presetDocument.ts:16-20`) : aucun fichier existant ne devient invalide,
  `PRESET_SCHEMA_VERSION` ne bouge pas. Le **chemin d'application** casse (§2.3)
  et doit être corrigé : c'est du code, pas une conversion de données.
- **Session en cours.** Sans objet : le changement arrive par un build.

**Aucun convertisseur à écrire.**

---

## 6. Découpage en tranches verticales

Six tranches depuis l'arbitrage du damier (§3.2). T0 est un préalable ajouté par
ce choix ; T1 reste le cœur ; T2/T3/T4/T5 sont indépendantes entre elles ⇒ DAG
justifié.

### T0 — Propagation de l'alpha dans la chaîne de compositing
**bloqué_par :** — · **type : AFK**

Préalable créé par le choix du damier. Aujourd'hui le composite propage `color.a`
depuis le bas de chaîne par un court-circuit qui se documente lui-même comme
conditionnel (`src/render/shaderCompose.ts:128-133`) : l'alpha n'est pas
réellement composé, il est hérité. Un damier exige de savoir, par pixel, si
quelque chose couvre — donc un alpha juste.

Portée : composition de l'alpha au même titre que la couleur dans la passe de
compositing ; toile effacée en **alpha 0** au lieu de 1 (ce qui contredit §1.2 —
la contrainte « alpha 1 » n'était dictée QUE par l'export) ; damier rendu à
l'affichage, jamais dans la texture exportée.

**Piège à ne pas rater, c'est le cœur de cette tranche** : l'export encode via
`putImageData` + `convertToBlob` (`src/export/exportImage.ts:48-55`). Un alpha 0
qui arrive jusque-là produit un **JPEG entièrement noir, en silence** (§2.2). La
séparation « alpha à l'écran / opaque à l'export » doit être explicite et testée,
pas implicite.

**Done =** une zone non couverte affiche le damier à l'écran ET sort en noir dans
le JPEG exporté ; comparaison d'export avant/après sur un document dont le fond
couvre toute la toile → identique au pixel près. Preuve : CDP sur la vraie
fenêtre + comparaison d'export.

### T1 — La toile et le calque de fond
**bloqué_par : T0** · **type : HITL** (la preuve exige la vraie fenêtre WebView2)

`ImageFrameResources` (toile allouée + effacée **alpha 1**, plus d'upload) →
dimensions explicites au lieu de `sourceTexture.width` → `openFile` enregistre le
fond dans `PhotoSourceStore` et pousse le calque → `sourceColor()` re-pointé sur
le calque photo le plus bas → `LayerPanel` perd `backgroundName` et rend le fond
comme ligne ordinaire → `MAX_PHOTO_LAYERS` porté à 5 (provisoire, mesuré en T4).

**Indivisible** : à l'instant où la texture de base cesse d'être la photo, tout
doit suivre, sinon l'écran est noir.

**Done =** le document s'ouvre et rend exactement comme avant (comparaison
d'export avant/après) ; la ligne de fond est sélectionnable, masquable,
déplaçable ; un effet déposé sous le fond ne change rien au rendu ; un masque de
luminosité fonctionne toujours. Preuve : CDP sur la vraie fenêtre + checkpoint
visuel.

### T2 — Remplacer l'image d'un calque photo
**bloqué_par : T1** · **type : AFK**
`LayerStack.setLayerImageSource(id, sourceId)` + enregistrement d'une nouvelle
source + action dans le panneau Photo + entrée d'historique. Répond à « remplacer
le fond sans perdre le travail », et vaut pour tout calque photo.
**Done =** remplacer l'image du fond conserve pile, masques et historique ;
annuler restaure l'image précédente.

### T3 — Guide edge-aware et epoch
**bloqué_par : T1** · **type : AFK**
Corrige l'hypothèse « index 0 = guide stable » (§2.6). **Done =** test Node sur
`FramePipelineExecutor` verrouillant l'epoch attendue pour le fond et le calque
au-dessus ; pas de reconstruction SAT à chaque frame quand rien ne change.

### T4 — Plafond et mesure VRAM — **FAITE le 2026-07-29**
**bloqué_par : T1** · **type : HITL**
Re-mesure au protocole de `…parity-design.md` avec 5 calques photo ; fixe
`MAX_PHOTO_LAYERS` et `MAX_REGISTERED_PHOTO_SOURCES` sur la mesure.
**Done =** encadré de mesure rempli, aucun seuil franchi, ou plafond descendu.
**Résultat : §4.4.** Pic mesuré 42,2 % (estimé 41,5 %), aucun `device.lost`,
aucun des quatre seuils franchi → `MAX_PHOTO_LAYERS` reste à **5**, aucune
constante modifiée.

### T5 — Presets et fond
**bloqué_par : T1** · **type : AFK**
Application de preset qui préserve les calques photo ; `SkipNotice` qui cesse de
signaler le fond. **Done =** appliquer un preset ne fait pas disparaître la
photo ; enregistrer un preset n'affiche plus d'avis parasite.

### Vagues
- **Vague 0** : T0.
- **Vague 1** : T1.
- **Vague 2** : T2, T3, T4, T5 en parallèle.

---

## 7. Arbitrages — tranchés le 2026-07-28

Les trois premiers ont été posés à Antoine avec un rendu en face pour le n°1
(règle du mockup avant toute question de goût). Réponses telles que données.

1. **Que montre la toile là où rien ne couvre ?** → **Damier de transparence.**
   La recommandation était le noir opaque ; Antoine a choisi le damier en
   connaissance du surcoût. Crée la tranche T0 (§6) et sort la propagation
   d'alpha du différé (§8). L'export reste opaque. Détail : §3.2.

2. **Le fond garde-t-il un statut spécial ?** → **Calque ordinaire, MAIS avec un
   verrou disponible.** Verbatim : « 1 mais il faut l'option cadenas visible ».
   Lecture retenue : le fond n'est plus verrouillé *par défaut* — il est
   supprimable, masquable, déplaçable, duplicable comme tout calque — et un
   **verrouillage manuel par calque** est offert, avec le cadenas visible sur la
   ligne quand il est actif. Le verrou devient donc une propriété de calque
   ordinaire (utilisable sur n'importe quel calque, pas seulement le fond), pas
   un statut d'arrière-plan. C'est ce qui évite de réintroduire le cas
   particulier par l'UI tout en gardant le garde-fou contre la suppression
   accidentelle.
   **Portée ajoutée à T1** : champ `locked` sur `LayerState`, respect du verrou
   par les mutateurs de `LayerStack` (suppression, réordonnancement, édition),
   affordance de (dé)verrouillage et cadenas dans la ligne du panneau.
   Le cadenas existe déjà comme marque visuelle sur la ligne d'arrière-plan
   dérivée (`src/components/LayerPanel.tsx:502`) : il change de sens — de
   « statut immuable » à « verrou posé par l'utilisateur » — au lieu de
   disparaître.

3. **Capacité** → **5 au total, soit 4 imports + le fond.** Ne retire aucune
   capacité actuelle. `MAX_PHOTO_LAYERS = 5`, `MAX_REGISTERED_PHOTO_SOURCES = 20`.
   Le chiffre de 41,5 % de VRAM reste une **estimation** : T4 le mesure, et le
   plafond descend si la mesure dément (§4.3).

4. **Signaler un calque recouvert par un calque opaque ?** Non posé — tranché sur
   la recommandation : **non en v1**, différé avec son déclencheur (§8).

---

## 8. Différé — avec déclencheur de réouverture nommé

- **Toile 1×1 au lieu de pleine taille** (~99 Mo économisés à 26 MP).
  Techniquement sûr : les cibles de passes internes sont dimensionnées sur la
  taille du document, pas sur la texture d'entrée
  (`src/render/effectPassRunner.ts:101-102`), et un échantillonnage
  `clamp-to-edge` d'une texture 1×1 rend une constante partout. Exige la
  correction de §1.4, livrée en T1. **Déclencheur** : la mesure T4 dépasse 50 %
  de la VRAM, ou le plafond doit descendre.
- **Taille de toile indépendante de toute photo** (recadrer le document, toile
  plus grande que le fond). Rendu possible par T1, non demandé. **Déclencheur** :
  demande explicite de recadrage de document.
- **Indicateur « calque recouvert »**. **Déclencheur** : Antoine signale avoir
  perdu du temps sur un calque invisible.
- ~~**Alpha réellement propagé** dans la chaîne de compositing (préalable au
  damier).~~ **N'EST PLUS DIFFÉRÉ.** Son déclencheur — « arbitrage n°1 tranché en
  faveur du damier » — s'est produit le jour même de la rédaction. Devenu la
  tranche **T0** (§6). Conservé barré plutôt que supprimé : un différé dont le
  déclencheur se déclenche immédiatement est un signal sur la façon dont il avait
  été estimé.

---

## 9. Alternatives écartées

### 9.1 Garder le fond hors pile et se contenter d'améliorer l'écrêtage
**Insuffisant — et, pour l'essentiel, sans objet.**
L'argument décisif n'est pas le coût mais l'inutilité : **un effet écrêté sur le
fond ne ferait rien**. L'écrêtage borne le poids de compositing par la couverture
de la base (`shaderCompose.ts:109-113`) ; tant que le fond couvre toute la toile,
cette couverture vaut 1 partout — écrêter au fond est l'identité. Et un effet
placé en bas de pile s'applique **déjà** exactement au fond seul, puisque rien
n'est en dessous.
L'écrêtage sur le fond ne devient utile qu'à partir du moment où le fond peut ne
plus couvrir toute la toile — c'est-à-dire quand le fond est un calque. La
prétendue alternative est une conséquence de la décision qu'elle prétend éviter.
Elle ne répond ni à « mettre un effet sous le fond » (le pipeline part de la
texture source) ni à « déplacer le fond dans la chaîne ».

### 9.2 Recharger l'image sans toucher à la pile (le fallback bon marché)
Honnêtement nommée parce qu'elle est **beaucoup** moins chère : recharger
`ImageFrameResources` sans appeler `replaceDocument` répondrait à **une** des
trois douleurs — « remplacer le fond sans perdre le travail » — pour environ une
tranche au lieu de cinq. Elle ne répond pas aux deux autres et **entre en
collision** avec le chantier : elle installerait un second chemin de remplacement
d'image à retirer plus tard. **À retenir uniquement si Antoine veut le
soulagement immédiat et diffère le reste.** Sinon, T2 la rend gratuite et
cohérente.

### 9.3 Type de calque distinct ou flag `isBackground`
Écarté : recrée dans le modèle le statut spécial qu'on supprime, et oblige à
auditer un par un les 13 sites qui testent `imageSource !== undefined` (§1.1).

### 9.4 Supprimer la texture de base et démarrer sur le premier calque photo
Écarté : information leakage (l'exécuteur devrait connaître la nature et la
couverture de son premier calque), et deux cas particuliers immédiats — pile vide
et premier calque = effet.

### 9.5 Ligne d'arrière-plan « faussement réordonnable »
Écarté sans discussion : le glisser-déposer déplacerait un objet qui n'existe pas
dans le modèle.

---

## 10. AUTO-VÉRIFICATION

État lu sur disque le 2026-07-28, branche `master`.

| Affirmation | Preuve |
|---|---|
| Le document n'est pas un `LayerState` (état actuel) | `src/layers/documentName.ts:5-7`, `src/layers/photoLayer.ts:3-7`, `src/components/LayerPanel.tsx:42-45` |
| La ligne de fond est dérivée, sans `data-layer-row-index` | `src/components/LayerPanel.tsx:486-512` |
| Ouvrir un document remplace la pile par une pile vide | `src/App.tsx:276-277`, `src/application/documentSession.ts:33-37` |
| Le pipeline part de `sourceTexture` | `src/render/framePipelineExecutor.ts:230` |
| La taille de toile est lue sur la texture source | `src/render/framePipelineExecutor.ts:294` |
| Le composite propage `color.a` du bas de chaîne | `src/render/shaderCompose.ts:133`, commentaire `:128-132` |
| L'export encode via `putImageData`/`convertToBlob` | `src/export/exportImage.ts:48-55` |
| Les masques paramétriques échantillonnent la texture source | `src/render/maskTextureResolver.ts:146`, `:458` ; injection `src/render/renderer.ts:214` |
| `guideEpoch` vaut 0 pour l'index 0 | `src/render/framePipelineExecutor.ts:345`, `:376-378` |
| Appliquer un preset remplace la pile entière | `src/App.tsx:993-996` |
| `capture` exclut les calques photo avec un `SkipNotice` | `src/presets/presetDocument.ts:16-20` |
| `MAX_PHOTO_LAYERS = 4`, le fond n'y compte pas | `src/layers/photoLayer.ts:27`, `:29-31`, commentaire `:3-7` |
| `MAX_REGISTERED_PHOTO_SOURCES = 4 × MAX_PHOTO_LAYERS` | `src/render/photoSourceStore.ts:51` |
| L'invariant du partage de cible est l'ordre des passes, pas l'unicité | `src/render/photoLayerInput.ts:72-87` |
| `setLayerClip` refuse un calque photo | `src/layers/layerStack.ts:134-141` |
| `clipBaseId` accepte tout calque portant `imageSource` comme base | `src/layers/clipping.ts:37-46` |
| L'écrêtage borne le poids par la couverture | `src/render/shaderCompose.ts:109-113` |
| Les cibles de passes internes sont dimensionnées sur le document | `src/render/effectPassRunner.ts:101-102` |
| `PhotoSourceStore` ne libère qu'au changement de document | `src/render/photoSourceStore.ts:148-156` |
| Un calque photo porte un `effectId` changeable | `src/layers/layerStack.ts:109-116` |
| Mesure VRAM : pic 40,1 %, +86 Mo par photo | `docs/superpowers/specs/2026-07-26-shaderlab-photo-layer-parity-design.md:803-843` |
| Aucune persistance de document ; seule sérialisation = presets | balayage `src/`, 138 fichiers `.ts`/`.tsx`, motifs `JSON.stringify\|JSON.parse\|schemaVersion\|serialize` → correspondances uniquement dans `src/presets/` (`presetStore.ts:75,86,90,106,113`, `presetTypes.ts:14`, `presetImportValidation.ts:27-33`, `presetDocument.ts:33,62,98`) |

**Non vérifié, explicitement :**
- Les chiffres VRAM du §4.2 sont des **estimations** dérivées des deltas mesurés
  le 2026-07-27, pas une mesure. T4 existe pour ça.
- Aucun rendu n'a été observé : ce document n'affirme aucun comportement visuel
  constaté, seulement des conséquences dérivées du code lu.
- La forensics de co-changement git n'a pas été relancée pour ce document.
