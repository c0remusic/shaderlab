# Ablation de `grain` — le coût est le NOMBRE DE HACHAGES, et rien d'autre

Status: ready-for-human
Type: research

Mesuré le 2026-09-18, même machine et même instrument que
[`01-ou-part-le-temps.md`](01-ou-part-le-temps.md). Photo boîtier 6240 × 4160,
effet `grain` aux réglages par défaut (mode Analogique), harnais offscreen,
`captureGpuTiming`. Instrument : `sondes/ablation-grain.mjs`.

Le 01 désigne `grain` comme le premier poste de calcul de la frame — 4,65 ms,
5,9 × le plancher de copie, **39 % de tout le calcul**. Il le désigne comme un
CANDIDAT : un classement ne donne pas la cause, seule une ablation la désigne
(leçon de `19-le-cout-du-verre`). Voici l'ablation.

## Méthode, et les deux corrections qu'elle a demandées

Le corps WGSL d'un module est une chaîne, et la clé du cache de pipelines EST la
chaîne composée : muter `grain.wgsl` dans la page suffit donc à obtenir une
variante compilée, sans toucher au disque. Chaque variante retire **un** terme et
garde la structure de passe identique — même nombre de passes, même résolution,
même uniform.

⚠️ **La première passe, 5 répétitions par variante mesurées en bloc, a rendu
TROIS ablations plus LENTES que le témoin.** Physiquement impossible : une
ablation ne peut qu'enlever du travail. C'était du bruit, et il valait plus que
les termes à mesurer. Deux corrections, et elles ne sont pas cosmétiques :

1. **Round-robin.** Mesurer une variante entièrement avant la suivante fait
   porter toute dérive d'horloge GPU par celle qui passe à ce moment-là. En
   tournant variante par variante à chaque tour, la dérive frappe tout le monde
   pareil.
2. **Minimum, pas médiane.** Le travail est déterministe : le bruit ne peut
   qu'AJOUTER (préemption, changement d'état d'horloge). Le minimum sur N tours
   estime le coût réel ; la médiane mesure l'état de la machine autant que celui
   du shader.

⚠️ **Et un CONTRÔLE DE BRUIT, qui n'est pas décoratif** : `temoin-bis` porte un
corps strictement identique au témoin à un commentaire près — autre chaîne, donc
autre pipeline, mais exactement le même travail. **L'écart témoin / témoin-bis
EST le plancher de bruit de la campagne.** Sans lui, la deuxième passe aurait
conclu que le transfert sRGB pèse 27 % du calcul ; il pèse 4 %. Les rangs des
termes secondaires s'étaient échangés d'un run à l'autre, et rien ne le signalait.

## Le relevé — 30 tours, minimum, plancher de bruit 0,066 ms

| variante | min | ce qu'elle retire | part du calcul |
|---|---|---|---|
| `temoin` | 3,867 ms | — | — |
| **`temoin-bis`** (contrôle) | 3,932 ms | **rien** | **0,066 ms = le bruit** |
| `branche-au-lieu-de-select` | 3,932 ms | l'évaluation des deux branches | **0,066 ms = bruit, AUCUN gain** |
| `sans-bruit-analogique` | 1,638 ms | les 12 hachages du bruit de valeur | **2,228 ms = 68 %** |
| `sans-bruit-capteur` | 3,408 ms | les 3 hachages jamais utilisés | 0,459 ms = 14 % |
| `sans-transferts-srgb` | 3,736 ms | les 5 `pow()` | 0,131 ms = 4 % |
| `sans-sqrt-normalisation` | 3,867 ms | le `sqrt` | **0,000 ms = 0 %** |
| `plancher-copie` | 0,590 ms | tout le calcul | 3,277 ms = 100 % |

Le plancher de passe mesuré ici (0,590 ms) recoupe le `passthrough` du 01
(0,786 ms) — deux chemins différents pour la même grandeur.

## Ce que ça dit

**Le coût de `grain` est le NOMBRE DE HACHAGES, et rien d'autre.** Quinze
hachages par pixel — douze pour le bruit de valeur analogique (3 canaux × 4
coins), trois pour le bruit capteur — portent **82 %** du calcul. Tout le reste
réuni en fait 4 % : les cinq `pow()` des transferts sRGB coûtent 0,131 ms, le
`sqrt` de normalisation ne coûte **rien de mesurable**.

⚠️ **Deux prédictions fausses, dans le même sens.** J'attendais que les cinq
`pow()` soient le poste dominant — une fonction transcendante « coûte cher », et
il y en a cinq par pixel contre quinze hachages en arithmétique simple. Le
matériel dit l'inverse : sur Turing, `pow` est une paire `log2`/`exp2` sur une
unité dédiée qui tourne en parallèle, quand quinze hachages saturent les unités
entières et vectorielles. **Compter les opérations « chères » n'est pas mesurer.**

**`select` évalue bien les deux branches — mais brancher ne récupère rien.**
`select(analogique, capteur, numerique)` calcule les deux champs de bruit à
chaque pixel, et retirer le champ capteur économise réellement 0,459 ms. Or
remplacer le `select` par un `if` sur une condition UNIFORME économise
**0,066 ms, soit exactement le bruit**. Le gain n'apparaît que si le code
DISPARAÎT du shader.

Hypothèse la plus simple, non vérifiée : le pilote *if-convertit* une branche
aussi courte (trois hachages) et la repredique en `select`. C'est une
optimisation standard. Ce qui est MESURÉ, et qui ne dépend pas de l'explication :
**la seule façon de récupérer ces 14 % est de ne pas émettre le code**, donc un
corps de shader spécialisé par mode — pas un branchement.

## Les deux pistes de correction, chiffrées

| piste | gain | bit-exact ? | ce qu'elle demande |
|---|---|---|---|
| corps spécialisé par mode (le champ inutilisé n'est pas émis) | 0,459 ms | **oui** | un mécanisme neuf : un corps WGSL qui dépend d'une valeur de paramètre |
| hachage à TROIS sorties (`hash32`, 4 appels au lieu de 12) | 0,918 ms | non — autre tirage | régénérer la référence de pixels de `grain` |
| les deux | **1,376 ms** | non | les deux ci-dessus |

## Verdict : ça ne paie pas, et c'est la réponse au chantier

1,376 ms sur une frame de 16,9 ms font **8 %**, pour un effet, au prix d'un
mécanisme neuf ET d'un grain qui ne tire plus le même motif.

**C'est exactement la forme du geste que ce dépôt a déjà écrit puis reverté** :
l'optimisation ALU du verre (neuf appels de bruit ramenés à trois par dérivées
analytiques), mesurée à 8 % de gain, dans le bruit, contre dix-huit références
déplacées (`19-le-cout-du-verre`). Même effort, même ordre de gain, même verdict.
Ne pas l'écrire.

⚠️ **Et ça ferme aussi le point 1 du chantier, plus durement que le 01 ne le
faisait.** `shader-f16` n'allège que l'arithmétique ; la seule arithmétique
lourde de la frame est le hachage. Or `hash` repose sur `fract(p * 0.1031)` avec
des coordonnées qui montent à plusieurs milliers : **en demi-précision, la
mantisse de 10 bits ne porte pas la partie fractionnaire de ce produit, et le
hachage cesse de hacher.** f16 n'y est pas marginal, il est FAUX. Il resterait à
éprouver sur les opérateurs de ton, dont le 01 dit déjà qu'ils sont près du
plancher de bande passante.

## Conclusion du chantier, en une phrase

Trois axes mesurés, trois fois non — le texte du shader (01), les allocations
CPU (01), l'arithmétique par pixel (ici). **Il ne reste que le terme que le 01 a
isolé : le nombre de pixels traités.** Et sous la seule forme qui ne dégrade
rien : ne pas calculer ce qui est hors écran, ce qui ne paie qu'en zoom.

## Reproduire

`node .scratch/optimisation/sondes/ablation-grain.mjs`, l'app lancée avec CDP
9222 et un Vite du worktree courant sur 1421. La sonde remet le corps d'origine
en sortant ; elle ne touche jamais au disque.
