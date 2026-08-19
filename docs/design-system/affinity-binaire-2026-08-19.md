# Lire le binaire d'Affinity — trois portes, et DEUX sont ouvertes

> ⚠️ Le titre a dit « une seule est ouverte » pendant quelques heures. Faux :
> la porte des plugins Photoshop est ouverte aussi, et c'est la plus large.
> Voir la correction en porte 2.

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

## Porte 2 — un hôte de plugins tiers : ⚠️ **OUVERTE** (correction du 2026-08-19)

> **CE PARAGRAPHE ÉTAIT FAUX ET IL EST CORRIGÉ CI-DESSOUS.** Il concluait
> « FERMÉE » parce que j'avais cherché les marqueurs Photoshop dans
> `libplugins.dll`. **Ce n'est pas le bon module** : `libplugins.dll` est le
> sous-système de CODECS. L'hôte de plugins Photoshop vit dans
> `libpersona.dll`, et il y est sans ambiguïté :
>
> ```
> .8bf   PIPL   PIMI   PluginMain
> RGBMode   RGB48Mode   RGB96Mode   CMYKMode
> ?LoadPiPL@PhotoshopPluginFile@@QEAA_NPEAX_K@Z
> ...V?$Counted@VPhotoshopPlugin@@@Kernel@@AEAUFilterRecord@PSP@@...
> ```
>
> ⚠️ **CORRECTION DU 2026-08-19 AU SOIR, SUR LE MODULE.** Ces symboles ne sont
> PAS dans `libpersona.dll`. Recompté en cherchant les chaînes en ASCII *et* en
> UTF-16 (un assembly .NET stocke les siennes en UTF-16, et le premier comptage
> ne regardait que l'ASCII) : `libpersona.dll` porte **une** occurrence de
> `FilterRecord` et **zéro** de `PhotoshopPluginWrapper`,
> `RasterFilterPluginWrapper`, `SupportsPhotoshopPlugins`, `AllowUnknownPlugins`
> ou `LiveFilter`. Tous vivent dans **`Serif.Affinity.dll`**, qui porte aussi
> 172 occurrences de `LiveFilter` et 42 de `PhotoshopPlugin`.
>
> **Le fait tient — l'hôte de plugins Photoshop existe** — mais le module cité
> était faux, et c'est exactement le genre d'erreur qui a déjà mordu trois fois
> dans ce fil : la mesure était juste, l'endroit était mauvais.
>
> Et `Serif.Affinity.dll` porte une page de préférences ENTIÈRE :
> `PhotoshopPluginsPreferencesPage` avec dossiers de recherche, dossiers
> détectés, bouton d'ajout de répertoire, colonne de statut
> (`Working` / `WorkingWithSandboxException` / `Broken` / `Unknown`), et une
> case `AllowUnknownPlugins`. Plus `SupportsPhotoshopPlugins`,
> `PhotoshopPluginWrapper`, `RasterFilterPluginWrapper`.
>
> **Conséquence : « porter nos effets dans Affinity » redevient possible**, par
> un plugin de filtre au format Photoshop — un DLL natif exposant `PluginMain`
> et recevant un `FilterRecord` avec les pointeurs de pixels. Un tel plugin peut
> tout faire, y compris ouvrir son propre device GPU. Les modes de pixels
> annoncés incluent `RGB96Mode`, donc **32 bits flottants**.
>
> ⚠️ Ce que ça coûterait n'est pas mesuré : C++ contre TypeScript, WGSL à
> reporter sur une API que le plugin peut ouvrir lui-même, et un filtre `.8bf`
> est appliqué UNE FOIS — la pile de calques non destructive resterait celle
> d'Affinity, pas la nôtre. À chiffrer avant d'y croire.
>
> **Troisième fois dans ce fil que je conclus d'une absence** — et les trois
> fois, l'absence était dans l'endroit où j'avais regardé, pas dans le produit.

### Ce que disait la version fausse, conservé pour mémoire


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

## Verdict, après correction

**Une porte fermée, deux ouvertes.**

| Porte | État | Ce qu'elle permet |
| --- | --- | --- |
| SDK JavaScript | fermée | 5,2 s par passe : automatiser, pas calculer |
| **Plugin Photoshop `.8bf`** | **ouverte** | du code natif, son propre GPU, 8/16/32 bits |
| Texture procédurale | ouverte | des équations par pixel, dans leur interface |

**« Porter nos effets dans Affinity » n'est donc PLUS un non technique.** C'est
un arbitrage de produit, et il se pose autrement : un plugin `.8bf` nous fait
écrire du C++ et rendre nos shaders sur une API que le plugin ouvre lui-même,
pour hériter de LEUR pile de calques, de LEURS masques, de LEUR export — et
perdre les nôtres.

**Ce qu'il reste à mesurer**, et c'est chiffrable :

1. **Le contrat `.8bf` réel** — un filtre est-il appliqué une fois (destructif)
   ou Affinity l'enveloppe-t-il en filtre live ? La différence décide de tout.
2. **Le langage de la texture procédurale**, et combien de nos vingt-sept
   effets s'y expriment.

## La leçon, et c'est la troisième fois

J'ai conclu **trois fois** d'une absence, et les trois fois l'absence était à
l'endroit où j'avais regardé, pas dans le produit :

1. « aucun chemin GPU programmable » — lu dans le SDK, démenti par le binaire ;
2. « pas d'hôte de plugins » — cherché dans `libplugins.dll`, qui est le
   sous-système de CODECS ; l'hôte est dans `libpersona.dll` ;
3. « Affinity 3 ne charge plus les `.8bf` » — inventé pour expliquer le point 2.

**Le point 3 est le pire** : il ne venait d'aucune mesure. Il rationalisait un
résultat négatif en lui fabriquant une histoire plausible — « la porte s'est
refermée entre les versions » — et cette histoire était assez crédible pour que
je l'écrive dans un commit.
