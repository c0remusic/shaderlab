# Le layout, mesuré contre les deux références

Type: grilling
Status: open
Parent: ../map.md

## Question

Énoncé d'Antoine : « Fait un max de recherche pour qu'on atteigne la qualité et
le workflow photoshop, **pareil pour le layout** ».

**Qu'est-ce qui, dans la disposition de l'app, s'écarte de ce qu'un utilisateur
de Photoshop ou de Lightroom attend ?**

## ⚠️ Ce que la recherche N'A PAS trouvé, et c'est le point de départ

Relevé du 2026-08-18 sur sources primaires Adobe : **aucune source ne donne de
gabarit chiffré.** La documentation est descriptive — « le panneau Propriétés
montre W et H », « la barre d'options est en haut » — jamais dimensionnelle.
Aucune largeur de panneau, aucune hauteur de barre, aucun rapport.

**Conséquence directe : ce ticket ne peut pas se résoudre par de la recherche.**
Il se résout par des MESURES sur notre app et par des captures comparées. Le
chercher plus loin dans la documentation serait du temps perdu, et c'est le
genre de recherche qu'on continue par habitude quand elle a déjà rendu ce
qu'elle avait.

## Ce qu'on sait déjà de notre layout, mesuré

- **La barre d'options est permanente et haute de 75 px** depuis le 2026-08-18.
  La toile perd 75 px en permanence, y compris sous *Déplacer* qui n'a rien à
  régler. C'est un arbitrage rendu (ticket 27), pas un défaut — mais c'est la
  plus grosse dépense de hauteur de l'app.
- **Le dock est à droite**, largeur par défaut 320 px, borné à 240–400, avec un
  rail d'icônes. Référence assumée : Photoshop.
- **La colonne du dock ne défile pas** — ADR-0001 l'interdit ; ce sont les
  cartes qui se compriment, avec un plancher en lignes.
- **Aucune section de panneau ne dépasse six lignes visuelles** depuis le
  2026-08-18, exception écrite comprise.

## Ce qu'il faut interroger

- **Quel écart Antoine a-t-il vu ?** L'énoncé met le layout en second, après
  « la qualité et le workflow ». C'est peut-être une conséquence des autres
  points (une barre qui bouge, un cadenas mal posé) plutôt qu'un sujet propre.
  À vérifier AVANT d'ouvrir un chantier de disposition.
- **Le prix de la barre permanente se voit-il ?** 75 px sur une fenêtre de
  720 px, c'est 10,4 % de la hauteur. Sur un écran large, rien ; sur un portable,
  beaucoup. La mesure existe, le jugement non.
- **Lightroom et Photoshop ne disposent PAS pareil**, et l'app doit choisir :
  Lightroom met ses réglages dans une colonne unique qui défile, Photoshop les
  éclate en panneaux flottants ou dockés. Nous avons pris Photoshop (dock,
  cartes, rail) avec une contrainte de Lightroom (pas de défilement de colonne).
  L'hybride est-il assumé, ou est-ce le mélange qui gêne ?
- **Que fait la barre d'options de *Déplacer* ?** Elle porte une phrase d'aide.
  C'est le seul endroit de l'app où une bande de 75 px ne sert qu'à écrire une
  phrase.

## Contraintes dures

- ADR-0001, dans sa lettre : zone de contrôles fixe hors du conteneur défilant,
  liste défilante DANS le panneau, hauteur de panneau bornée, **jamais un
  défilement de colonne**.
- La palette d'outils ne doit pas bouger quand on change d'outil — mesuré à
  0 px depuis le 2026-08-18, et c'était un vrai défaut avant.

## Ce qui prouve que ce ticket est fini

Un écart NOMMÉ, mesuré sur notre app, et une décision. Pas « le layout a été
revu ».

⚠️ Et si la réponse est « il n'y avait pas d'écart de layout, c'étaient les
autres points », **c'est une réponse valide et il faut l'écrire**. Le pire
résultat serait de refondre une disposition qui allait bien parce qu'un ticket
existait.
