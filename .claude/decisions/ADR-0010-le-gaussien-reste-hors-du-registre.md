---
id: ADR-0010
status: active
date: 2026-08-01
---

# ADR-0010 : le flou gaussien reste hors du registre

## Contexte

La famille des flous de Photoshop a été portée le 2026-08-01, à la demande
d'Antoine : `lensBlur` (noyau d'objectif — pondération des hautes lumières et
diaphragme à N lames, plus quatre géométries de champ qui couvrent Iris et
Tilt-Shift), `motionBlur` (trois trajectoires — directionnelle, rotation, zoom,
donc Path Blur et Spin Blur) et `surfaceBlur` (bilatéral). Le cadrage vient du
§6ter du cahier de références du 2026-08-01.

Ce même paragraphe pose le constat qui commande cette décision : **le vrai
clivage de la Blur Gallery n'est pas entre ses cinq outils, il est avec le
gaussien.** Un gaussien moyenne uniformément ; il sert à réduire le détail, pas
à imiter un objectif. Sur une photo, il « lave » l'image — il efface les
contours en même temps que ce qu'on voulait atténuer.

La question se pose parce que la parité est tentante : Photoshop l'expose, tout
éditeur d'images en a un, et son absence se lit facilement comme un oubli.

## Décision

**Aucun `gaussianBlur`, `boxBlur` ou `averageBlur` n'entre au registre des
effets.** Un test du registre le vérifie (`surfaceBlur.test.ts`).

La barre de qualité du projet est explicite : « pas de rendu filtre Photoshop
2005 ; un effet qui marche mais rend cheap n'est pas terminé » (CLAUDE.md § Quoi).
Poser un gaussien au registre serait livrer sciemment ce rendu-là, et le
justifier par la parité avec un logiciel dont on a précisément décidé de ne pas
copier les défauts.

## Conséquences

- **Un flou doux reste atteignable** : `lensBlur` à intensité de bokeh nulle
  dégénère en une moyenne pondérée par la seule distance, ce qui EST un flou
  ordinaire. Le paramètre le dit dans son libellé (« À 0 le flou est une
  moyenne — c'est-à-dire un gaussien, et il lave l'image »). La capacité existe
  donc ; ce qui est refusé, c'est de la présenter comme un outil à part entière.
- ~~**Le lissage sans perte de contour a son propre effet** : `surfaceBlur`, un
  bilatéral. C'est lui qu'on cherche quand on croit vouloir un gaussien pour
  nettoyer un ciel ou une peau — et il fait le travail sans effacer les bords.~~
  ⚠️ **CADUC depuis ADR-0011 (2026-08-03)** : `surfaceBlur` est sorti du registre
  sur verdict d'usage. Le refus du gaussien tient toujours — il ne s'appuyait pas
  sur cette conséquence — mais l'échappatoire qu'elle offrait n'existe plus. Voir
  ADR-0011, qui prend cette perte en charge explicitement.
- **Les flous de la chaîne interne ne sont pas concernés.** `blurChain.ts`
  (`glow`, `halation`) et les passes de `gooeyMerge` emploient des noyaux
  pyramidaux : ce sont des étages de calcul, pas des effets choisissables. La
  décision porte sur le REGISTRE, c'est-à-dire sur ce que l'utilisateur peut
  poser en calque.
- **Cette décision est révisable sur un usage réel, pas sur un argument de
  parité.** Si un besoin concret apparaît qu'aucun des trois flous ne couvre, il
  faudra le nommer — « Photoshop l'a » n'est pas ce besoin.

## Alternatives écartées

- **L'ajouter en le documentant comme déconseillé.** Un effet au registre est un
  effet qu'on pose ; l'avertissement vit dans un fichier que l'utilisateur ne lit
  pas. Le refus doit être structurel pour tenir.
- **Le cacher derrière un réglage de `surfaceBlur` (seuil au maximum).** C'est
  déjà vrai techniquement — un seuil très haut accepte tous les voisins et le
  bilatéral redevient un flou ordinaire — mais en faire un usage recommandé
  reviendrait à livrer le gaussien par la porte de service.
