# 06 — Concevoir l'encre procédurale (décision LIVE)

**What to build:** Trancher AVEC Antoine le design d'une encre **procédurale**
(bavure et grain générés en shader) qui remplace l'encre-par-texture pré-baked de
la famille Impression. Elle doit tenir la barre qualité du projet (pas « filtre
Photoshop 2005 ») — diffusion d'encre sur papier, bord rugueux crédible. Méthode
imposée : cross-référencer visuellement avant de figer (une apparence ne se déduit
pas d'une spec). Lien : `affinity/` ticket 02 (langage de texture procédurale).

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent (planche de mécanisme) — **REQUALIFIÉ le 2026-09-09 sur le pointage d'Antoine : un EFFET plein cadre qui fait baver les couleurs de la photo, pas un mode d'encre** (§ ci-dessous). Le cadrage du grilling du 2026-08-27 (« mode SUPPLÉMENTAIRE à côté des scans ») est caduc. Le design du mécanisme ne se fige qu'après le pointage de la planche de mécanisme, jamais avant.
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

## Pointage d'Antoine (2026-09-09) — et REQUALIFICATION du ticket

> « en fait on s'en fiche de la texture du papier, le but c'est surtout de
> faire baver les couleurs type aquarelle »

Lu sur la planche : **A (bavure fusante) est la cible**, E (papier) SORT,
B (granulation) et D (lavis) secondaires ; C (front de séchage) est gardé comme
le BORD d'une bavure — ce à quoi elle ressemble une fois sèche, pigment poussé
au front, dentelé — pas comme un phénomène à part.

Et « faire baver les COULEURS » ne dit pas ce que le ticket chartrait. Question
posée en gestes (« tu ouvres une photo, tu poses l'effet : qu'est-ce qui
bave ? ») — réponse : **les couleurs de la PHOTO**, l'image entière fuse comme du
pigment dans du papier mouillé. Donc :

- **Ce n'est PAS un mode d'`inkTexture`** (encre sur une marque de trame). C'est
  un **EFFET créatif plein cadre**, le 27ᵉ du registre, qui lit ce qui est en
  dessous et le fait baver. `inkTexture` et l'encre-scan ne bougent pas.
- **Le ticket 07 (encre procédurale dans Impression) est CADUC** : il encrait
  des marques, et personne ne l'a demandé. Il reste dans le dossier, statut
  `wontfix`, pour que la question ne renaisse pas sous un autre nom.
- ⚠️ Le grilling du 2026-08-27 avait cadré « mode SUPPLÉMENTAIRE à côté des
  scans » — c'était MA traduction du mot « encre », jamais interrogée ; le
  prototype de références l'a fait sortir (même mécanique que « forme » au
  ticket 10). Un mot du domaine se vérifie sur une image, pas sur une spec.

**Prochain pas : planche de MÉCANISME** — un prototype jetable de l'effet, rendu
sur les photos de test par l'iframe du harnais, en variantes par ABLATION (un
facteur à la fois : diffusion seule = le naïf, + ondulation des bords, + front
de pigment, + front dentelé, diffusion en DENSITÉ plutôt qu'en couleur, portée
doublée), vue réduite pour la bave (par masses) ET crop 1:1 pour le front (par
pixel). Antoine pointe la colonne. Le design du mécanisme se fige après, jamais
avant. Barre : le naïf (photo floutée + ondulée) est la variante témoin qu'on
DOIT pouvoir distinguer, sinon c'est un filtre 2005.

- [x] Planche de références RÉELLES construite (15 images, 5 phénomènes, crops 1:1).
- [x] **[Antoine]** Pointé : A, bavure des couleurs de la PHOTO ; E sort (2026-09-09).
- [ ] Planche de mécanisme (prototype jetable, variantes par ablation) — Antoine pointe.
- [ ] Modèle arrêté (mécanisme de diffusion, bord, paramètres exposés) — d'après le pointage.
- [ ] Jugé crédible devant références/photo par Antoine.
- [ ] Périmètre exact : ce que l'encre procédurale remplace dans `inkTexture` / `encreRang`, et ce qui reste.
