# Registre de la boucle Ralph — « compléter les effets »

Ouvert le 2026-08-01. **Lire ce fichier AVANT de toucher au code** : la boucle
renvoie le même prompt à chaque itération, donc c'est ici et dans `git log` que
vit l'état, nulle part ailleurs.

## Condition d'arrêt

Les quatre chantiers actionnables ci-dessous sont livrés, chacun avec ses portes
vertes. Les BLOQUÉS n'entrent pas dans la condition : les deviner serait
exactement l'erreur que le cahier de références documente.

## Portes obligatoires, à chaque tranche

```
npx tsc --noEmit
npm run lint
npm run test
npm run test:gpu-shaders -- --origin http://localhost:1421
npm run test:render
```

Prérequis déjà en place : app Tauri avec CDP 9222, Vite frais du worktree sur
1421. Si l'un manque, le relancer (`npm run dev:debug`, `npx vite --port 1421`)
— et sans `--origin`, `test:gpu-shaders` compile les modules figés en cache de
l'app, pas l'édition en cours (vert ET rouge faux).

Tout NOUVEL effet doit en plus :
- entrer dans `src/render/effects/registry.ts` ;
- avoir une référence de rendu dont la mire peut **montrer sa propriété
  principale** (leçon du lens blur : la mire commune ne pouvait pas voir un
  bokeh, dix-sept tests unitaires étaient verts sur un effet cassé) ;
- être déclaré dans `test/scripts/renderRefs.test.mjs`, qui refuse le commit
  sinon.

## Chantiers

| # | chantier | état |
|---|---|---|
| 1 | `pixelStretch` — `Offset` signé (§6bis) | à faire |
| 2 | `gooeyMerge` — couleurs de premier plan / de fond (§6bis) | à faire |
| 3 | **Hatching** — nouvel effet (gravure : angles de trame, densité par le ton, croisement) | à faire |
| 4 | **Colored edges** — nouvel effet (contours colorés) | à faire |
| 5 | **Motion blur** — directionnel, radial (spin), zoom | à faire |
| 6 | **Surface blur** — lissage qui ne traverse pas les contours | à faire |

### La famille des flous de Photoshop — état, demandé par Antoine le 2026-08-01

La Blur Gallery tient cinq outils, et le cahier (§6ter) a montré que le clivage
n'est pas entre eux mais entre le NOYAU et la GÉOMÉTRIE DE CHAMP qui module son
rayon. Le noyau est livré (`lensBlur`, `942568b`). Reste à compléter la famille :

| outil Photoshop | chez nous |
|---|---|
| Lens Blur (noyau bokeh) | ✅ `lensBlur` — pondération des hautes lumières + diaphragme à N lames |
| Field Blur | ✅ couvert autrement — le masque au pinceau par calque fait le dégradé libre |
| Iris Blur | ✅ `lensBlur` → géométrie `Iris` |
| Tilt-Shift | ✅ `lensBlur` → géométrie `Linéaire` |
| Path Blur | ⬜ chantier 5, mode directionnel |
| Spin Blur | ⬜ chantier 5, mode radial |
| Radial Blur (zoom) | ⬜ chantier 5, mode zoom |
| Surface Blur / Smart Blur | ⬜ chantier 6 |

**REFUSÉS AVEC RAISON, pas oubliés** — les inscrire ici pour qu'on ne les
« complète » pas plus tard par souci de parité :
- **Gaussian Blur** : la référence même de §6ter dit qu'il ne sert qu'à réduire
  le détail et qu'il LAVE une photo. Le poser au registre serait livrer
  sciemment le rendu que la barre de qualité du projet interdit. Un flou doux
  s'obtient déjà par `lensBlur` à intensité de bokeh nulle, et le fichier le dit.
- **Box / Average** : dégénérescences du gaussien, rien de plus.

## BLOQUÉS — ne pas deviner, ne pas compter dans la condition d'arrêt

- **`warp`** : le §4 le juge « sans écart de référence » sans que la fiche Figma
  du shader du même nom (Miggi from Figgi) ait jamais été lue. Trou franc.
- **`sliceShift`** : noté « aligné », jamais revérifié contre la fiche.
- **Arrêts libres de `gradientMap`** : sixième ligne de la référence §6. Ne tient
  pas dans `array<f32, N>` de taille fixe et demande un nouveau genre de
  contrôle dans `ParamPanel`. Chantier d'INTERFACE, pas de shader.

La page `figma.com/community/shaders` ne publie la description que des QUATRE
vedettes de son carrousel ; les quinze autres surfaces de contrôle ne sont
lisibles qu'en ouvrant chaque shader dans Figma, donc avec le compte d'Antoine.

## Écarts §6bis qui n'en sont pas — établi le 2026-08-01, ne pas rouvrir

- **`Source Mix` de gooey merge** : refusé par décision de projet déjà écrite —
  « Pas de curseur mélange avec l'original : le calque porte déjà son `opacity`,
  son `blendMode` et son masque » (`gradientMap.ts`).
- **`inversion` de gooey merge** : atteignable depuis `6da8041` par
  `Mode d'entrée → Luminance inversée`. L'ajouter ferait deux chemins pour le
  même geste.

## Journal

- **it. 1** — registre ouvert. Départ : `451be1a` (A1 première passe), registre
  à quatorze effets, verrou de rendu vert 12/12.
