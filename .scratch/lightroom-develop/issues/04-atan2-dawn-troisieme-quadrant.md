# 04 — `atan2` de Dawn rend le mauvais signe au 3ᵉ quadrant : qui d'autre est mordu ?

Type: research
Status: ready-for-agent
Blocked by: none

**Constat (ticket 01, 2026-09-11, sonde GPU directe)** : le round-trip
`oklab_to_oklch` → `oklch_to_oklab` (`effects/oklab.ts`, partagés) n'est PAS
l'identité sur une couleur du 3ᵉ quadrant (a < 0, b < 0 — le bleu) : hue GPU
0,262 contre 0,733 en TS, le bleu ressort orange. Cause isolée : `atan2` sur
Dawn (D3D12, cette machine) rend le mauvais signe dans ce quadrant. Le ticket
01 a contourné (rotation 2×2 directe sur (a, b), sans `atan2` ni `fract`).

**Pourquoi les autres effets semblent immunisés** : ils construisent leur
teinte depuis un PARAMÈTRE (un angle de curseur), jamais depuis l'`atan2`
d'une couleur arbitraire. Semblent — pas prouvé.

## À faire

- [ ] Lister les lecteurs de `oklab_to_oklch` / `atan2` dans `src/render/effects/*`
      (`blendSpace` OKLCH, `gradientMap`, `isolines`, `outlines` roue
      d'orientation, `lensFlare`, `hsl.ts`…) et dire pour chacun si l'entrée de
      l'`atan2` peut être une couleur de l'image (3ᵉ quadrant atteignable) ou
      seulement un paramètre.
- [ ] Reproduire le bug en isolation dans le harnais (un shader qui écrit
      `atan2(y, x)` pour les quatre quadrants dans une texture, relu) — c'est
      Dawn, le pilote NVIDIA, ou notre WGSL (`atan2` avec des `f32` négatifs
      nuls, `-0.0` ?). Une seule cause à la fois.
- [ ] Si Dawn : une `atan2_sure` dans `oklab.ts` (repli par `atan` + correction
      de quadrant explicite), adoptée par tous les lecteurs, `test:render` zéro
      écart attendu SAUF là où le bug mordait — un écart est alors une
      CORRECTION, à relire à l'œil et à consigner référence par référence.
