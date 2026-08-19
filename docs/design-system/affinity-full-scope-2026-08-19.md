# Affinity, relevé COMPLET — outils, masques, UX, UI

Antoine : « quoi d'autres ? Et pour la qualité de nos outils ? Et l'ux ? Et
l'ui ? Et le masque ? Full scope ». Suite de
[`affinity-ce-quon-peut-lui-prendre-2026-08-19.md`](affinity-ce-quon-peut-lui-prendre-2026-08-19.md),
qui ne couvrait que les filtres.

**Méthode.** Symboles C++ non strippés de `libraster.dll`, `librastertools.dll`,
`libaffinity.dll`, `libcommands.dll`, plus les noms de types .NET de
`Serif.Affinity.dll` — celui-là est managé, donc ses noms sont lisibles tels
quels. Lecture seule.

⚠️ **Un nom de classe prouve l'EXISTENCE, jamais la qualité.**
`BandpassMaskRasterNode` existe ; ce qu'il rend ne se lit pas dans un symbole.
Tout ce qui suit est une carte de ce qu'ils ont, pas un jugement sur ce que ça
vaut. Et l'inverse : ce qu'ils n'ont pas nommé peut exister sous un autre nom.

---

## 1. Les LIVE FILTERS — 44, et l'architecture est la nôtre

```
Bilateral · Bloom · BoxBlur · Clarity · Defringe · Denoise · DepthOfField
Diffuse · DiffuseGlow · DisplacementMap · DustAndScratches · FieldBlur
Gaussian · Glitch · Halftone · HighPass · LensBlur · LensDistortion
Lighting · Liquify · Maximum · MedianBlur · MeshWarp · Minimum · MotionBlur
MultiBandSharpen · Noise · NoiseReduction · Perspective · PinchPunch
Pixelate · ProceduralTexture · RadialBlur · Ripple · ShadowsHighlights
Sphere · Texture · Twirl · UnsharpMask · Vignette · Voronoi
```

**Un « live filter » est un CALQUE de filtre non destructif, empilable et
masquable.** C'est exactement notre modèle de calque d'effet. Sur ce point
structurel, nous ne sommes pas en retard — nous avons la même idée.

Ce qu'ils ont en plus : `CanMergeLiveFilterDown` (fusionner un filtre dans le
calque du dessous).

**Ce qu'ils ont et que nous n'avons pas, comme filtres** :
`Liquify`, `MeshWarp`, `Perspective`, `PinchPunch`, `Ripple`, `Vignette`,
`Clarity`, `ShadowsHighlights`, `HighPass`, `MultiBandSharpen`, `Median`,
`Bilateral`, `Maximum`, `Minimum`, `DustAndScratches`, `Denoise`, `Defringe`,
`Pixelate`, `Voronoi`, `Twirl`, `Sphere`, `Diffuse`, `DiffuseGlow`.

⚠️ Mais `Maximum`/`Minimum`/`Median`/`Box` sont des primitives de traitement, pas
des effets d'auteur. Et **`surfaceBlur` (bilatéral) a été RETIRÉ chez nous par
ADR-0011 sur arbitrage d'usage** — leur `Bilateral` n'est donc pas un manque,
c'est une décision déjà prise en sens inverse.

## 2. Les AJUSTEMENTS — 26, et c'est une FAMILLE SÉPARÉE

```
3DLUT · BlackWhite · BrightnessContrast · ChannelMixer · ColourBalance
Curves · Exposure · GradientMap · HSL · Invert · LensFilter · Levels
Normals · OCIO · Posterise · Recolour · SelectiveColour · ShadowsHighlights
SoftProof · SplitToning · Threshold · ToneCompression · ToneStretch
Vibrance · WhiteBalance
```

⚠️ **La distinction ajustement / filtre est un choix de TAXONOMIE que nous
n'avons pas fait.** Chez eux, un ajustement remappe des valeurs sans regarder les
voisins ; un filtre lit un voisinage. Chez nous, `curves`, `channelMixer`,
`gradientMap`, `duotone` vivent dans le même registre que `glass` et
`lensFlare` — notre `EFFECT_CATEGORIES` range en six catégories éditoriales, mais
la frontière « par pixel / par voisinage » n'y est pas.

**Ce qu'ils ont et pas nous** : `Levels`, `Exposure`, `WhiteBalance`,
`Vibrance`, `SelectiveColour`, `SplitToning`, `BlackWhite`, `Threshold`,
`3DLUT`, `Recolour`, `LensFilter`, `Normals`, `ToneCompression`/`ToneStretch`.

⚠️ **`3DLUT` mérite d'être noté à part** : notre binding 7 (`libraryTexture`,
ADR-0018) sait déjà charger une image ; une LUT 3D est un cas particulier de
texture. Le mécanisme est là.

## 3. LES MASQUES — le relevé le plus riche, et notre plus gros écart

**Chez nous** : quatre sources (`brush`, `gradient`, `luminosity`, `colorRange`),
trois modes de combinaison (`add`, `subtract`, `intersect`), un affinage de bord
(`feather`, `contract`, `smooth`, `edgeAware`, `edgeRadius`, `edgeStrength`),
inversion, activation.

**Chez eux**, un `LiveMask` composite à cinq sources :

```
AddCompoundBrushMaskCommand              <- nous l'avons
AddCompoundGradientMaskCommand           <- nous l'avons
AddCompoundLuminosityRangeMaskCommand    <- nous l'avons
AddCompoundHueRangeMaskCommand           <- nous avons colorRange, proche
AddCompoundObjectSelectionMaskCommand    <- MANQUE (sélection d'objet par IA)
```

Plus `BandpassMaskRasterNode` — **un masque par BANDE DE FRÉQUENCE**, qui n'a
aucun équivalent chez nous et qui est conceptuellement neuf : masquer par la
finesse du détail plutôt que par le ton ou la teinte.

**Et six mécanismes autour du masque que nous n'avons pas du tout :**

| Leur mécanisme | Ce que ça fait | Chez nous |
| --- | --- | --- |
| `MaskTexture` · `MaskTextureMode` · `MaskTextureScale` | **texturer le masque lui-même** | rien |
| `CreateMaskPresetCommand` (+ rename/delete) | **presets de MASQUE** | presets d'effet seulement |
| `QuickMask` | peindre une sélection en surimpression, à la bascule | rien |
| `MaskColour` · `SetMaskColour` | la couleur de surimpression est réglable | rouge en dur |
| `RefineSelectionTool` + `RefineSelectionToolPanel` | un OUTIL d'affinage, pas des curseurs | curseurs seulement |
| `MaskToBelow` · `ReleaseMask` · `ApplyMask` · `RasteriseToMask` | le masque circule entre calques | rien |

⭐ **`MaskTexture` est l'idée la moins chère et la plus proche de notre terrain.**
Texturer un masque — grain, papier, rayures — c'est exactement ce que notre
bibliothèque de textures fait déjà pour les effets (binding 7). Un masque
texturé donne des bords sales et organiques que ni le pinceau ni le dégradé ne
produisent, et c'est la matière même de notre positionnement analogique.

## 4. LES SÉLECTIONS — nous n'en avons AUCUNE

```
RasterSelectionBrushTool · RefineSelectionTool · SelectionRasterNode
GrowShrinkSelection · OutlineSelection · SetRasterSelectionFromPolygon
SetRasterSelectionFromObject · feather/smooth/grow/outline
```

Notre `LayerStack` a bien `rasterSelectAll`, `rasterDeselect`,
`growShrinkRasterSelection`… **côté Affinity**. Chez nous, il n'y a pas de
concept de sélection du tout : on peint un masque, point.

⚠️ **Ce n'est peut-être pas un manque.** Une sélection est un masque temporaire
sans calque ; notre modèle dit « tout est un masque de calque ». C'est une
position défendable, pas un oubli — mais elle n'a jamais été écrite comme une
décision.

## 5. LES PINCEAUX — douze chez eux, un chez nous

```
PaintBrush · EraseBrush · PixelBrush · AdjustmentBrush · BurnBrush
DodgeBrush · FilterBrush · InpaintingBrush · SharpenBrush · ToneBrush
UndoBrush · FadeRewind
```

Trois idées structurelles, pas seulement « plus de pinceaux » :

- **`FilterBrush` et `AdjustmentBrush`** — peindre un FILTRE ou un AJUSTEMENT
  localement, au lieu de peindre une couleur. Leurs paramètres le confirment :
  `FilterTypeToAdd`, `FilterBlendMode`, `FilterTonalRange`, `AdjustmentTypeToAdd`.
- **`UndoBrush`** — repeindre vers un état d'historique (le pinceau d'historique
  de Photoshop).
- **`ToneBrush`** avec `ToneBrushTonalRange` — agir sur une plage tonale seule.

**Et un moteur de pinceau, pas une brosse ronde** : `BrushEngine`,
`BrushDynamic`, `BrushDynamicController`, `BrushNozzle`,
`BitmapNozzleGenerator`, `RoundRasterBrush`, `SquareRasterBrush`,
`IntensityBitmapRasterBrush`, `AddPressureProfile`.

⚠️ Et **`MixboxBlend` / `MixboxInterpolate`** : ils embarquent Mixbox, le mélange
de couleurs par modèle PIGMENTAIRE. Deux traits qui se croisent mélangent comme
de la peinture, pas comme des nombres.

Notre pinceau : rayon, dureté, opacité, débit, gomme. **Correct pour un masque,
et c'est son seul usage** — nous ne peignons pas de la couleur.

## 6. UX — ce qui n'est pas un outil mais qui décide du geste

**Le magnétisme est un SYSTÈME**, pas une case :

```
SnappingGrid · SnappingGridCube · SnappingGridRotation · SnappingGridPresets
SnappingOptions · SnappingPlane · SnappingSetup · SnappingTargetInterface
SnappingEditorController
```

Une grille orientable, en plan ou en cube, avec des **presets**. Chez nous, le
magnétisme existe sur `TransformHandles` et rien d'autre.

**La barre contextuelle est une architecture** : `ContextBarPanel`, `ToolPanel`,
`SubToolPanel`, `ToolTrayPanel`, `CreateToolPanel`, `EffectToolPanel`,
`ModifySelectionToolPanel`, `RefineSelectionToolPanel`… **un panneau par outil**,
et des SOUS-outils. Nous avons une barre d'options unique (ticket 27) qui coûte
75 px de hauteur permanente.

## 7. UI — trois observations qui portent

1. **Panneaux VIRTUALISÉS** : `VirtualizingPanel`, `VirtualizingTilePanel`,
   `VirtualizingWrapPanel`, `UniformVirtualizingTilePanel`,
   `DockedVirtualizingStackPanel`. Ils ne rendent que les lignes visibles. Notre
   `LayerPanel` rend tout — invisible à cinq calques, mesurable à deux cents.
2. **DEUX studios, gauche ET droite** : `IsLeftStudio` / `IsRightStudio`. Notre
   dock est à droite seulement, et c'est lui qui débordait à 1280 × 720.
3. **Une bibliothèque d'ASSETS** : `AssetListPanel`, `AssetTilePanel`. Nous avons
   des presets d'effet et une bibliothèque de textures, séparément.

---

## Ce qu'il faut en prendre — classé par rapport gain / coût

### À faire, le mécanisme existe déjà chez nous

1. ⭐ **Texturer le masque** (`MaskTexture`). Le binding 7 charge déjà des
   images pour les effets ; un masque texturé donne les bords sales que notre
   positionnement analogique réclame. **C'est l'idée la plus alignée du relevé.**
2. ⭐ **Plage tonale sur `glow`** (relevé précédent, `tonalRangeControl` existe).
3. **Couleur de surimpression du masque réglable** — la nôtre est rouge en dur.
   Un rouge sur une photo rouge ne se voit pas.
4. **LUT 3D** comme ajustement — le binding 7 sait déjà charger l'image.

### À trancher, parce que c'est une position et pas un manque

5. **Sélections** — leur modèle a des sélections ET des masques ; le nôtre n'a
   que des masques. Défendable, jamais écrit. À poser en ADR dans un sens ou
   dans l'autre.
6. **Ajustement contre filtre** — ils séparent « par pixel » de « par
   voisinage ». Nos six catégories éditoriales ne portent pas cette frontière,
   et c'est peut-être elle qui manque au sélecteur d'effet.

### Chantiers, à charter s'ils sont voulus

7. **Masque par bande de fréquence** (`Bandpass`) — masquer par finesse de
   détail. Neuf, et personne d'autre ne le fait.
8. **Pinceau de filtre / d'ajustement** — peindre un effet localement. Notre
   modèle (un effet = un calque + un masque) le fait déjà en deux gestes ; leur
   pinceau le fait en un.
9. **Presets de masque**.
10. **Panneaux virtualisés** — inutile aujourd'hui, obligatoire à deux cents
    calques. À noter, pas à faire.

### Écarté

- **Bilatéral** — retiré chez nous par ADR-0011, décision déjà prise.
- **Moteur de pinceau à dynamiques, nozzles, Mixbox** — hors sujet : nous
  peignons des masques, pas de la peinture.
- **Astro, super-résolution, portrait, IA générative** — un autre produit.
