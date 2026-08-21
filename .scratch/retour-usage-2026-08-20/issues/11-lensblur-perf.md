Type: research
Status: open

## Question

« Lens blur est très laggy » (retour d'Antoine). Connu et déjà instruit
(ROADMAP / mémoire `mesurer-un-cran-au-dela-du-gain`, `sondes-cdp-mesurent-un-proxy`).
`lensBlur` intègre sur la surface de l'ouverture (jusqu'à 256 taps par pixel),
c'est intrinsèquement cher — même famille de coût que `glass` (lectures de texture
dispersées, une lecture dispersée ≈ 25× une cohérente).

À rechercher/mesurer AVANT tout code (build de PRODUCTION, jamais dev — le
plancher dev est 2,6× celui de la prod) :
- Cadence réelle de `lensBlur` par géométrie de champ et par rayon, sur 26 Mpx,
  avec `perf-probe.mjs` et le chronométrage GPU par passe (`gpuTiming.ts`).
- Leviers possibles SANS baisser la qualité : sous-échantillonnage adaptatif au
  rayon, séparabilité partielle, pyramide pour les grands rayons (le mipmap de
  diffusion a rendu le coût de `texture` PLAT — applicable ici ?).
- ⚠️ Deux pistes DÉJÀ CONDAMNÉES par la mesure sur `glass`, ne pas les refaire :
  réduire le nombre de prélèvements, réécrire en dérivées analytiques.

Research (mesure) d'abord ; l'implémentation sera un ticket ultérieur si un levier
se confirme. Cadence cible (jouable au pointeur) à fixer avec Antoine.
