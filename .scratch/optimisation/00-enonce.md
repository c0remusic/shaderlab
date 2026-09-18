# Chantier OPTIMISATION — énoncé, et ce que la proposition d'entrée suppose

Status: needs-triage
Type: research

**Lancé par Antoine le 2026-09-17**, avec une proposition d'outillage : minifier
le WGSL dans le pipeline Vite (plugin de transformation sur les fichiers `.wgsl`,
suppression des commentaires, écrasement des espaces, élimination de code mort
par un minificateur Rust type `wgsl-minifier` / `wgslender` / `shaderkit`), plus
l'activation de l'extension `shader-f16` pour diviser par deux la bande passante
mémoire des calculs.

Ce fichier n'est pas un refus : c'est ce qu'il faut savoir du dépôt avant de
choisir, mesuré sur disque le jour même.

## Ce que la proposition suppose, et qui n'est pas vrai ici

**Il n'y a AUCUN fichier `.wgsl` dans ce dépôt.** Mesuré :
`find src scripts test -name "*.wgsl"` rend **0**. Tout le WGSL vit dans des
template literals TypeScript (`wgsl:` des modules d'effet, `passes[].wgsl`). Un
plugin Vite qui accroche `transform` sur `id.endsWith(".wgsl")` n'a donc
strictement rien à transformer, et l'import `import shader from './x.wgsl'` n'a
aucun appelant à convertir.

**Et surtout : le shader qui atteint `createShaderModule` N'EXISTE PAS au
build.** Il est ASSEMBLÉ À L'EXÉCUTION par `shaderCompose`, à partir du corps du
module, des bindings réellement fournis (masque, `prevPass`, `auxPass`,
couverture, texture de bibliothèque, transformation) et du corps du mode de
fusion. La chaîne composée EST la clé de cache du pipeline. Un minificateur de
build ne peut pas voir cette chaîne ; il ne verrait que des morceaux, et minifier
des morceaux qui seront concaténés est le cas où un minificateur régex casse le
plus facilement.

⚠️ Le minificateur régex proposé est d'ailleurs dangereux tel quel sur nos corps :
sa dernière règle supprime les espaces autour de `-`, ce qui transforme `a - -b`
en `a--b`, une erreur de parse. Nous avons de quoi l'attraper — `npm run test:wgsl`
(naga, en CI) et `test:gpu-shaders` (191 shaders compilés sur GPU) — mais ça dit
seulement qu'on saurait qu'il casse, pas qu'il apporte.

## Ce que pèsent réellement nos shaders

Mesuré le 2026-09-17 par `composeShader` sur le registre complet :

| | |
|---|---|
| shaders composés | **104** |
| total | **549,2 Kio** |
| moyenne | 5,28 Kio |
| les plus gros | `lensFlare` 37,3 · `glass` 33,6 · `outlines` 31,4 · `develop:reglagesDeBase` 21,5 Kio |

Pour la TAILLE DU BUNDLE, 549 Kio de texte dans une app desktop qui charge des
photos de 26 Mpx n'est pas un poste. Pour le TEMPS DE COMPILATION des shaders,
c'est une vraie question et elle est ouverte : 104 variantes à compiler, et un
commentaire ne coûte rien au parseur mais un corps de 37 Kio coûte quelque chose.
**Personne ne l'a mesuré ici.** C'est la première chose à faire.

## Ce que ce dépôt a DÉJÀ mesuré sur la performance, et qui oriente

⚠️ **Le coût mesuré n'est ni l'ALU ni le texte du shader, c'est la COHÉRENCE DE
CACHE.** Deux mesures du dossier `glass` le disent (CLAUDE.md, § Moyen de preuve) :

- la diffusion passée de 9 à 16 prélèvements a coûté **37 % de cadence**, et
  l'ablation du même jour montre qu'à déplacement nul un pavé coûte exactement ce
  que coûte une feuille — la géométrie est gratuite, c'est la lecture dispersée
  qui coûte, environ 25 fois une lecture cohérente ;
- une optimisation ALU (neuf appels de bruit ramenés à trois, par dérivées
  analytiques) a été mesurée à **8 % de gain, dans le bruit**, contre dix-huit
  références déplacées — écrite puis revertée.

Conclusion à ne pas réapprendre : sur ce moteur, retirer des multiplications ou
des caractères ne réduit pas le coût dominant. Un chantier d'optimisation qui
commence par le texte du shader commence par l'axe déjà mesuré comme le moins
payant.

## Seconde source : webgpufundamentals, « Speed and Optimization »

<https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html>
(proposée par Antoine le 2026-09-17, lue le jour même)

⚠️ **Elle porte sur un problème que nous n'avons pas, et elle le dit
elle-même.** Son banc rend jusqu'à **30 000 cubes**, et elle propose un mode de
rendu en **1×1 pixel** pour éliminer la rastérisation et isoler le coût de l'API.
Elle annonce explicitement ne traiter ni l'optimisation du fragment shader, ni la
bande passante des textures. Nos frames sont l'exact inverse : une poignée de
passes PLEIN ÉCRAN sur 26 Mpx, où tout le coût est du côté GPU.

⚠️ **CE TABLEAU A ÉTÉ ÉCRIT DEUX FOIS.** La première version sortait de
`WebFetch`, qui résume la page avec un petit modèle ; relue sur le HTML BRUT le
même jour, elle portait trois erreurs — aucune n'était une invention, toutes
étaient des ATTRIBUTIONS. Un résumeur rend les phrases ; il ne rend pas à quoi
elles se rapportent. Les chiffres ci-dessous sont cités du texte source.

Ses six techniques, dans l'ordre de la page, et ce qu'elles valent ici :

| technique | ce que la page dit EXACTEMENT | chez nous |
|---|---|---|
| `mappedAtCreation` | « slightly faster », non chiffré, à l'initialisation | sans objet |
| entrelacer les sommets | « That's like 600% faster! » — ⚠️ **hypothétique**, sur une scène IMAGINÉE de 100 modèles (« *Imagine instead of just a cube we had 100s of models* »), et ça compte des APPELS à `setVertexBuffer`, pas du temps | **aucun sommet** — nos passes sont des triangles plein écran sans buffer de sommets |
| scinder les uniformes | « our math portion dropped ~16% » | à voir, mesuré |
| séparer plus d'uniformes | non chiffré | à voir |
| **un gros buffer d'uniformes à décalages** | « shaved off 40% of the JavaScript time » | **la seule qui transfère** — voir ci-dessous |
| buffers mappés | « around 15000 objects at 75fps, about 87% more than we started with » — ⚠️ **cumulatif**, pas le gain de cette étape | dépend de la précédente |

Deux chiffres de la page que le résumé avait perdus, et le second compte :

- **La ligne de base** : « ~8000 cubes before the framerate dropped », écran
  75 Hz, M1. Et le « **2x speed up** » final est le CUMUL des six, mesuré rendu
  désactivé — « *9000 at 75fps with the original non-optimized example and 18000
  at 75fps in this last version* ». Ce n'est pas le gain d'une technique.
- Une septième piste, hors des six, en fin d'article : passer des DÉCALAGES aux
  fonctions de math JS (`mat4.multiply(a, aOffset, b, bOffset, dst, dstOffset)`)
  vaut « about 7% faster », et l'auteur la juge lui-même « burdensome to use ».
  Rien à voir avec les décalages de buffer d'uniformes — la confusion des deux
  était la troisième erreur de la première version.

**Ce qui transfère, et sa taille réelle.** `runEffectPass` appelle `createBuffer`
pour ses paramètres à CHAQUE passe et à CHAQUE frame (plus le compositing et la
transformation). Compté sur la mire 2048 × 7584, une frame, un calque
(`compte-allocations.mjs`, qui enveloppe les méthodes du device et compte au lieu
de supposer) :

| cas | buffers | bindGroups | textures | pipelines | writeBuffer |
|---|---|---|---|---|---|
| témoin (étage sauté) | 4 | 3 | 0 | 0 | 3 |
| exposition 1 | 5 | 4 | 0 | 0 | 4 |
| clarté 100 (réveille la pyramide) | **12** | **11** | 0 | 0 | 11 |
| tout le bloc présence | 12 | 11 | 0 | 0 | 11 |

Deux lectures, opposées, et il faut les tenir ensemble :

- **Les deux postes que la source optimise le plus sont DÉJÀ résolus ici** :
  zéro texture et zéro pipeline créés par frame — le pool de cibles
  (`passTargetPool`) et le cache de pipelines par chaîne WGSL font leur travail.
- **Mais douze buffers et onze bind groups par frame** pour UN calque, et ça
  monte avec la pile. À soixante images par seconde, sept cents allocations de
  buffer par seconde pour transporter quelques dizaines de flottants. C'est
  exactement le motif que la source remplace par un gros buffer à décalages.

**Ce que ça ne prouve pas.** Douze allocations ne sont pas trente mille : l'ordre
de grandeur qui rend la technique payante là-bas n'est pas le nôtre. Le chiffre à
obtenir avant d'écrire une ligne est la PART de `jsEncodeMs` que ces allocations
prennent — `frameDiagnostics` le rend déjà, et l'enveloppe ci-dessus peut
chronométrer aussi bien que compter.

## Ce qui reste genuinement à instruire

✅ **La campagne de mesure est faite : [`01-ou-part-le-temps.md`](01-ou-part-le-temps.md)
(2026-09-17).** Elle répond au point 0 et déplace le reste. Résumé en trois
chiffres : le coût GPU est **proportionnel aux pixels** (0,65 ms par Mpx,
constant sur un rapport de 64) ; nous calculons **187 fois** les pixels que
l'écran montre ; et `jsEncodeMs` vaut **0,6 à 1,3 ms** contre ~17 ms de GPU.
Son §7 éprouve la décision « pas de distinction preview/export » SUR IMAGE, et
elle tient : la ligne de partage est **global contre local**, pas ton contre
pixel.

✅ **Et l'ablation du premier poste de calcul :
[`02-ablation-du-grain.md`](02-ablation-du-grain.md) (2026-09-18).** Le coût de
`grain` est le NOMBRE DE HACHAGES et rien d'autre (82 % du calcul) ; les cinq
`pow()` pèsent 4 %, le `sqrt` zéro. Les deux corrections possibles valent 8 % de
la frame, au prix d'un mécanisme neuf et d'un grain qui change de motif —
**même forme et même ordre de gain que l'optimisation ALU du verre, écrite puis
revertée.** Verdict : ne pas l'écrire.

0. ~~**La part de `jsEncodeMs` prise par les douze allocations de buffer par
   frame.**~~ ✅ **RÉPONDU, et c'est NON.** Tout l'encodage JS tient dans ~1 ms
   contre ~17 ms de GPU, et il est INDÉPENDANT de la taille de l'image (0,8 ms à
   26 Mpx, 1,3 ms à 0,41 Mpx). Le gros buffer à décalages viserait une fraction
   de cette milliseconde, soit moins de 2 % du temps de frame — en build de DEV,
   où ce poste est pourtant gonflé. Le motif existe, l'ordre de grandeur n'y est
   pas. Ne pas refactorer.
1. ~~**`shader-f16`.**~~ ⚠️ **QUASI CLOS, et par le pire côté.** L'adapter
   l'ANNONCE bien sur cette machine (RTX 2060 / Turing, WebView2 153 —
   `shader-f16` est dans `adapter.features`), et le mécanisme d'adhésion
   optionnel de `gpuContext.ts` se recopierait tel quel. Mais f16 n'allège que
   l'ARITHMÉTIQUE — nos textures restent en 8 bits unorm, l'invariant
   sRGB-par-le-format interdit un chemin flottant — et le 02 montre que **la
   seule arithmétique lourde de la frame est le HACHAGE**. Or `hash` repose sur
   `fract(p * 0.1031)` avec des coordonnées à plusieurs milliers : en
   demi-précision, une mantisse de 10 bits ne porte pas la partie fractionnaire
   de ce produit et **le hachage cesse de hacher**. f16 n'y est pas marginal, il
   est faux. Ce qui resterait : les opérateurs de ton, dont le 01 dit qu'ils sont
   déjà près du plancher de bande passante — donc un gain attendu proche de zéro,
   pour une question de précision ouverte près du noir en lumière linéaire.
2. **Le temps de compilation des 104 shaders**, jamais mesuré. Si une variante
   neuve fait bégayer le premier geste après l'ajout d'un effet, c'est là que la
   minification aurait un sens — et elle porterait alors sur la chaîne COMPOSÉE,
   à l'exécution, pas sur des fichiers au build. C'est un coût de DÉMARRAGE, pas
   de frame : la campagne du 01 ne le touche pas.
3. **Les postes déjà nommés** : `docs/ROADMAP.md` et
   `.scratch/prochain-palier/issues/19-le-cout-du-verre.md` portent les mesures
   de coût existantes.
4. ⭐ **NOUVEAU, et c'est le seul levier d'un autre ordre de grandeur : ne pas
   calculer les pixels qu'on ne regarde pas.** Le canvas porte la résolution
   native et le zoom n'est qu'un `transform` CSS (`ui/viewport.ts`), donc à 100 %
   on calcule 26 Mpx pour en montrer environ 5 %. Borner le rendu à la RÉGION
   VISIBLE ne dégrade rien — mêmes pixels, pleine résolution, simplement pas
   ceux qui sont hors écran — et ne touche donc pas à la décision « pas de
   distinction preview/export ». Chantier lourd (il touche le cadrage du
   pipeline), et le seul qui s'attaque au terme de l'équation qui compte. Détail
   et arbitrage dans le 01.

## La règle qui gouverne tout le chantier

⚠️ **Une mesure de cadence se prend en build de PRODUCTION.** Le plancher du
build de dev vaut 2,6 fois celui de la prod (15,4 ms contre 6,2 ms de travail
synchrone par événement) et noie les petits signaux : une mesure en dev prouve
qu'un coût EXISTE, jamais qu'il est négligeable.

⚠️ Et **un agent ne peut PAS lancer cette mesure lui-même** : le bac à sable
refuse `src-tauri/target/`, donc le binaire release ne se lance pas depuis une
session. Le run se prépare (build + photo synthétique 26 Mpx) et se passe à
Antoine — `node scripts/perf-probe.mjs bench <curseur>`.
