Type: grilling
Status: resolved

## Décision (2026-08-21) : SUPPRIMER — ✅ FAIT le 2026-08-21

Antoine a redit « horrible » — l'option « supprime-le » est tranchée, pas
« fais mieux ». Livré : retrait de `emboss` du registre (`registry.ts` +
`catalog.ts`), module `src/render/effects/emboss.ts` supprimé, ses 3 scénarios
et 3 références de pixels retirés de `render-check.mjs` / `renderRefs.test.mjs`,
[ADR-0019](../../../.claude/decisions/ADR-0019-retrait-de-emboss.md) écrit, garde
de retrait posé dans `registry.test.ts`. `outlines` est confirmé seul lecteur
d'`edgeGradient.ts` (son en-tête l'annonçait déjà). Presets non cassés
(`presetDocument.ts` avertit au lieu de lever). Gates verts : tsc, unit.

## Question

« Relief est horrible, supprime-le ou fais quelque chose de mieux avec » (retour
d'Antoine). Décision : `emboss` sort-il du registre, ou est-il refondu ?

Ce qu'il faut pour trancher :
- Qu'est-ce qu'Antoine attend d'un effet de relief/estampage ? (le sien est un
  gaufrage gris directionnel classique — filtre « Photoshop 2005 » que la barre
  de qualité du projet proscrit).
- Y a-t-il une version QUALITÉ défendable (relief coloré, éclairage directionnel
  réglable, matière) ou est-ce un doublon de ce que `outlines`/`edgeGradient`
  font déjà mieux ? `emboss` est le 3ᵉ lecteur d'`edgeGradient.ts` (garde la
  DIRECTION du gradient, jette la magnitude).
- Si supprimé : ADR + `registry.ts` (le retrait ne casse pas les presets,
  `presetDocument.ts` pousse un avertissement). Si refondu : un design d'upgrade
  qualité, cross-référencé visuellement.

Décision d'Antoine, pas un correctif — d'où grilling.
