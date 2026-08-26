# 03 — Les verrous remontent au niveau du calque

**What to build:** Les quatre verrous cessent d'être accrochés au sélecteur
d'effet et rejoignent les autres attributs du CALQUE (fusion, opacité), sur
**leur propre ligne** avec le libellé **« Verrous : »** — modèle Photoshop, qui
groupe fusion / opacité / *Lock:* au même endroit de son panneau Calques. L'état
enfoncé du verrou actif est déjà livré (`db9777e`) ; ce ticket règle leur PLACE.

⚠️ **Ce n'est pas cosmétique.** Les verrous étaient posés sur la ligne « Effet »
pour une raison de PLACE, pas de sens — le commentaire du code le dit en toutes
lettres (« se logent dans la place libre de la ligne Effet »). Ils agissent sur le
calque mais pendent au sélecteur d'effet : c'est une cause du « l'icône pinceau ne
fait rien », pas seulement un mot manquant. Relevé par Antoine le 2026-08-21.

**Blocked by:** 02 — le sélecteur d'effet part en colonne Propriétés, ce qui libère
la ligne et rend le regroupement possible.

**Status:** ready-for-agent
**Type:** task

- [ ] Les quatre verrous sont sur leur propre ligne, groupés avec fusion et opacité dans la carte Pile.
- [ ] Libellé « Verrous : » devant les quatre icônes.
- [ ] Le cadenas de la LIGNE du calque (plein/creux) est INCHANGÉ — marque d'état, pas contrôle répété.
- [ ] Densité : ADR-0001 tenu, `test-storybook` EN ENTIER vert (gardes de densité comprises).
- [ ] Validé à l'œil par Antoine.
