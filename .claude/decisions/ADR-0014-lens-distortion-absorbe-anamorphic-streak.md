---
id: ADR-0014
status: active
date: 2026-08-03
---

# ADR-0014 : `lensDistortion` est écrit, et absorbe `anamorphicStreak`

## Contexte

La fiche Figma décrit `Lens distortion` comme « fisheye (`Distortion`) +
aberration avec trois modes (Lateral / Longitudinal / **Anamorphic**,
"horizontal cinema-lens split") ». Le §7 du cahier de références le portait en
tête du backlog « dans l'ordre où leur fiche les rend faisables », et le triage
en faisait le point D10 — une décision d'Antoine, pas du code en attente.

`anamorphicStreak` avait été écrit le 2026-08-01 comme troisième membre de la
famille des HALOS. Ce classement était défendable (il part du même bright-pass
que `glow` et `halation`) et il était faux : une traînée sur un seul axe n'est
pas un halo, c'est ce que fait le **verre cylindrique** d'un objectif
anamorphique. La fiche le dit d'ailleurs en nommant `Anamorphic` un de ses trois
modes d'aberration — le phénomène appartient à la distorsion d'objectif.

## Décision

**`lensDistortion` entre au registre et `anamorphicStreak` en sort**, absorbé
(arbitrage d'Antoine, 2026-08-03 : « tout dans lensDistortion »).

L'effet porte trois choses, et la troisième ne coûte rien quand elle est éteinte.

**La géométrie.** Modèle radial `r' = r · (1 + k·r²)`, appliqué dans l'espace
CORRIGÉ DE L'ASPECT — sans quoi le fisheye serait ovale sur une photo 3:2 et le
curseur mentirait. Le signe est exposé (barillet / coussinet) et zéro est
l'**identité exacte**, pas « visuellement neutre » : `f` vaut alors 1 et l'UV est
rendue telle quelle. Un `zoom` recadre les coins que le barillet découvre ; il
est laissé à 1 et non calculé, parce qu'un recadrage est une décision.

**Les trois aberrations, qui ne sont pas trois forces du même phénomène.**

| Mode | Ce qui le distingue, et qui se voit |
|---|---|
| Latérale | Le grandissement dépend de la longueur d'onde : décalage RADIAL, **nul au centre**, croissant vers les coins. |
| Longitudinale | Le PLAN DE MISE AU POINT dépend de la longueur d'onde : elle ne déplace rien, elle défocalise par canal — donc elle se voit **partout, centre compris**. Le vert reste net et sert de référence. |
| Anamorphique | Décalage purement HORIZONTAL et **indépendant du rayon** — un verre cylindrique ne disperse que sur l'axe qu'il comprime. |

Trois références de rendu, à la même force et sur la même mire, et leurs écarts
mutuels l'établissent : **38,6 %** entre longitudinale et latérale, **36,3 %**
entre anamorphique et latérale. À l'œil, les trois images sont sans ambiguïté —
franges radiales, défocalisation générale à liseré violet/vert, et le disque
dédoublé orange/cyan du split de cinéma.

**La traînée**, reprise sans changer sa physique : bright-pass qui JETTE la
couleur de la source (la traînée prend sa teinte du traitement de l'objectif —
une lampe verte donne une traînée bleue), puis trois passes d'étalement
directionnel à pas croissants ×4.

## Ce qui rend l'absorption acceptable

Les quatre passes de la traînée sont **CONDITIONNELLES** (`EffectPass.enabled`,
posé le même jour), et son intensité a pour défaut **zéro**. Poser
`lensDistortion` pour un simple fisheye ne fait donc tourner — ni **allouer** —
aucune passe interne. Sans cette capacité, l'absorption aurait facturé quatre
cibles de demi-résolution à tout usage géométrique, soit ~24 Mo sur une image de
24 Mpx, et elle aurait été un mauvais échange.

⚠️ **Le piège que ça ouvre est neutralisé par construction.** Quand les passes
sautent, `prevPass` porte la texture SOURCE. L'énergie lue est multipliée par
`streakIntensity`, qui est la **même expression** que le prédicat des passes :
le produit vaut alors zéro et rien de cette source ne fuit. Découpler les deux
conditions ferait apparaître la photo, en double et additivement, **sans aucune
erreur de compilation** — un test fige donc le lien.

## Conséquences

- **Un preset qui cite `anamorphicStreak` perd ce calque**, avec un
  avertissement et jamais une exception (même mécanisme qu'ADR-0011 à 0013).
- **Le recouvrement avec `chromaticBleed` est RÉEL et assumé.** Le mode Latérale
  fait ce que cet effet fait déjà, avec les mêmes trois contrôles de profil
  radial. Antoine a tranché « tout dans lensDistortion », ce qui met
  `chromaticBleed` en **candidat au retrait** — non fait ici : retirer un effet
  est une décision à part et mérite son propre ADR. En attendant, un test vérifie
  que `chromaticBleed` est toujours au registre, pour que le doublon reste
  VISIBLE au lieu de se faire oublier.
- **La famille des halos retombe à deux** (`glow`, `halation`), et son découpage
  s'en trouve plus net : l'un étale sans colorer, l'autre réexpose en rouge sur
  fond sombre. La traînée n'y avait effectivement pas sa place.
- **Le registre reste à vingt** : un id sort, un id entre.
- **Les index des paramètres de la traînée ont bougé** et sont désormais déclarés
  en constantes (`P_STREAK_THRESHOLD`…), à côté de la liste qu'elles indexent.
  Ils étaient EN DUR dans les corps de passe d'`anamorphicStreak`, où la traînée
  occupait les premiers rangs ; ici elle vient après la géométrie et
  l'aberration, et un décalage silencieux aurait fait lire le mauvais curseur.

## Alternatives écartées

- **Géométrie et traînée seulement, aberration laissée à `chromaticBleed`.**
  C'était la proposition faite à Antoine, et elle évitait le doublon. Rejetée par
  lui au profit de la conformité à la fiche — dont acte, avec le doublon nommé.
- **Garder `anamorphicStreak` séparé.** Il aurait fallu justifier qu'une traînée
  d'objectif anamorphique n'appartient pas à la distorsion d'objectif, alors que
  la fiche de référence range les deux sous le même nom.
