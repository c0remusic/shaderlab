# Remédiation des deux audits — backlog exécutable

État de départ mesuré le 2026-07-31, sur `master@8494b78`. Source des findings :
`docs/superpowers/specs/2026-07-30-audit-prerelease.md` (perf, architecture,
robustesse, React/UI) et `docs/superpowers/specs/2026-07-31-audit-effets.md`
(les six effets de rendu).

Ce fichier est l'état durable de la boucle de remédiation. Chaque item porte son
type (**AFK** = spécifiable sans jugement humain ; **HITL** = demande l'œil ou
l'arbitrage d'Antoine), son `bloqué_par`, et son moyen de preuve. Un item ne se
coche que sur preuve produite dans le même tour.

---

## Barrière — LEVÉE le 2026-07-31 à 00:40, par réfutation

### B0 — CLOS — le verrou de rendu n'était pas rouge

**La barrière n'existait pas.** Elle reposait sur « `npm run test:render` est
rouge 6/6 sur master depuis T1 », affirmation présente dans le rapport d'audit,
dans `docs/INDEX.json`, dans le message du commit `8494b78` et dans
`.claude/learning-log.md` — et jamais mesurée. L'entrée du learning-log qui la
« reconfirme » l'écrit elle-même : « vérifié cette session en lisant le harnais
et son en-tête, **non en le relançant** ».

**Mesure, sur `master@e0b6cd4`**, app en CDP 9222 et Vite du worktree courant
sur 1421 :

```
npm run test:render
  -> 10 scenarios, reproductibilite inter-passes 0 canal, gate de signal OK
  -> Non-regression : 10/10 « aucun ecart »
  -> « Aucune regression de rendu. »   sortie 0
```

**Témoin de discrimination** — exigé par `scripts/render-check.mjs:89-96`, sans
lequel aucun verdict de ce script ne vaut :

```
grain.ts:39   0.2126 -> 0.2500
npm run test:render
  -> FAIL   grain-graine-fixe   ecart max 18 > 1 LSB  [moyenne 0.1655, 1er pixel 5]
  -> ECHEC — 1 scenario(s) dont le rendu a change.    sortie 1
temoin retire
npm run test:render
  -> Aucune regression de rendu.   sortie 0
git status --short src/render/effects/grain.ts  ->  (vide)
```

Le harnais rougit sur le seul scénario concerné, puis redevient vert, arbre
propre. L'instrument attrape ce qu'il prétend garder.

**Ce que ça change** : la ligne PIXELS n'est bloquée par rien. Ce qui reste vrai
de la prescription d'origine, c'est **l'exigence de témoin** — un verrou vert ne
vaut que planté / rougi / retiré, à refaire à chaque correctif de pixels.

**Contrainte de montage inchangée** : l'app tourne avec CDP 9222 **et** un Vite
du worktree courant sur 1421 ; `scripts/dev.ps1` tue **tout** process
`shaderlab` de la machine, donc un seul agent à la fois sur cette ligne.

---

## Ligne PIXELS — sérialisée, une seule instance de l'app à la fois

`bloqué_par: []` depuis la levée de B0. Chaque correctif de cette ligne se clôt
par le cycle témoin planté / rougi / retiré décrit en B0, jamais par un vert nu.

## Avertissement — une session concurrente écrit sur ce dépôt

`C:\dev\shaderlab` n'est pas isolé par worktree et une autre session y commite :
`e0b6cd4` a été posé à 00:28 pendant cette session. Le learning-log du jour
documente la direction du risque : une session voisine a **poussé** des commits
qu'elle n'avait pas écrits, en poussant les siens. Conséquence à tenir ici : un
commit local n'est pas réversible, et rien ne se commite qu'on ne serait pas prêt
à voir public. Pathspec explicite obligatoire (`git commit -m "msg" -- <fichiers>`).

### E1 — HITL — un effet posé sur le calque photo rend l'image NOIRE

`warp.ts:64` et `chromaticBleed.ts:29-31` rechargent `srcTexture` là où le
contrat impose de lire le paramètre `color` (`shaderCompose.ts:179-181`).
Mesuré sur GPU réel : luminance 0, 100 % de pixels noirs.

**Ne pas implémenter en boucle.** L'audit tranche : « le correctif demande une
décision d'architecture, il ne s'improvise pas », et il a mesuré puis REFUSÉ les
deux correctifs évidents (liséré noir d'environ 55 px sur chaque bord de photo ;
poids de compositing pris à un UV non déplacé, `shaderCompose.ts:115`).

**Ce que la boucle produit** : deux ou trois options d'architecture du contrat
`fs_main`, chacune avec son coût et ce qu'elle casse, à trancher par Antoine.
Aucun shader modifié tant que l'option n'est pas choisie.

### E2 — CLOS le 2026-07-31 à 00:54 — la graine du warp détruisait le bruit

`hash2` est remplacé par un hachage ENTIER de la maille (`warp.ts:16-40`).
`gnoise` n'appelle `hash2` que sur des points de grille, donc la conversion en
`i32` est exacte et le hachage ne repasse plus par un produit de flottants.

**Mesure avant / après**, même protocole (101 graines, `scale=3`, 3 octaves,
16×16 cellules échantillonnées, `hash2` émulé en f32 exact par `Math.fround`) :

```
AVANT  graines avec >=1 octave morte : 89/101
       graines entierement mortes    : 54/101
       premiere graine entierement morte : 47
APRES  graines avec >=1 octave morte : 0/101
       graines entierement mortes    : 0/101
```

Les deux chiffres d'avant (89/101 et première graine morte à 47) sont ceux de
l'audit, retrouvés **indépendamment** par cette émulation — elle est donc
fidèle. Aux paramètres réels du scénario versionné (`scale=4`, 4 octaves), toute
graine rend désormais `[25, 81, 289, 576]` gradients distincts, soit la
saturation de la grille d'échantillonnage.

**Rectification d'un point de l'audit.** Il écrivait que la référence
`masque-pinceau-degrade` « tourne à seed=2, donc déjà dans la zone dégradée ».
Mesuré aux paramètres réels du scénario (`render-check.mjs:458-459` —
`scale: 4, amplitude: 0.08, octaves: 4, seed: 2`) : **0 octave morte sur 4**.
La dégradation est réelle mais partielle — l'octave la plus fine tombait à 32
gradients distincts contre 574 à seed=0. « Zone dégradée » oui, « octave morte »
non.

**Preuve de non-régression** :

```
npx tsc --noEmit                -> No errors found
npm run test:gpu-shaders        -> tous OK, garde hasImageSource+clipToCoverage incluse
npm run test:render             -> FAIL masque-pinceau-degrade et lui SEUL
                                   ecart max 142, moyenne 1.3642 ; 9 autres inchanges
node render-check.mjs --update --scenario masque-pinceau-degrade
npm run test:render             -> Aucune regression de rendu.  sortie 0
```

Le fait que le verrou rougisse sur le seul des dix scénarios qui utilise warp
est la discrimination de ce correctif : il n'a rien touché d'autre. Les deux
images de référence, avant et après, ont été relues à l'œil — même lecture,
écart confiné au masque, aucune casse structurelle.

<details><summary>Énoncé d'origine</summary>

`hash2` sature en f32 (`warp.ts:53`, `:16-20`) : au-delà de 2²³ l'ulp vaut 1,
`fract()` rend 0, le gradient devient constant et le FBM dégénère en grille
régulière. 89 graines sur 101 ont au moins une octave morte ; à partir de
seed=47 les trois le sont.

Correctif : **remplacer `hash2`**. Le palliatif consistant à borner le décalage
est explicitement refusé par l'audit (il produirait des quasi-doublons, panne
moins spectaculaire donc plus durable).

Attention : la référence versionnée `masque-pinceau-degrade` tourne à seed=2,
donc déjà dans la zone dégradée — sa référence changera, et c'est voulu.

**Preuve** : distribution des octaves mortes recomptée sur les 101 graines,
avant et après.

</details>

### E3 — CLOS le 2026-07-31 à 01:05 — le grain culminait dans les ombres

Le décalage se pose désormais sur le ton PERCEPTUEL, et c'est la fonction de
transfert **partagée** qui le ramène en linéaire (`grain.ts:46-60`). Les deux
propriétés du projet sont tenues : le mélange reste linéaire (on ajoute un delta
linéaire à une couleur linéaire, aucun gamma manuel sur la couleur), et **aucune
seconde formule de transfert n'a été écrite** — c'était le piège nommé par
l'audit, `srgbTransfer.ts` reste la source unique. `SRGB_TO_LINEAR_WGSL` est
importé, pas recopié.

**Mesure avant / après**, écart-type du grain en niveaux sur 255, intensité par
défaut 0,12, les deux formules de transfert reprises verbatim de
`srgbTransfer.ts` :

```
ton   actuel   propose
0.10    18.0     3.2
0.30    15.9     7.4
0.50     9.6     8.8
0.70     5.2     7.4
0.90     1.6     3.2
actuel   argmax = 0.19   ecretage noir au ton 0.10 = 26.8 %
propose  argmax = 0.50   ecretage noir au ton 0.10 = 0.0 %
```

L'argmax passe de **0,19 (les ombres) à 0,50 (le demi-ton)**, et l'écrêtage noir
disparaît. Le commentaire `grain.ts:38`, qui promettait « peak in midtones,
fades in deep shadows and highlights » et que le code contredisait, est
maintenant vrai.

**Preuve de non-régression** :

```
npx tsc --noEmit         -> aucune sortie
npm run test:gpu-shaders -> 64 shaders composes compiles, 0 en echec
npm run test:render      -> FAIL grain-graine-fixe et lui SEUL
                            ecart max 70, moyenne 3.3783 ; 9 autres inchanges
node render-check.mjs --update --scenario grain-graine-fixe
npm run test:render      -> Aucune regression de rendu.  sortie 0
```

Références relues à l'œil, avant et après : le grain lourd des ombres a reculé
et la répartition s'est recentrée, ce qui est exactement l'effet annoncé.

<details><summary>Énoncé d'origine</summary>

`grain.ts:46-48` : pondération perceptuelle, addition restée linéaire. Écart-type
mesuré à intensité par défaut — ton 0,10 → 15,2/255 ; ton 0,50 → 7,1/255 ;
ton 0,90 → 1,2/255. Le commentaire `grain.ts:38` promet exactement l'inverse.

Le correctif proposé par l'audit fait bien ce qu'il annonce (argmax ramené à
0,498, écrêtage noir de 17,5 % à 0 %) **mais inline une troisième formule de
transfert sRGB**, ce que `srgbTransfer.ts:19-21` interdit en toutes lettres.
À réécrire en passant par la fonction partagée.

**Preuve** : les trois écarts-types recomptés après correctif, et
`grep` prouvant qu'aucune formule sRGB n'a été ajoutée.

</details>

### E5 — CLOS EN PARTIE le 2026-07-31 à 01:15 — la coquille est rebouchée

`UPSAMPLE_WGSL` échantillonnait à un texel entier (`glow.ts:33`). Les huit taps
forment un anneau, aucun n'est au centre : à un texel entier, les taps diagonaux
tombent exactement sur des centres de texels voisins et la bilinéaire ne ramène
presque rien du texel courant. Corrigé à un **demi-texel**.

**Mesure**, simulation du noyau sur une impulsion unité, échantillonnage
bilinéaire, sortie à 2× la résolution d'entrée :

```
o = 1.0 texel   energie au centre =  1.0 %   pixel central / maximum = 0.105
o = 0.5 texel   energie au centre = 19.8 %   pixel central / maximum = 1.000
```

Le « environ 1 % du poids au centre » de l'audit est retrouvé indépendamment.

**Preuve de non-régression** :

```
npx tsc --noEmit         -> aucune sortie
npm run test:gpu-shaders -> 64 shaders composes compiles, 0 en echec
npm run test:render      -> FAIL effets-glow-posterize et lui SEUL
                            ecart max 140, moyenne 2.5969 ; 9 autres inchanges
node render-check.mjs --update --scenario effets-glow-posterize
npm run test:render      -> Aucune regression de rendu.
```

**⚠️ CHANGEMENT DE LOOK À VALIDER À L'ŒIL.** Les deux références relues : le
halo est nettement plus **resserré** après correctif, la bavure large a reculé
et le damier redevient lisible près du disque. C'est le comportement correct du
noyau documenté, mais c'est un changement esthétique — à confirmer sur une vraie
photo avant release.

**RESTE OUVERT, reclassé HITL** : la chaîne s'arrête à 1/8, donc le rayon du
bloom est un nombre constant de pixels image au lieu de suivre la taille de la
photo. Allonger la chaîne changerait le rayon perçu sur toutes les images
existantes — c'est une décision produit, pas une correction, et elle se combine
au resserrement ci-dessus. Ne pas la trancher en boucle.

**NON FAIT, et volontairement** : l'audit signale qu'un offset de bright-pass
« ±0,25 texel » avait été proposé et qu'il est faux arithmétiquement (le bon
serait ±0,5). C'est un avertissement sur un correctif proposé, pas une demande.
La passe de bright-pass n'a aujourd'hui aucun offset (`glow.ts:69-85`) et n'a
pas été touchée.

<details><summary>Énoncé d'origine</summary>

À l'upsample, l'offset vaut 4× le canonique : environ 1 % du poids au centre.
Et la chaîne s'arrête à 1/8, donc le rayon est un nombre constant de pixels
image au lieu de suivre la taille de la photo.

**Piège nommé par l'audit** : l'offset de bright-pass proposé (±0,25 texel) est
faux arithmétiquement — le centre du pixel destination tombe déjà sur le coin
des quatre texels, **l'offset correct est ±0,5**. Appliqué tel quel, le shader
compile, rend, change la référence pixel et ne fait PAS ce qu'il annonce.

</details>

### E4 — HITL — le placement des paliers de posterize

Les paliers sont répartis uniformément sur l'axe linéaire. Le seul correctif
proposé (quantifier sur l'axe perceptuel) est **mesuré dangereux** : il éclaircit
l'image de 27 points sRGB à levels=2 et multiplie par dix l'erreur de
préservation de moyenne.

La question qui commande le correctif n'est pas dans le code : l'aplat noir
massif sous 39 % de clarté perçue est-il le look voulu d'un posterize graphique,
ou un défaut ? À regarder à levels=2 et sur un aplat coloré saturé (le dither est
achromatique). **Aucun correctif avant cet arbitrage.**

---

## Défaut de méthode de CE backlog, constaté le 2026-07-31 à 01:45

**Ce backlog a été construit en lisant les rapports d'audit, sans vérifier chaque
item contre le code courant.** Trois items s'en sont trouvés périmés d'emblée :

- **R2** était déjà corrigé par `e18a940`. `git blame -L 441,456` rend la ligne
  `.catch((e) => setError(messageFromUnknown(e)));` avec ce SHA, et
  `docs/INDEX.json:175` liste « rejet flottant du Ouvrir avec capturé » parmi
  ses corrections.
- **U2** était déjà corrigé : `LayerPanel` avait déjà son `onKeyDown`. L'agent
  n'a pas eu à l'écrire — il a trouvé et corrigé autre chose (voir plus bas).
- **U3** était déjà corrigé au HEAD par `e18a940`, présent sur `master` et les
  six worktrees (`git branch -a --contains`).

C'est la même racine que la fausse barrière B0 : une affirmation d'un document
prise pour l'état du disque. Le rapport d'audit décrivait le code du 2026-07-30,
et la remédiation avait avancé entre-temps. **Un backlog se construit contre le
code, pas contre le rapport qui l'a motivé** — le rapport dit seulement où
regarder.

## Ligne ARCHITECTURE — parallélisable, worktree propre, aucune instance de l'app

### A1 — AFK — `App.tsx` porte encore 1823 lignes

`wc -l src/App.tsx` → **1823** (contre 1951 à l'audit ; `usePresetWorkflow` en a
retiré environ 130). ⚠️ **Re-mesuré le 2026-08-01 : 2156 lignes** — le fichier a
repris 333 lignes en un jour (toile de montage, calque photo, dialogues). Ce
n'est pas une dérive lente : c'est le point d'ajout par défaut du dépôt, et
l'extraction ne tiendra que si elle vise ce qui grossit. L'extraction faite est documentée comme volontairement
partielle dans `src/hooks/usePresetWorkflow.ts:25-29` : restent dans `App.tsx` le
JSX des `Dialog`, l'application d'un preset (`applyPreset`/`requestApplyPreset`),
le renommage, l'import/export de fichier preset.

Prochains candidats nommés par R6 (`ARCHITECTURE.md:549`), par volume : les cinq
`<Dialog>`, l'échantillonnage colorimétrique (`App.tsx:870-899`), l'application
de preset.

**Preuve** : `wc -l src/App.tsx` avant/après, et `npm run test` + `npx tsc
--noEmit` verts, avec la liste des tests réellement exécutés (un code de sortie
0 ne prouve pas que le fichier modifié a été touché).

### A3 — AFK — le bloc AUTO-VÉRIFICATION d'`ARCHITECTURE.md` est périmé

R6 (`ARCHITECTURE.md:549`) est à jour (1823, daté). Deux occurrences du chiffre
mort de 727 survivent : le schéma `ARCHITECTURE.md:67` et le bloc
AUTO-VÉRIFICATION `ARCHITECTURE.md:589`.

Le fix prescrit est de **ré-exécuter le § 9 en entier** : recompter les lignes
réelles de TOUS les fichiers cités, pas seulement les deux repérées ici.

**Preuve** : chaque chiffre du § 9 accompagné de la commande qui l'a produit.

---

## Ligne ROBUSTESSE & UI — parallélisable, worktree propre

### U1-bis — CLOS le 2026-08-01 — l'énoncé était périmé quand on l'a relu

Posé le 2026-07-30 : `eslint.config.js` à la racine, `eslint@^9.39.5`,
`eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`, script `"lint": "eslint ."`.

L'énoncé disait « Ni `.husky/` ni `.git/hooks/pre-commit` n'existent ». **Faux au
2026-08-01, et sans doute déjà faux à la rédaction** : `scripts/hooks/pre-commit`
est versionné (source, daté du 2026-07-31 03:11) ET installé dans
`.git/hooks/pre-commit`. Il lint les seuls fichiers `src/**` stagés, en mode
AVERTISSEMENT assumé (`BLOCKING=0`, passage en bloquant documenté en tête du
fichier), avec un fail-safe parlant si ESLint manque dans le worktree.

Reste de vrai : `npm run lint` rendait **8 avertissements**, tous
`react-hooks/exhaustive-deps` sur `presets`. Corrigés le 2026-08-01 — voir la
note d'extraction des membres en tête d'`App.tsx`. `npm run lint` : 0 problème.

C'est le troisième item de ce backlog démenti par le disque (après R2 et U2). La
règle vaut d'être reposée : **un item de backlog n'est vrai qu'à la date de sa
mesure**.

### R2 — AFK — rejet flottant sur « Ouvrir avec »

`App.tsx:446-457` — le `try/catch` couvre le corps du `.then`, pas la promesse
`getLaunchPath()`. Fix d'une ligne, sans piège :
`.catch((e) => setError(messageFromUnknown(e)))`.

### R3 — AFK — le chemin « Ouvrir avec » n'a aucun filet

Extraire la résolution du chemin de lancement en **fonction pure**, et la tester
sur trois cas : `null`, chemin valide, rejet. C'est exactement ce que
`test/App.test.ts:3-10` dit avoir déjà fait pour le resync du painter de masque.

### R1 — AFK — erreurs GPU récupérables muettes en production

`gpuContext.ts:57-59` n'appelle que `diagnosticLogger`, et `launch.ts:94-97`
coupe tout hors DEV. Le commentaire `gpuContext.ts:56` renvoie à des
`pushErrorScope` « ciblés dans renderer.ts » : **cette contre-mesure n'existe
pas** (un seul match sur 147 fichiers, ce commentaire lui-même).

**Piège nommé** : ne PAS router `onuncapturederror` vers `onFatalError` — une
erreur récupérable afficherait « le GPU a redémarré » à tort, et le handler peut
partir en rafale à chaque frame. Le fix correct est un canal séparé et débouncé
(compteur borné + journal persistant hors `import.meta.env.DEV`).

### U2 — AFK — la ligne de calque n'est pas atteignable au clavier

`LayerPanel.tsx:191-195` — `<li onClick>` sans `tabIndex`, `role` ni `onKeyDown`.
Conséquence : au clavier seul, la zone de contrôles centralisée par l'ADR-0001
devient inatteignable, puisqu'elle dépend de la sélection.

Fix : `role="button"` + `tabIndex={0}` + `onKeyDown` (Entrée/Espace) sur le
`<li>`, ou un `<button>` englobant `layer-panel__row-main`.

### U3 — AFK — le sélecteur SV et la bande de teinte ne sont pas atteignables au clavier

`ColorPickerPanel.tsx:142-162` (canvas SV) et `:171-186` (teinte) :
`onPointerDown`/`onPointerMove` uniquement. Fix : `tabIndex={0}` +
`role="slider"` + `aria-valuenow/min/max` + flèches, à l'image de
`LabeledSlider`.

### U5 — CLOS le 2026-08-01 — plus aucun disable nu

L'énoncé visait `Canvas.tsx:78`. Au 2026-08-01, cette ligne est
`const viewportRef = useRef(viewport);` — le disable n'y est plus, et le balayage
complet de `src/` rend **14 `eslint-disable`, tous suivis de `--` et d'une
justification** (dont 4 dans `Canvas.tsx`/`labeled-slider.tsx`/`number-field.tsx`
qui expliquent chacun ce que la règle ne peut pas voir). Rien à faire.

### U4 — HITL léger — dérive à l'ADR-0001 dans `MaskPanel`

`MaskPanel.tsx:241-301` : chaque `<li>` de source porte quatre contrôles répétés,
là où `LayerPanel` a été migré le 2026-07-29. L'audit accepte **les deux issues**
— centraliser sur la source sélectionnée, OU écrire dans le fichier pourquoi
≤4 sources reste sous le seuil de gain. Le silence, lui, n'est pas acceptable.

Défaut proposé si Antoine ne tranche pas : **documenter l'exemption**, moins
cher et réversible.

---

## Résultat de la vague parallèle du 2026-07-31 (6 items, 12 agents)

Chaque correctif est passé sous un vérificateur adverse chargé de le RÉFUTER.
Deux ne survivent pas, et c'est le rendement de la passe adverse.

### Fusionnés sur master, verdict « tient »

| item | commit | ce qui a été fait |
|---|---|---|
| **A3** | `8b1a585` | § 9 ré-exécuté en entier : les 16 fichiers cités recomptés, total 5609 exact ; `#[tauri::command]` corrigé de 9 à 17 (vérifié contre `generate_handler!`). Les 3 occurrences restantes de « 727 » sont explicitement historiques et datées. |
| **R2+R3** | `370cb0e` | R2 était déjà fait ; R3 réellement livré — résolution du chemin de lancement extraite en fonction pure dans `launch.ts`, couverte par 4 tests (`test/launch.test.ts`) dont deux cas de rejet. |
| **U2** | `3538f95` | U2 était déjà fait. L'agent a trouvé et corrigé **autre chose** : le `preventDefault` de la ligne annulait l'activation clavier du bouton œil imbriqué, dont le `keydown` remontait jusqu'à elle. Mesuré avant/après : œil focalisé + Entrée donnait `toggle=0, select=1`, donne maintenant `toggle=1, select=0`. |

### Réfutés, laissés hors de master

**R1** (`d85e94b`, branche `worktree-wf_b2f6b8b2-313-3`) — les preuves mécaniques
tiennent toutes, mais **l'objectif n'est atteint par aucune destination
vérifiée**. Sur les trois annoncées : `logDiagnostic` no-ope en release (l'agent
le dit lui-même), `console.error` est hors de portée dans un build livré — le
port CDP n'existe que dans `scripts/dev.ps1:32`, un lanceur de dev, et l'audit
source pose l'inverse en `:177` — et il ne reste que `localStorage`, dont la
persistance en release n'est pas mesurée. Second défaut, plus grave :
`gpuContext.ts:83-88` sort sans écrire tant que la fenêtre de 5 s n'est pas
franchie, donc **une rafale qui s'arrête avant 5 s perd tout sauf sa première
ligne** — précisément le régime pré-crash que le mécanisme existe pour capturer
(`lib.rs:283-290`). Les 6 tests n'exercent que des rafales qui traversent la
fenêtre : le cas perdant n'est pas couvert.

**U3** (`b291136`, branche `worktree-wf_b2f6b8b2-313-5`) — deux des trois écarts
revendiqués reposent sur des affirmations d'état fausses. La règle
`:focus-visible` ajoutée est un **no-op** : `src/design/reset.css:15` pose déjà
la même règle globalement, chargée par `index.css:5` puis `main.tsx:4`. Et la
justification « une touche non traitée déroule la colonne du dock » est
impossible : `ColorPickerPanel` est rendu en frère de `PanelColumn`
(`App.tsx:1579` vs `:1418`), en `position: absolute` dans `.workspace` qui est
`overflow: hidden`. **Reste réel et récupérable** : l'élargissement de
`VALUE_KEYS` (Home/End/Page sur la bande de teinte) est un correctif correct.

### Sans commit, à juste titre

**U5+U1-bis** — `npm run lint` rend **32 erreurs, 11 avertissements, 12
fichiers**. Brancher ESLint au pré-commit bloquerait tout commit du dépôt.
L'agent s'est arrêté et a remonté l'arbitrage au lieu de forcer, ce qui était la
consigne. **Décision à prendre** : purger les 32 erreurs d'abord, ou brancher le
hook en mode avertissement.

## Gelés — ne pas toucher dans cette boucle

- **P-A et P-B** (churn d'allocations SAT, `maskTextureResolver.ts:842-866` et
  `:935-947`). L'audit l'écrit : « à ne pas corriger avant d'avoir mesuré le
  régime edge-aware », chemin désactivé par défaut (`src/mask/types.ts:18`),
  aucune fuite. Un correctif ici serait précisément l'« optimisation non fondée »
  que `rules/audit/performance.md` classe CRITIQUE. Piège de fix documenté en
  prime.
- **R4** (frontière fichier Rust non confinée). BASSE, aucun vecteur d'injection
  (CSP réelle, 0 correspondance d'injection sur `src/`), et le seul confinement
  correct est un modèle de jetons — un chantier, pas un `if`. Confiner
  naïvement casserait « Ouvrir avec » de Windows.

---

## Fait, vérifié le 2026-07-31 (ne pas rouvrir)

- **A2** — la formule sRGB dupliquée est déposée : `App.tsx:891-893` appelle
  `srgbToLinear(pixel[i] / 255)`. Le piège du `/255` n'est pas tombé.
- **U1** — ESLint est installé et configuré (voir U1-bis pour ce qui manque).

## Introuvable — à décider

L'audit effets annonce **vingt-cinq findings survivants**, mais seuls les
**cinq HAUTE** sont écrits. `git show --stat 8494b78` ne contient que
`docs/INDEX.json` et le rapport ; les vingt MOYENNE/BASSE n'existent nulle part
sur disque, ni dans `.superpowers/sdd/`. Ils sont morts avec le contexte des
douze agents.

Deux issues : relancer l'audit des effets pour les régénérer (coût d'une passe
complète), ou acter que le périmètre réel est de cinq findings. À trancher par
Antoine — la boucle ne peut pas remédier ce qu'elle ne peut pas lire.
