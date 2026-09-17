# Où part le temps — la mesure, avant toute idée d'optimisation

Status: ready-for-human
Type: research

Mesuré le 2026-09-17 sur la vraie fenêtre (CDP 9222), photo 6240 × 4160
(25,96 Mpx), pile de cinq effets — `glow`, `grain`, `curves`, `nettete`,
`lensDistortion` — plus l'étage de développement. GPU : NVIDIA GeForce RTX 2060
(Turing), WebView2 153.0.4234.32.

Instruments : `__shaderlabDebug.capturerTimingGpu()` (temps GPU par passe),
`frameDiagnostics` (temps d'encodage JS, relu dans `.dev-logs/`), le compteur
Windows `\GPU Process Memory(pid)\Total Committed`, et les sondes de ce dossier
(`opti/` du scratchpad de session — voir « Reproduire » en fin de fichier).

⚠️ **Build de DÉVELOPPEMENT.** La règle du dépôt vaut ici : une mesure en dev
prouve qu'un coût existe, jamais qu'il est négligeable. Elle s'applique au temps
CPU et à la cadence. Elle ne s'applique **pas** au temps GPU par passe : le WGSL
est identique dans les deux builds, et c'est la même carte qui l'exécute.

---

## 1. Le coût est proportionnel aux PIXELS, et à rien d'autre

Même photo, même pile de cinq effets, quatre tailles. Seul le nombre de pixels
change ; le contenu, le nombre de passes et les réglages sont identiques.

| taille | Mpx | passes | GPU total | ms par Mpx |
|---|---|---|---|---|
| 26,0 Mpx | 25,958 | 18 | **16,91 ms** | 0,651 |
| 6,5 Mpx | 6,490 | 18 | 4,46 ms | 0,687 |
| 1,6 Mpx | 1,622 | 18 | 1,05 ms | 0,647 |
| 0,41 Mpx | 0,406 | 18 | 0,33 ms | 0,813 |

**0,65 ms par mégapixel, constant sur un rapport de 64.** Le nombre de passes
est le même sur les quatre lignes : ce n'est donc pas le compte de passes qui
gouverne, c'est la surface qu'elles traversent. La dernière ligne remonte un peu
parce qu'à 0,4 Mpx plusieurs passes tombent sous le quantum de l'horloge GPU
(65 536 ns) et ne sont plus mesurées mais rangées.

Conséquence qui décide de tout le chantier : **toute optimisation qui ne réduit
pas le nombre de pixels traités travaille sur les 0,65, jamais sur les 26.**

## 2. Nous calculons 187 fois les pixels que l'écran montre

Le canvas porte la résolution NATIVE du document et n'est réduit que par CSS
(`presentPass.ts:44`, `ui/viewport.ts` — le zoom est un `transform` CSS, jamais
un changement de résolution de rendu).

| | |
|---|---|
| canvas | 6240 × 4160 = **25,96 Mpx** |
| affiché à l'écran, dock ouvert | 456 × 304 = **0,139 Mpx** |
| rapport | **187 ×** |

Le rapport dépend de la place que prend le dock : 63 × avec le dock replié,
187 × avec les panneaux ouverts. Il ne descend jamais sous ~8 × sur cette
machine, l'écran étant bien plus petit que la photo.

Et à 100 % de zoom, le rapport ne s'inverse pas : on voit alors une FRACTION de
l'image (environ 5 % de sa surface dans cette fenêtre) et on calcule quand même
les 26 Mpx.

## 3. Ventilation par effet, à 26 Mpx

Médiane de trois frames, chacune provoquée par un vrai réglage.

| passe | GPU | rapport au plancher de copie |
|---|---|---|
| `grain` | **4,65 ms** | 5,9 × |
| `reglagesDeBase` (étage) | 2,82 ms | 3,6 × |
| `nettete` | 2,69 ms | 3,4 × |
| `lensDistortion` | 2,56 ms | 3,3 × |
| `glow` (12 passes) | 2,16 ms | — |
| `curves` | 0,98 ms | 1,2 × |
| `passthrough` | 0,79 ms | 1,0 × (le plancher) |

**`passthrough` est le plancher de copie** : il lit un texel et l'écrit, sans
rien calculer. À 26 Mpx il coûte 0,786 ms, soit 207,7 Mo lus + écrits en
0,786 ms = **264 Go/s, environ 79 % du pic mémoire d'une RTX 2060** (336 Go/s).
Une passe pleine résolution triviale est donc déjà limitée par la bande
passante ; il n'y a rien à y gagner par le code.

Ce plancher permet de séparer les deux coûts. Neuf des dix-huit passes sont en
pleine résolution (les dix de la pyramide de `glow` travaillent sur des tailles
réduites et coûtent 0,85 ms à elles toutes) :

- **7,07 ms (42 %)** sont le trafic incompressible de neuf allers-retours en
  pleine résolution ;
- **9,8 ms (58 %)** sont du calcul au-dessus de ce plancher ;
- et **`grain` seul porte 3,86 ms de ce calcul, soit 39 % du total.**

⚠️ Un classement ne donne pas la cause — la leçon du verre (`19-le-cout-du-verre`)
est explicite là-dessus. `grain` est un **candidat**, pas un verdict : il faut une
ablation, un facteur à la fois, pour savoir si c'est son hachage, ses
prélèvements ou sa dépendance à la luminance qui coûte.

## 4. Le CPU ne coûte presque rien, et cela RÉPOND au point 0 du chantier

`jsEncodeMs`, relu dans `.dev-logs/`, six calques, 26 Mpx :

```
frame#15 jsEncodeMs=1   enabledLayers=6 churnedThisFrame=24 pipelineCacheSize=10 imageSize=6240x4160
frame#30 jsEncodeMs=0.8 enabledLayers=6 churnedThisFrame=24 pipelineCacheSize=10 imageSize=6240x4160
frame#45 jsEncodeMs=0.8 enabledLayers=6 churnedThisFrame=24 pipelineCacheSize=10 imageSize=6240x4160
frame#60 jsEncodeMs=0.6 enabledLayers=6 churnedThisFrame=24 pipelineCacheSize=10 imageSize=6240x4160
```

**0,6 à 1,3 ms, et INDÉPENDANT de la taille de l'image** — 0,8 ms à 26 Mpx,
1,3 ms à 0,41 Mpx, le même travail d'encodage quelle que soit la surface. C'est
la signature d'un coût purement CPU, et c'est le dénominateur que le point 0 de
l'énoncé demandait.

> **Le point 0 est donc RÉPONDU, et la réponse est NON.** Les douze allocations
> de buffer par frame vivent à l'intérieur de ~1 ms d'encodage JS, contre
> ~17 ms de GPU. La technique du gros buffer d'uniformes à décalages
> (webgpufundamentals, « shaved off 40% of the JavaScript time ») viserait au
> mieux une fraction de cette milliseconde : moins de 2 % du temps de frame, en
> build de DEV où ce poste est pourtant gonflé. Elle ne vaut pas son refactor
> ici. Le motif existe bien, l'ordre de grandeur n'y est pas — exactement ce que
> l'énoncé disait qu'il fallait vérifier avant d'écrire une ligne.

Reste noté sans être instruit : `churnedThisFrame=24`, vingt-quatre ressources
recyclées par frame. Le compteur existe, personne ne lui a demandé lesquelles.

## 5. Mémoire

`Total Committed` du process GPU WebView2, même pile de cinq effets :

| document | Total Committed |
|---|---|
| 26,0 Mpx | **1150,3 Mo** |
| 0,41 Mpx | 160,7 Mo |

**990 Mo sont imputables à la seule résolution native**, soit environ neuf ou dix
textures RGBA8 pleine résolution résidentes (103,8 Mo pièce). Sur les 6 Go de
cette carte, une toile à `MAX_CANVAS_PIXELS` (64 Mpx, ADR-0007) demanderait le
même facteur — de l'ordre de 2,8 Go. Le plafond tient, mais sans marge
confortable pour une pile plus haute.

## 6. Ce que la cadence dit, et ce qu'elle ne peut pas dire

`perf-probe bench` en dev, glissement réel de 120 pas : **3,4 · 7,8 · 17,4
images/s**, part de fil principal de 31 % à 99 % selon la passe. Non concluant,
et c'est attendu : le build de dev est exactement là où ce chiffre ne vaut rien.
Ce qu'on peut en dire malgré tout, c'est que 16,9 ms de GPU plafonnent la pile à
59 images/s **même si tout le reste devenait gratuit**.

Ce chiffre-là se reprend en production. C'est le seul de ce document qui l'exige.

---

## Ce que ces mesures écartent, et ce qu'elles ouvrent

**Écarté — la minification WGSL.** Elle ne touche aucun des postes mesurés. Le
coût est dans les pixels traversés, pas dans le texte du shader. (Reste vraie la
question ouverte du temps de COMPILATION des 104 variantes, qui est un coût de
démarrage et non de frame — point 2 de l'énoncé, toujours non mesuré.)

**Écarté — le gros buffer d'uniformes à décalages.** Point 0, répondu ci-dessus.

**À mesurer avant de croire quoi que ce soit — `shader-f16`.** L'adapter
l'ANNONCE sur cette machine (vérifié : `shader-f16` est dans
`adapter.features`), donc le mécanisme d'adhésion optionnel de `gpuContext.ts`
suffirait. Mais une passe triviale est déjà à 79 % du pic de bande passante, nos
textures restent en 8 bits unorm, et f16 n'allège que l'ARITHMÉTIQUE. Le seul
endroit où il aurait une chance est le calcul au-dessus du plancher de copie —
`grain` en premier. À éprouver là, sur un seul effet, avant tout portage.

**Le seul levier d'un autre ordre de grandeur : ne pas calculer 187 fois trop de
pixels.** Il se heurte à une décision explicite d'Antoine (« Pas de distinction
preview/export — un seul pipeline, résolution native, toujours »), et cette
décision a une base réelle : un effet PAR PIXEL — grain, trame, micro-relief —
rendu à 456 px de large ne ressemble pas à sa version pleine résolution réduite
pour l'affichage. Réduire APRÈS calcul est une moyenne correcte ; calculer
réduit change la fréquence spatiale du motif. Ce n'est pas la même image.

Mais la décision porte sur un aperçu DÉGRADÉ, et il existe une forme du levier
qui n'en est pas un :

> **À 100 % de zoom, seule une fraction de l'image est visible, et rien ne serait
> perdu à ne calculer que la région visible — au pixel près, à pleine
> résolution.** Aucun compromis de fidélité, aucune distinction preview/export :
> les mêmes pixels, simplement pas ceux qu'on ne regarde pas.

C'est le chantier que ces mesures désignent. Il est plus lourd que tout ce que
la proposition d'entrée envisageait (il touche le cadrage du pipeline, pas un
shader), et c'est le seul qui s'attaque au terme de l'équation qui compte.

**Arbitrage qui revient à Antoine**, et qui n'est pas dans ce fichier :
faut-il rouvrir la question du rendu à la résolution d'affichage à
l'AJUSTEMENT — où l'œil voit déjà une réduction, celle du compositeur, et où la
question n'est donc pas « vrai ou faux » mais « quelle réduction » ?

---

## Reproduire

Sondes écrites pour cette campagne (scratchpad de session, `opti/`) :

| sonde | ce qu'elle rend |
|---|---|
| `etat.mjs` | taille canvas, taille affichée, rapport, calques |
| `ouvrir.mjs <photo> [effets…]` | monte la scène par CDP |
| `timing.mjs <module> <param> <val> [n]` | temps GPU par passe, passes du même effet indexées |
| `balayage-taille.mjs` | la loi d'échelle des quatre tailles |
| `adapter.mjs` | features et limites annoncées par l'adapter |
| `vram.ps1` | `Total Committed` du process GPU WebView2 |
| `faire-tailles.py` | les copies réduites de la photo |

⚠️ **Un trou d'instrument, à savoir avant de relire ces chiffres.** Seules les
passes encodées par `runEffectPass` sont chronométrées (`effectPassRunner.ts:460`).
La passe de PRÉSENTATION ne l'est pas — elle écrit pourtant les 26 Mpx du canvas.
Le « GPU total » de ce document est donc un plancher : il manque au moins une
passe pleine résolution, de l'ordre de 0,8 ms.
