# Le verrou est binaire là où Photoshop en a quatre

Type: grilling
Status: open
Parent: ../map.md

## Question

Le verrou VERROUILLE depuis le 2026-08-18 : le trou du chemin vivant est fermé,
les manipulateurs ne se rendent plus sur un calque verrouillé, et l'icône a
retrouvé sa taille. Ce ticket ne rouvre pas ça.

**Faut-il plusieurs verrous, comme Photoshop, ou un seul suffit-il ?**

## Ce que la recherche a établi

[Recherche 01](../research/01-conventions-adobe.md), source primaire Adobe :
Photoshop expose **quatre** verrouillages — pixels transparents, pixels d'image,
POSITION, et tout — et **l'icône est PLEINE quand le calque est entièrement
verrouillé, CREUSE quand il l'est partiellement**.

Le cas d'usage est donné par Adobe, et il est précis : verrouiller partiellement
un calque qui a déjà la bonne transparence et les bons styles **pendant qu'on
hésite encore sur son placement**.

## Pourquoi ça nous concerne plus qu'avant

Nos quatorze opérations refusées le sont ENSEMBLE. On ne peut donc pas geler la
géométrie d'un aplat en continuant à régler sa couleur — or c'est exactement le
geste que la barre d'options a rendu courant le même jour : la couleur se règle
maintenant à deux endroits, et la forme se tire à la main.

Le geste « je tiens la position, je cherche encore la couleur » n'a aucune
expression chez nous.

## ⚠️ Le faux ami à ne pas transposer

« Lock Image Pixels » n'a **pas de sens direct ici** : un calque d'effet n'a pas
de pixels propres, il transforme ce qui est en dessous. Recopier les quatre
verrous d'Adobe demanderait de dire ce qu'est un « pixel » pour un effet — c'est
une question de DOMAINE, pas de recopie d'interface.

Le seul des quatre qui se transpose sans débat est **Lock Position**, qui chez
nous voudrait dire : geler la géométrie (`centreX`, `centreY`, `largeur`,
`hauteur`, `rotation`, et le transform d'un calque photo) en laissant le reste
réglable.

## Ce qu'il faut interroger

- **Deux verrous suffisent-ils ?** « Position » et « Tout » couvriraient le cas
  nommé par Adobe sans inventer un vocabulaire de pixels qui n'existe pas ici.
- **Comment l'icône dit-elle « partiel » ?** La convention d'Adobe est
  plein/creux. Notre cadenas est une pastille dans la cellule d'état ; deux
  formes y tiennent-elles sans devenir illisibles à 12 px ?
- **Où se posent les verrous ?** Le CONTRÔLE a migré dans la zone de contrôles
  de la carte (ADR-0001) et la ligne ne porte que l'ÉTAT. Deux verrous, c'est
  deux contrôles dans cette zone — ou un menu, ce qu'ADR-0001 n'a jamais
  tranché.
- **Que devient un preset ?** `locked` n'est pas dans `params[]` ; un verrou
  partiel ajouterait un champ au calque. Vérifier ce que `presetDocument` en
  fait avant de choisir la forme.

## Contraintes dures

- **`replaceLiveLayers` est la porte de tous les gestes vivants.** Un verrou
  partiel doit s'y exprimer, sinon il ne protégera que ce que personne ne fait —
  c'est exactement le défaut corrigé le 2026-08-18.
- Le déverrouillage et la visibilité restent toujours autorisés, quel que soit
  le verrou : un verrou irréversible ou qui empêche de masquer est hostile.

## Ce qui prouve que ce ticket est fini

Une décision écrite sur le NOMBRE de verrous et sur ce que chacun refuse,
opposable au chemin vivant. Si la réponse est « un seul suffit », elle doit dire
ce qu'on répond au cas « je tiens la position, je cherche la couleur ».
