# Le geste de la forme n'est pas au niveau

Type: grilling
Status: open
Parent: ../map.md

## Question

Énoncé d'Antoine, 2026-08-18 : « petit problème de forme, on est pas non plus
sur de la qualité photoshop ».

**Qu'est-ce qui, dans le geste de tracer et de retoucher une forme, n'est pas au
niveau ?** La phrase désigne le GESTE, pas le rendu — le rendu de l'aplat a reçu
ses deux fronts de qualité le 2026-08-17 (dégradé, polygone) et ses poignées le
2026-08-18.

## Ce qui est DÉJÀ livré, et qu'il ne faut pas recompter

- **Tracé à la souris** (outil Forme, `U`, Maj pour un carré) — 2026-08-17.
- **Huit poignées et une rotation** sur la forme posée (genre `box`, qui réutilise
  `TransformHandles`) — 2026-08-18.
- **Primitive et couleur dans la barre d'options**, avec pastille et sélecteur —
  2026-08-18. Les réglages appartiennent à l'OUTIL : ils sèment le prochain
  tracé (ticket 27 du palier précédent).

## Les écarts MESURÉS, à trier avant d'en corriger un seul

Relevé sur sources primaires Adobe le même jour
([recherche 01](../research/01-conventions-adobe.md)) :

1. **La poignée de rotation d'Adobe apparaît au SURVOL de la forme**, la nôtre
   est permanente. Même geste, moins d'encre sur la toile.
2. **Les manipulateurs n'existent qu'en mode canvas `idle`** : tracer puis
   retoucher demande de repasser à *Déplacer*. Photoshop garde ses poignées dans
   l'outil de forme.
3. **Le panneau et la toile ne montrent pas les mêmes grandeurs** : nous donnons
   `largeur`/`hauteur` en fraction du cadre, Photoshop donne W et H en pixels.
   Un utilisateur qui tire une poignée ne peut pas lire ce qu'il vient de faire.
4. **Le premier rectangle d'une session est NOIR** — `aplat` a teinte 0,
   saturation 0 et clarté 0 pour défauts. La barre permet de le changer avant de
   tracer, mais le défaut reste le noir.
5. **Aucun retour chiffré pendant le geste** : ni dimensions, ni angle. C'est
   l'un des trois écarts que le ticket 17 du palier précédent a laissés hors
   portée, et il mord ici plus qu'ailleurs.

⚠️ **Le rayon d'angle et le contour sont ÉCARTÉS**, par Antoine, le 2026-08-17.
Adobe les a ; nous non, et c'est une décision. Ne pas les rouvrir sur la seule
foi du relevé de conventions.

## Ce qu'il faut interroger

- **Lequel de ces cinq écarts EST « le petit problème » ?** L'énoncé est court
  et la liste est longue : la première chose à produire est de savoir lequel
  gêne, pas de les corriger tous. Une capture annotée ou trois minutes d'usage
  tranchent plus vite qu'une mesure.
- **Le mode canvas doit-il suivre l'outil ?** (écart 2) C'est la question la plus
  structurante : elle touche `CanvasMode`, dont la raison d'être est de rendre
  les combinaisons incompatibles inexprimables. La réponse « les poignées
  existent dans l'outil Forme » demande de dire ce que devient le tracé quand
  une forme est sélectionnée — un nouveau tracé, ou une prise de poignée ?
- **Quelle unité pour W et H ?** (écart 3) Le shader lit des fractions, c'est ce
  qui rend un preset indépendant de la définition. Afficher des pixels demande
  une conversion à l'affichage seul — ou un second jeu de champs, ce qu'ADR-0001
  refuse.

## Contraintes dures

- `params[]` ne se réordonne jamais ; l'index est persisté dans les presets.
- Un contrôle sur la toile ne doit pas régresser la mesure d'alignement du
  ticket 17 : l'overlay est calé **sous 0,02 px** avant et après zoom.
- ADR-0001 s'applique au moment où le composant s'écrit.

## Ce qui prouve que ce ticket est fini

L'écart nommé par Antoine est identifié, corrigé, et la correction se voit sur
une capture de la vraie fenêtre. Les quatre autres sont soit faits, soit sortis
de portée par écrit.

⚠️ Pas « la forme a été améliorée ». Le ticket doit dire LEQUEL des cinq était
le sujet.
