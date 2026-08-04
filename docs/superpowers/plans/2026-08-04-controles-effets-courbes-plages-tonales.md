# Contrôles d'effets — courbes et plages tonales — plan d'implémentation

> Source : `../specs/2026-08-04-controles-effets-courbes-plages-tonales-design.md`.
> Tranche 2, après clôture du plan spatial du 2026-08-03.

## État au 2026-08-04

- Tasks 1 à 6 : **terminées et review-clean**.
- Gates automatisés de Task 7 : **verts** — 1 738 tests unitaires, 295 tests
  Storybook, type-check, lint tokens, build et 154 shaders composés.
- Checkpoint technique WebView2 : **passé** sur une instance fraîche avec la
  fixture `sample.jpg` — ajout de Courbes, sélection du calque, canaux M/R/V/B,
  ajout de point, coordonnées E/S, déplacement clavier, historique actif et
  console sans erreur. Le checkpoint humain final et la référence de rendu
  dédiée restent en attente.
- Tranche 3 `gradientMap` : **implémentée et review-clean techniquement** ;
  checkpoint humain final en attente. Voir
  `2026-08-04-controle-rampe-gradient-map.md`.

### Sous-passe de checkpoint — fluidité et finition professionnelle

Ouverte après verdict humain : « très loin du niveau de Photoshop niveau
fluidité et esthétique ». Le verdict invalide la clôture visuelle de Task 7,
pas les fondations Tasks 1–6.

- Poignée pilotée par un état local immédiat ; synchronisation React/GPU
  coalescée à une fois par frame.
- Canaux condensés en M/R/V/B et coordonnées Entrée/Sortie du point actif.
- Point actif plus lisible, hit target agrandi, graphe traité comme surface
  principale ; aide permanente retirée.
- Plage tonale d'effet condensée en réglette et quatre valeurs ; la variante
  détaillée reste réservée au masque.
- `pointercancel` restaure désormais la géométrie de départ sans commit.
- Revue dans la vraie fenêtre effectuée : le faux plancher « cinq lignes » de
  la carte Propriétés provoquait un double scroll dock + carte. Propriétés est
  maintenant correctement classée comme formulaire fixe : un seul scroll
  vertical demeure, dans son contenu.
- Checkpoint humain encore requis avant clôture.

## Règles

- TDD sur modèle, interpolation et validation avant React/WGSL.
- Aucun branchement UI par identifiant d'effet.
- Données numériques dans `LayerState.params`; aucun tableau/buffer lourd dans
  le state React.
- Live pendant le geste, un commit au relâchement, zéro commit sur cancel.
- Référence de pixels écrite avant le shader non neutre.

## Task 1 — Capacité et déclaration

- Porter `MAX_EFFECT_PARAMS` de 32 à 48 et corriger le commentaire périmé
  `array<f32, 8>`.
- Définir `CurveControl`, `CurveChannel`, `TonalRangeEffectControl` dans les
  types d'effet.
- Valider clés, slots, endpoints, bornes, ordre et capacité.
- Tests d'échec ciblés puis registre complet.

## Task 2 — Modèle pur de courbe

- Créer `src/ui/curveControl.ts`.
- Résoudre slots actifs, insertion, suppression, clamp entre voisins et
  navigation clavier.
- Implémenter l'interpolation cubique monotone CPU.
- Tester identité, S-curve, points serrés, endpoints, slots pleins, cancel et
  vecteurs partagés avec le WGSL.

## Task 3 — Éditeur accessible

- Créer `CurveControl.tsx/.css/.stories.tsx`.
- SVG responsive, quadrillage tokenisé, quatre tracés, canal actif et points.
- Pointer capture sans saut, clavier, noms accessibles, focus visible.
- Stories clair/sombre, identité, S-curve, canal RGB, slots pleins, disabled,
  pointercancel et commit unique.

## Task 4 — Effet Courbes et référence neutre

- Ajouter `src/render/effects/curves.ts` et ses tests.
- Déclarer 37 paramètres, quatre canaux, plage tonale et mélange.
- Ajouter la mire rampe + patchs RGB et capturer d'abord l'identité neutre.
- Implémenter la même interpolation monotone en WGSL, maître luminance puis RGB.
- Vérifier identité à l'octet, monotonie et absence de sortie hors 0..1.

## Task 5 — Plage tonale d'effet

- Extraire du contrôle masque uniquement l'anatomie visuelle et les fonctions
  pures partageables ; conserver deux modèles métier distincts.
- Brancher les quatre bornes déclarées dans `ParamPanel`.
- Appliquer la réponse smoothstep au mélange source/courbe dans le shader.
- Tester non-croisement, valeurs limites et parité CPU/WGSL.

## Task 6 — Intégration panneau, historique et presets

- Faire dériver le rendu de `curveControls`/`tonalRangeControl`.
- Garantir qu'aucun paramètre n'apparaît deux fois et que les clés React sont
  séparées par espace de noms.
- Vérifier capture/application/export/import du preset Courbes, sans source
  photo et sans migration spéciale.
- Tester undo/redo : ajout, déplacement, suppression et reset de point.

## Task 7 — Preuve finale

- Suite unit, Storybook, type-check, tokens, build, shaders et rendu de référence.
- Vraie WebView2 : quatre canaux, ajout/retrait, clavier, plage tonale, preset,
  changement de calque, undo/redo et console.
- Checkpoint humain sur rampe puis vraie photo : lisibilité, précision, courbe
  neutre, contraste extrême et dominante RGB.
- Après validation, exécuter la tranche 3 rampe `gradientMap` — fait le
  2026-08-04 ; voir son plan dédié.

## Terminé quand

- La droite identité est réellement neutre.
- Aucun overshoot ou inversion locale n'est mesuré.
- Le panneau et le shader lisent une déclaration unique.
- Les presets restent JSON numériques et transportables.
- Tous les gates et le checkpoint humain sont consignés.
