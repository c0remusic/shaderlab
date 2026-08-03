---
id: ADR-0016
status: active
date: 2026-08-03
---

# ADR-0016 : `lensDistortion` absorbe `chromaticBleed` (orientation du décalage)

## Contexte

Le recouvrement était **déclaré depuis ADR-0014**, dans l'en-tête de
`lensDistortion` et dans un test qui le gardait délibérément visible : le mode
d'aberration Latérale fait ce que `chromaticBleed` fait, avec les mêmes contrôles
de profil radial. Antoine avait tranché « tout dans lensDistortion », ce qui
mettait `chromaticBleed` en candidat au retrait — laissé ouvert parce que retirer
un effet est une décision à part.

**Ce dossier a été instruit par une MESURE, pas par une lecture comparée des deux
fichiers.** Les deux effets ont été posés sur la même mire (damier neutre) et aux
mêmes réglages (`amount`/`aberration` 0,06, `centerFalloff` 2, `centerPresence`
0,1, `asymmetry` 0,4), et le harnais de rendu a chiffré l'écart :

|  | Écart, en part des canaux |
| --- | --- |
| `lensDistortion` Latérale **vs** `chromaticBleed`, tout égal par ailleurs | **0,005 %** (≈ 10 canaux sur 196 608) |
| `chromaticBleed` à 45° **vs** le même à 0° | **23,1 %** |

La mesure a dit **deux** choses là où on n'en attendait qu'une :

1. Le doublon était réel sur le cas radial, à une dizaine de canaux près — un
   niveau d'accord qu'aucune lecture de code n'aurait osé affirmer, les deux
   implémentations étant indépendantes (l'une déplace, l'autre change le
   grandissement).
2. **`chromaticBleed` savait une chose de plus, et elle n'était pas mineure.**
   Son curseur `angle` (±45°) fait pivoter le décalage : à 45° les franges sont
   TANGENTIELLES au lieu de radiales, la signature d'un objectif décentré. Un
   grandissement dépendant de la longueur d'onde — ce que fait le mode Latérale —
   ne produit que du radial, par construction. Aucun réglage des quatre autres
   curseurs ne s'en approche.

Sans cette seconde ligne, le retrait aurait été un retrait sec présenté comme un
dédoublonnage.

## Décision

`chromaticBleed` est absorbé par `lensDistortion`, et l'orientation est **portée
avant le retrait** sous la forme du paramètre `aberrationAngle` (±45°, défaut 0),
ajouté à la fin de la liste.

**Un seul paramètre neuf pour tout un effet.** Les quatre autres existaient déjà
ici : `amount` → `aberration`, et `centerFalloff` / `centerPresence` /
`asymmetry` sous les mêmes noms et la même algèbre — le profil radial de l'un,
`centerPresence + (1 − centerPresence)·pow(radial, falloff)`, est le `mix(pow(…),
1, centerPresence)` de l'autre, écrit autrement.

Deux contraintes ont commandé la forme exacte :

1. **Le défaut prend une BRANCHE, pas une rotation par l'identité.** À angle nul
   les deux écritures sont algébriquement égales et ne le sont pas en flottant :
   `p·geom·(1+k)` n'est pas bit pour bit `p·geom + p·geom·k`. Or
   `effet-lens-distortion-laterale` fige la première. La branche préserve donc
   exactement le chemin verrouillé, et l'écriture par décalage ne sert que là où
   elle est nécessaire — vérifié : cette référence sort `aucun ecart`.
2. **La rotation se fait dans l'espace corrigé de l'aspect**, avant reconversion
   en UV. La faire après serait une rotation dans un espace anisotrope, donc un
   cisaillement déguisé sur toute image non carrée. L'effet absorbé portait déjà
   cet avertissement ; le reperdre en déménageant le code aurait été le genre de
   régression qu'aucun test n'attrape.

## Conséquences

- **L'id `chromaticBleed` disparaît** : un preset qui le cite perd ce calque avec
  un avertissement, jamais une exception (même mécanisme qu'ADR-0011 à 0015).
- **Ce n'est PAS une absorption identique à l'octet**, à la différence des quatre
  précédentes — les deux implémentations étaient indépendantes, pas déplacées.
  Trois références ont donc été régénérées, et c'est le chiffre de 0,005 % qui
  autorise à le faire plutôt que l'inverse :
  - `effet-chromatic-bleed` → `effet-lens-distortion-laterale-damier`
  - `effet-chromatic-bleed-tangentiel` → `effet-lens-distortion-laterale-decentree`
  - `photo-double-exposure`, où l'effet n'était qu'un PASSAGER (le scénario
    verrouille la double exposition). Contrôle d'ampleur : le PNG passe de 36 820
    à 36 823 octets, soit trois octets — la transposition est fidèle.
- **Le verrou de l'orientation rend le même chiffre qu'avant** : la nouvelle paire
  de références s'écarte de **23,1 %**, exactement comme l'ancienne. La capacité
  est portée à l'identique en amplitude, pas approximée.
- **Le curseur d'orientation apparaît en BAS du panneau**, loin des autres
  réglages d'aberration, parce que l'index est persisté dans les presets et que le
  confort de rangement ne vaut pas de déplacer les quinze autres. Même arbitrage
  qu'aux quatre absorptions précédentes.
- **Le registre passe de dix-neuf à dix-huit effets.**
- Le troisième garde-fou d'ADR-0014 — « un test verrouille que `chromaticBleed`
  est toujours au registre, pour que le doublon reste visible » — est **retourné**
  et non supprimé : le même test vérifie désormais que l'id ne résout plus.

## Ce qui a été rapatrié plutôt que perdu

`chromaticBleed` n'avait pas de fichier de test à lui ; ses propriétés vivaient
dispersées dans les tests d'AUTRES modules, ce qui est le cas le plus facile à
perdre.

- `test/render/effects/uvSpace.test.ts` prouvait sur lui la convention d'espace
  (correction d'aspect + repli des taps hors cadre). Reportée sur
  `lensDistortion`, avec en plus l'assertion sur la rotation en espace isotrope.
- `test/render/effects/registry.test.ts` prouvait sur lui que tout paramètre
  exposé porte un label français et une unité. Reporté de même : ce que ce test
  garde n'est pas un effet, c'est une règle du registre.

## Alternatives écartées

- **Retirer sans porter l'orientation.** C'était l'option par défaut avant la
  mesure, et elle aurait coûté une géométrie entière — 23,1 % d'écart n'est pas
  une nuance. Le fait qu'elle ait semblé raisonnable jusqu'à la mesure est
  précisément l'argument pour mesurer avant de retirer.
- **Garder `chromaticBleed` pour son seul mode tangentiel.** Un effet entier, cinq
  curseurs, une entrée de liste et une implémentation à maintenir, pour un
  paramètre qui tient en une ligne dans le voisin.
- **Insérer `aberrationAngle` à côté d'`asymmetry`, où il se lit.** Aurait décalé
  les neuf index suivants, tous persistés — un preset réglé sur la traînée serait
  ressorti avec un autre réglage.
