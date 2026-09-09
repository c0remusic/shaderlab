# 29 — Menu contextuel (clic droit) sur la TOILE

**What to build:** Tranche 2 du clic droit (ticket 28 = la pile). « go » d'Antoine,
2026-09-09, sur la proposition : clic droit sur la toile → ce que Photoshop fait
sous l'outil Déplacement — **la liste des calques sous le curseur**, du plus
haut au plus bas, un clic en sélectionne un ; puis, sur le calque sélectionné,
les mêmes actions que le menu de la pile (Masquer, Dupliquer, Aplatir en
nouveau calque, Fusionner avec le dessous, Verrous ▸, Supprimer). Lightroom n'a
pas d'équivalent (pas de calques) ; la référence est Photoshop seule.

**Blocked by:** 28 — la primitive `context-menu` et le sous-menu Verrous
naissent là ; ce ticket les RÉUTILISE, ne les recopie pas.

**Status:** ready-for-agent (après le 28)
**Type:** task

## Ce qui existe déjà (mesuré le 2026-09-09)

- `src/ui/hitTest.ts` `hitTestPhotoLayer` (photos) et `src/ui/autoSelect.ts`
  `hitTestAutoSelect` (tous genres, lit les rasters pinceau COMMITTÉS — donc la
  pile COMPLÈTE `sessionRef.current.layers()`, jamais la projection d'affichage,
  invariant anti-OOM). Les deux rendent UN id : le calque couvrant le plus haut.
  Ce ticket a besoin de la LISTE des calques couvrants sous le point — une
  fonction sœur pure, `hitTestAll` (même signature, rend `string[]` du plus
  haut au plus bas), testée en unit comme les 17 cas d'`autoSelect.test.ts`.
- `App.tsx` `handleCanvasPick` : le clic gauche désigne selon la case
  « Sélection auto » (ticket 26). Le clic DROIT n'en dépend pas : il liste
  toujours TOUS les genres (c'est Photoshop : le menu contextuel du Déplacement
  liste tout ce qui a un pixel sous le curseur, que la sélection auto soit
  cochée ou non).
- Un calque d'effet SANS ancrage (`canvasControls` absent, `spatialParams.ts`)
  couvre TOUTE la toile : il est donc sous n'importe quel point. Décision à
  prendre en implémentant : les lister (Photoshop liste les calques de réglage
  partout) — oui, mais APRÈS les calques placés/photo, et en un groupe séparé
  par un séparateur, sinon la liste est toujours la pile entière.

## Contraintes

- Aucune logique dans `components/` : le hit-test est pur (`ui/`), le menu
  reçoit la liste et les handlers.
- Clic droit ne déplace rien, ne peint rien : en mode pinceau, le clic droit
  ouvre le menu et n'entame pas un trait (vérifier `button` sur la surface de
  peinture).
- Le calque sous le curseur est mis en SURBRILLANCE dans la pile au survol de
  son entrée dans le menu (comme Photoshop) — si la pile a déjà un état de
  survol (`hover`), le réutiliser ; sinon hors périmètre, le noter.
- Stories : menu ouvert avec 1 calque, avec 3 (photo placée + effet placé +
  effet plein cadre), vide (aucun calque → « Ajouter un effet… » seul).
- Gates : `npm run test`, `test-storybook` ENTIER, `test:render` zéro écart,
  lint, tokens.

- [x] `hitTestAll` pur + tests.
- [x] Menu sur la toile : liste des calques sous le curseur (placés/photo, séparateur, plein cadre), un clic sélectionne.
- [x] Sur le calque sélectionné : les mêmes actions que le menu de la pile (réutilisées, pas recopiées).
- [x] En mode pinceau, le clic droit n'entame pas un trait.
- [x] Stories + gates.
- [x] **Vérifié live par CDP le 2026-09-09 (session libre)** : photo-1 + Light
      leak + Grain ; clic droit au centre de la toile → menu `[Light leak,
      photo-1.jpg] | [Grain ✓]` puis les six actions ; choisir Light leak →
      Aplatir → la pile devient `[photo-1, Light leak, Aplati — Light leak,
      Grain]` et le menu suivant coche « Aplati — Light leak ». Capture
      `assets/menu-29-toile.png` (non versionnée), script
      `menu29-verif.mjs` (scratchpad de session).
- [ ] Validé en gestes par Antoine : clic droit sur la photo à travers un light leak → choisir le light leak → Aplatir. (Structure et gestes prouvés en headless chromium par les stories `CanvasContextMenu`, et le composant confirmé monté dans la vraie fenêtre par CDP — mais la scène live + la capture restent à faire par Antoine ou sur session libre, voir Livraison.)

## Livraison (tranche 2, 2026-09-09)

Fait :
- **`hitTestAll` pur** (`src/ui/autoSelect.ts`, SŒUR de `hitTestAutoSelect`,
  même signature, mêmes règles de couverture — pile COMPLÈTE, verrous non
  consultés, source paramétrique = couvre partout, raster vidé = 0). Elle
  COLLECTE tous les couvrants du haut vers le bas au lieu de s'arrêter au
  premier. `hitTestAutoSelect` n'est PAS touché (ses 17 tests restent verts).
  12 tests neufs (`test/ui/hitTestAll.test.ts`).
- **`LayerActionsMenuItems`** (`src/components/layerActionsMenu.tsx`) : le bloc
  d'entrées du ticket 28 (Masquer/Afficher · Dupliquer · Aplatir · Fusionner ·
  Verrous ▸ · Supprimer) EXTRAIT en un fragment partagé, plus `VERROUS` et
  `LOCK_IMPLIED`. `LayerPanel` (ligne de pile) ET `CanvasContextMenu` (toile)
  l'utilisent — jamais recopié. Extraction VERBATIM : les 5 stories de menu du
  ticket 28 restent vertes.
- **`CanvasContextMenu`** (`src/components/CanvasContextMenu.tsx`) : enveloppe la
  toile et ses overlays via un déclencheur `display: contents` (aucune boîte, la
  chaîne de hauteurs `100%` du pasteboard intacte). Rend la liste des calques
  sous le curseur en CASES (le sélectionné coché), placés/photo puis un
  séparateur puis plein cadre ; un clic sur une case SÉLECTIONNE et laisse le
  menu OUVERT (Base UI ne ferme pas sur une case) ; suit un séparateur puis
  `LayerActionsMenuItems` sur le calque SÉLECTIONNÉ. Aucun calque sous le
  curseur → « Ajouter un effet… » seul. Aucune logique : liste et verdicts
  fournis, actions = handlers d'`App`.
- **Câblage `App`** : `handleCanvasContextMenu` calcule le point (même
  conversion écran→image que `Canvas`/`EffectMoveSurface`), appelle `hitTestAll`
  sur `sessionRef.current.layers()`, et fait LE PARTAGE placé/plein-cadre
  (photo, OU effet à `canvasControls`) — ici et non dans le module pur, qui n'a
  pas le registre. Indépendant de la case « Sélection auto ».
- **Sélecteur d'effet LEVÉ** : l'état d'ouverture du `EffectPicker` passe de
  `LayerPanel` (interne) à `App` (`pickerOpen`/`onPickerOpenChange` opt-in), pour
  que « Ajouter un effet… » de la toile ouvre le MÊME sélecteur que le vide de
  la pile.
- **Gardes `button !== 0`** sur les deux surfaces de `Canvas` qui ne l'avaient
  pas (le `<canvas>` — paint/tracé/désignation — et le pourtour du pasteboard —
  désélection) : un clic droit N'ENTAME rien et laisse le `contextmenu` remonter
  au menu. Les overlays (EffectMove, AutoSelect, TransformHandles, CanvasControls,
  Shape/EffectTransformHandles, Point/Axis/Region) gardaient DÉJÀ `button !== 0`.

Décisions prises (là où le brief laissait un choix) :
- **`hitTestAll` rend une liste PLATE** (haut→bas), pas deux groupes — au lieu de
  ce que le brief décrit. Le partage placé/plein-cadre a besoin de
  `EffectModule.canvasControls`, propriété du MODULE (registre), absente de
  `LayerState` ; l'injecter briserait « même signature » et la pureté (raison de
  l'injection de `photoSizeOf`). Le partage se fait donc chez `App`, qui a le
  registre. Contrat honoré à la lettre (même signature, module pur) ; les tests
  unit ne portent que sur la couverture, ce qu'une liste plate suffit à prouver.
- **La case garde le menu OUVERT** (pas de fermeture au clic) : c'est ce qui
  permet « choisir un calque PUIS Aplatir » dans un seul menu — la section
  d'actions se recale sur le calque fraîchement sélectionné (même patron que le
  sous-menu Verrous du 28).
- **Surbrillance de la ligne de pile au survol d'un item : HORS PÉRIMÈTRE.** La
  pile n'a PAS d'état de survol réutilisable — le survol de ligne est un `:hover`
  CSS pur (`LayerPanel.css`), sans prop programmatique. Le brief le conditionnait
  à un état existant ; il n'y en a pas, donc non fait (noté).

Écart au brief (avec sa raison) :
- **Vérification CDP live + capture `menu-29-toile.png` NON faites.** L'unique app
  en cours (CDP 9222) est la session ACTIVE de l'autre sous-agent (aquarelle) ;
  reproduire la scène (photo + light leak placé + grain) exigerait d'AJOUTER des
  calques, donc d'écraser un état que je n'ai pas produit — interdit par CLAUDE.md
  (2026-07-25) — et `dev:debug` tuerait leur app. Preuve substituée : CDP en
  LECTURE SEULE confirme `.workspace__canvas-context` monté dans la vraie fenêtre
  avec `display: contents` effectif (HMR a chargé le code) ; et les 3 stories
  `CanvasContextMenu` prouvent en headless chromium la liste `[Light leak, IMG] |
  [Grain]`, la sélection au clic, et le bloc d'actions — DOM que le headless rend
  fidèlement (contrairement au canvas WebGPU). Reste à faire sur session libre.
