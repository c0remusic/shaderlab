# 05 — Vignettes de galerie des effets au survol

**What to build:** Dans le sélecteur « Ajouter un effet », survoler un effet montre
un aperçu basse-définition de ce qu'il ferait — galerie façon filtre Photoshop.
Résolution et moment de calcul (à la volée vs pré-calcul) selon le verdict du
ticket 04.

**Blocked by:** ~~04~~ — ✅ **DÉBLOQUÉ le 2026-08-21**, la mesure est faite.

## Ce que la mesure du ticket 04 a décidé

- **À LA VOLÉE au survol**, pas de pré-calcul — **à condition** d'avoir un rendu
  en taille vignette : la pile rend en **4,0 ms** à 0,03 Mpx (majorant, mesuré en
  dev). ⚠️ Ce chemin N'EXISTE PAS aujourd'hui : `exportFrame` rend à la taille du
  DOCUMENT, donc un aperçu de la photo réelle coûte **261 ms**, pas 4. Le premier
  travail de ce ticket est donc le rendu réduit, pas l'UI.
- **Le coût ne dépend PAS de l'effet** : `glass`, le plus cher du registre, rend
  exactement le même 4,0 ms que la photo nue à cette taille. Inutile de traiter
  les effets chers à part.
- **La résolution est libre** (le coût est un plancher, pas un produit) :
  choisir ce qui rend le mieux à l'œil. 200 × 150 mesuré.
- Mémoriser l'aperçu par effet après le premier survol suffit.
- Piste si les 4 ms gênaient un jour : le plancher est dominé par la RELECTURE
  CPU d'`exportFrame` ; un aperçu qui reste sur le GPU coûterait moins. Non
  mesuré, pas nécessaire aujourd'hui.

**Status:** ready-for-human
**Type:** task

## Cadrage du 2026-08-26 — architecture retenue, décision de fidélité PRÉPARÉE

**La décision de fidélité est prête à trancher SUR IMAGES** :
<https://claude.ai/code/artifact/c80e3b93-cfd8-4cb3-863e-928314271ceb> — 14
vignettes rendues par le VRAI pipeline (240×160, effets aux défauts,
photo-1.jpg), composite RÉDUIT contre CROP 1:1 côte à côte. Ce que la planche
montre : en réduit la photo se reconnaît et l'effet s'identifie (mais les
paramètres en pixels — dither, halftone, verre — paraissent ~26× trop gros) ;
en crop 1:1 l'échelle est exacte mais l'image est méconnaissable et le bruit
natif du JPEG à 100 % écrase les effets doux (lensFlare illisible). Reco :
**réduit** — convention des galeries de filtres, une vignette sert à
reconnaître, pas à mesurer. Régénérable : `assets/planche-05-fidelite.mjs`
(app lancée avec CDP + Vite 1421) puis `assets/planche-05-assemble.mjs`.

**Architecture retenue pour le chemin vignette** (exploration complète en
fichier:ligne dans l'historique de session, résumé) :
- **Mini-pile** : source 240×160 + le seul effet survolé — PAS la pile réelle
  réduite. Aligné sur la mesure du 04 (le coût ne dépend pas de l'effet) et
  évite les deux gouffres mesurés : les masques peints ne se ré-échantillonnent
  pas (`MaskTextureResolver` suppose un raster exactement `width×height`,
  `maskUpload.computeR8UploadRegion` lit `bytesPerRow = width` — un raster
  6240×4160 dans une texture réduite est silencieusement faux), et
  `allocateDocument` est destructif et monolithique (`renderer.ts:337-411`).
- **Second `Renderer` offscreen sur canvas détaché** (précédent direct :
  `render-check.mjs:3836-3878` — deux Renderer y coexistent déjà). `initGpu`
  crée un device NEUF : acceptable ici, la mini-pile n'upload que la source
  240×160 (~150 Ko), aucune texture à partager. Recompilation des shaders par
  effet : une fois, mémoïsée par le cache de pipelines du runner de la vignette.
- **La source vignette se fabrique depuis `exportFrame`** (261 ms, UNE fois par
  ouverture du sélecteur, mémoïsable par état de pile) réduite en canvas 2D.
- **La piste « rester sur le GPU »** (ticket 04) est notée non nécessaire :
  4 ms par survol suffisent.

- [ ] **[Antoine]** Trancher la fidélité sur la planche : réduit, crop 1:1, ou
      autre chose que la planche fait surgir.
- [ ] Un chemin de rendu de la pile à taille VIGNETTE existe (architecture
      ci-dessus ; la décision de fidélité choisit la SOURCE, pas le mécanisme).
- [ ] Survoler un effet dans le sélecteur → une vignette d'aperçu apparaît
      (câblage : `EffectPicker.tsx:44-51`, même paire de props que
      `onOptionPreview`/`onOptionPreviewEnd` du select des modes de fusion).
- [ ] Coût tenu selon le verdict de 04 (aucun gel de l'interface au survol).
- [ ] Validé à l'œil par Antoine.
