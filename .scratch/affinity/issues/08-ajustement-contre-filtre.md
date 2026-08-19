# Ajustement contre filtre — la frontière que nous n'avons pas

Type: grilling
Status: open
Parent: ../map.md

## Le constat

Affinity sépare deux familles, et la frontière est nette :

- **26 AJUSTEMENTS** — remappent des valeurs sans regarder les voisins :
  `Levels`, `Curves`, `Exposure`, `WhiteBalance`, `HSL`, `ChannelMixer`,
  `GradientMap`, `SelectiveColour`, `SplitToning`, `Threshold`, `3DLUT`…
- **44 LIVE FILTERS** — lisent un voisinage : les flous, `Glitch`, `Halftone`,
  `Liquify`, `Voronoi`, `HighPass`…

**Chez nous, `curves` et `glass` vivent dans le même registre.** Notre
`EFFECT_CATEGORIES` (`effects/catalog.ts`) range en six catégories
ÉDITORIALES ; la frontière « par pixel / par voisinage » n'y est pas.

## Pourquoi ça pourrait compter — ce n'est pas qu'un menu

La frontière porte des propriétés réelles :

- un opérateur par pixel est **exact à toute échelle** ; un opérateur à
  voisinage dépend de la résolution, et c'est pour ça qu'une vignette ne
  ressemble pas au rendu final ;
- deux opérateurs par pixel se **composent sans passe intermédiaire** — une
  optimisation que `shaderCompose` ne fait pas aujourd'hui ;
- un opérateur par pixel s'exprime dans une **texture procédurale**
  ([ticket 02](02-langage-texture-procedurale.md)) ; l'autre non.

## Les questions

- Notre `EFFECT_CATEGORIES` gêne-t-il réellement quelqu'un, ou est-ce une
  élégance à ne pas payer ?
- Si la frontière est réelle, doit-elle se voir dans l'INTERFACE (deux listes)
  ou seulement dans le MODÈLE (un drapeau sur `EffectModule`) ?
- ⚠️ **Combien de nos 27 effets sont réellement « par pixel » ? À MESURER.** Un
  effet peut n'échantillonner qu'un texel sans qu'on l'ait jamais noté. Le
  chiffre décide s'il y a une frontière ou seulement deux ou trois cas — et sans
  lui, ce ticket n'est qu'une intuition de taxonomie.

## Ce qui prouve que le ticket est fini

Le compte mesuré, et une décision : soit un drapeau sur `EffectModule` avec ce
qu'il permet concrètement, soit l'écriture noir sur blanc que la frontière ne
nous sert à rien.
