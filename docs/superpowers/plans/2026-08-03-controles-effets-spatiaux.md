# Contrôles d'effets spatiaux — plan d'implémentation

> **TERMINÉ le 2026-08-04.** Tasks 1–7 exécutées, revue automatique verte
> (1716 tests unitaires, 289 stories, build, tokens, 151 shaders), preuve CDP
> sur vraie WebView2 et checkpoint Antoine. Extension issue du checkpoint :
> Motion blur expose l'axe en Directionnel et un point Centre en Rotation/Zoom.
> Suite écrite dans `2026-08-04-controles-effets-courbes-plages-tonales.md`.

> Source : `docs/superpowers/specs/2026-08-03-controles-effets-design.md`.
> État de départ : `master@b1ed8c4`, arbre déjà modifié par le chantier verre.
> Ne jamais inclure dans les commits de ce plan `scripts/render-check.mjs`,
> `test/scripts/renderRefs.test.mjs`, les PNG `effet-verre-*` ni
> `2026-08-03-references-postproduction.md` tant qu'ils restent hors de cette
> ligne de travail.

## Règles d'exécution

- Lire `git status --short` avant chaque tâche et ne stage que les chemins listés.
- TDD sur toute géométrie pure et toute validation de déclaration.
- Aucun test React rendu dans Vitest Node ; les gestes DOM vivent en Storybook et
  le comportement géométrique dans des fonctions pures.
- Aucun changement de shader, de paramètre ou de rendu pixel dans les Tasks 1-5.
- Une interaction = mises à jour live + un seul commit final.
- Preuve visuelle : vraie fenêtre WebView2 via CDP, puis checkpoint humain.

## Task 1 — Déclarer et valider `CanvasControl`

**Fichiers**

- Modifier : `src/render/effects/types.ts`
- Modifier : `src/render/effects/validate.ts`
- Modifier : `test/render/effects/registry.test.ts`

**Travail**

1. Écrire d'abord les tests d'échec pour : paramètre absent, `id` dupliqué,
   rôles dupliqués et unité incompatible.
2. Ajouter l'union discriminée `CanvasControl` (`point`, `disk`, `axis`) et
   `EffectModule.canvasControls?: CanvasControl[]`.
3. Valider chaque nom contre `effect.params`. Ne pas inférer un contrôle à partir
   de `regionX`, `angle` ou toute autre convention.
4. Conserver provisoirement `canvasRegion` comme API dépréciée afin que la Task 1
   compile sans modifier les effets ; interdire qu'un effet déclare les deux API.
5. Vérifier : `npm run test -- --run test/render/effects/registry.test.ts` puis
   `npx tsc --noEmit`.

**Commit ciblé** : types, validation et test uniquement.

## Task 2 — Généraliser la géométrie pure

**Fichiers**

- Créer : `src/ui/canvasControls.ts`
- Créer : `test/ui/canvasControls.test.ts`
- Modifier ensuite : `src/ui/regionHandles.ts` et son test seulement si du code
  commun peut être extrait sans changer les résultats existants.

**Travail**

1. Extraire le rectangle/repère commun et les conversions point UV ↔ écran.
2. Porter le disque isotrope existant sans réécrire sa formule.
3. Ajouter les conversions d'axe : angle/longueur ↔ extrémité écran, avec rapport
   d'aspect, bornes du paramètre et cas longueur nulle.
4. Couvrir paysages, portraits, carré, centre hors cadre, angle traversant 0/360,
   rayon hors vue et longueur aux bornes.
5. Prouver dans les tests que les valeurs historiques du disque rendent les mêmes
   coordonnées qu'avant extraction.
6. Vérifier le test ciblé puis toute la suite unitaire.

## Task 3 — Construire l'hôte et les poignées génériques

**Fichiers**

- Créer : `src/components/CanvasControls.tsx`
- Créer : `src/components/CanvasControls.css`
- Créer : `src/components/CanvasControls.stories.tsx`
- Modifier : `src/design/components.css` seulement si un token réellement partagé
  manque ; aucune valeur canonique ne doit être dupliquée.

**Travail**

1. Centraliser la mesure du canvas affiché dans un seul hôte.
2. Rendre point, disque et axe depuis l'union discriminée.
3. Reprendre les protections éprouvées de `RegionHandles` : compensation du point
   saisi, capture pointeur, `pointercancel`, poignée rabattue dans la vue, double
   trait clair/sombre.
4. Implémenter clavier et noms accessibles. Une répétition de touche se commit au
   `keyup`, pas à chaque `keydown`.
5. Exposer une API générique `onChange(patch)` / `onCommit()` ; le composant ne
   connaît ni calque ni effet.
6. Stories : fond clair, fond sombre, canvas portrait, contrôle désactivé, point
   hors cadre autorisé, axe court et long.
7. Vérifier `npm run test-storybook`, `npm run lint:tokens` et le type-check.

## Task 4 — Migrer les deux disques existants sans régression

**Fichiers**

- Modifier : `src/render/effects/pixelStretch.ts`
- Modifier : `src/render/effects/lensFlare.ts`
- Modifier : leurs tests
- Modifier : `src/App.tsx`
- Supprimer après migration : `src/components/RegionHandles.tsx`,
  `src/components/RegionHandles.css`
- Conserver ou fusionner : `src/ui/regionHandles.ts` selon le résultat de Task 2

**Travail**

1. Remplacer chaque `canvasRegion` par un `canvasControls: [{ kind: "disk", ... }]`.
2. Brancher `CanvasControls` une seule fois dans `App.tsx`, à partir du module de
   l'effet sélectionné. Aucun branchement par `effectId`.
3. Résoudre valeurs et bornes depuis `EffectParam`; envoyer un patch par noms.
4. Garder la condition actuelle de visibilité et l'exclusion pendant la peinture
   de masque.
5. Étendre les tests de registre pour prouver la migration et la suppression de
   l'ancienne API.
6. Vérifier type-check, tests, build et shaders. Aucun scénario de rendu ne doit
   changer puisque ni paramètres ni WGSL ne changent.
7. Check CDP : les deux disques sont présents, déplaçables, undoables en une fois,
   alignés après zoom/pan, sans erreur console.

## Task 5 — Ajouter l'axe de `motionBlur`

**Fichiers**

- Modifier : `src/render/effects/motionBlur.ts`
- Modifier : `test/render/effects/motionBlur.test.ts`
- Modifier éventuellement : `src/render/effects/types.ts` et validation uniquement
  si une condition déclarative de visibilité par mode est nécessaire.

**Travail**

1. Relever les noms et unités exacts de l'angle, de la longueur et du mode dans le
   fichier au moment d'implémenter ; ne pas recopier un nom depuis ce plan.
2. Déclarer l'axe directionnel à partir des paramètres existants.
3. Si les modes rotation/zoom rendent cet axe mensonger, ajouter au modèle une
   condition déclarative testable liée à un `choices` existant ; ne jamais écrire
   `if (effect.id === "motionBlur")` dans l'UI.
4. L'extrémité règle angle et longueur simultanément ; le centre de dessin reste
   celui de la toile tant qu'aucun paramètre de centre réel n'existe.
5. Tester les limites 0/360, longueur max et changement de mode.
6. Vérifier que la référence de pixels du flou ne change pas pour les mêmes params.
7. Checkpoint humain : direction compréhensible, poignée attrapable, cohérence
   entre l'axe, les nombres et le filé visible.

## Task 6 — Regrouper les paramètres liés dans Réglages

**Fichiers**

- Modifier : `src/components/ParamPanel.tsx`
- Modifier : `src/components/ParamPanel.css`
- Modifier : `src/components/ParamPanel.stories.tsx`
- Modifier/créer : test pur de regroupement des paramètres

**Travail**

1. Étendre `groupEffectParams` pour produire un item de groupe spatial à partir de
   `canvasControls`, sans retirer les sliders correspondants.
2. Afficher `Source`, `Zone` ou `Trajectoire` comme groupe cohérent, puis les
   valeurs précises dessous.
3. Un paramètre ne doit apparaître qu'une fois, même s'il est référencé par un
   contrôle ; les clés React restent séparées par espace de noms.
4. Les paramètres non spatiaux et les groupes couleur gardent leur ordre relatif.
5. Stories pour `lensFlare`, `pixelStretch` et les modes de `motionBlur`.

## Task 7 — Vérification finale et décision de suite

1. Lancer `npm run test`, `npm run test-storybook`, `npx tsc --noEmit`,
   `npm run lint:tokens`, `npm run build`, `npm run test:gpu-shaders`.
2. Lancer l'app selon la procédure CDP du dépôt ; surveiller PID et logs réels.
3. Tester sur une photo claire puis sombre : flare, pixel stretch, motion blur,
   zoom/pan, undo/redo, peinture de masque, changement de calque et d'effet.
4. Checkpoint visuel humain obligatoire. Questions limitées à l'usage réel :
   encombrement, lisibilité, précision, besoin éventuel d'une bascule globale.
5. Après validation seulement, écrire le plan de tranche 2 “courbes et plages
   tonales”. Ne pas glisser cet éditeur dans la présente tranche.

## Définition de terminé

- Les trois critères d'usage du design sont démontrés sur la vraie fenêtre.
- `canvasRegion` n'existe plus.
- Aucun branchement UI par identifiant d'effet.
- Les paramètres et presets existants restent compatibles.
- Tous les tests automatiques sont verts et le checkpoint humain est consigné.
- Les fichiers étrangers déjà modifiés au départ ne figurent dans aucun commit.
