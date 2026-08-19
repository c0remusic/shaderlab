# Lire le binaire d'Affinity — trois portes, et une seule est ouverte

Suite de [`affinity-porter-les-effets-2026-08-19.md`](affinity-porter-les-effets-2026-08-19.md),
qui répondait « non » sur la foi du SDK JavaScript seul. Antoine : « et en
lisant le binaire d'affinity ? » — question juste, et elle change la réponse.

**Méthode** : lecture SEULE des binaires installés
(`C:\Program Files\WindowsApps\Canva.Affinity_3.2.3.4646_x64__8a0j1tnjnt4a4\App`),
extraction de chaînes et recherche de symboles. Recherche d'interopérabilité sur
une copie licenciée ; aucun binaire modifié, aucune protection touchée, rien
redistribué.

## Ce que le binaire montre de l'architecture

| Module | Taille | Rôle |
| --- | --- | --- |
| `libpersona.dll` | 359 Mo | l'interface |
| `librastertools.dll` | 164 Mo | **les filtres** |
| `librenderer.dll` | 82 Mo | le rendu |
| `libraster.dll` | 71 Mo | **le moteur de pixels** |
| `libplugins.dll` | 4,2 Mo | (voir porte 2) |
| `libscriptingjs.dll` | 21 Mo | le SDK JS |

**Le calcul GPU est en OpenCL**, pas en HLSL ni en Vulkan. `libraster.dll` porte
le gabarit de kernel en clair :

```c
#define OPENCL_KERNEL_LANGUAGE
#define device_address_space __global
#define KERNEL_PREAMBLE \
__kernel void Kernel(const __global source_type* input_pixels,
                     __global dest_type* output_pixels,
                     const __global mask_type* mask_pixels,
                     const __global mask_type* secondary_mask_pixels,
                     const __global void* sampler_pixels,
                     const __global void* process_pixels, ...)
    uint2 gid = uint2_literal(get_global_id(0), get_global_id(1));
#define KERNEL_POSTAMBLE }
```

Les macros `device_address_space` / `constant_address_space` disent pourquoi
c'est un gabarit : **la même source de filtre se compile en OpenCL OU en C++
CPU**. C'est leur portabilité, pas un point d'entrée.

⚠️ **Aucun shader n'est livré en fichier** (`*.hlsl`, `*.glsl`, `*.cl`, `*.spv` :
zéro). Rien à remplacer sur disque.

## Porte 1 — le SDK JavaScript : FERMÉE

Déjà mesurée : `readPixel`/`writePixel` un pixel à la fois, plancher **5,2 s**
pour une passe sur 26 Mpx contre 63 ms pour la pile complète de shaderlab.

## Porte 2 — un hôte de plugins tiers : FERMÉE

`libplugins.dll` ne contient **aucun** marqueur de plugin Photoshop — ni `8bf`,
ni `PiPL`, ni `SPBasic`, ni `FilterRecord`. Ses classes de plugin sont ses
propres codecs :

```
JpegXLImportPlugin · JpegXLExportPlugin · RasterImportPlugin
RasterExportPlugin · WebPExportPlugin        (+ LittleCMS)
```

⚠️ **Affinity Photo v1/v2 chargeait les `.8bf`. Affinity 3 sous Canva ne les
charge plus.** Cette porte était ouverte, elle s'est refermée — ne pas se fier à
un souvenir de la version précédente.

## Porte 3 — la TEXTURE PROCÉDURALE : OUVERTE

`ProceduralTextureCommand@RasterTools` existe dans la 3 — **238 occurrences**
dans `librastertools.dll`, 69 dans `Serif.Affinity.dll`, et `Equations` avec.

C'est le filtre où **l'utilisateur écrit ses propres équations par canal**, et il
passe par le même chemin OpenCL que les filtres intégrés. C'est donc du GPU, à
la vitesse d'Affinity, et c'est programmable.

Le catalogue de filtres qui l'entoure est d'ailleurs bien plus proche de notre
territoire que les dix effets de calque du SDK ne le laissaient croire :

```
Bloom · DiffuseGlow · Glitch · Voronoi · Twirl · LensBlur · MotionBlur
RadialBlur · DepthOfField (Elliptical/Field/TiltShift/ZMap) · AddNoise
UnsharpMask · Colourise · Lighting · PortraitLighting · Sphere · Texture
VerticalEdgeDetect · Deinterlace · EquationTransform · SuperResolve
```

## ⚠️ Ce que la porte 3 ne résout PAS, et qu'il faut mesurer avant d'y croire

1. **Elle n'est pas dans le SDK.** L'API `Document` que j'ai listée en entier ne
   contient AUCUNE méthode `procedural`. La texture procédurale est ouverte à un
   HUMAIN dans l'interface, pas à un script. Automatiser passerait par les
   macros (`importMacro` / `exportMacro`), non explorées.
2. **Le langage n'a pas été relevé.** Une expression par pixel ne fait pas un
   effet à voisinage : nos pyramides de flou (`blurChain`), les seize
   prélèvements de la diffusion du verre, les neuf passes du mode Échos
   d'`outlines` n'ont a priori rien pour s'exprimer là-dedans. Ce qui pourrait
   passer : `curves`, `duotone`, `gradientMap`, `channelMixer`, `dither`,
   `aplat` — des opérateurs par pixel. **Non vérifié.**
3. **Et la question de fond ne bouge pas.** Même si dix effets sur vingt-sept
   passaient, on aurait dix équations collées dans un filtre, sans nos presets,
   sans notre pile, sans nos masques par calque — et sans les dix-sept autres.

## Verdict

**Porter la BIBLIOTHÈQUE d'effets dans Affinity : toujours non.** Deux portes
sur trois sont fermées à clé, et la troisième n'accepte que ce qui tient en une
expression par pixel.

**Mais la question méritait d'être posée, et le relevé a corrigé une erreur du
document précédent** : celui-ci concluait « aucun chemin GPU programmable ». Il y
en a un — la texture procédurale — et je ne l'avais pas cherché parce que le SDK
ne le mentionne pas. Lire le SDK d'un outil ne dit pas ce que l'outil sait faire.

**Ce qui vaudrait le coup d'être mesuré ensuite**, si la question revient : le
langage exact de la texture procédurale, et combien de nos vingt-sept effets s'y
exprimeraient. C'est une demi-journée, et ça trancherait pour de bon.
