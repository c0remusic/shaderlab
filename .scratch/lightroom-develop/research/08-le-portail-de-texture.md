# Le portail de Texture est un détecteur de GRAIN, pas de bord

Mesuré le 2026-09-16 sur une vraie photo (DSCF5171, original boîtier), après
qu'Antoine ait dit « toujours pas satisfait par texture » alors que la mire
donnait un écart moyen de 0,057 à Lightroom sur quatorze échelles.

**Deux corrections ont été écrites et REVERTÉES avant que la cause soit
mesurée.** Elles sont ici avec leurs chiffres : les refaire serait perdre la
journée deux fois.

## Le symptôme, chiffré

Bord montant, Texture +100, écart au témoin, polarités séparées — les mélanger
annule tout halo signé et ne laisse que sa part symétrique.

| distance au bord | −12 | −9 | −6 | 0 | +3 | +6 |
|---|---|---|---|---|---|---|
| Lightroom | +0,78 | +0,71 | **−0,11** | −4,41 | **+4,17** | +2,12 |
| shaderlab | −0,78 | −0,86 | **−1,43** | −5,36 | **+1,75** | +1,30 |

Deux défauts. Nous creusons une **tranchée sombre sur 12 px** du côté sombre de
chaque bord, là où Lightroom ne creuse pas — c'est le liseré que l'œil attrape,
parce qu'il est cohérent le long de tous les contours. Et nous soulevons **2,4
fois moins** du côté clair.

Sur le grain, même sens : nous amplifions ×1,62 à +100 quand Lightroom fait
×1,76, et nous lissons ×0,65 à −60 quand il fait ×0,53. Notre opérateur **cerne
au lieu de porter**.

## L'ablation nomme la bande

Une seule ablation, un facteur à la fois — et elle aurait dû venir en premier :

| distance | −12 | −6 | 0 | +3 | +6 |
|---|---|---|---|---|---|
| Lightroom | +0,78 | −0,11 | −4,41 | +4,17 | +2,12 |
| les deux bandes | −0,78 | −1,43 | −5,36 | +1,75 | +1,30 |
| **bande fine seule** | +0,02 | **−0,22** | −2,08 | −0,18 | +0,07 |
| **bande moyenne seule** | −0,76 | **−1,09** | −3,15 | **+2,02** | +1,29 |

La tranchée est **entièrement** la bande moyenne ; la fine ne porte que le bord
immédiat et ne creuse rien. Et la même bande moyenne porte tout le soulèvement
du côté clair : chez nous les deux sont indissociables, chez Lightroom le
soulèvement existe sans la tranchée.

## Les deux impasses, avec leurs chiffres

**1. Faire voir au portail la structure locale** — `porte = eps/(max(var, d²)+eps)`
avec `d = y − yMoyen`. Résultat : tranchée à peine reculée (−1,12 contre −1,43)
et soulèvement **effondré** (0,61 contre 1,75). Perte nette.

**2. Le filtre guidé rapide de He**, coefficients `a` et `b` calculés au bas de
la pyramide et moyennés par la remontée — l'étape que le binaire nomme
(`cr_stage_box_conv_plus_product_and_computeab`). Résultat : tranchée inchangée
(−1,46) et bord **creusé** (−7,41 contre −5,36). Ce second échec est le plus
informatif : si les coefficients faisaient ce qu'on croit, la bande devait
s'affaiblir près du bord, pas se renforcer.

Les deux corrections partageaient la même faute de méthode — moduler un
coefficient **jamais regardé**.

## La sonde, et la cause

Une passe de diagnostic jetable (par l'iframe du harnais, aucun commit) a fait
sortir les trois champs au lieu de l'image. Lus sur 238 lignes en travers du
même bord :

| distance au bord | −12 | −6 | 0 | +6 | +12 |
|---|---|---|---|---|---|
| **variance** | 0,0142 | 0,0163 | **0,0180** | 0,0169 | 0,0148 |
| **portail** | 0,369 | 0,337 | **0,315** | 0,329 | 0,362 |
| détail moyen | −0,058 | −0,027 | +0,007 | +0,029 | +0,041 |

⚠️ La cible de rendu est en sRGB **par le format** : ce que le shader écrit est
encodé à l'écriture. Lire la PNG telle quelle fait mentir les trois champs du
même facteur — décoder par l'EOTF avant toute lecture.

**La variance vaut 0,015 PARTOUT**, parce que le grain du capteur la remplit à
lui seul (~12 niveaux de luma dans ces photos). L'epsilon vaut 0,0082, donc le
portail est déjà fermé aux deux tiers en terrain plat, et il ne lui reste
presque aucune course : au bord il ne descend que de 0,369 à 0,315, **15 %**. Le
détail moyen, lui, est un passe-haut antisymétrique impeccable — c'est lui,
multiplié par un portail quasi constant, qui creuse la tranchée.

**Le portail est un détecteur de grain, pas un détecteur de bord.**

Ça explique les deux impasses d'un coup. Dans la première, `d²` au bord vaut
0,0016 — **dix fois sous le plancher de grain**, donc invisible ; ailleurs le
terme ne faisait que fermer davantage, d'où le soulèvement effondré. Dans la
seconde, même plancher, donc `a` quasi constant lui aussi.

Et ça explique le dernier chiffre qui manquait : **pourquoi Lightroom amplifie
le grain PLUS que nous** (×1,76 contre ×1,62). Chez eux le portail est grand
ouvert sur le grain ; chez nous il est bloqué à 0,33.

## La racine, et ce que la correction demande

**L'epsilon a été calibré sur une mire sans grain.** Sur la mire, la variance ne
vient que du signal, et six amplitudes donnent une constante propre à deux pour
cent près. Sur une photo, la variance vaut grain + structure, et le grain seul
dépasse déjà l'epsilon.

Séparer un bord d'un grain demande une mesure de structure **lissée** : la
variance du signal PASSE-BAS, et non la variance locale du signal. Les deux
portent le même nom et ne sont pas la même chose —

> **variance du flou ≠ flou de la variance**, et nous calculons la seconde.

Le binaire décrit la première à sa façon : le guide du filtre de Texture y est
une « small content image », une image réduite où le grain a disparu et où seule
la structure survit.

Notre chaîne de passes est LINÉAIRE et n'a **qu'un seul créneau de lissage**,
déjà pris par la pyramide. C'est le même manque que la portée de Clarté et que
l'airlight du voile — mais celui-ci est établi par la mesure, pas par
l'argument. **Trois opérateurs, un seul blocage.**

## Les instruments, tous rejouables

- `assets/photo-texture-rendu.mjs` — rend NOTRE Texture sur la photo aux doses
  de la campagne Lightroom, en détourages 1:1 (un opérateur par pixel se juge
  en 1:1, jamais réduit).
- `assets/mesure-photo-texture.py` — le grain et le profil de bord, polarités
  séparées. `assets/planche-photo-texture.py` — la planche Lightroom / nous.
- `assets/ablation-bandes.mjs` — éteint une bande à la fois et rend les trois
  cas. `assets/lire-sonde.py` — lit les trois champs de la sonde, EOTF comprise.
- Campagne Lightroom : `ph-temoin`, `ph-texture-{p40,p100,m60}` sur
  `DSCF5171.JPG`, par le plugin — voir `assets/listes-de-mesures.md`.
- La sonde de diagnostic n'est PAS versionnée : trois lignes dans le bloc de
  présence, `return vec4(porte, 0.5 + 2.5 * (y - yMoyen), min(varMoyenne * 50, 1), 1)`,
  rendues par l'iframe du harnais puis `git checkout`. C'est le geste à refaire
  avant de toucher à un coefficient — pas une formule de plus.
