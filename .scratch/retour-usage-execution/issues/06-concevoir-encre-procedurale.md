# 06 — Concevoir l'encre procédurale (décision LIVE)

**What to build:** Trancher AVEC Antoine le design d'une encre **procédurale**
(bavure et grain générés en shader) qui remplace l'encre-par-texture pré-baked de
la famille Impression. Elle doit tenir la barre qualité du projet (pas « filtre
Photoshop 2005 ») — diffusion d'encre sur papier, bord rugueux crédible. Méthode
imposée : cross-référencer visuellement avant de figer (une apparence ne se déduit
pas d'une spec). Lien : `affinity/` ticket 02 (langage de texture procédurale).

**Blocked by:** None — can start immediately.

**Status:** ready-for-human — **PLANCHE LIVRÉE le 2026-09-07, Antoine pointe.** CADRÉ au grilling du 2026-08-27 : mode SUPPLÉMENTAIRE à côté des scans (l'encre-scan reste, gelée par ses références), famille visée **AQUARELLE** (bavure qui fuse, bord granuleux). Le design du mécanisme ne commence qu'après le pointage, jamais avant.
**Type:** grilling
**HITL — Antoine tranche live. L'agent ne décide pas à sa place.**

## La planche de références (2026-09-07)

`assets/ref-06/planche-06-aquarelle.html` — **15 aquarelles réelles** (Wikimedia
Commons, domaine public / CC BY / CC BY-SA / CC0, sources et licences dans
`assets/ref-06/ref-06-sources.md` ; aucune image n'entre dans le dépôt, le HTML
de 9,6 Mo et le dossier `raw/` sont régénérables par `query.mjs` →
`download.mjs` → `build-planche.mjs`, servis par `serve.mjs` sur le port 8099).
Chaque vignette est une vue d'ensemble PLUS un crop 1:1 centré sur le phénomène.
Cinq sections, une par PHÉNOMÈNE — c'est là qu'Antoine pointe, pas sur une
image entière :

| # | Phénomène | Ce que c'est | Références |
|---|---|---|---|
| A | Bavure fusante (wet-on-wet) | pigment lâché dans du papier mouillé : il FUSE sans bord — le cœur de la cible | Turner (nuages et pluie), Sargent (Chioggia), aquarelle fraîche en cours, feuilles wet/dry côte à côte |
| B | Granulation | pigment lourd déposé dans le creux du grain, bosses claires : moucheté à deux tons, propriété de la MATIÈRE | prune (pruine), grappe, Sargent (alligators), David Cox (ciel) |
| C | Bords de séchage | backrun / chou-fleur, auréole, lifting : bord DUR mais découpé en dentelle | swatch Te Papa, deux planches pomologiques |
| D | Lavis dégradé | aplat dont le ton glisse sans couture — la base tonale | trois études Turner (Rigi, Zurich, Lucerne) |
| E | Substrat | le papier NU, grain fin 100 % coton — référence du support, pas un rendu | une photo de papier |

Écartés et pourquoi (huiles prises pour des aquarelles, kit peinture-au-numéro
opaque, aquarelles médicales) : dans `ref-06-sources.md`.

**Question posée à Antoine, en gestes** : ouvrir la planche, et dire quelles
VIGNETTES (par section) ressemblent à ce que l'encre doit faire sur une marque
de `halftone` / `dither` / `hatching`. Un phénomène pointé = un mécanisme à
concevoir ; un phénomène ignoré = hors périmètre. C'est ce pointage qui remplit
les trois cases ci-dessous.

- [x] Planche de références RÉELLES construite (15 images, 5 phénomènes, crops 1:1).
- [ ] **[Antoine]** Pointer les vignettes/phénomènes visés sur la planche.
- [ ] Modèle d'encre procédurale arrêté (mécanisme de diffusion, bord, paramètres exposés).
- [ ] Jugé crédible devant références/photo par Antoine.
- [ ] Périmètre exact : ce que l'encre procédurale remplace dans `inkTexture` / `encreRang`, et ce qui reste.
