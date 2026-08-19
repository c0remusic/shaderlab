# Comment Affinity fait ce que notre 16 bits ne sait pas faire

Relevé le 2026-08-19 sur les binaires. **Répond à un arbitrage que le dépôt a
laissé ouvert en toutes lettres.**

## L'arbitrage bloqué chez nous

`.scratch/prochain-palier/research/01-16-bit-hors-du-depot.md` §1.7 pose deux
phrases et constate qu'elles ne peuvent pas être vraies ensemble :

1. `CLAUDE.md` § Stack : « chaîne de couleur en sRGB par le FORMAT, jamais par
   un gamma manuel en WGSL » ;
2. le fait mesuré : sur 101 formats `GPUTextureFormat`, les **23 variantes
   `-srgb` sont TOUTES des `unorm`**. `rgba16float-srgb` n'existe pas.

Et le document conclut, littéralement : « Ce document ne choisit pas lequel
céder ». L'export print bute donc dessus avant sa première ligne.

## Ce que fait Affinity — et il ne se pose pas la question

**Ils n'ont AUCUN drapeau sRGB de format.** Leur calcul est en OpenCL
(`KERNEL_PREAMBLE`, `__global source_type* input_pixels`) : un buffer OpenCL
n'a pas de notion d'espace colorimétrique. La question ne se pose pas parce que
le mécanisme n'existe pas chez eux.

À la place, la fonction de transfert est une **DONNÉE portée par un profil**, et
`libraster.dll` en montre toute la machinerie :

```
ICCProfile · ICCProfileSet · ICCManager · SetICCProfile · GetICCProfile
GetLinearRGBProfile · IsLinear · GetGammaForProfile · GetApproximateGamma
Linearization · LinearizationTable · GammaEncoding
CreateHardwareICCTransform          <- la transformation est accélérée
OCIOManager · OCIOConvert · OCIODisplay · OCIOLoadFromFile
LUT · LUT8 · LUT16 · LUT3D · CLUT · SoftProof · Intent
```

`IsLinear` et `GetLinearRGBProfile` sont les deux qui comptent : le moteur SAIT
si le buffer courant est linéaire, et sait fabriquer le profil linéaire
correspondant à un profil donné. L'encodage n'est pas un effet de bord du
format — c'est une étape nommée, au moment choisi.

## Et leur profondeur de bits

Côté interface : `Depth8Bit`, `Depth16Bit` dans le menu de format de document.
Le 32 bits est une chose à part — `RGB32BitHDR`, `EnableHDR`, `IsHDRAvailable`,
`Unbounded`, `HDRClipping`/`HDRClippingValues`, `ToneMapHDRImage`, et une
`ToneMappingPersona` entière. Plus `GainMap`, `AddGainMapToJPEG`,
`HDRCapacityMin`/`Max`, `HDRHeadroom` — les gain maps HDR modernes.

⚠️ **Le 32 bits n'est pas « le 16 bits en plus grand » chez eux.** Il amène son
propre écrêtage, son propre tone mapping, et un persona dédié. Si notre export
print vise le 16 bits, c'est bien le 16 qu'il faut viser — pas le flottant par
facilité.

## Ce que ça apporte à l'arbitrage

**La troisième voie que notre document ne listait pas : ne pas choisir entre les
deux phrases, mais retirer au FORMAT le rôle de porter l'espace.**

Concrètement, l'invariant deviendrait :

> La chaîne de couleur est LINÉAIRE de bout en bout, et l'encodage sRGB est une
> ÉTAPE EXPLICITE et unique, à la frontière de sortie.

Ce n'est pas « un gamma manuel en WGSL » au sens que `CLAUDE.md` interdit —
l'interdit visait des conversions dispersées et implicites, refaites dans chaque
effet. Une étape d'encodage unique, nommée, à un seul endroit, est le contraire
de ce défaut. C'est d'ailleurs **déjà** ce que fait le chemin actuel : la vue
srgb ne sert qu'à la passe FINALE (`gpuContext.ts:155-164`).

⚠️ **Mais ça reste un arbitrage, et ce document ne le rend pas.** Trois choses
manquent avant de trancher :

1. **Le coût mesuré** de l'encodage explicite contre l'encodage par le format.
   Le matériel fait la conversion gratuitement aujourd'hui ; en WGSL elle coûte
   une fonction de transfert par pixel de la passe finale. À mesurer, pas à
   supposer négligeable — la règle du dépôt sur les mesures en build de prod.
2. **Ce que deviennent les sept modules** qui consomment `srgbFormat`
   (`effectPassRunner`, `imageFrameResources`, `textureLibraryStore`,
   `photoLayerInput`, `photoSourceStore`, `presentPass`, `renderer`).
3. **Les 119 références de pixels.** Un changement d'espace de la chaîne les
   déplace toutes, ou aucune — et il faut savoir laquelle des deux AVANT.

## Ce que ce relevé ne dit pas

Il ne dit pas qu'Affinity a raison. Un moteur OpenCL n'a pas le choix : il
n'existe aucune conversion de format à laquelle se raccrocher. **Leur solution
est peut-être une contrainte déguisée en architecture**, et la nôtre — laisser
le matériel faire — reste plus rapide tant qu'on est en 8 bits.
