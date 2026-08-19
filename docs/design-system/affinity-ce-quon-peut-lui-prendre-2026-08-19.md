# Le sens inverse — ce que le binaire d'Affinity apprend à shaderlab

Antoine : « on peut aussi faire dans le sens inverse pour voir comment améliorer
shaderlab ». Suite de [`affinity-binaire-2026-08-19.md`](affinity-binaire-2026-08-19.md).

**Méthode.** `librastertools.dll` (164 Mo) n'est pas strippé : ses symboles C++
nomment chaque outil ET chaque paramètre. Un symbole
`?GetDiffuseThreshold@DiffuseGlowTool@RasterTools@@` dit « l'outil DiffuseGlow a
un paramètre DiffuseThreshold », en anglais quelle que soit la langue de
l'interface — là où les libellés d'écran sont localisés et noyés.

Extraction par regex sur la chaîne entière : **52 outils, 423 paramètres**.

⚠️ **Le compte brut ment.** Une bonne moitié des 423 est de l'infrastructure —
`ToolID`, `Description`, `ObjectClassProperties`, `ProgressType`, les douze
champs d'historique. Les comptes ci-dessous sont donnés APRÈS retrait de ce
bruit ; les deux colonnes ne sont comparables que comme ça.

## Là où nous sommes DEVANT

| Nous | Affinity | Écart |
| --- | --- | --- |
| `motionBlur` 7 | MotionBlur 2 (`Radians`, `Radius`) | trajectoire, biais, tombée |
| `texture` 9 | Texture 3 | échelle, rotation, décalage, pivot |
| `grain` 5 | AddNoise 3 | dépendance à la luminance |
| `lensBlur` 11 | LensBlur 7 | quatre géométries de champ |
| `lensFlare` 33 | *(rien)* | ils n'ont pas de flare |
| `lensDistortion` 16 | *(rien)* | — |

Et **dix-huit de nos effets n'ont aucun équivalent chez eux** : `halation`,
`glass`, `warp`, `displacementMap`, `duotone`, `hatching`, `halftone`, `dither`,
`gooeyMerge`, `channelMixer`, `curves`, `isolines`, `pixelStretch`,
`gradientMap`, `aplat`, `outlines`, `lensFlare`, `lensDistortion`.

**Les deux bibliothèques ne visent pas la même chose.** La leur est
photographique et retouche (astro, portrait, profondeur de champ, super-résolution) ;
la nôtre est optique, analogique et imprimée. Ce n'est pas un retard.

## Là où ils sont DEVANT — les six idées à prendre

### 1. ⭐ Le BLOOM se règle par PLAGE TONALE

```
Bloom : ShadowBlend/ShadowValue · MidtoneBlend/MidtoneValue
        HighlightBlend/HighlightValue · Colour · ColourValue · Method · Strong
```

Notre `glow` a **quatre** paramètres : `threshold`, `knee`, `intensity`,
`spread`. Un seuil unique décide de ce qui brille. Eux dosent le halo
**séparément dans les ombres, les tons moyens et les hautes lumières**, chacun
avec son mélange ET sa valeur.

C'est l'idée la plus directement transposable du lot, et le mécanisme existe déjà
chez nous : `EffectModule.tonalRangeControl` est utilisé par `curves`. Aucun
mécanisme neuf à écrire.

### 2. ⭐ Le ZMAP — un effet piloté par une CARTE, pas par une géométrie

Leur profondeur de champ a **quatre** modes de champ : `Elliptical`, `Field`,
`TiltShift`, **`ZMap`**. Les trois premiers sont des géométries — nous les avons
sur `lensBlur`. Le quatrième prend une **carte de profondeur en entrée**.

Nous avons exactement la pièce qu'il faut : `displacementMap` (2026-08-18) lit
une image par le binding 7 d'ADR-0018, et le mécanisme est **générique dès son
écriture**. Rien n'empêche `lensBlur` de déclarer un `libraryTexture` et de lire
son rayon dedans.

⚠️ Sauf que `validateEffect` **refuse** `libraryTexture` + passes internes — la
limite déjà notée pour `lensFlare`. `lensBlur` a des passes. C'est donc ce
verrou-là qu'il faudrait lever d'abord, et il gouverne plus d'un effet.

### 3. Les ÉQUATIONS écrites par l'utilisateur, à DEUX endroits

```
EquationTransform : XEquation, YEquation, Polar, AnglesInDegrees, FactorA/B/C
ApplyImage        : C1..C5, EquationsEnabled, EquationsMode, BlendMode, SourceMode
ProceduralTexture : Config, ConstantValues, PresetsFilter, InputsPresetMode
```

Trois filtres où l'utilisateur écrit du code. `EquationTransform` est un WARP
défini par deux équations, en cartésien ou en polaire. Notre `warp` est un FBM
paramétré ; le leur est ouvert.

⚠️ **C'est aussi la réponse à la question de la veille** : ils ont bien un chemin
programmable, et il y en a trois, pas un.

### 4. L'ÉCLAIRAGE depuis une carte de relief

```
Lighting : Ambient, AmbientColour, Diffuse, Specular, SpecularColour,
           Shininess, Depth, BumpMapOpacity, Lights (plusieurs), ScaleXToFit
```

Un Phong complet, avec **plusieurs sources** et une carte de relief. Notre
`emboss` (5 paramètres : rendu, angle, force, épaisseur, entrée) ne garde que la
DIRECTION du gradient et éclaire d'une seule lumière implicite.

### 5. `FadeRewind` — fondre la DERNIÈRE opération

```
FadeRewind : Fade, BlendMode
```

Photoshop l'appelle `Édition > Atténuer`. On applique un effet à fond, puis on le
dose APRÈS coup, avec un mode de fusion. Ce n'est pas un effet : c'est une
propriété de l'historique.

⚠️ Chez nous, c'est **déjà là et gratuit** — un calque d'effet a son `opacity` et
son `blendMode`. Ce point ne coûte rien à cocher : c'est un avantage de notre
modèle en calques, pas un manque.

### 6. Le GLITCH a dix-neuf paramètres réels, notre `sliceShift` en a huit

```
Glitch : GlitchMethod, GlitchChannel, GlitchNumChannels, ChannelCoefficients,
         GlitchStrengthHorizontal/Vertical, AdditionalStrength, Stagger,
         ShredSpacing, InvertDirection, RadiusX, RadiusY, Angle, Origin, …
```

Deux idées qu'on n'a pas : **le décalage par CANAL avec ses coefficients**
(`GlitchChannel`, `ChannelCoefficients`) et le **décalage horizontal ET vertical
séparés**. Notre `chromaSplit` est un scalaire.

## Ce que ce relevé NE dit pas

- **Un nom de paramètre n'est pas une implémentation.** `Bloom.Method` existe ;
  ce qu'il vaut ne se lit pas dans un symbole. Toute idée reprise ici demande
  d'être regardée à l'écran avant d'être codée — la règle du dépôt sur les
  apparences.
- **Rien sur la qualité de leur rendu.** Ce relevé compte des paramètres, ce qui
  est exactement le genre de mesure dont `CLAUDE.md` dit qu'elle convainc sans
  rien prouver.
- **Le filtrage du bruit d'infrastructure est fait à la main.** Un paramètre réel
  a pu partir avec, ou l'inverse.

## Ordre proposé, si on prend

1. **Plage tonale sur `glow`** — le mécanisme existe (`tonalRangeControl`), le
   gain est visible, rien à débloquer.
2. **Lever `libraryTexture` + passes internes dans `validateEffect`** — ça
   débloque le ZMap sur `lensBlur` ET la texture sur `lensFlare`, deux d'un coup.
3. **Décalage par canal sur `sliceShift`** — petit, et notre `chromaSplit` est
   déjà l'amorce.
4. Le reste (éclairage Phong, équations utilisateur) est un chantier, pas une
   amélioration.
