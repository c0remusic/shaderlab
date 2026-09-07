# 13 — Poignées de transformation de la forme

**What to build:** La forme dessinée se retouche par des **poignées** sur la toile
(redimensionner, déplacer, tourner), pas par des curseurs — reprend le ticket 25
de `prochain-palier`, seul front bloqué par le chantier des outils sur la toile.
« Un rectangle se trace, les curseurs retouchent ce qui existe » ; les poignées
sont le geste de retouche attendu.

**Blocked by:** 12 — il faut une forme dessinée avant de la retoucher.

**Status:** ready-for-human
**Type:** task

- [x] Poignées de redimensionnement et de déplacement sur la forme sélectionnée.
      Huit pastilles écrivent les DEUX COINS de la source `shape` d'un calque
      d'effet (pivot = bord opposé, pas un scale) ; le clavier DÉPLACE la boîte.
- [x] Accessible au clavier (précédent `overlay transform inaccessible clavier`).
      Cadre focusable, flèches = déplacer (Maj = pas plus grand) ; les BORDS se
      règlent déjà aux quatre curseurs du panneau Masque — même partage que
      `TransformHandles` (flèches déplacent, champs Largeur/Hauteur redimensionnent).
- [ ] Validé à l'œil par Antoine — la fluidité du tirage se sent au pointeur, pas au harnais.

## Portée livrée (lecture du périmètre)

Le ticket citait « redimensionner, déplacer, tourner » ; le brief a resserré sur
le SOCLE des poignées d'étirement (`EffectTransformHandles`, `59f8594`). Livré :

- **Source `shape` de masque** (le marquee d'un calque d'effet, ticket 12) : elle
  n'avait AUCUNE poignée sur la toile. C'est le manque réel — nouveau composant
  `ShapeTransformHandles` + module pur `ui/shapeHandles.ts`.
- **Box d'`aplat`** : DÉJÀ retouchable par poignées depuis le 2026-08-18
  (ticket 25) — `canvasControls: [{ kind: "box" }]` rendu par `CanvasControls`
  via `boxControl.ts`/`TransformHandles`, 8 poignées + rotation, survit à l'outil
  Forme. Rien ajouté ici (l'y refaire aurait doublé le manipulateur).
- **Rotation** : hors périmètre pour la source `shape` — le modèle n'a pas de
  paramètre de rotation (`params = x0,y0,x1,y1,feather,invert,mode`). L'`aplat`,
  lui, tourne déjà par sa `box`.
- **Redimensionnement au clavier** : couvert par les quatre curseurs de bord du
  panneau Masque ; le clavier des poignées fait donc le DÉPLACEMENT, non couvert
  ailleurs (décision, cohérente avec `TransformHandles`).
