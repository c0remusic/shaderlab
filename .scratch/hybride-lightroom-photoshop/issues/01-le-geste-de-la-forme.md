# Le geste de la forme n'est pas au niveau

Type: grilling
Status: resolved
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

---

## Answer — RÉSOLU le 2026-08-18

**Deux des cinq écarts sont corrigés, et ce sont les deux qui cassaient le
GESTE.** Les trois autres sont soit hors de ce ticket, soit une non-question.

### 1. ✅ Tracer puis ajuster SANS quitter l'outil (écart 2)

C'était le plus lourd, et il était structurel. `showsTransformHandles` valait
`idle` seulement, et gouvernait TOUT : poignées du calque photo comme contrôles
d'effet. À l'usage — on trace un rectangle, il se pose, et pour l'ajuster il faut
**quitter l'outil qui vient de le créer**.

Les deux prédicats se SÉPARENT plutôt que de s'élargir, parce qu'ils ne disent
pas la même chose : les poignées du calque PHOTO n'ont rien à faire pendant un
tracé (déplacer la photo sous la forme qu'on dessine n'a aucun sens, et sa boîte
couvre toute l'image donc elle avalerait le geste) ; les contrôles d'EFFET
portent sur ce qu'on vient de créer.

Et le CORPS de la boîte devient inerte dans l'outil Forme : les poignées restent
attrapables, mais un glissement DANS la forme commence une NOUVELLE forme, comme
chez Photoshop. Sans cette borne, l'outil de tracé cesse de pouvoir tracer
par-dessus son propre résultat.

**Mesuré dans la vraie fenêtre** : après relâchement, outil toujours « Forme »,
**9 poignées** rendues, corps inerte.

### 2. ✅ La mesure PENDANT le geste (écart 5)

On tirait une forme sans jamais savoir de quelle taille. En PIXELS de l'image et
non en fraction du cadre — c'est l'unité que l'utilisateur reconnaît, et la seule
qui reste vraie quand on zoome ; le shader continue de lire des fractions.
Relevé en cours de tracé : `1095 × 626 px`.

### 3. ⏸️ L'unité du panneau (écart 3) → [ticket 03](03-symetrie-panneau-toile.md)

Il déborde l'aplat : cinq effets ont des contrôles spatiaux en pourcentage.
Trancher ici créerait deux conventions.

### 4. ✅ Le rectangle noir n'est PAS un défaut (écart 4)

La recherche l'a retourné : chez Photoshop, une forme prend la **couleur de
premier plan**, dont le défaut est le noir
([recherche 01](../research/01-conventions-adobe.md)). Notre noir est donc la
convention, pas un oubli. Ce qui manquait était de pouvoir le changer AVANT de
tracer, et c'est livré (pastille et sélecteur dans la barre d'options).

### 5. ⏸️ La rotation au survol (écart 1) — délibérément NON fait

Adobe ne montre sa poignée de rotation qu'au survol de la forme ; la nôtre est
permanente. C'est « moins d'encre sur la toile », pas un geste cassé — et le
corps de la boîte étant désormais inerte dans l'outil Forme, un `:hover` sur
cette boîte ne se déclencherait plus. Le faire demanderait une cible de survol
séparée, donc un vrai travail pour un gain esthétique. Écarté, avec sa raison.
