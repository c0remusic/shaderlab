# Contrôles par mode — plan d'implémentation

> Source : `../specs/2026-08-05-controles-par-mode-design.md`.
> Exécute aussi les exigences 1 et 3 de
> `2026-08-04-rationalisation-des-controles.md`, dont la **Task 1 est faite**
> (39 déclarations éprouvées, résultats dans
> `2026-08-05-applicabilite-task1-resultats.md`).

## Arbitrages pris par défaut, à corriger si besoin

Antoine a demandé l'exécution avant d'avoir tranché les trois questions du §6
du design. Défauts retenus, chacun isolé dans **une seule** tâche pour qu'un
revirement coûte une tâche et pas le plan :

1. **`glass.flat` → libellé conditionnel** (Task 6). Le paramètre reste unique,
   son libellé et son infobulle suivent la matière. Motif : le shader n'a qu'un
   besoin, c'est l'affichage qui en a trois, et les trois règlent la même
   intention — la franchise de la structure.
2. **Une section vide se MASQUE** (Task 3). ADR-0001 prime sur la stabilité
   visuelle : une carte qui garde des sections grisées reprend la hauteur que le
   chantier cherche à rendre.
3. **Les cinq gabarits du design font foi** (Task 2) : `liste`, `paire`,
   `grille`, `posé`, `figure`.

## Invariants que TOUTE tâche doit respecter

- **`params[]` ne bouge JAMAIS.** Les index sont persistés dans les presets. On
  réordonne et on regroupe des **items de rendu**, jamais le tableau.
- **Aucun `if (effectId)` dans `components/`.** Le contrat est déclaratif, lu
  uniformément (`ARCHITECTURE.md`).
- **`groupEffectParams` s'appuie sur l'ordre de `params[]`** en deux endroits
  (`spatialFirstIndex`, `firstIndexByKey`) : les sections déplacent des blocs
  ENTIERS, jamais ne les traversent.
- **Zéro pixel ne doit bouger.** `npm run test:render` doit rendre **aucun
  écart** sur les 82 scénarios. C'est le gate le plus discriminant : un écart
  prouverait qu'on a touché le modèle en croyant toucher l'affichage.
- **Les 19 premiers index d'`outlines` sont gelés** par sept références.

---

## Task 1 — `EffectParam.appliesWhen`

- Ajouter le champ à `EffectParam` (`render/effects/types.ts`), documenté au
  même niveau que `maxFrom` : d'où ça vient, et ce que ce n'est PAS.
- Forme **déclarative seule** (voie A) : `{ param: string; equals: number | number[] }`,
  identique à `CanvasControlVisibility`. Aucune échappatoire prédicat.
- Étendre `validateEffect` : la cible existe, elle porte `choices`, les index
  sont valides. **Réutiliser** la validation de `CanvasControl.visibleWhen`
  (`validate.ts:94`), ne pas la recopier.
- ⚠️ Ce n'est pas une validation de valeur : masquer ne borne rien, le shader
  garde ses clamps.
- Tests unitaires : cible absente, cible sans `choices`, index hors bornes.

## Task 2 — `EffectModule.sections` et les gabarits

- `SectionLayout = "liste" | "paire" | "grille" | "pose" | "figure"`.
- `EffectSection { id, label, params: string[], appliesWhen?, layout }`.
- `validateEffect` : chaque paramètre cité existe et n'est cité qu'**une fois**
  ; un paramètre non cité par une section reste rendu à sa place (pas de
  section obligatoire) ; `pose`/`figure` exigent un contrôle spécialisé
  correspondant sur l'effet.
- Tests : paramètre inconnu, paramètre en double, section vide déclarée.

## Task 3 — `ParamPanel` interprète

- `groupEffectParams` rend des items groupés par section, **en déplaçant des
  blocs entiers** ; l'ordre interne à une section reste celui de `params[]`.
- Masquer un paramètre dont `appliesWhen` est faux ; masquer une section dont
  la condition est fausse **ou dont tous les paramètres sont masqués**.
- Gabarits `paire` et `grille` : CSS par tokens existants, aucune valeur en
  dur (`npm run lint:tokens` est un gate).
- Stories : un effet par gabarit, et pour `glass` une story par régime
  (feuille / pavé / Poli).

## Task 4 — Porter les 38 déclarations inertes

Les 38 verdicts « inerte » de la Task 1 deviennent des `appliesWhen`, en
**gardant l'infobulle** — elle explique POURQUOI, le masquage ne dit que QUE.
Répartition : `glass` 14, `outlines` 11, `lensDistortion` 3, `lensFlare` 2,
`lensBlur` 2, `motionBlur` 2, `hatching` 2, `warp` 1, `gradientMap` 1.

⚠️ `glass.flat` n'en fait PAS partie (Task 6).

## Task 5 — Sections sur les six effets qui en profitent

Un fichier par effet, indépendants les uns des autres :

- **`glass`** — *Matière* (material, density, depth, profile, flat, fillet,
  orientation, irregularity, grain) · *Optique* (thickness, specular,
  dispersion, diffusion, relief) · *Pavé* (les 8, gabarit `grille`, absente des
  neuf matières de feuille).
- **`outlines`** — *Détection* · *Encre* · *Échos* (absente hors mode Échos —
  le même prédicat que ses neuf passes portent déjà).
- **`lensFlare`** — trois sections CUMULATIVES (fantômes, diffusion, capteur),
  pas un mode : les trois phénomènes s'additionnent (ADR-0017).
- **`curves`** — les quatre canaux en sections, gabarit `figure`.
- **`channelMixer`** — une section par canal de sortie.
- **`gradientMap`** — *Rampe* (`figure`) · *Tonalité* (`paire` pour
  blackPoint/whitePoint) · *Répétition*.

### ⚠️ Task 5 bis — les SEPT effets omis par la première passe

Le périmètre ci-dessus filtrait sur le nombre de paramètres, alors que le design
§2 dit que le critère est le **mode exclusif**. Correction relevée par Antoine
le 2026-08-05 ; voir le §4 du design pour le raisonnement.

**Tout effet portant un mode exclusif reçoit des sections commandées par ce
mode.** Sept manquaient :

| Effet | Mode exclusif | Ce que ça donne |
| --- | --- | --- |
| `warp` | `type`(9) | neuf régimes de déformation derrière une liste de 10 |
| `dither` | `style`(7) × `distribution`(2) | **quatorze** panneaux dans une liste de 14 |
| `lensBlur` | `fieldShape`(4) | Uniforme / Linéaire / Iris / Radial |
| `hatching` | `pattern`(4) | Droites / Ondulations / Zigzag / Cercles |
| `halftone` | `colorMode`(4) | quatre régimes de trame |
| `motionBlur` | `trajectory`(3) | Directionnel / Rotation / Zoom |
| `lensDistortion` | `aberrationMode`(3) | Latérale / Longitudinale / Anamorphique |

Ces sept portent déjà leurs `appliesWhen` (Task 4, faite) : il ne manque que le
regroupement. Les paramètres déjà masqués par `appliesWhen` n'ont pas à être
re-conditionnés — une section peut se contenter de les CONTENIR.

### Task 5 ter — les HUIT derniers : plus aucun effet dehors

Arbitrage d'Antoine, 2026-08-05 : « il faut quand même optimiser leurs contrôles
même s'ils n'ont qu'une option ». **Les 21 effets du registre sont donc dans le
périmètre**, et les deux listes d'exclusion précédentes tombent.

**TOUS reçoivent des sections** (arbitrage confirmé : « qu'ils aient des
sections »). Aucune exception, y compris les effets à quatre paramètres.

| Effet | Paramètres | Sections |
| --- | --- | --- |
| `isolines` | 18 | Détection · Trait · Couleurs · Fond |
| `pixelStretch` | 12 | Zone (son disque posé) · Étirement · Rendu |
| `duotone` | 11 | Ombres · Hautes lumières · Tonalité (`paire` sur noir/blanc) |
| `gooeyMerge` | 11 | Fusion · Teinte |
| `sliceShift` | 8 | Découpe · Décalage · Bords |
| `halation` | 6 | Seuil · Halo |
| `grain` | 5 | Grain · Réponse tonale |
| `glow` | 4 | Seuil · Diffusion |

⚠️ **Objection soulevée puis levée par Antoine, notée pour le prochain lecteur.**
Sur un effet à quatre paramètres, deux titres de section coûtent de la hauteur
au lieu d'en rendre — c'est la lettre d'ADR-0001. La cohérence l'emporte ici :
un panneau qui a des sections sur la moitié des effets et pas sur l'autre oblige
l'utilisateur à réapprendre la carte à chaque changement d'effet, et c'est un
coût qui ne se voit pas dans une mesure de hauteur.

**Conséquence à surveiller au checkpoint** : c'est sur `glow` et `grain` que le
risque se matérialiserait. Si la carte y devient plus haute qu'avant, le gabarit
des titres doit maigrir — pas les sections disparaître.

## Task 6 — `glass.flat`, libellé conditionnel

- Mécanisme déclaratif : un libellé et une infobulle qui suivent un paramètre à
  `choices` (même forme que `appliesWhen`, appliquée au texte).
- Trois cas : *Part plate* (matières 0-1-2), *Profondeur du brossage*
  (Aluminium), *Largeur de la rainure* (Martelé, Écorce).
- ⚠️ Le troisième était **non documenté** et déplace 47 à 49 % des canaux : il
  ne doit surtout pas être masqué.

## Task 7 — Preuve

- `npm run test` · `npm run test-storybook` · `npx tsc --noEmit` ·
  `npm run lint` · `npm run lint:tokens`.
- **`npm run test:render` : zéro écart attendu sur les 82 scénarios.**
- `node scripts/render-check.mjs --applicabilite` : les 38 restent inertes,
  `glass.flat` reste vivant en Martelé et Écorce.
- Checkpoint humain : `glass` et `outlines` en changeant de mode — c'est là que
  le saut de hauteur se verrait.
