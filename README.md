# shaderlab

> Nom provisoire — le projet n'a jamais été baptisé pour de bon.

Application de bureau **Windows** pour appliquer des effets visuels temps réel à des
photographies JPEG. Les effets s'empilent en **calques**, chacun avec son masque au
pinceau, son opacité et son mode de fusion ; le rendu se fait sur le GPU, à la
résolution native de l'image, sans distinction entre aperçu et export.

Elle est née d'une frustration précise : aucun greffon Lightroom ne peut appliquer
d'effet GPU, le pipeline RAW étant fermé. C'est un outil personnel, développé en
public — pas un produit, pas de version distribuée, pas de support.

## Ce qu'elle fait

- **Vingt-six effets** empilables — halos (`glow`, `halation`, `lensFlare`,
  `lightLeak`), optique (`lensDistortion`, `lensBlur`, `motionBlur`, `glass`),
  déformation (`warp`, `displacementMap`), impression (`dither`, `hatching`,
  `halftone`, `outlines`…), couleur (`curves`, `channelMixer`, `gradientMap`…).
- **Dix-sept modes de fusion**, chacun dans l'espace colorimétrique que son
  opérateur justifie — le produit en lumière linéaire parce que multiplier deux
  transmittances filtre de la lumière, les autres en sRGB.
- **Masques par calque** : pinceau, dégradé linéaire ou radial, plage de
  luminosité, plage de couleur, forme — combinables, avec affinage de bord.
- Un **étage de développement** global appliqué au composite de la pile, portage du
  module *Develop* de Lightroom : étalonnage, réglages de base et courbe, TSL,
  color grading.
- Undo/redo, presets, recadrage de toile, verrous de calque.

## Lancer

Prérequis : Node 20+, Rust stable, et les dépendances de [Tauri v2](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev
```

## Vérifier

```bash
npm run test           # tests unitaires (Vitest, environnement Node)
npm run test-storybook # tests de composants (Vitest + Playwright)
npm run lint           # ESLint
```

Trois gates de plus ont besoin d'un vrai GPU et ne tournent donc pas en
intégration continue — elles se lancent en local, l'application ouverte avec son
port de débogage :

```bash
npm run test:render       # non-régression au pixel près (150 références)
npm run test:gpu-shaders  # compilation de tous les shaders composés
npm run test:wgsl         # validation statique du WGSL (celle-ci tourne en CI)
```

## Comment ce dépôt est écrit

Le code porte ses raisons. Un commentaire n'y décrit pas ce que fait la ligne
d'en dessous : il dit ce qui a été mesuré, ce qui a été essayé et refusé, et ce
qu'une prochaine lecture risque de croire à tort. Les chiffres cités sont
relançables — quand l'un d'eux se révèle faux, il est corrigé **et** signalé comme
l'ayant été.

Quelques points d'entrée :

| Question | Fichier |
| --- | --- |
| Comment le projet est organisé | `ARCHITECTURE.md` |
| Le vocabulaire du domaine | `CONTEXT.md` |
| Ce qui reste à faire | `docs/ROADMAP.md` |
| Les décisions tranchées, et pourquoi | `.claude/decisions/INDEX.md` |
| Les consignes de travail | `CLAUDE.md` |

## Licence

GNU General Public License, version 3 ou ultérieure (`GPL-3.0-or-later`) — texte
intégral dans [`LICENSE`](LICENSE). Choisie le 2026-09-23 : shaderlab est un outil
personnel, et la GPL permet d'y intégrer des travaux eux-mêmes sous GPL, comme la
simulation argentique [spektrafilm](https://github.com/andreavolpato/spektrafilm).
Toute donnée tierce intégrée garde sa propre licence, citée à côté d'elle.
