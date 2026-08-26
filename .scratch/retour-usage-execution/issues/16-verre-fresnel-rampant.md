# 16: Fresnel rampant par pixel (verre Poli)

**What to build:** En mode Poli, remplacer le Fresnel constant à 0,04 — **l'erreur
centrale** identifiée par la recherche `../retour-usage-2026-08-20/research/01-glass-shading.md`
— par une rampe de Schlick calculée par pixel : `R = 0,04 + 0,96·(1 − |view·N|)⁵`.
Le reflet s'allume aux bords et aux angles rasants, reste faible de face — c'est ce
qui « fait verre ». Fondation des tranches suivantes (le reflet fabriqué s'y module).

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Le Fresnel du Poli rampe avec l'angle de vue (0,04 de face → tend vers 1 en rasant), par pixel.
- [ ] Le voile plat uniforme disparaît ; le reflet se concentre aux bords.
- [ ] Les 18 références de pixels du verre régénérées et **relues à l'œil**.
- [ ] Jugé devant photo par Antoine (HITL — un banc prouve que ça agit, pas que c'est beau).
