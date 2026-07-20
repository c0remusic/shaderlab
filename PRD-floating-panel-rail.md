# PRD — Rail d'icônes dockable pour FloatingPanel

> Cadré par interview (skill `grill-me`), 2026-07-20. Le QUOI uniquement — le
> COMMENT technique reste à faire via `superpowers:brainstorming` avant toute
> implémentation.

## Contexte

Le système `FloatingPanel` actuel (Calques/Réglages) ne fait que du
positionnement libre + magnétisme entre panneaux (voir
`docs/superpowers/specs/2026-07-20-shaderlab-floating-panels-design.md`).
Antoine a d'abord envisagé une fusion en onglets façon VS Code, inspirée de
Photoshop — vérifié en direct sur photoshop.adobe.com (session réelle) que ce
n'est PAS ce que fait Photoshop web : c'est un **rail d'icônes fixe** à droite
(Calques/Réglages/Historique/Commentaires) qui bascule l'affichage de chaque
panneau indépendamment, plusieurs pouvant être visibles empilés en même temps.
C'est ce modèle qu'Antoine veut, avec en plus la possibilité de sortir un
panneau du rail pour le rendre flottant (que le système actuel sait déjà
faire) et de le redocker.

## Décisions actées (interview, une question à la fois)

1. **Comportement du rail** : chaque icône bascule l'affichage/masquage de
   SON panneau indépendamment — plusieurs panneaux peuvent être dockés et
   visibles en même temps (empilés), pas un seul panneau actif façon onglets.
2. **Détacher un panneau du rail** : glisser le panneau docké/visible hors de
   sa zone (même geste de drag que le système `FloatingPanel` actuel) → il
   devient flottant, libre.
3. **Redocker un panneau flottant** : glisser le panneau flottant près du
   rail (magnétisme/geste symétrique au détachement).
4. **État par défaut au lancement** : les panneaux (Calques, Réglages) sont
   **dockés dans le rail par défaut** — remplace le comportement actuel
   (flottants près du bord droit dès l'ouverture).
5. **Icône du rail quand le panneau est flottant** : l'icône **reste
   visible** dans le rail (pas de disparition), avec un indicateur discret
   (point) — cliquer dessus **redocke** le panneau (raccourci en plus du
   drag).

## Hors scope de ce PRD (différé)

- Fusion en onglets/tabs (écarté explicitement par Antoine — "je me suis
  trompé je crois").
- Contenu du panneau Masques dans le rail (Tranche 4 du chantier masquage —
  s'ajoutera comme une icône de plus une fois ce panneau construit).
- Redimensionnement des panneaux (déjà différé dans le design floating-panel
  d'origine, toujours vrai ici).
- Persistance de l'état docké/flottant entre sessions.

## Points techniques à trancher au brainstorming (pas dans ce PRD)

- Où vit le rail dans le DOM/layout (nouveau composant `PanelRail`, relation
  avec `.workspace`/`.canvas-stage`) ?
- Comment un panneau "docké" diffère-t-il visuellement/structurellement d'un
  panneau flottant (même composant `FloatingPanel` avec un mode `docked`, ou
  composant distinct) ?
- Seuil de distance pour le geste de redocking par drag (réutiliser
  `SNAP_DISTANCE` de `snapping.ts`, ou un seuil dédié pour une cible plus
  large comme le rail) ?
- Le repli (collapse) existant d'un panneau s'applique-t-il aussi à l'état
  docké, ou le dock a sa propre notion de hauteur ?
- Interaction avec le magnétisme panneau↔panneau existant : un panneau
  flottant qui approche le rail déclenche-t-il un aperçu visuel distinct du
  magnétisme normal ?

## Prochaine étape

`superpowers:brainstorming` sur les points ci-dessus, puis
`superpowers:writing-plans` avant toute implémentation. Pas encore fait.
