# Audit pré-release — performance & architecture — shaderlab

> Date : 2026-07-30. Branche `master` à `9c70327`, working tree propre, rien à
> pousser. Audit en LECTURE SEULE : aucun fichier de `src/` n'a été modifié.
> Conduit en boucle : une passe de findings, puis une passe de RÉFUTATION
> adverse, puis consolidation. Chaque preuve retenue a été rouverte par l'agent
> principal, pas reprise d'un sous-agent sur parole.

## 0. Santé de base — mesurée, pas déclarée

| Contrôle | Commande | Résultat |
|---|---|---|
| Types | `npx tsc --noEmit` | `TypeScript: No errors found` |
| Tokens design | `npm run lint:tokens` | `Findings: 0`, **170 fichiers balayés** |
| Tests unitaires | `npm run test` | **1028 tests / 86 fichiers**, tous verts |
| Shaders GPU | `npm run test:gpu-shaders` | **64 shaders composés compilés, 1 garde d'exclusion, 0 en échec** (nvidia turing, 6 effets, 11 modes de fusion) |
| Rendu (pixels) | `npm run test:render` | **10 scénarios, aucun écart** contre les références versionnées ; chaque scénario prouve aussi qu'il montre ce qu'il prétend montrer |

Le balayage tokens est prouvé non nul (170 fichiers). `test:gpu-shaders` et
`test:render` exigent l'app en marche avec CDP 9222 et un Vite du worktree
courant sur 1421 — les deux ont été lancés pour cet audit.

## 0 bis. Ce que la passe de réfutation a changé

Cinq findings sont sortis de la première passe classés HAUTE. **Aucun n'a
survécu à HAUTE.** Le détail est dans chaque entrée ; le résumé :

| Finding | Annoncé | Retenu | Motif |
|---|---|---|---|
| Frontière fichier Rust non confinée | HAUTE | **BASSE** | CSP `'self'`, aucun vecteur d'injection, pas d'élévation de privilège |
| Erreurs GPU muettes en prod | HAUTE | **MOYENNE** | Le cas fatal EST remonté ; c'est une décision documentée, pas un oubli |
| Rejet flottant « Ouvrir avec » | HAUTE | **BASSE** | La commande Rust ne peut pas `Err` ; seul un IPC cassé rejetterait |
| Formule sRGB dupliquée | HAUTE | **MOYENNE** | Dérive DRY réelle, mais trois lignes de maths sans frontière de module |
| Churn d'allocations SAT | HAUTE | **BASSE** | Chemin désactivé par défaut, ressources libérées, régime jamais mesuré |

C'est le résultat le plus utile de cet audit : **la base est plus saine que la
première passe ne le laissait croire.** Deux findings portaient en outre un fix
faux, corrigé ci-dessous.

## 1. Findings — ARCHITECTURE

### A1 — HAUTE — `App.tsx` a 2,68× la taille que sa propre documentation lui prête

Seul finding qui reste HAUTE après réfutation, parce qu'il est purement factuel.

**Théorie.** `ARCHITECTURE.md` documente `App.tsx` comme une dette connue à 727
lignes et prescrit un remède : chaque feature apporte son propre hook module,
pour qu'`App.tsx` ne gagne que du câblage. Le remède a été appliqué à
`usePhotoLayer`/`usePresets` et à rien d'autre depuis.

**Preuve** (recomptée à la main) :
- `wc -l src/App.tsx` → **1951**
- `ARCHITECTURE.md:58` — `src/App.tsx — COMPOSITION ROOT (727 lignes, cf. §7 dette)`
- `ARCHITECTURE.md:540` — R6, même chiffre de 727
- `ARCHITECTURE.md:4` — le document se tamponne « état lu sur disque le 2026-07-25 », alors que son § 4.6 a été réédité le 2026-07-30 sans que R6 soit revu
- Logique restée inline malgré R6 : gating d'écrasement de preset `App.tsx:1090-1105`, écriture de preset `App.tsx:1107-1209`, échantillonnage colorimétrique `App.tsx:870-899`, cinq `<Dialog>` complets `App.tsx:1737-1947`

**Conséquence.** ~1500 lignes de logique de préconditions (preset, export, tracé
de masque) n'ont pour seule frontière de vérification que le checkpoint visuel
humain. Un agent ne peut pas y détecter une régression sans session CDP.

**Fix.** Extraire le sous-système presets (`gateOnPhotoLayers`, les fonctions
`request*`/`commit*`, les trois dialogues associés) dans un `usePresetWorkflow`,
sur le modèle de `usePhotoLayer`. Puis remettre R6 au chiffre réel.

### A2 — MOYENNE (rétrogradé de HAUTE) — formule sRGB→linéaire dupliquée

**Théorie.** Le projet possède une fonction canonique testée dont le commentaire
dit vouloir empêcher toute seconde formule. `App.tsx` la recopie.

**Preuve** (les deux fichiers rouverts) :
- `srgbTransfer.ts:19-28` — « pas de seconde formule qui puisse dériver », puis `srgbToLinear(c)` avec `Math.max(c, 0)`, **entrée attendue 0..1**
- `App.tsx:887-890` — `toLinear` recopié, **entrée 0..255**, avec un `/255` en tête
- `App.tsx:891` l'applique à `pixel[0..2]`, sortie brute de `getImageData`, donc des octets

**Pourquoi MOYENNE et non HAUTE** : c'est trois lignes de mathématique pure, sans
frontière de module en jeu. La dérive DRY est réelle, la menace structurelle non.

**⚠️ PIÈGE DU FIX — le fix évident est faux.** Remplacer par
`srgbToLinear(pixel[0])` supprime le `/255` en silence : on calculerait
`Math.pow((128 + 0.055)/1.055, 2.4) ≈ 5,6·10⁴` au lieu de `≈ 0,216`.
`Math.max(c, 0)` ne rattrape pas, aucun test ne rougit (le pipeline WGSL est
intact), et les échantillons `colorRange` saturent sans erreur. Le seul fix
correct est **`srgbToLinear(pixel[0] / 255)`** — la normalisation reste chez
l'appelant, elle ne fait pas partie de la fonction de transfert.

### A3 — MOYENNE — le bloc AUTO-VÉRIFICATION d'`ARCHITECTURE.md` est périmé

Voir la preuve de A1. Document maintenu par endroits, pas dans son ensemble. Un
agent qui lit R6 pour arbitrer « refactor `App.tsx` ? » sous-estime le problème
d'un facteur 2,68.

**Fix.** Ré-exécuter le § 9 en entier — recompter les lignes réelles de tous les
fichiers cités — à la prochaine passe qui touche ce document.

## 2. Findings — PERFORMANCE

Cadre : le plan `2026-07-30-shaderlab-performance.md` a fermé sa boucle en P0
(cible tenue en production, 6,9 ms contre 16,7 visés). P1 à P5 nomment des
gaspillages réels laissés en confort.

### P-A — BASSE (rétrogradé de HAUTE) — churn d'allocations dans la construction SAT

**Le fait est réel, sa portée ne l'est pas.**

**Preuve du gaspillage** (rouverte) :
- `maskTextureResolver.ts:842-847` — `uniform()` fait `createBuffer` à chaque appel
- `maskTextureResolver.ts:838` — `createBindGroup` à chaque invocation ; seul le `pipeline` est mis en cache
- `maskTextureResolver.ts:852-866` — `buildSat()` boucle `ceil(log2(2048)) = 11` fois en H puis en V
- Trois `buildSat` par passe edge-aware : `:875`, `:879`, `:890`

**Recompte.** Le chiffre de la première passe (~90 allocations) **sous-estimait** :
23 passes et 22 uniformes par `buildSat`, ×3, plus 4 uniformes isolés
(`:886, 888, 891, 892`) ≈ **73 buffers et ~79 bindGroups, soit ~150 allocations**.

**Pourquoi BASSE malgré ça** — trois raisons vérifiées indépendamment :
1. **Le chemin est désactivé par défaut.** `edgeAware: false` dans le constructeur d'état (`src/mask/types.ts:18`), et `maskTextureResolver.ts:671,680` : `const active = x.edgeAware && x.edgeStrength > 0;` puis `if (!active) return input;`. S'ajoute le garde `:757` (`if (!needsGuide && !needsAB) return w.result;`) : coût par **invalidation**, pas par frame.
2. **Aucune fuite.** `p.push(b)` (`:845`, `:941`) alimente `pendingDestroy`, drainé à `framePipelineExecutor.ts:199` et `:564`.
3. **La ligne de base classe ce cache précis en « propre — à ne pas toucher »** (baseline §5, citant `maskTextureResolver.ts:749-757`), et déclare le régime edge-aware **jamais mesuré**.

Un coût non mesuré sur un chemin non mesuré et désactivé par défaut est
exactement ce que `rules/audit/performance.md` classe « optimisation non
fondée ». **À ne pas corriger avant d'avoir mesuré le régime edge-aware.**

**⚠️ PIÈGE DU FIX.** Mutualiser les uniformes en un buffer persistant est faux
tel quel : les 22 valeurs de `2**k` d'un `buildSat` sont consommées par des
passes encodées dans le **même** `GPUCommandEncoder`, non encore soumis.
Réécrire un buffer unique entre deux `beginRenderPass` écraserait la valeur de la
passe précédente. Il faut un buffer par étape avec offsets dynamiques, ou une
constante de spécialisation WGSL.

### P-B — BASSE — même motif dans `refine()`

`maskTextureResolver.ts:935-947` — `u()` fait un `createBuffer` par passe du plan
de morphologie (`planRefine`, `:955-964`). Plan borné à ~2-6 passes. Même
réserve, même piège de fix.

### Faux positifs écartés (vérifiés — à ne pas re-signaler)

Deux gaspillages que la baseline décrit comme non couverts par P1-P5 **ont déjà
été corrigés** le même jour, après sa rédaction :
- Boucle d'overlay au repos → plafond `OVERLAY_ANIMATION_FPS=15` + garde `visibilityState` (`src/render/overlayAnimationLoop.ts:41-91`)
- Rendu React de l'arbre entier par `pointermove` → `scheduleSync()` coalescé rAF (`src/hooks/usePhotoLayer.ts:211-217`), `FrameScheduler` (`App.tsx:243-249`), mémoïsation `WeakMap` à identité stable (`src/layers/displayProjection.ts:43-74`)

Sans fuite tracée : `PhotoSourceStore`, `ImageFrameResources`,
`MaskTextureResolver.dispose()/sweep()`, `FramePipelineExecutor.submitAndDestroy`.
`History` est borné par refcount + budget en octets + éviction FIFO.
`LayerStack.clone()` est O(métadonnées), pas O(pixels).

## 3. Invariants vérifiés (aucun écart)

- Masque hors state React (crash OOM 24MP, `e3c7584`) → `test/layers/displayProjection.test.ts`, 4 tests dont 2 sur l'identité de tableau
- `MAX_CANVAS_PIXELS = 64 Mpx` (ADR-0007) → `test/render/limits.test.ts`, 6 tests
- ADR-0002 (round-trip déposé) → `isLaunchFile`/`roundTripActive` absents de `src/`
- ADR-0006 (fond blanc à l'export) → `render/presentPass.ts`, `kind: "white"`

## 4. Findings — ROBUSTESSE

Constat d'ensemble : la discipline « pas de fallback silencieux » est réellement
tenue dans `App.tsx`, les hooks et `renderer.ts` — les `catch` retracés propagent
vers `setError` ou sont commentés comme best-effort.

### R1 — MOYENNE (rétrogradé de HAUTE) — erreurs GPU récupérables muettes en production

**Preuve du fait** (trois fichiers rouverts) :
- `gpuContext.ts:57-59` — le handler ne fait qu'appeler `diagnosticLogger`
- `launch.ts:94-97` — `logDiagnostic` : `if (!import.meta.env.DEV) return;`
- `App.tsx:313` passe bien `logDiagnostic` en `diagnosticLogger`
- `gpuContext.ts:56` renvoie à « targeted `pushErrorScope` calls in renderer.ts » : **cette contre-mesure n'existe pas**. Balayage `pushErrorScope|popErrorScope` sur `src/` — **147 fichiers `.ts`/`.tsx`**, un seul match, ce commentaire. Témoin de discrimination : le même grep sur `createTexture` rend **7 fichiers**, l'instrument attrape donc bien.

**Pourquoi MOYENNE et non HAUTE** : le cas FATAL est couvert et documenté.
`gpuContext.ts:48-51` câble `device.lost` sur `onFatalError` → bandeau
utilisateur, et `:44-47` tranche explicitement que c'est « the one GPU signal
that must reach the user ». La répartition fatal→utilisateur /
récupérable→diagnostic dev est une **décision prise**, pas un oubli. Reste réel :
en release, une erreur de validation récupérable ne laisse aucune trace, et
l'utilisateur n'a pas de devtools dans un WebView2 distribué.

**⚠️ PIÈGE DU FIX.** Ne PAS router `onuncapturederror` vers `onFatalError` : une
erreur récupérable afficherait « le GPU a redémarré » à tort, et le handler peut
partir en rafale à chaque frame. Le fix correct est un canal séparé et débouncé
(compteur borné + journal persistant hors `import.meta.env.DEV`).

**Non vérifié, donc non affirmé** : savoir si WebView2/Chromium journalise
lui-même l'erreur non capturée en console quand un handler est assigné est une
affirmation sur l'interne d'un produit tiers. Elle demanderait une source
éditeur ; elle n'entre pas dans ce rapport.

### R2 — BASSE (rétrogradé de HAUTE) — rejet flottant sur « Ouvrir avec »

**Preuve.** `App.tsx:446-457` — le `try/catch` couvre le corps du `.then`, pas la
promesse `getLaunchPath()`. Formellement, rejet non géré.

**Pourquoi BASSE** : `src-tauri/src/lib.rs:7-18` — `fn get_launch_path() ->
Option<String>`, **pas de `Result`, aucun chemin `Err`**, et le commentaire note
qu'`args_os` a été choisi précisément pour ne jamais paniquer. La seule source de
rejet restante est une panne de transport IPC, c'est-à-dire un binaire mal
assemblé, pas un état d'exécution. À comparer à `App.tsx:465`, où le `.catch`
existe **avec** un chemin de rejet réel documenté (preset corrompu).

**Fix.** Une ligne, sans piège :
`.catch((e) => setError(messageFromUnknown(e)))`. À faire par hygiène de
symétrie, pas en urgence.

### R3 — MOYENNE — le chemin « Ouvrir avec » n'a aucun filet automatisé

**Preuve.** Balayage `launch` sur `test/` (**84 fichiers**) → 2 fichiers, et les
deux matchs sont des **commentaires** sur la dépose du round-trip
(`test/export/exportImage.test.ts:229-231`, `test/presets/presetStore.test.ts`),
pas des tests du flux.

**Nuance vérifiée en ouvrant le fichier.** Ce n'est pas un oubli :
`test/App.test.ts:3-10` acte une convention de projet (« pas de rendu de
composant dans ce projet […] vérifiée visuellement par CDP sur la fenêtre
réelle »), et le fichier ne contient qu'un `expect(1 + 1).toBe(2)`. Le finding
est donc : la convention laisse ce chemin sans filet, **alors que sa logique est
extractible en fonction pure** — exactement ce que le même commentaire dit avoir
fait pour le resync du painter de masque.

**Fix.** Extraire la résolution du chemin de lancement en fonction pure, et la
tester sur trois cas : `null`, chemin valide, rejet.

### R4 — BASSE (rétrogradé de HAUTE) — frontière fichier Rust non confinée

**Le fait.** `read_image_file` (`lib.rs:101-108`) et `import_preset`
(`:278-281`) acceptent un chemin libre venu de la webview, là où tout le chemin
preset est confiné (`preset_path` `:190-195` → `is_safe_preset_id` `:184-188`,
qui rejette `..`, `/`, `\`, sous `app_config_dir()/presets`).

**Pourquoi BASSE — trois raisons, dont deux réfutent la première passe :**
1. **Pas d'élévation de privilège.** `src-tauri/tauri.conf.json:24` porte une CSP réelle : `default-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'` — aucune origine distante. Grep sur `src/` de `dangerouslySetInnerHTML|innerHTML|fetch(|XMLHttpRequest|<iframe|new Worker(|import(` → **0 correspondance**. Aucun vecteur d'injection. L'utilisateur possède déjà ses fichiers.
2. **L'absence de `src-tauri/capabilities/` n'est pas un argument** : en Tauri v2 les `#[tauri::command]` maison ne sont pas filtrées par les capabilities, qui ne gouvernent que les permissions de plugins/core. La première passe faisait là une erreur de catégorie.
3. **La première passe lisait mal le code** : `export_preset` valide bien son extension, et le chemin preset est confiné de bout en bout.

En flux nominal, le chemin vient de `rfd` (dialogue natif, `:118`, `:267`) ou
d'`argv[1]`. Il reste une remarque de défense en profondeur : une XSS future
obtiendrait une primitive de lecture disque.

**⚠️ PIÈGE DU FIX.** Confiner `read_image_file` à un répertoire **casserait
« Ouvrir avec » de Windows** (`get_launch_path` rend un chemin arbitraire par
conception) et `pick_image_file`. Le seul confinement correct est un modèle de
jetons — le chemin retourné par un dialogue natif devient une capacité à usage
unique côté Rust. C'est un chantier, pas un `if`.

### Chemins critiques réellement couverts (pour mémoire)

Export d'image (`test/export/exportImage.test.ts` : écriture, disque plein, pixel
non opaque, dimensions), undo/redo (`test/layers/history.test.ts`), frontière
Rust (`#[cfg(test)]` dans `lib.rs:350-499` : `write_atomic`, `is_jpeg_path`,
`is_safe_preset_id`, `decode_target_path`, `join_export_filename`, cas nominaux
ET de rejet). Aucun `unwrap()`/`expect()` sur une entrée webview : le seul hors
tests porte sur `CARGO_MANIFEST_DIR`, constante de build, sous
`debug_assertions`.

## 5. Findings — REACT / UI / DÉPENDANCES

Sévérités recalibrées par l'agent principal sur un point : ce projet est une app
desktop souris-first, donc un défaut de navigation clavier est réel mais n'est
pas bloquant au même titre qu'un défaut fonctionnel. Les faits, eux, ont été
rouverts.

### U1 — HAUTE — le projet n'a AUCUNE configuration ESLint

**Preuve** (vérifiée à la main) :
- Aucun `.eslintrc*` ni `eslint.config.*` à la racine
- `grep eslint package.json` → **aucune correspondance** : ESLint n'est déclaré dans aucune dépendance
- Les `scripts` de `package.json` contiennent `lint:tokens` (design tokens, maison) et **rien d'autre en lint**

**Conséquence.** Les règles des hooks (dépendances manquantes, hooks
conditionnels) et l'accessibilité JSX ne sont vérifiées par **aucun outil**. Ce
finding est la cause racine des trois suivants : le projet écrit des
`eslint-disable-next-line` (`App.tsx:466`, `Canvas.tsx:78`) pour un linter qui
n'existe pas dans le repo. C'est le trou d'outillage le plus rentable à combler
de tout cet audit.

**Fix.** `eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-jsx-a11y` en
config flat, script `lint`, branché au pré-commit.

### U2 — MOYENNE — la ligne de calque n'est pas atteignable au clavier

**Preuve.** `LayerPanel.tsx:191-195` — `<li onClick={() => onSelect(layer.id)}>`
sans `tabIndex`, `role` ni `onKeyDown`. Seuls la poignée de drag et le bouton œil
prennent le focus ; la sélection de la ligne, non.

**Conséquence.** Au clavier seul, impossible de changer de calque sélectionné —
donc toute la zone de contrôles centralisée (opacité, fusion, effets), qui dépend
de la sélection, devient inatteignable. C'est le corollaire non prévu de
l'ADR-0001 : centraliser les contrôles rend la sélection critique.

**Nuance vérifiée.** `LayerPanel.tsx:196-200` montre que le sujet est connu :
« annoncer une hiérarchie exigerait `role="tree"` avec sa navigation clavier, ce
que cette liste n'implémente pas ». La lacune est documentée, pas ignorée — mais
elle n'est justifiée nulle part comme un choix.

**Fix.** `role="button"` + `tabIndex={0}` + `onKeyDown` (Entrée/Espace) sur le
`<li>`, ou un `<button>` englobant `layer-panel__row-main`.

### U3 — MOYENNE — le sélecteur SV et la bande de teinte ne sont pas atteignables au clavier

**Preuve.** `ColorPickerPanel.tsx:142-162` (canvas SV) et `:171-186` (teinte) :
`onPointerDown`/`onPointerMove` uniquement. Balayage `role=|tabIndex|onKeyDown|aria-`
sur le fichier → **3 lignes seulement** : `role="dialog"` (`:133`), un
`aria-hidden` décoratif (`:137`), et le `onKeyDown` du champ hex (`:196`).

**Atténuation réelle.** Le champ Hex offre un repli clavier — mais seulement pour
une valeur complète tapée à la main, sans ajustement incrémental.

**Fix.** `tabIndex={0}` + `role="slider"` + `aria-valuenow/min/max` + flèches, à
l'image de ce que `LabeledSlider` fait déjà ailleurs dans le projet.

### U4 — MOYENNE — dérive à l'ADR-0001 non documentée dans `MaskPanel`

**Théorie.** L'ADR-0001 classe « Sources de masque » comme cas applicable
(« partiel — mode de combinaison répété »). `LayerPanel` a reçu la migration le
2026-07-29 ; `MaskPanel` non.

**Preuve.** `MaskPanel.tsx:241-301` — chaque `<li>` de source porte **quatre**
contrôles répétés : `IconButton` actif/inactif (`:242-255`), bouton nom
(`:256-262`), `IconButton` supprimer (`:266-275`), et un groupe de trois `Toggle`
de mode de combinaison (`:277-301`, vérifié : `role="group"
aria-label="Mode de combinaison"`).

**Conséquence.** Écart à une règle que le projet s'est lui-même donnée, sans
commentaire expliquant l'exemption — alors que la carte voisine a été migrée le
même jour.

**Fix.** Soit centraliser sur la source sélectionnée comme pour les calques, soit
écrire dans le fichier pourquoi ≤4 sources reste sous le seuil de gain. Les deux
sont acceptables ; le silence ne l'est pas.

### U5 — BASSE — `eslint-disable exhaustive-deps` sans justification inline

`Canvas.tsx:78` porte un disable nu, là où `App.tsx:466` suit la convention du
projet (`-- refresh is stable (useCallback), run once on mount only.`). Sans
linter actif (U1), c'est un point aveugle silencieux.

### Vérifié — aucun finding

- **Champs du panneau Photo** (le soupçon a11y venait d'une session antérieure) : `NumberField` (`components/ui/number-field.tsx:126-138`) lie `<label htmlFor>` et `<input id>` via `useId()`. **Soupçon levé, il était faux.**
- **Dépendances** : toutes celles déclarées sont importées dans `src/` ; aucun import ne vise un paquet absent de `package.json`.
- **ADR-0001 sur `LayerPanel`/`LayerControls`** : conforme, contrôles centralisés hors scroller.
- **Cycle de vie** : rAF, `ResizeObserver`, `keydown`, `setTimeout`, pont debug — toutes les souscriptions trouvées ont leur cleanup apparié (`Canvas.tsx:131-138`, `PanelColumn.tsx:156-167`, `App.tsx:428-437, 1046-1048, 1397-1404, 1430-1444, 566-600`).
- **Mutation directe d'état, hooks conditionnels** : aucun.

## 6. Verdict

**Pas de bloquant.** Rien dans cet audit n'empêche une release : le rendu est
verrouillé au pixel, les shaders compilent, 1028 tests passent, aucune fuite de
ressource GPU tracée, aucun `unwrap()` sur entrée webview, la CSP est
restrictive.

Par ordre de rentabilité réelle :
1. **U1** — poser ESLint. Cause racine, corrige la classe entière.
2. **A2** — une ligne, mais **avec le `/255`** (voir le piège).
3. **A1/A3** — extraire `usePresetWorkflow` et remettre `ARCHITECTURE.md` au chiffre réel.
4. **U2/U3** — focus clavier sur la ligne de calque et le picker.
5. **R1/R2/R3/U4/U5** — hygiène.
6. **P-A/P-B** — **ne rien toucher avant d'avoir mesuré le régime edge-aware.**

## 7. Suite prévue (demandé le 2026-07-30, non commencé)

Même grille appliquée aux **effets**, en deux temps :
- **Code** — `src/render/effects/` : registry, composition de shaders,
  `MAX_EFFECT_PARAMS`, allocations par passe, duplication entre effets,
  couverture de test. Auditable en lecture seule.
- **Rendu** — la barre « pas de filtre Photoshop 2005 » du `CLAUDE.md` : chaque
  effet a-t-il reçu son upgrade qualité (dual-filter bloom, aberration radiale,
  warp FBM, grain luminance-dépendant) ou est-il resté en version naïve. Exige
  l'œil d'Antoine sur la fenêtre réelle — les sous-agents sont headless.
