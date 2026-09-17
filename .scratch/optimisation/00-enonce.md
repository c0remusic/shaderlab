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

## Ce qui reste genuinement à instruire

1. **`shader-f16`.** C'est la seule idée de la proposition qui touche le matériel
   et pas le texte. Le mécanisme d'adhésion existe déjà et se recopie :
   `gpuContext.ts` demande `timestamp-query` SI ET SEULEMENT SI l'adapter
   l'annonce, jamais en dur — demander une feature absente ferait rejeter
   `requestDevice` en bloc. Trois choses à vérifier avant d'écrire une ligne :
   l'adapter de cette machine l'annonce-t-il sous WebView2 ; nos textures étant
   en 8 bits unorm et l'invariant sRGB-par-le-format interdisant un chemin
   flottant, f16 n'allège que l'ARITHMÉTIQUE, pas les lectures de texture ; et
   la précision suffit-elle pour nos opérateurs de ton, dont plusieurs
   travaillent près de zéro en lumière linéaire.
2. **Le temps de compilation des 104 shaders**, jamais mesuré. Si une variante
   neuve fait bégayer le premier geste après l'ajout d'un effet, c'est là que la
   minification aurait un sens — et elle porterait alors sur la chaîne COMPOSÉE,
   à l'exécution, pas sur des fichiers au build.
3. **Les postes déjà nommés** : `docs/ROADMAP.md` et
   `.scratch/prochain-palier/issues/19-le-cout-du-verre.md` portent les mesures
   de coût existantes.

## La règle qui gouverne tout le chantier

⚠️ **Une mesure de cadence se prend en build de PRODUCTION.** Le plancher du
build de dev vaut 2,6 fois celui de la prod (15,4 ms contre 6,2 ms de travail
synchrone par événement) et noie les petits signaux : une mesure en dev prouve
qu'un coût EXISTE, jamais qu'il est négligeable.

⚠️ Et **un agent ne peut PAS lancer cette mesure lui-même** : le bac à sable
refuse `src-tauri/target/`, donc le binaire release ne se lance pas depuis une
session. Le run se prépare (build + photo synthétique 26 Mpx) et se passe à
Antoine — `node scripts/perf-probe.mjs bench <curseur>`.
