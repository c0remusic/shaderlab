# 09 — Audit sémantique de l'étage contre le binaire de Lightroom

Type: research
Status: ready-for-agent
Blocked by: none

**What to build :** Antoine, 2026-09-12, après le fix présence (`b725e6c`, prouvé
par minage de CameraRaw.dll) : « tu peux faire ça pour tous les paramètres ? »
Pour CHAQUE curseur des quatre modules de l'étage (`reglagesDeBase` 20, `hsl` 33,
`colorGrading` 14, `etalonnage` 7) : retrouver dans le binaire l'étage Adobe qui
le porte (fichier `cr_*.cpp`, noms `cr_stage_*`, pipelines GPU), en déduire
ESPACE de travail et CANAL, comparer à notre implémentation, verdict
CONFORME / DIVERGENT / INDÉTERMINÉ avec la pièce. Corriger les divergences
prouvées ET mesurables ; consigner le reste.

Trouvailles déjà acquises (fix `b725e6c`) : Texture = `cr_stage_texture_direct_gf_ycc`
(log-YCC, filtre guidé sur Y seul) ; Clarté = `cr_clarity.cpp` / pipeline
`LocalContrastY` ; le log-YCC rend l'opération multiplicative en linéaire.
Vu aussi : `cr_tone_map_stage.cpp` (texturePool/highlights/shadows/clarity),
`cr_noise.cpp` (wavelet), 293 blobs DXBC (kernels compilés — leurs chunks RDEF
portent des noms d'uniforms lisibles), `Develop.lrmodule` (Lua, noms UI).

- [ ] Inventaire binaire : tous les `cr_*.cpp` cités + `cr_stage_*` + noms de pipelines/uniforms, rangés par panneau.
- [ ] Tableau curseur par curseur (74) : étage LR, espace, canal, notre implémentation, verdict + pièce.
- [ ] Divergences prouvées et mesurables : corrigées (twin + WGSL, refs de l'étage seulement, mêmes gates).
- [ ] Indéterminés : listés avec ce qui manque (mesure à faire, ou structure invisible dans les strings).
