# Le verrou est binaire là où Photoshop en a quatre

Type: grilling
Status: resolved
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

---

## Answer — TRANCHÉ le 2026-08-18 : QUATRE verrous

Arbitrage d'Antoine : quatre verrous, comme Photoshop. Ce que ce ticket devait
donc résoudre n'est plus le nombre, mais le faux ami qu'il avait lui-même nommé.

### Le faux ami se lève par une lecture de domaine

Le ticket posait « Lock Image Pixels n'a pas de sens direct ici : un calque
d'effet n'a pas de pixels propres ». C'est vrai des pixels, et ça rate ce que le
calque possède réellement :

> **Le MASQUE d'un calque d'effet EST son canal alpha.**

Là où Photoshop distingue « pixels transparents » et « pixels d'image », nous
distinguons **le masque à zéro** et **le masque tout court**. La correspondance
est exacte, et il n'y a aucun vocabulaire à inventer — c'était la crainte du
ticket, et elle tombe.

### Le partage des opérations

⚠️ **Elles sont DIX-SEPT, pas quatorze.** Ce ticket et `CLAUDE.md` annoncent tous
deux « quatorze opérations » ; mesuré sur `layerStack.ts`, il y a dix-sept gardes
`isLocked`. Troisième dénombrement de prose pris en défaut sur cette carte.

| Verrou | Ce qu'il refuse | Opérations |
| --- | --- | --- |
| **Position** | la géométrie, et rien d'autre | `updateLayerTransform`, plus `updateParams` restreint aux paramètres cités par `canvasControls` (`centreX`, `centreY`, `largeur`, `hauteur`, `rotation`) |
| **Masque** | ce que le calque COUVRE | `updateBrushMask`, `fillBrushMask`, `addMaskSource`, `removeMaskSource`, `updateMaskSourceParams`, `setMaskSourceCombineMode`, `updateRefineEdge`, `setMaskInvert`, `setMaskEnabled`, `setMaskSourceEnabled`, `setLayerImageSource` |
| **Transparence** | l'EXTENSION du masque — on peint dedans, jamais dehors | écrêtage de `updateBrushMask` / `fillBrushMask` aux texels déjà non nuls |
| **Tout** | les dix-sept | les trois ci-dessus, plus `setLayerEffect`, `setLayerClip`, `removeLayer`, `reorderLayer` |

### ⚠️ « Transparence » n'est pas de la même nature que les trois autres

Les trois autres **refusent** une opération : un test, un `return false`. Le
verrou de transparence **laisse passer l'opération en modifiant son résultat** —
le pinceau écrit, mais borné. Deux conséquences qui doivent être tenues à
l'écriture :

1. Il ne peut pas se poser au même endroit que les autres dans `LayerStack`.
2. Il doit s'exprimer **aussi dans `MaskPainter`**, qui est le chemin réel du
   pinceau vivant — même piège que `replaceLiveLayers`, la porte que les gardes
   ne couvraient pas. Une règle posée au seul endroit propre ne protège que ce
   que personne ne fait.

### Ce que la mesure a réglé sans débat

- **Les presets ne bougent pas.** `locked` n'apparaît pas une seule fois dans
  `presetDocument.ts` (0 occurrence). Passer d'un booléen à quatre drapeaux n'y
  casse rien.
- **Les deux garde-fous durs tiennent** : le déverrouillage reste toujours
  atteignable, et la visibilité du calque n'est jamais bloquée, quel que soit le
  verrou.

### Ce qui reste à confirmer avant d'écrire

Deux points que la planche pose et que la mesure ne tranche pas :

- **La lisibilité du plein/creux à 12 px.** Le cadenas de statut fait
  `--icon-size-xs`, soit 12 px. La convention d'Adobe (plein = tout verrouillé,
  creux = partiellement) doit se lire à cette taille, pas seulement en principe.
  Les deux glyphes sont rendus à leur taille réelle sur la planche.
- **L'indépendance des quatre bascules**, « Tout » allumant les trois autres —
  c'est le modèle d'Adobe, mais il n'a pas été confirmé ici.

Planche : [`docs/wireframes/quatre-verrous.html`](../../../docs/wireframes/quatre-verrous.html).
