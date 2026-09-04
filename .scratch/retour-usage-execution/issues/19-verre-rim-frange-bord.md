# 19: Liseré de bord de CELLULE (rim géométrique) sur les matières à motif

> ⚠️ **REQUALIFIÉ le 2026-09-02 après lecture du shader** — troisième ticket de la
> chaîne verre dont la prémisse ne tenait pas telle quelle (après 16 et 18). Le
> titre d'origine était « Rim de bord + frange chromatique de bord (verre
> Poli) ». Ce qui suit nomme ce qui EXISTE déjà, ce qui MANQUE, et ce qui n'est
> pas codable dans ce shader.

**What to build (d'origine) :** la finition « verre premium » du patron Apple
Liquid Glass (recherche, idée 4) : un **rim / edge highlight** et une
**aberration chromatique de BORD seulement** (pas globale). Toute l'énergie au
bord, le centre neutre — ce qui sépare « verre » de « plastique 90s ».

## Ce qui EXISTE déjà (vérifié ligne à ligne dans `glass.ts`)

- **(b) La frange chromatique de bord est LIVRÉE, avec son curseur.** La
  dispersion (bloc `disp > 0.001`) sépare les trois canaux par trois `refract`
  à trois indices. Sur une normale plate les trois rendent le même `(0,0,−1)`
  — algébriquement, pour tout η — donc écart **nul au bit** à plat, visible sur
  les seuls flancs inclinés. C'est exactement « de bord seulement, pas
  globale ». Nuances : la frange suit la PENTE, pas le contour d'une forme
  (sur `Prisme`, pente constante, elle est uniforme sur le flanc) ; sur le
  **Poli** — la cible d'origine — il n'y a aucun bord : inclinaison max
  2,14°, la frange y est une nappe basse fréquence de ~1,6 px aux défauts.
- **Rim par la normale** : le Fresnel `F` de Schlick (par pixel, module le
  mélange matcap) éclaire les flancs raides ; inerte sur le Poli par
  géométrie (constat du 16).
- **Le lobe `appoint` du matcap** (ex-`rim`, renommé le 2026-09-02) n'est PAS
  un rim : lobe directionnel, non nul à plat (0,034). Le nom mentait.
- **Blinn-Phong** : ~8e-5 à plat — le « blob spéculaire dur » à faire
  disparaître est déjà invisible sur le Poli ; il n'existe que sur les flancs
  des matières à motif.

## Ce qui n'est PAS codable ici

« Le bord de la FORME » (patron Liquid Glass, SDF/masque) n'existe pas dans
ce shader : `glass` est plein cadre et **le masque n'entre jamais dans
`fs_main`** — il est échantillonné au compositing (`shaderCompose.ts`,
`maskValue` × opacité). Un rim au contour d'une forme dépend d'une entrée
forme/SDF côté shader qui n'existe pas (chantiers 10-13 / 24).

## Ce qui MANQUE et s'implémente : un rim GÉOMÉTRIQUE de cellule

Un liseré d'intensité **constante le long d'un contour**, fonction de la
**distance au bord** de la cellule/strie — indépendant de l'inclinaison, donc
visible là où la pente est nulle ou uniforme (`Prisme`, méplat `plat`), de
largeur contrôlée en UV. Primitives déjà calculées et jetées : `d2 − d1` du
Voronoï (distance à l'arête de cellule), `1 − |u|` (position dans la strie),
`verre_bosse` (« 1 au sommet et 0 au bord », lu par le seul Gaufré).
Matières concernées : celles à motif (Cannelé, Croisé, Gaufré, Martelé,
Écorce, Cathédrale) — pas le Poli, qui n'a pas de bord à border.

**Blocked by:** 18 (une seule évolution du chemin `glass.ts` à la fois — le
18 attend le choix d'Antoine sur la planche des leviers du Poli).

**Status:** ready-for-agent (après le 18)
**Type:** task

- [x] ~~Frange chromatique de bord UNIQUEMENT~~ — déjà livrée par la
      dispersion, nulle au bit à plat (constat 2026-09-02).
- [ ] Rim géométrique de cellule : un terme d'intensité fonction de la
      distance au bord, dosé par un paramètre (ou par `specular` existant —
      à trancher sur captures), sur les matières à motif.
- [ ] Les **13** références du verre régénérées et relues à l'œil.
- [ ] Jugé devant photo par Antoine — le verdict visé reste « verre », plus
      « 3D des années 90 ».
