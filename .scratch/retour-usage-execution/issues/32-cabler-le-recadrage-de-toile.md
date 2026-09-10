# 32 — Câbler le recadrage de toile (export, écran, outil)

**What to build:** Le recadrage de TOILE est arbitré (non destructif, Antoine,
2026-08-18) et MODÉLISÉ (`src/layers/canvasFrame.ts`, `LayerStack.cadre`,
`DocumentSession.recadrerToile / cadreToile / annulerRecadrage`, 7 tests) —
mais câblé nulle part : ni `render/`, ni `export/`, ni `App.tsx` ne lisent le
cadre (constat du ticket 27, 2026-09-09). Antoine, 2026-09-10 : « fais les 4 »
→ brancher. Spécification complète : `.scratch/prochain-palier/issues/28-recadrer-la-toile-deja-ouverte.md`
(§ « Ce qui RESTE » et le constat de méthode du 2026-08-20) et
`docs/ROADMAP.md` § « recadrer la TOILE ».

**Blocked by:** None pour la tranche A. La tranche B attend le ticket 30/31 (même
zone `App.tsx`).

**Status:** ready-for-agent
**Type:** task

## Contraintes qui gouvernent tout (à ne pas réinventer)

- **Le pipeline évalue TOUT en espace d'ORIGINE** — masques, dégradés, transforms,
  UV. Le cadre ne s'applique QU'à la présentation et à l'export. Évaluer dans
  l'espace du cadre ferait glisser le dégradé (défaut décrit au ticket 28).
- **Un cadre, pas de nouvelles dimensions** : `imageSize` (React) et
  `ImageFrameResources.width/height` (GPU) restent ceux de la toile d'origine.
  Rien n'est réalloué. Annuler = reposer `null`.
- **Composition** : un recadrage d'un recadrage est exprimé dans le cadre
  COURANT ; `composerCadre` fait la conversion, ne pas la refaire.
- Le raster d'un Tampon (ticket 27) reste pleine toile : un cadre ne change pas
  ce qu'un tampon capture (l'espace d'origine), seulement ce qu'on montre.

## Tranche A — moteur : export et écran lisent le cadre (prouvable au harnais)

1. `Renderer` reçoit le cadre courant (API à choisir : `setCadre(frame | null)`
   posé par `App` à chaque commit, OU paramètre de `exportFrame(layers, cadre)`
   et de `requestRender` — préférer ce qui garde `Renderer` sans état dupliqué ;
   noter le choix).
2. **Export** : `exportFrame` ne relit que le sous-rectangle du cadre
   (`FrameReadback` sur une région, ou copie de texture → texture au cadre
   puis readback). `ExportedFrame.width/height` = celles du cadre. Le fichier
   JPEG exporté est découpé.
3. **Écran** : `presentPass` échantillonne le sous-rectangle du cadre (remappage
   UV) et le canvas présenté prend les dimensions du cadre (résolution native du
   cadre, réduit par CSS comme aujourd'hui — `presentPass.ts:44`). Le damier /
   fond hors cadre n'existe plus : hors cadre n'est pas montré.
4. **Gates** : un scénario `render-check.mjs` qui pose un cadre (par ex. le
   quart central de la mire) et gèle l'export découpé — `cadre-toile` + son
   témoin, DEUX points d'enregistrement (scénario ET table `ATTENDU` de
   `test/scripts/renderRefs.test.mjs`, même commit). Un second scénario
   `cadre-toile-degrade` : masque dégradé + cadre → prouve que le dégradé ne
   glisse pas (l'export découpé doit être le CROP exact de l'export sans cadre —
   compare les octets du sous-rectangle, pas deux références). `test:render`
   complet zéro écart sur les 125 existantes. `test:gpu-shaders --origin`.
   Tests unit sur la logique pure (région de readback, remappage UV).
5. L'écran n'est PAS prouvable au harnais (`presentPass` écrit le canvas que
   `render-check` ne lit pas) : capture CDP mesurée avec un cadre posé par le
   pont de debug (`__shaderlabDebug.recadrer(rect)` à ajouter — UNE ligne dans
   le pont, seule édition d'`App.tsx` de cette tranche).

## Tranche B — l'outil de recadrage (après 30/31)

Référence Lightroom (outil Recadrer `R`) et Photoshop (`C`) : un cadre avec
huit poignées sur la toile, l'image entière visible ASSOMBRIE hors cadre pendant
le geste, ratio libre ou contraint (`Maj`), `Entrée` valide, `Échap` annule,
double-clic dans le cadre valide. Barre d'options de l'outil : « Annuler le
recadrage » (repose `null`, grisé s'il n'y a pas de cadre), ratio (libre /
d'origine / carré / 4:5 / 3:2 — la liste d'ADR-0007). Un recadrage validé = un
pas d'undo (`commit`). Composant de poignées : réutiliser `TransformHandles`
(huit poignées) sans rotation, pas un manipulateur neuf. Après validation, la
toile affichée devient le cadre (tranche A) ; l'outil rouvert montre l'image
entière assombrie avec le cadre courant, pour l'agrandir ou le déplacer — c'est
le non-destructif rendu VISIBLE, et c'est ce que Lightroom fait.

- [x] A1 `Renderer` lit le cadre (API notée — voir Journal).
- [x] A2 export découpé au cadre, dimensions du cadre.
- [x] A3 écran : présentation remappée (tranche A) ; canvas aux dimensions du cadre LIVRÉ en tranche B (DOM, effet d'écran d'`App`).
- [x] A4 scénarios `cadre-toile` + `cadre-toile-temoin` + `cadre-toile-degrade` (crop octet-exact vérifié dans le harnais ET en assertion Node), `test:render` zéro écart sur les 125, `gpu-shaders --origin` vert.
- [x] A5 capture CDP mesurée de l'écran recadré.

## Journal tranche A (livré)

**Fichiers.** `src/render/cadreProjection.ts` (neuf, 2 fonctions pures) ·
`src/render/renderer.ts` · `src/render/presentPass.ts` ·
`src/render/frameReadback.ts` · `scripts/render-check.mjs` ·
`test/scripts/renderRefs.test.mjs` · `test/render/cadreProjection.test.ts` (neuf) ·
`test/render/presentPass.test.ts` · `test/render/frameReadback.test.ts` ·
3 PNG dans `test/render-refs/`. Le pont debug `recadrer`/`annulerRecadrage` a
atterri dans `src/App.tsx` (commit `b077eeb` de l'agent ticket 30, qui a commité
App.tsx pendant que mon édition y était — le hook est présent et correct).

**API retenue — asymétrique, et voulue.**
- EXPORT : paramètre explicite `Renderer.exportFrame(layers, cadre)`. Aucun état
  dans le renderer, pas de divergence possible avec `LayerStack.cadre` — c'est la
  moitié PROUVABLE au harnais (le harnais passe `scenario.cadre`). Répond au
  critère du ticket 28 §4.3.
- ÉCRAN : champ `Renderer.setCadre(cadre|null)`, lu UNIQUEMENT par le chemin
  canvas de `runPipeline`. Un champ et non un paramètre parce que `requestRender`
  a ~10 sites d'appel dans `App.tsx` (zone de l'autre agent) ; c'est le même
  patron d'état d'écran que `displayScale`/`isolatedLayerId`. Il ne feed jamais
  l'export, donc un champ périmé ne peut pas produire un fichier mal découpé.

**Export découpé.** `exportFrame` compose TOUJOURS la toile entière (present pass
inchangé, fond blanc), puis relit le seul sous-rectangle : `regionDeLecture(cadre,
W, H)` → `FrameReadback.readTextureBytes(exportTexture, origin)`. Garantit que
l'export cadré est le crop octet-exact de l'export plein.

**Écran.** `presentPass` (variante damier seulement) remappe l'UV via un uniforme
`presentParams` (struct : `cell` + `uvRemap`), piloté par
`remapUvPourCadre(cadre, W, H)`. Cadre `null` → identité, rendu inchangé au bit
près. La variante blanche (export) est intacte.

**Reste pour la tranche B (fichier:ligne).**
- Redimensionner le canvas DOM aux dimensions du cadre (résolution native du
  cadre). Aujourd'hui `Canvas.tsx`/`App.tsx` fixent `canvas.width/height` aux
  dimensions du DOCUMENT ; sans ce redimensionnement, l'écran affiche le
  sous-rectangle ÉTIRÉ dans le canvas plein (mesuré : dims canvas 6240×4160
  inchangées avant/après recadrage). Le remappage UV est déjà correct pour les
  deux tailles de canvas. Point d'entrée : `initGpu`/`context.configure`
  (`src/render/gpuContext.ts:171`) + le dimensionnement du `<canvas>` dans
  `Canvas.tsx`, plus l'appel `setDisplayScale` d'`App.tsx` à recalculer sur les
  dims du cadre.
- Câbler l'écran vivant : `App.tsx` doit appeler `renderer.setCadre(session.
  cadreToile())` à chaque commit qui touche le cadre (à côté de `requestRender`),
  et le vrai export (`exportImage` → `FrameRenderer.exportFrame`) doit passer
  `session.cadreToile()` — l'interface `FrameRenderer.exportFrame(layers)` gagne
  alors un second argument. Non fait ici : hors du seul hunk App.tsx autorisé.
- L'outil de recadrage lui-même (B1/B2/B3), après tickets 30/31.

**Prémisse du brief corrigée sur pièce.** Le brief (et le §2026-08-20 du ticket
28) disent « l'ÉCRAN n'est PAS prouvable au harnais (presentPass écrit le canvas
que render-check ne lit pas) ». FAUX : `render-check.mjs` relit le canvas via
`surface: "canvas"` (`readCanvas`, cf. les scénarios `toile-damier` et
`masque-overlay-*`). Un scénario `surface:"canvas"` avec cadre PROUVERAIT donc le
remappage d'écran au harnais — mais figerait le comportement ÉTIRÉ propre à la
tranche A (canvas non redimensionné), qui changera en tranche B. Non committé
pour cette raison ; l'écran reste prouvé par la capture CDP (A5).
- [x] B1 outil Recadrer (`C`), poignées, assombrissement hors cadre, `Entrée`/`Échap`, ratio — `src/components/CropOverlay.tsx` (+ `.css`), module pur `src/ui/cropTool.ts`, hook `src/hooks/useCropTool.ts`, mode `canvasCrop` (`ui/canvasMode.ts`), outil `crop` (`ui/tools.ts`, touche `C`), icône `ToolPalette`.
- [x] B2 barre d'options : ratio + « Annuler le recadrage » (grisé sans cadre) + rappel clavier — `ToolOptionsBar` prop `recadrage`.
- [x] B3 stories (`CropOverlay.stories` deux ratios, `ToolPalette.stories`, `ToolOptionsBar` Recadrer/RecadrerAvecCadre, menu contextuel) + gates complets (tsc, lint, test 2256, test-storybook 379, test:render 128 zéro écart, lint:tokens, lint:css-comments).
- [x] B écran vivant : canvas aux dims du cadre + viewport/displayScale recalculés (`App` effet d'écran) ; overlays compensent l'origine du cadre (`ui/transform.documentClientRect`) ; export réel `exportImage(...cadre)` → `FrameRenderer.exportFrame(layers, cadre)`.
- [x] Menu contextuel de la toile (ticket 29) : « Recadrer… » + « Annuler le recadrage ».
- [ ] Validé en gestes par Antoine : recadrer, exporter (fichier découpé), rouvrir l'outil, agrandir le cadre (rien n'a été perdu), annuler.

## Journal tranche B (livré)

**Décisions prises là où la tranche laissait un choix.**
- **Pose ABSOLUE du cadre à la validation, pas composition.** L'outil montre
  l'image ENTIÈRE (`setCadre(null)` le temps de l'outil) pour permettre d'AGRANDIR
  un cadre existant. `composerCadre` seul l'interdit (il ne fait que rétrécir le
  cadre courant). La validation fait donc `annulerRecadrage()` PUIS
  `recadrerToile(rect)` — la composition contre `null` est l'identité — ce qui
  honore la lettre du brief (« composerCadre fait la composition ») tout en
  rendant le geste réversible et agrandissable.
- **Touche `C`** (Photoshop), `KeyC` était libre. `R` (Lightroom) laissé libre :
  le reste de la palette (V/B/E/U) vient déjà de Photoshop.
- **Nouveau mode `canvasCrop`**, distinct du `crop` existant (rognage d'un CALQUE
  photo, sans appelant de production) : deux gestes, deux cibles.
- **Liste de ratios définie dans `cropTool.ts`** (Libre · D'origine · Carré · 4:5 ·
  3:2), PAS dérivée d'ADR-0007 : cet ADR dérive des dimensions de CRÉATION par
  contenance (« A3 » y est un format absolu, pas un ratio), un recadrage choisit
  une PROPORTION. « Carré »/« 4:5 » partagent les proportions d'ADR-0007 mais le
  concept vit ici ; ratios relatifs orientés comme la toile (même règle ADR-0007).

**Mécanisme du canvas qui suit le cadre.** `App` porte un état `cadre` (copié de
la session). `screenCadre = cropActive ? null : cadre` (l'outil montre tout).
Un effet applique `screenCadre` : `canvas.width/height` = dims du cadre
(`regionDeLecture`), `renderer.setCadre`, `fitViewport` recalculé UNIQUEMENT quand
les dims changent (sinon un undo réinitialiserait le zoom). Les ressources GPU du
document ne bougent pas.

**Compensation des overlays.** `documentClientRect(canvasRect, cadre, docSize)`
(neuf, `ui/transform.ts`, testé) rend le rectangle VIRTUEL où la toile ENTIÈRE
apparaîtrait ; sous un cadre le canvas ne couvre que le sous-rectangle, donc les
overlays s'y calent inchangés (leurs repères restent en coordonnées d'origine) et
un repère hors cadre est clippé. Threadé (`frame`/`cadre` + `imageSize`) dans
TransformHandles, CanvasControls (Point/Axis/Region/box), EffectMoveSurface,
AutoSelectMoveSurface, EffectTransformHandles, ShapeTransformHandles. `Canvas`
ajoute `frameOrigin` aux conversions écran→document (pinceau, tracé, désignation) ;
`handleCanvasContextMenu` de même.

**Prémisse corrigée sur pièce.** Le règlement ESLint du projet
(`react-hooks/refs`) INTERDIT toute écriture/lecture de ref pendant le rendu — le
patron « latest ref » (`ref.current = prop` en corps de composant) que je visais
d'abord est refusé (alors que `Canvas.viewportRef` l'utilise et passe : divergence
non expliquée, contournée). Refonte : les overlays lisent la prop `frame`
directement (dans les `useCallback`, avec deps) ; `useCropTool` (re)pose son
rectangle par le patron « ajuster l'état pendant le rendu » et non par effet
(`set-state-in-effect` aussi interdit) ; les refs du pont de debug sont écrites
dans un effet.

**Reste.** Validation EN GESTES par Antoine (le hook `[ ]` ci-dessus). La
poignée d'un `aplat` sous un cadre n'a pas été éprouvée EN LIVE (elle exige
d'ajouter un effet via l'UI par CDP) — couverte par le test unit de
`documentClientRect`, les stories de poignées et le mécanisme partagé.
