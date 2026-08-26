# 02 — Réglages d'effet en panneau latéral (deux colonnes)

**What to build:** Les réglages de l'effet sélectionné passent d'un onglet de la
colonne de dock à une DEUXIÈME colonne, à côté de la pile — comme le panneau
*Properties* de Photoshop / le panneau *Develop* de Lightroom. Content-sized, sans
défilement (ADR-0001), groupes à onglets préservés (on ajoute une colonne, on ne
rouvre pas le layout déjà tranché).

Wireframe : `docs/wireframes/reglages-panneau-lateral.html`.

**Blocked by:** None — can start immediately.

## ✅ Décisions arrêtées (Antoine, 2026-08-21)

- **Colonne Propriétés à GAUCHE**, collée à la toile.
- **Masque reste un onglet de la carte Pile** (avec la pile, pas avec les Propriétés).
- **Le sélecteur d'effet part en tête de la colonne Propriétés** — c'est « ce que
  fait ce calque », pas un attribut de la pile.
- **Les verrous sont rendus au niveau du CALQUE** : leur propre ligne avec le
  libellé « Verrous : », groupés avec fusion et opacité (modèle Photoshop, qui met
  fusion / opacité / *Lock:* au même endroit). ⚠️ Ils étaient posés sur la ligne
  « Effet » pour une raison de PLACE, pas de sens — le commentaire du code le dit
  en toutes lettres. C'est la cause de la lecture bancale, pas un détail de style.
- **Le cadenas sur la LIGNE du calque reste** (plein = total, creux = partiel) :
  marque d'état, pas contrôle répété — ADR-0001 interdit le second, pas la première.

**Status:** done
**Type:** prototype

- [x] Les réglages de l'effet s'affichent dans une colonne distincte à GAUCHE de la pile, côté toile.
- [x] Le sélecteur d'effet est en tête de cette colonne, plus dans la carte Pile.
- [x] Dans la carte Pile : fusion, opacité et verrous groupés ; les verrous sur leur propre ligne avec le libellé « Verrous : ».
- [x] Aucune colonne ne défile ; chacune prend la hauteur de son contenu (`curves` 37 params compris).
- [x] Groupes à onglets intacts (hybride ticket 04 non rouvert) ; Masque toujours onglet de la Pile.
- [ ] Largeur totale du dock à deux colonnes mesurée sur l'app (repli si nécessaire) — ça se mesure, la doc Adobe ne chiffre rien.
- [x] `test-storybook` EN ENTIER (changement de layout — gardes de densité comprises).
- [ ] Validé à l'œil par Antoine.

## ✅ LIVRÉ le 2026-08-21 (`f31c4ab`)

Disposition par défaut à deux colonnes : Propriétés d'abord (côté toile), pile
ensuite. Aucune infrastructure ajoutée — `DockLayout` est un `DockGroup[][]`
depuis le 2026-08-19, seul le DÉFAUT change. Le sélecteur d'effet est monté en
tête des Propriétés (`EffectSelector`, neuf). Masque : rien à faire, il n'a
jamais été un panneau — il vit dans la ligne de calque et en onglet de facette
des Propriétés.

Gates verts : tsc, lint, lint:tokens, lint:css-comments, unit (2095),
storybook (338). Reste la validation à l'œil par Antoine, et la largeur du dock
à deux colonnes à mesurer sur petit écran.
