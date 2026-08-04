# Pile, propriétés et masque — plan d'implémentation

> Source : `2026-08-03-pile-proprietes-masque-design.md`.
> Dépendance visuelle : validation humaine de
> `docs/wireframes/effect-controls.html` avant Task 1.
> Les modifications non committées du chantier verre restent étrangères à ce plan.

## État vérifié au 2026-08-04

- Tasks 1 à 8 : **livrées dans `1bd8fde`**, puis vérifiées tâche par tâche sur
  le code réel. Le statut antérieur « non commencées » était périmé.
- Task 7 : stratégie bornée retenue — indicateur de présence/nombre de sources,
  aucun raster ni miniature 24 Mpx dans React.
- Task 9 automatisée : 1 745 tests unitaires, 302 Storybook, type-check, lint
  tokens, build, 154 shaders et 77 références pixels verts.
- WebView2 réelle : ajout de Glow, sélection de sa cible masque, titre
  `Propriétés · Glow · Masque`, entrée en peinture puis sortie par Échap,
  aucune erreur console. Capture : `C:\tmp\shaderlab-pile-full-final.png`.
- Le verdict esthétique humain final reste différé à la demande d'Antoine
  d'enchaîner en autonomie ; il ne bloque plus la suite mais n'est pas présenté
  comme une validation qu'il n'a pas donnée.

## Task 0 — Checkpoint du wireframe — remplacé par vérification sur pièce

Vérifier ensemble : hiérarchie photo/effets, double cible effet/masque, densité
verticale, inspecteur Effet/Masque, mode peinture et ajout contextualisé. Consigner
les corrections dans le design avant de toucher au code.

## Task 1 — Modèle pur de sélection contextuelle — terminé

- Créer un module pur décrivant la cible : photo, effet ou masque d'un calque.
- Définir les transitions clic ligne, clic vignette, changement/suppression de
  calque, masque absent et sortie peinture.
- Tester toutes les transitions sans rendu React.

## Task 2 — Projection de pile — terminé

- Étendre la projection `layerTree` existante pour fournir les lignes et leurs
  relations sans modifier `LayerState`.
- Ajouter les métadonnées de cible et de masque nécessaires à l'affichage.
- Conserver l'ordre causal et les conversions de drag existantes.

## Task 3 — Nouveau panneau Pile — terminé

- Migrer `LayerPanel` vers le libellé et l'anatomie validés.
- Ajouter vignette/cible de masque et état absent.
- Garder visibilité, isolation, verrou et drag accessibles.
- Déplacer les actions secondaires vers une zone unique/menu sans régression.
- Stories et tests de modèle pour photo, effet, masque, écrêtage et verrou.

## Task 4 — Inspecteur Propriétés unifié — terminé

- Introduire `PropertiesPanel` comme routeur contextuel mince.
- Réutiliser le contenu réel de `PhotoPanel`, `ParamPanel` et `MaskPanel` ; ne pas
  dupliquer leurs handlers métier.
- Rendre les onglets Effet/Masque seulement quand ils ont un sens.
- Préserver la mémorisation et le coalescing live/commit existants.

## Task 5 — Ajout d'effet contextualisé — terminé

- Déclarer une catégorie humaine par effet avec validation exhaustive du registre.
- Construire le menu recherché et groupé.
- Définir l'insertion relativement à la photo/effet sélectionné.
- Refuser explicitement les destinations incompatibles.

## Task 6 — Session d'édition de masque — terminé

- Remplacer le booléen dispersé par un état de session lié au layerId/sourceId.
- Fermer la session sur Échap, suppression, changement de document ou cible.
- Masquer les contrôles d'effet concurrents et conserver la barre pinceau.
- Tester les transitions pures et les sorties anormales (`pointercancel`).

## Task 7 — Miniature de masque bornée — terminé par stratégie de présence

- Mesurer d'abord le coût et choisir une cadence/stratégie de cache.
- Ne jamais placer le raster complet dans le state React.
- Afficher présence/état avant de promettre une miniature temps réel si le budget
  n'est pas tenu à 24 Mpx.

## Task 8 — Dépose des cartes fragmentées — terminé

- Retirer les entrées dock Photo/Params/Mask seulement après parité fonctionnelle.
- Simplifier rail, layout persistant et titres.
- Migrer ou invalider proprement les layouts persistés anciens.

## Task 9 — Preuve finale — automatisation et WebView2 terminées

- Tests, Storybook, type-check, tokens, build et shaders.
- CDP vraie WebView2 : sélection effet/masque, ajout, drag, photo, propriétés,
  peinture, undo/redo et console.
- Checkpoint humain obligatoire sur une pile courte puis une pile dense.
