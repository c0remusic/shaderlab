# Provenance et licences — pack de textures livré

Ce fichier est la **preuve de conformité** du pack CC0 embarqué dans
`src-tauri/textures/` (empaqueté par `bundle.resources`, donc REDISTRIBUÉ).
Ticket 09 (`.scratch/retour-usage-execution/issues/09-plus-de-textures.md`),
récupéré le 2026-09-07.

## Source unique : Texture Ninja (CC0 1.0)

- **Site** : https://texture.ninja/
- **Auteur** : Joost Vanhoutte
- **Licence déclarée** (verbatim, site) : « All textures on Texture Ninja are
  released into the public domain (CC0). Free for personal & commercial use,
  no attribution required. »
- **Nature de la preuve** : CC0 déclaré par l'auteur (site + article CGPress),
  pas de deed CC0 par fichier au téléchargement — d'où cette table archivée
  (recherche 08 §2). CC0 autorise la redistribution commerciale sans attribution ;
  la table reste par prudence et traçabilité, pas par obligation.
- **URL de fichier** : chaque `cdnUrl` ci-dessous est l'origine exacte du scan
  (CDN Texture Ninja), redimensionné à 2048 px (côté long, LANCZOS) et ré-encodé
  JPEG q92. Pack complet : **19 textures, 19.55 Mo**.

## Curation — axée RELIEF

Chaque candidat a été MESURÉ avant d'être retenu (le manque du ticket : les
scans PBR déjà connus sont des albédos plats, ~10 niveaux/255 ; une carte de
déplacement lit une PENTE). Métriques sur la version 2K livrée :
`distinct` = niveaux de luma distincts /255 (bin > 0,02 % des pixels) ;
`std` = écart-type de luma ; `rstd` = écart-type du résidu haute fréquence
(luma − flou gaussien r=4) = le relief fin qu'un displacement lit.

| Fichier livré | Famille (catégorie TN) | Clé source TN | URL de fichier | Dim. livrée | distinct | std | rstd |
|---|---|---|---|---|---|---|---|
| `sl-01-bark-coarse.jpg` | Bark | `bark_7816.jpg` | https://d1wumrtbuo797i.cloudfront.net/bark_7816.jpg | 1365×2048 | 206 | 46.6 | 28.29 |
| `sl-02-bark-fine.jpg` | Bark | `Bark-1482.jpg` | https://d1wumrtbuo797i.cloudfront.net/Bark-1482.jpg | 1106×2048 | 193 | 35.0 | 25.69 |
| `sl-03-stone-wall.jpg` | Stone / Stone Walls | `StoneWall-3129.jpg` | https://d1wumrtbuo797i.cloudfront.net/StoneWall-3129.jpg | 2048×1367 | 201 | 48.2 | 27.87 |
| `sl-04-stone-wall-blocks.jpg` | Stone / Stone Walls | `StoneWall--4.jpg` | https://d1wumrtbuo797i.cloudfront.net/StoneWall--4.jpg | 2048×658 | 215 | 43.5 | 26.49 |
| `sl-05-wood-rough.jpg` | Wood / Rough | `Wood-1242.jpg` | https://d1wumrtbuo797i.cloudfront.net/Wood-1242.jpg | 2048×944 | 209 | 41.5 | 28.84 |
| `sl-06-wood-grain.jpg` | Wood / Rough | `Wood-3390.jpg` | https://d1wumrtbuo797i.cloudfront.net/Wood-3390.jpg | 2048×1349 | 145 | 28.6 | 22.28 |
| `sl-07-cracks-mud.jpg` | Cracks | `Cracks_008.jpg` | https://d1wumrtbuo797i.cloudfront.net/Cracks_008.jpg | 2048×609 | 170 | 42.4 | 24.68 |
| `sl-08-cracks-fine.jpg` | Cracks | `Cracks_022.jpg` | https://d1wumrtbuo797i.cloudfront.net/Cracks_022.jpg | 2048×1367 | 197 | 33.7 | 21.64 |
| `sl-09-metal-diamond.jpg` | Metal / Diamond Metal | `metal_4474.jpg` | https://d1wumrtbuo797i.cloudfront.net/metal_4474.jpg | 2048×1365 | 192 | 30.3 | 25.46 |
| `sl-10-rock.jpg` | Rock | `Stone-2358.jpg` | https://d1wumrtbuo797i.cloudfront.net/Stone-2358.jpg | 2048×1293 | 220 | 44.5 | 21.62 |
| `sl-11-rock-weathered.jpg` | Rock | `rock_6769.jpg` | https://d1wumrtbuo797i.cloudfront.net/rock_6769.jpg | 2048×1365 | 214 | 40.8 | 19.43 |
| `sl-12-fiberboard.jpg` | Wood / FiberBoard | `WoodFiberboard-6496.jpg` | https://d1wumrtbuo797i.cloudfront.net/WoodFiberboard-6496.jpg | 2048×1367 | 214 | 55.4 | 17.02 |
| `sl-13-stone-plain.jpg` | Stone / Plain | `stone_7667.jpg` | https://d1wumrtbuo797i.cloudfront.net/stone_7667.jpg | 2048×1365 | 158 | 29.3 | 21.99 |
| `sl-14-fabric-tarp.jpg` | Fabric | `Tarp-0486.jpg` | https://d1wumrtbuo797i.cloudfront.net/Tarp-0486.jpg | 2048×1367 | 118 | 24.3 | 21.8 |
| `sl-15-fabric-denim.jpg` | Fabric | `FabricJeans-1591.jpg` | https://d1wumrtbuo797i.cloudfront.net/FabricJeans-1591.jpg | 2048×896 | 134 | 23.7 | 20.35 |
| `sl-16-concrete.jpg` | Concrete | `concrete_7241.jpg` | https://d1wumrtbuo797i.cloudfront.net/concrete_7241.jpg | 2048×1365 | 135 | 22.6 | 19.13 |
| `sl-17-wood-planks.jpg` | Wood / Planks | `wood_planks_5740.jpg` | https://d1wumrtbuo797i.cloudfront.net/wood_planks_5740.jpg | 2048×1365 | 183 | 32.2 | 16.96 |
| `sl-18-plaster-damaged.jpg` | Plaster / Damaged Plaster | `Plaster_Damaged-3888.jpg` | https://d1wumrtbuo797i.cloudfront.net/Plaster_Damaged-3888.jpg | 2048×848 | 151 | 35.6 | 13.99 |
| `sl-19-metal-brushed.jpg` | Metal / Plain Metal | `metal_8133.jpg` | https://d1wumrtbuo797i.cloudfront.net/metal_8133.jpg | 2048×1365 | 122 | 21.3 | 11.75 |
