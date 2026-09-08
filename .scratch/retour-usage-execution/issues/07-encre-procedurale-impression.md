# 07 — Encre procédurale dans hatching / dither / halftone

**What to build:** Les trois effets de la famille Impression encrent leurs marques
calculées avec l'encre procédurale conçue en 06 ; le chemin encre-par-texture
pré-baked (`inkTexture` échantillonnant un scan + `encreRang` de `hatching`) est
retiré. Les presets qui citent l'ancien chemin dégradent proprement, jamais une
exception.

**Blocked by:** 06 — le design de l'encre procédurale doit être arrêté.

**Status:** wontfix — **CADUC le 2026-09-09.** Le pointage d'Antoine sur la planche
de références du 06 a requalifié le besoin : ce qui doit baver, ce sont les
COULEURS DE LA PHOTO (un effet plein cadre), pas la marque d'une trame. Ce
ticket encrait des marques ; personne ne l'a demandé. `inkTexture`, l'encre-scan
et `encreRang` restent tels quels, gelés par leurs références. Ne pas le
rouvrir sous un autre nom sans une demande d'usage qui vise explicitement les
trames.
**Type:** task

- [ ] `hatching`, `dither`, `halftone` encrent en procédural.
- [ ] L'encre-par-texture pré-baked est retirée du chemin de ces effets.
- [ ] `presetDocument` avertit (jamais ne lève) sur un preset citant l'ancien paramètre.
- [ ] Références de pixels régénérées et **relues à l'œil** avant commit.
