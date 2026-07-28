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

### T4 — Plafond et mesure VRAM
**bloqué_par : T1** · **type : HITL**
Re-mesure au protocole de `…parity-design.md` avec 5 calques photo ; fixe
`MAX_PHOTO_LAYERS` et `MAX_REGISTERED_PHOTO_SOURCES` sur la mesure.
**Done =** encadré de mesure rempli, aucun seuil franchi, ou plafond descendu.

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
