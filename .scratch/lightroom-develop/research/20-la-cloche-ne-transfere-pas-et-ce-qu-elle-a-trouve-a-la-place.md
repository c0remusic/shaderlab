# La cloche ne transfère pas au modèle en service — et ce que l'essai a trouvé à la place

Mesuré le 2026-09-22, juste après
[research/19](19-les-poids-de-plage-sont-quatre-cloches.md). **Essai refusé.**
Aucun changement dans `src/` : l'édition a servi de look-dev jetable, puis a été
reprise. Le refus a une raison mesurée, et l'essai a trouvé autre chose que ce
qu'il cherchait.

## Pourquoi l'essai valait d'être fait

research/19 a mesuré le poids des hautes lumières comme une **cloche centrée à
L = 0,810** (sommet au niveau sRGB 200, soit L ≈ 0,833), là où `colorGrading.ts`
pose une rampe `wh = α^g · cov` qui monte jusqu'au blanc. Cette note-là concluait
« rien n'est posé dans `src/` », parce que le modèle en COURBE qui a servi à
extraire le poids demande la campagne F.

Mais **le poids est un facteur séparé de l'opérateur**. Remplacer `wh` ne demande
pas le modèle courbe, donc pas la campagne F. L'essai était disponible tout de
suite, et le protocole existait déjà : `assets/verifier-grading.mjs` bundle le twin
depuis le DISQUE, édition non commitée comprise.

**Référence à battre : 4,17 niveaux de moyenne sur les treize mesures de virage,
pire cas 41,0 (`st-balance-p100`).**

## 1. La cloche au centre mesuré PERD

| variante | moyenne | pire cas |
|---|---|---|
| en service (rampe) | **4,17** | 41,0 |
| cloche au centre mesuré (0,810 / 0,19 / 0,8) | **4,37** | 38,9 |

Posée exactement là où elle a été mesurée, la cloche est **plus mauvaise** que la
rampe qu'elle devait corriger.

**La raison est le symétrique exact du piège que research/18 avait identifié.** Le
poids de research/19 a été extrait en inversant le modèle en COURBE (`lin·(1 +
w(g−1)) + w·b`). Le modèle en service est un décalage de L saturant. Une forme
mesurée à travers un opérateur, injectée dans un autre, mesure les deux à la fois
— et ici elle échoue. **La cloche et la courbe vont ensemble ou pas du tout.**

## 2. Ce que l'essai a montré en passant : chroma et luminance ne veulent pas le même poids

Première variante, la cloche appliquée partout (0,84 / 0,21 / 0,6, balance 0,3) :

| scène | en service | cloche | ce que c'est |
|---|---|---|---|
| `st-hl-orange` | 2,15 (max **26,3**) | **1,65** (max **16,2**) | CHROMA des hautes lumières |
| `cg-hl-lum-p50` | **2,57** | 2,87 | LUMINANCE des hautes lumières |

**La cloche améliore la chroma et dégrade la luminance** — l'inverse de ce à quoi
research/19 la destinait, puisque c'est sur la luminance qu'elle a été mesurée.

L'explication tient à ce que les deux chemins n'ont pas le même opérateur : la
chroma est un décalage **additif** de `a`/`b`, la luminance passe par
`appliqueLum`, **saturant**. `colorGrading.ts` leur impose pourtant le même `wh`.
⚠️ **Ce partage n'a jamais été mesuré ; il est postulé.** C'est un fait sur notre
code, pas sur Lightroom, et il reste vrai quoi qu'il advienne de la cloche.

## 3. Le gain apparent est à 65 % un correctif de la Balance

En ajustant librement la gaussienne sur la chroma seule, l'optimum (d'abord en
bord de grille, puis intérieur après extension) tombe à **4,02** — 3,6 % mieux que
4,17. Tentant. Le détail par scène le désarme :

| scène | en service | gaussienne 0,93 / 0,25 / 0,8 |
|---|---|---|
| **`st-balance-p100`** | 6,99 (max **41,0**) | **5,71** (max **15,2**) |
| `cg-fusion-0` | 4,99 | 4,68 |
| `st-duo` | 4,84 | 4,57 |
| `st-hl-orange` | 2,15 | 2,05 |
| `cg-fusion-100` | 6,35 | **6,50** |
| les huit autres | — | **inchangées au centième** |

**65 % du gain de moyenne vient d'une seule scène**, et le centre qui l'obtient
(0,93) est très loin du centre mesuré (0,810). Une gaussienne de centre 0,93 sur
[0, 1] est une rampe adoucie, pas la cloche de research/19 : **ce qui gagne n'est
pas ce qui a été mesuré.** C'est du sur-ajustement sur treize scènes, et la table
de calibration met en garde contre exactement ça.

## Ce que l'essai laisse, et qui vaut mieux que ce qu'il cherchait

⚠️ **Le pire cas des treize mesures peut tomber de 41,0 à 15,2.** Il est sur
`st-balance-p100` depuis le début, et aucune des corrections de poids successives
ne l'avait fait bouger. Une forme bornée en haut de rampe le divise par 2,7 — donc
**le défaut vit dans ce que la Balance fait à `alpha`**, pas dans la forme du poids
des hautes lumières. À `Balance +100`, `alpha` est fortement décalé et `α^g`
devient très raide ; toute forme bornée limite les dégâts, ce qui est le signe
qu'on traite un symptôme.

C'est une piste neuve, ciblée sur une scène nommée, avec un gain chiffré à
l'avance — et elle ne demande ni la campagne F ni le modèle courbe.

## Ce qui reste vrai de research/19

Rien n'y est démenti. La mesure tient : les quatre poids extraits **sous le modèle
courbe** sont quatre cloches, le centre des hautes lumières est robuste sous trois
jeux de constantes, et `midSigma` y reçoit sa validation croisée à 0,001 près. Ce
que cette note ajoute est **qu'on ne peut pas en prélever une pièce pour
l'installer dans l'autre modèle** — et c'est une raison mesurée de garder
l'ordre : la campagne F, puis l'opérateur, puis les poids.
