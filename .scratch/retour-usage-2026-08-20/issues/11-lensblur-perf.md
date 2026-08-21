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

## Analyse du coût — 2026-08-21 (lue au code, `lensBlur.ts`)

**Structure : DEUX passes.** La collecte (`LENS_GATHER_WGSL`) tourne DÉJÀ en
**demi-résolution** (`passes: [{ scale: 0.5 }]`, ligne 398) ; la passe finale
mélange net/flou en pleine def (`mix(color, blurred, smoothstep(0.35, 1.0,
radiusPx))`). Le demi-def est une optimisation existante : ¼ des pixels ET rayon
en texels divisé par deux, donc ~16× moins de taps que la version naïve.

**Modèle de taps (ligne 226) :** `taps = clamp(π·rt²/3, 24, 256)` avec
`rt = radiusPx·0.5` (rayon en texels demi-def). Conséquences chiffrées :
- Le nombre de taps est **quadratique en rayon** jusqu'au plafond, puis plat.
- Il **sature à 256 dès ~31 px** de rayon plein-def (`π·(0.5·r/2)²/3 = 256`).
  Le curseur va à 120 px : les trois quarts de sa course sont donc au plafond.
- Au plafond : 256 taps × (26/4 =) 6,5 Mpx demi-def = **1,66 milliard de lectures
  dispersées** sur un disque de rayon 30 texels. Header : « 256 taps sur 24 Mpx =
  six milliards » (avant le demi-def).

**Où est le coût, et c'est la même signature que `glass` :** ce ne sont pas les
taps en soi, c'est leur DISPERSION. 256 lectures étalées sur un disque de 30
texels ont une cohérence de cache faible, et une lecture dispersée ≈ 25× une
cohérente (mesuré sur `glass`). La géométrie de champ donne des zones MOINS
chères : `lens_field` fait tomber le rayon à 0 hors de la zone (Linéaire/Iris/
Radial), et la collecte court-circuite à rayon nul (`radiusPx < 0.35` → 1 tap).
Uniforme paie plein tarif partout, c'est le pire cas à mesurer.

**Levier le plus probable (confirme l'intuition du ticket) : pyramide de mips sur
la source de collecte.** À grand rayon, échantillonner un mip grossier rend les
lectures LOCALES *et* rétrécit le disque en texels — exactement ce qui a rendu le
coût de `texture` PLAT. ⚠️ **Même caveat que `glass` (ROADMAP § coût du verre)** :
la source de la collecte est une cible de ping-pong recréée CHAQUE FRAME, donc la
mipmapper coûterait une chaîne de blits par image — gain/coût à MESURER, pas à
supposer. La brique existe (`src/render/mipmapGenerator.ts`, sur master).
Levier plus simple, sans infra : baisser `scale` de la collecte (0.5 → 0.25) au-
delà d'un rayon seuil (sous-échantillonnage adaptatif), au prix de la qualité.
⚠️ Réduire le nombre de taps reste condamné : à rayon max la couverture est déjà
sous 7 % (header ligne 223), moins de taps = plus de bruit.

## Mesure live — PRÉPARÉE, en attente d'exécution

La cadence en PRODUCTION (le chiffre que le ticket demande) n'a **pas** pu être
prise cette session : le sandbox de session refuse l'accès à `src-tauri/target/`
(build-output), donc le binaire release ne peut pas être lancé depuis ici. Une
mesure dev ne la remplace pas (plancher JS 2,6× — mémoire
`mesure-en-dev-ne-prouve-pas-l-absence`) ; en revanche `gpuTiming.ts` sur l'app
dev DONNERAIT la distribution GPU par passe (temps GPU, non gonflé par le
plancher JS), si on veut confirmer la part de la collecte sans build prod.

**Tout est prêt pour une exécution en un geste :**
1. Build release **fait** cette session (`cargo build --release`, exit 0).
2. Photo synthétique **26 Mpx (6240×4160)** prête — fond sombre + hautes lumières
   ponctuelles pour exercer la pondération du bokeh (le coût ne dépend pas du
   contenu, mais la branche de poids doit travailler). Générateur : pngjs, hash
   déterministe. Chemin (scratchpad de session, ne survit pas) :
   `…/scratchpad/photo-26mpx.png`. PNG accepté par `read_image_file`
   (`createImageBitmap` renifle le format, éprouvé 2026-08-17).
3. Lancement : `Start-Process src-tauri\target\release\shaderlab.exe -ArgumentList
   "<photo.png>"` avec `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`.
4. Scène + mesure via `perf-probe.mjs` : `add-effect "Lens blur"`, `poser` le
   rayon (balayer 8/24/60/120 px), `poser` la géométrie de champ (Uniforme vs
   Radial), puis `drag` (le seul qui mesure la cadence). Croiser avec
   `gpuTiming` par passe.

Balayage à couvrir : rayon × géométrie de champ, sur 26 Mpx, build prod. La
cadence cible jouable au pointeur reste à fixer avec Antoine (10 img/s
inutilisable, 60 demande ÷6 — cf. le même arbitrage ouvert sur `glass`).
