# Aplat passe à la qualité

Type: task
Status: claimed
Parent: ../map.md

> ⚠️ **Ce ticket portait `Blocked by: 17` et c'était une erreur de découpage.**
> Seul le FRONT 2 (les poignées) dépend du ticket 17 ; les fronts 1 et 3 ne
> dépendent de rien. Un ticket bloqué sur une partie qu'il n'a pas besoin de
> commencer par ne se prend jamais — le blocage est noté au front concerné, où
> il est vrai.

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

## ✅ Fronts 1 et 3 — livrés le 2026-08-17

**Front 1, le dégradé.** Trois modes de remplissage (`Couleur unie`, `Dégradé
linéaire`, `Dégradé radial`), un second arrêt de couleur, un angle et une
étendue. ⚠️ **Les deux arrêts sont convertis en LINÉAIRE avant d'être
interpolés** — un fondu mélangé en gamma passe par un milieu assombri, défaut
classique d'un dégradé fait à la main. Le scénario de verrouillage va du crème au
bleu sombre pour cette raison précise : sur deux teintes voisines le défaut serait
invisible.

Ni `ColorRampControl` ni `mask/sources/gradient.ts` n'ont été réutilisés, contre
ce que ce ticket suggérait : le premier pilote une rampe à N arrêts éditables
(bien plus que deux couleurs), le second est une source de MASQUE qui rend un
scalaire, pas une couleur. Les emprunter aurait coûté une adaptation plus grosse
que les vingt lignes de `mix`. À reconsidérer si un troisième arrêt est demandé.

**Front 3, le polygone.** Un paramètre, `cotes` (3 à 12). ⚠️ **Pas d'ÉTOILE**, et
c'est délibéré : elle demande deux rayons alternés donc une seconde géométrie, et
le cahier de postproduction n'en demande nulle part. L'ajouter « parce que
Photoshop l'a » violerait la règle du dépôt — ici il n'y a même pas de besoin
mesuré.

Le polygone partage la conversion en pixels de l'ellipse, pas seulement son
espace : c'est elle qui garantit que le bord n'est pas deux fois plus doux sur le
grand axe que sur le petit, et le défaut se serait reproduit à l'identique sur un
polygone étiré.

### Deux verrous posés

`effet-aplat-polygone` (13,2 % d'écart avec le rectangle de même boîte) et
`effet-aplat-degrade` (34,1 % avec le même aplat en couleur unie). Chacun ne
change QU'UNE chose par rapport à `effet-aplat`, donc l'écart mesure la capacité
et rien d'autre.

⚠️ **Aucune référence existante n'a bougé.** Les défauts reconduisent le rendu
d'avant au bit près — `remplissage` vaut 0, donc un preset écrit hier lit 0 sur
un paramètre absent de son document et rend exactement ce qu'il rendait.

### Ce que la garde de câblage a attrapé

Le shader avait été écrit en supposant que les paramètres du dégradé venaient
AVANT `cotes` : quatre index décalés, tous lisant du plausible.
`parametresCables.test.ts` les a nommés un par un. Sans elle, le mode de
remplissage aurait lu l'étendue, et le défaut ne se serait vu que sur un réglage
que personne n'aurait touché ce jour-là.

## Ce que ce ticket ne tranche PAS

L'outil de SÉLECTION, qui est un effort à part et hors du périmètre de cette
carte (voir sa section **Out of scope**). `aplat` peint ; il ne sélectionne pas.
