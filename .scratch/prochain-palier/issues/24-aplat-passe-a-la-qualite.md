# Aplat passe à la qualité

Type: task
Status: open
Blocked by: 17
Parent: ../map.md

## Question

`aplat` est entré au registre le 2026-08-17 sur arbitrage d'Antoine — « 2 mais
faut l'améliorer type photoshop ». Il est donc **le seul effet du registre encore
à sa version pipeline**, ce que la barre de qualité du dépôt n'admet pas
(`CLAUDE.md` : « un effet qui marche mais rend cheap n'est pas terminé »).

Trois fronts retenus par Antoine le même jour, sur quatre proposés. **Le contour
et le rayon d'angle ont été explicitement ÉCARTÉS** — ne pas les remettre sans
lui redemander.

## Front 1 — un remplissage en DÉGRADÉ

Photoshop a trois calques de remplissage : Couleur unie, Dégradé, Motif. `aplat`
ne fait que le premier. Le motif, lui, n'est pas à écrire — c'est l'effet
`texture`, déjà au registre.

Ce que le dégradé sert dans le cahier de postproduction : le §453 (aplat
d'espace négatif) et le §98 (« dégradés colorés localisés, plutôt qu'une
dominante uniforme »).

⚠️ **Le dépôt a déjà DEUX mécanismes de rampe, et il ne faut pas en écrire un
troisième** : `ColorRampControl` (le contrôle, `gradientMap`) et
`mask/sources/gradient.ts` (la géométrie linéaire/radiale). La question de
conception est laquelle réutiliser, pas comment en faire une.

## Front 2 — les POIGNÉES sur la toile

Aujourd'hui seul le CENTRE se manipule sur l'image (`CanvasControl` de genre
`point`) ; largeur, hauteur et rotation restent au curseur.

⚠️ **Ce front est BLOQUÉ par le [ticket 17](17-les-outils-sur-la-toile.md)**, et
c'est structurel, pas une précaution : `CanvasControl` n'a que trois genres —
`point`, `disk`, `axis` (`effects/types.ts:151`) — et aucun ne sait exprimer une
boîte redimensionnable avec rotation. Ajouter un quatrième genre touche un
mécanisme PARTAGÉ par quatre effets, donc ça se décide au ticket 17 et pas ici.

Matière déjà instruite : le [ticket 18](18-ce-qu-est-un-manipulateur-de-niveau-pro.md)
porte 42 lignes de grille sur ce qu'est un manipulateur de niveau professionnel,
dont les écarts chiffrés (poignées de 12 px pour 24 recommandés, zéro `:hover`
dans les quatre CSS d'overlay, aucune valeur affichée pendant le geste).

## Front 3 — plus de PRIMITIVES

Rectangle et ellipse seulement. Photoshop ajoute polygone, étoile, trait, et les
formes personnalisées.

Chacune est quelques flottants de plus dans la MÊME fonction de couverture —
c'est le point de conception déjà posé dans l'en-tête d'`aplat.ts`, et il faut le
tenir : rectangle et ellipse partagent `aplat_couverture`, et deux blocs séparés
auraient dérivé sur l'anticrénelage, qui est la seule partie difficile.

⚠️ **L'index d'un choix est PERSISTÉ dans les presets.** Une primitive nouvelle
s'ajoute à la FIN de la liste `choices` de `borne`, jamais au milieu — et les
trois références de pixels existantes citent `borne: 1` et `borne: 2`.

## Contraintes dures

- **Trois références de pixels existent déjà** (`effet-aplat`,
  `effet-aplat-ellipse`, `effet-aplat-hors-photo`) et se déplaceront à chaque
  front. Les relire à l'œil avant de committer.
- **`effet-aplat-hors-photo` verrouille `outAlpha = max(color.a, couverture)`.**
  C'est la propriété la plus facile à défaire par accident : sans elle, un aplat
  posé à côté de la photo disparaît, et l'effet a l'air correct partout où une
  photo couvre.
- **La paire rectangle/ellipse a un plancher de signal** : à 0,5 × 0,32 elle ne
  s'écartait que de 2,96 % et le gate a rougi. Leur différence n'est QUE les
  quatre coins (1 − π/4 de la boîte), donc toute réduction de la forme dans ces
  scénarios refait tomber le signal.

## Ce que ce ticket ne tranche PAS

L'outil de SÉLECTION, qui est un effort à part et hors du périmètre de cette
carte (voir sa section **Out of scope**). `aplat` peint ; il ne sélectionne pas.
