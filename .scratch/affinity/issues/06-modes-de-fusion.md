# Les modes de fusion manquants — et les deux mécanismes qui valent plus

Type: task
Status: open
Parent: ../map.md

## Le compte

Nous en avons **dix-sept** — recompté sur disque le 2026-08-19 au soir
(`src/render/blend/registry.ts`, 17 entrées). Affinity en expose **33**, lus
dans l'app par l'enum du SDK le même soir (`BlendMode.keys` — plus fiable que
le relevé de symboles, qui en avait trouvé 32) :

```
Normal · Pigment · Darken · DarkerColour · Multiply · ColourBurn · LinearBurn
Lighten · LighterColour · Screen · ColourDodge · Add · Overlay · SoftLight
HardLight · VividLight · PinLight · LinearLight · HardMix · Difference
Exclusion · Subtract · Divide · Hue · Saturation · Luminosity · Colour
Average · Negation · Reflect · Glow · ContrastInvert · Erase
```

Manquants chez nous : **quinze** utiles (`Average`, `ContrastInvert`,
`DarkerColour`, `Divide`, `Erase`, `Exclusion`, `Glow`, `HardMix`,
`LighterColour`, `LinearBurn`, `LinearLight`, `Negation`, `PinLight`,
`Reflect`, `VividLight`) — `Pigment` est Mixbox, écarté (nous ne peignons pas
de couleur).

## Pourquoi c'est peu cher

`blendMode` est une CHAÎNE : ajouter ou réordonner ne déplace aucun index de
preset, et l'ordre du registre EST celui du sélecteur. Un mode est un module
autonome, même patron que les effets.

## ⚠️ La règle qui décide de l'ESPACE, et ce n'est pas « comme Photoshop »

Le critère du dépôt est **« l'opérateur a-t-il une lecture physique ? »**.
`multiply` est en linéaire parce que multiplier deux transmittances FILTRE de la
lumière ; `overlay` et sa famille n'en ont aucune et décodent donc en sRGB.

À classer un par un, pas en bloc. `Divide` et `Add` ont une lecture physique.
`VividLight`, `PinLight`, `HardMix` n'en ont aucune. `Negation`, `Reflect`,
`Glow`, `ContrastInvert` sont à instruire.

## Les DEUX mécanismes autour, et ils valent probablement plus que les modes

1. **`BlendGamma`** — le gamma de fusion est réglable par l'utilisateur
   (`BlendGamma`, `IsBlendGammaPreview`, `TextBlendGamma`). Chez nous l'espace
   est décidé PAR MODE et gelé dans le code.
2. **`BlendRanges`** — le « Blend If » de Photoshop : limiter la fusion à une
   plage de valeurs, du calque source OU de celui du dessous. Aucun équivalent
   chez nous, et c'est un mécanisme, pas un mode de plus.

⚠️ **Quinze modes de plus, c'est quinze entrées dans une liste. Les plages de
fusion changent ce qu'on peut faire avec les dix-sept qu'on a déjà.** Si le
ticket doit être découpé, commencer par là.

## Ce qui prouve que le ticket est fini

Une variante de shader composée PAR MODE, avec un attendu DÉRIVÉ du registre —
le gate `test:wgsl` ne validait QUE `normal` jusqu'au 2026-08-18, et seize modes
sur dix-sept n'apparaissaient dans aucun shader composé.
