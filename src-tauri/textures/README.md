# Textures livrées avec l'application

Ce dossier est empaqueté dans le build (`bundle.resources` de
`tauri.conf.json`). Il sert de **jeu de départ minimal**, et rien d'autre.

## ⚠️ Ce dossier n'est PAS la bibliothèque

La bibliothèque réelle est **`Images/shaderlab-textures`**, jumelle de
`Images/shaderlab-export`. C'est là que vivent les scans, et `default_texture_dir`
la résout en premier.

La distinction a un coût mesuré derrière elle : le jeu CC0 téléchargé le
2026-08-05 pèse **2,64 Go pour 44 matières 8K**. Posé ici, il partirait dans
l'installateur ET serait recopié dans le dossier cible à **chaque build**,
`tauri dev` compris. Un dossier de ressources se garde petit ou vide.

Ordre de résolution (`default_texture_dir`, premier existant) :

1. `Images/shaderlab-textures` — la bibliothèque de l'utilisateur ;
2. `<ressources>/textures` — ce dossier-ci.

Et par-dessus, la bibliothèque **retient le dernier dossier désigné à la main**
(`localStorage`), qui gagne sur les deux.

## Règle de licence — une seule, et elle n'a pas d'exception

**Seul du CC0 (ou équivalent domaine public) peut être déposé ici.** Ce dossier
part dans l'installateur : tout ce qu'il contient est REDISTRIBUÉ.

| Source | Licence | Résolution |
| --- | --- | --- |
| [ambientCG](https://ambientcg.com/) | CC0 1.0, usage commercial, sans attribution | jusqu'à 8K, JPG et PNG |
| [Poly Haven](https://polyhaven.com/license) | CC0 | 8K minimum |

⚠️ **Un pack payant ne va jamais ici** — Fox Rockett Surface Supply, True Grit
Texture Supply, RetroSupply et les autres se vendent avec une licence
d'utilisation, pas de redistribution. Pour ceux-là, le bouton « Dossier… » lit
un dossier quelconque de la machine et en retient le chemin. Rien n'est copié,
rien n'est redistribué.

⚠️ Les textures PBR arrivent en paquets multi-cartes (Color, Normal, Roughness,
Displacement, AO). **Seule la carte Color sert ici** — les autres encodent de la
géométrie de surface pour un moteur 3D et ne rendent rien de lisible en overlay.
Le jeu téléchargé ne contient que des `*_Color.jpg`, extraits par requêtes HTTP
Range depuis les zips (ambientCG ne sert pas les cartes à l'unité — vérifié) :
2,64 Go tirés au lieu des ~15 Go qu'auraient pesé les zips complets.

## Pourquoi les images ne sont pas versionnées

Le `.gitignore` de ce dossier exclut les images. Un scan 8K pèse de 30 à 100 Mo
en JPEG ; git ne sait ni compresser ni différencier du binaire, et l'historique
enflerait définitivement.

Conséquence assumée : **un dépôt fraîchement cloné n'a aucune image**, ici comme
dans `Images/shaderlab-textures`. Le panneau le dit et invite à désigner un
dossier — il ne prétend pas qu'il n'y a rien à voir.

## Dimensions — la limite est dure, pas indicative

`assertImageFitsGpu` (`src/render/limits.ts`) refuse toute image dont un côté
dépasse `maxTextureDimension2D`. shaderlab ne demande aucun `requiredLimits`,
donc le device reçoit les limites par défaut de la spec WebGPU : **8192**.

- 8192 × 8192 passe, exactement à la limite. C'est le format de tout le jeu CC0
  téléchargé — il n'y a aucune marge au-dessus.
- 8193 est refusé, par un bandeau d'erreur au moment du clic.

La bibliothèque lit les dimensions dans l'en-tête sans décoder
(`src/textures/imageDimensions.ts`), les affiche sous chaque vignette, et
**désactive** celles qui dépassent — voir le problème avant de cliquer.
