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

**Status:** done
**Type:** task

- [x] Les quatre verrous sont sur leur propre ligne, groupés avec fusion et opacité dans la carte Pile.
- [x] Libellé « Verrous : » devant les quatre icônes.
- [x] Le cadenas de la LIGNE du calque (plein/creux) est INCHANGÉ — marque d'état, pas contrôle répété.
- [x] Densité : ADR-0001 tenu, `test-storybook` EN ENTIER vert (gardes de densité comprises).
- [ ] Validé à l'œil par Antoine.

## ✅ LIVRÉ le 2026-08-21 (`f31c4ab`)

`LayerControls` (fusion, opacité, verrous, actions) redescend du panneau
Propriétés dans la carte Pile, en zone de contrôles fixe. Les verrous prennent
leur propre ligne avec le libellé « Verrous : ».

⚠️ **Le défaut était PIRE que décrit dans ce ticket.** Il disait « les verrous
partagent la ligne du sélecteur d'effet » ; mesuré au code, ils étaient dans un
PANNEAU DIFFÉRENT de la pile qu'ils commandent (`controlsContent` de
`PropertiesPanel`). Le regroupement au niveau du calque n'était donc pas un
rangement de confort, c'était la correction d'un niveau faux.

Gates verts : tsc, lint, lint:tokens, lint:css-comments, unit (2095),
storybook (338). Reste la validation à l'œil par Antoine.
