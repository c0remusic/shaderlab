---
id: ADR-0019
status: active
date: 2026-08-21
---

# ADR-0019 : `emboss` sort du registre

## Contexte

`emboss` (le Relief) est entré au registre le 2026-08-18 dans la tranche 3 du
ticket 12, comme TROISIÈME lecteur d'`edgeGradient.ts` : là où `outlines` prend
la MAGNITUDE du gradient de Scharr, `emboss` n'en gardait que la DIRECTION,
projetée sur une direction de lampe pour rendre un gaufrage gris directionnel.

Devant l'app le 2026-08-20/21 (retour d'usage,
`.scratch/retour-usage-2026-08-20/`), Antoine l'a jugé « horrible » puis a redit
« supprime-le ou fais quelque chose de mieux avec ». Le grilling
([ticket 03](../../.scratch/retour-usage-2026-08-20/issues/03-emboss-supprimer-ou-refaire.md))
a tranché SUPPRIMER, pas refondre : le gaufrage gris directionnel est le filtre
« Photoshop 2005 » que la barre de qualité explicite du projet proscrit, et sa
propriété — lire la direction d'un bord — n'ouvre aucune version qualité
défendable qui ne soit déjà mieux couverte par `outlines`.

## Décision

**`emboss` est retiré du registre des effets** (arbitrage d'Antoine, 2026-08-21).

Le retrait porte sur tout ce que l'effet touchait, pas seulement l'entrée du
registre :

- le module `src/render/effects/emboss.ts` ;
- son import et son enregistrement dans `registry.ts`, et son entrée de
  catégorie (`Impression`) dans `catalog.ts` ;
- ses trois scénarios de `scripts/render-check.mjs` (`effet-emboss`,
  `effet-emboss-oppose`, `effet-emboss-sur-image`) et leurs trois références de
  pixels ;
- les trois entrées correspondantes de la table `ATTENDU` de
  `renderRefs.test.mjs`.

Un garde de retrait est posé dans `test/render/effects/registry.test.ts`, à côté
de celui de `surfaceBlur` : il rend le retrait CONSCIENT — réintroduire `emboss`
oblige à supprimer la ligne, donc à relire cet ADR.

## Conséquences

- **`edgeGradient.ts` redevient à un seul lecteur, `outlines`.** L'en-tête du
  module l'annonçait déjà (« aujourd'hui lu par un seul effet ») — la mesure était
  en avance sur le registre, elle est maintenant juste. Le module RESTE malgré son
  unique lecteur, pour la raison écrite dans son en-tête (le réinliner coûterait
  plus que le garder).
- **Un preset qui cite `emboss` perd ce calque, il ne casse pas.**
  `presetDocument.ts` ignore un `effectId` qui ne résout plus et pousse un
  avertissement, jamais une exception.
- **Le registre passe de vingt-sept à vingt-six effets.** (Il était à vingt-huit
  la veille ; `noise` en est sorti le même jour par revert de `f336ac9`, refusé lui
  aussi. Les deux retraits sont indépendants.)
- **La tranche 3 du ticket 12 n'a plus que deux effets vivants** — `nettete` et
  `displacementMap`. C'est le seul des trois à ne pas avoir survécu à son premier
  contact avec l'usage.

## Alternatives écartées

- **Refondre `emboss` en version qualité** (relief coloré, éclairage directionnel
  réglable, matière). Écarté par Antoine : le verdict est « supprime-le », pas
  « fais mieux ». Et la propriété que l'effet portait — la direction du bord —
  n'ajoute rien qu'`outlines` et son mode Échos ne fassent déjà, mieux, à partir
  de la même détection.
- **Le garder en le dépriorisant dans la liste.** Même objection que pour
  `surfaceBlur` (ADR-0011) et le gaussien (ADR-0010) : un effet au registre est un
  effet qu'on pose. L'ordre d'une liste n'est pas une décision.
