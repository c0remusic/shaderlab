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
## Planche de mécanisme (2026-09-09) — construite, à pointer

`assets/ref-06/planche-06-mecanisme.html` (non versionné, 3,5 Mo) — prototype
`aquarelle.ts` (sauvegardé en `assets/ref-06/aquarelle.prototype.ts` +
`prototype-aquarelle-registre.patch` ; à ce moment il est aussi VIVANT dans
`src/` non commité, avec sa ligne de registre et de catalogue — ne pas le
ramasser dans un commit) rendu par le pipeline réel sur `photo-1` (⚠️ les
quatre `photo-N.jpg` de vram-test ont le même md5, une seule photo existe).
Scripts : `planche-06-rendu.mjs`, `planche-06-assemble.mjs`, `aq-stats.json`.

Huit colonnes par ablation : 0 témoin · 1 diffusion pyramidale seule (LE NAÏF)
· 2 + ondulation des frontières (fbm sur les UV) · 3 + front de pigment lisse
(gradient de densité sur la diffusée, assombrit et sature) · 4 + dentelle du
front (bruit HF) · 5 mode Densité (mélange GÉOMÉTRIQUE en linéaire — Beer-Lambert ;
le « (1 − c) puis reconversion » du brief était identique au mode Couleur, une
moyenne commute avec un affine, le sous-agent l'a vu) · 6 portée ×2 · 7 mouillé
0,5 (bave par plages). Toutes les vignettes ont un md5 distinct, écart-type
55-61 ; les crops 5 et 7 sont identiques (crop dans une plage saturée du champ
de mouillé), attendu.

**Mon constat, avant le pointage** (lecture des PNG, pas un verdict) : les
colonnes 3-5 ressemblent au filtre « Aquarelle » de Photoshop — flou isotrope
plus bord assombri, la silhouette noire vire au gris-brun. Ce que les
références A montrent et que ce mécanisme n'a pas : une bave DIRIGÉE (le
pigment est porté par l'eau, il fuse le long d'un flux, pas en rond), un front
qui s'arrête par SEUIL (irrégulier, net) au lieu de s'éteindre en gaussienne,
et des noirs qui restent des noirs. Si Antoine dit « aucune », la piste
suivante est l'ADVECTION (diffusion multi-pas le long d'un champ de flux
bruité, borné par un seuil de mouillé), pas un réglage de plus sur celui-ci.

**Verdict d'Antoine sur la planche 1 (2026-09-09) : « c'est plutôt moche ».**
Aucune colonne. Le mécanisme v1 (pyramide de flou + ondulation + front par
gradient) est REJETÉ, pas à régler — c'est le filtre « Aquarelle » de Photoshop.

**Planche 2 en cours — mécanisme v2, ADVECTION** : le pigment est porté par
l'eau (passes itérées à demi-résolution le long d'un curl noise à deux
échelles, masse d'eau + fibres), plages mouillées par SEUIL d'un champ fbm
(dedans ça fuse, dehors la photo reste nette, pigment accumulé sur l'iso-ligne
du front, dentelée), composite en ABSORBANCE (le pigment ne fait qu'assombrir,
une silhouette reste noire), colonne optionnelle « lavis » (abstraction en
paliers doux avant la bave). Colonne 8 = rappel de la v1 rejetée, côte à côte.

- [x] Planche de mécanisme v1 (flou + front) — construite le 2026-09-09, REJETÉE le jour même.
**Planche 2 rendue le 2026-09-09** : `assets/ref-06/planche-06-mecanisme-2.html`,
scripts `planche-06-rendu-2.mjs` / `planche-06-assemble-2.mjs`, PNG `aq2-col*`,
`aq2-stats.json`. Sept passes à demi-résolution, curl noise à deux échelles,
composite en absorbance, plages par seuil, front par |∇W|, lavis en passe 0.
Mesuré : noirs PRÉSERVÉS (10 % les plus sombres du témoin : 2,2 à 4,4 sur 255
sur toutes les colonnes — c'est le mécanisme, pas le mode) ; cols 1 et 2
identiques par construction à mouillé plein (mix(a, b, 1) = b dans les deux
modes, la différence ne vit que sur les plages partielles). Coût dev
+27,6 ms sur 26 Mpx (ordre de grandeur, ~2,6× la prod). **Mon constat** :
les noirs tiennent, mais le curl noise TOURBILLONNE — langues de fumée, look
« liquify/turbulence », pas une bave d'aquarelle. Ce qu'une bave a et que ni
v1 ni v2 n'ont : des LAVIS (régions plates à bord irrégulier, pas une photo
floutée ni tordue), un bord qui s'effiloche en fibres FINES et courtes
(feathering capillaire, pas des vortex), et un rebord sombre là où ça s'arrête.
Piste v3 si « aucune » : abstraction en lavis (Kuwahara anisotrope, Kyprianidis
2009 — régions plates, bords gardés) puis effilochage des frontières par
tendrilles HF de faible amplitude + rebord ; l'advection n'y est plus.

**Antoine, devant la planche 2 et la piste v3 : « On peut tous les faire peut
être ? »** Lu comme : les INGRÉDIENTS ensemble, chacun avec son curseur (0 =
éteint), pas trois modes exclusifs — c'est la recette Bousseau 2006 complète.
**Planche 3 en cours — v3 COMBINÉE** : lavis (Kuwahara généralisé 4 secteurs,
régions plates à bords gardés) → bave (pyramide de diffusion de v1) → fibres
(advection de v2 mais HF seule, 3 passes, petite amplitude — sans le potentiel
basse fréquence qui faisait les vortex) → composite plages/front/absorbance.
Chaque étage saute par `EffectPass.enabled` quand son curseur est à 0. Colonnes
CUMULATIVES (un ingrédient de plus par colonne), plus « tout sans lavis » pour
isoler ce que le lavis apporte, plus rappels v1/v2 rejetés.

- [x] Planche v2 (advection) — rendue le 2026-09-09 ; ni pointée ni rejetée seule : « tous les faire ».
**Planche 3 rendue le 2026-09-09** : `assets/ref-06/planche-06-mecanisme-3.html`,
scripts `-rendu-3.mjs` / `-assemble-3.mjs`, 27 PNG `aq3-*`, `aq3-stats.json`.
Neuf passes max (lavis Kuwahara 4 secteurs à 1:1, pyramide 0,5→0,125→0,5,
trois passes de fibres HF à 0,5), 9 params, noirs préservés (0,05 à 1,54/255),
coût dev +31,6 ms sur 26 Mpx (~+12 ms prod estimé). Kuwahara recalculé dans
la composite pour le côté sec (une seule texture survit à la chaîne). Le
sous-agent a dû corriger la pondération du brief : 1/(1+var^q) avec var ≤ 0,25
donnait des poids ≈ 1 partout, soit un box-blur ; 1/(var+ε)^3 est le vrai
Kuwahara.

**Mon constat** : mécaniquement tout est là (aplats à bords nets en col1,
tendrilles courtes, noirs qui tiennent), mais à l'échelle de la vignette le
résultat est TIMIDE — une photo à peine adoucie, avec des anneaux de front
isolés qui se lisent comme des gouttes d'eau sur un objectif, posés là où le
champ de mouillé les met, sans rapport avec l'image. Et la photo de test est
le mauvais sujet : une silhouette noire et un ciel déjà lisse n'ont presque
aucune frontière entre deux TEINTES — or une bave d'aquarelle, c'est deux
couleurs voisines qui se mangent. Trois planches sur `photo-1` mesurent le
mécanisme, aucune ne peut montrer la bave. Leçon CLAUDE.md (« demander les
photos de l'utilisateur AVANT de raffiner ») appliquée tard : la prochaine
planche se rend sur UNE OU DEUX PHOTOS D'ANTOINE, choisies par lui pour cet
effet, avant tout réglage de plus.

- [x] Planche v3 (chaîne combinée, ablation cumulative) — rendue le 2026-09-09.
- [ ] **[Antoine]** Une ou deux photos où il poserait l'aquarelle (plusieurs teintes qui se touchent).
- [ ] Planche v3 re-rendue sur SES photos — il pointe, ou « aucune ».
- [ ] Modèle arrêté (mécanisme de diffusion, bord, paramètres exposés) — d'après le pointage.
- [ ] Jugé crédible devant références/photo par Antoine.
- [ ] Périmètre exact : ce que l'encre procédurale remplace dans `inkTexture` / `encreRang`, et ce qui reste.
