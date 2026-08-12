# Feuille de route — shaderlab

> **Ce document répond à une seule question : qu'est-ce qui RESTE ?**
> Le statut d'un chantier passé se lit dans `docs/INDEX.json`, les décisions
> tranchées dans `.claude/decisions/INDEX.md`, le vocabulaire dans `CONTEXT.md`.
> Ici, rien que l'ouvert.
>
> Écrit le 2026-08-04, tenu à jour le 2026-08-05. Entretien : quand un bloc est
> soldé, il sort d'ici et son résultat va dans `INDEX.json` — pas de section
> « fait » qui s'accumule.
>
> ⚠️ **Deux sessions ont travaillé en parallèle sur `master` les 3 et 4 août** et
> se sont marché dessus sans dommage (le travail non commité de l'une a été
> ramassé par l'autre). Avant tout dispatch, `git worktree list` **et**
> `git log --oneline -3` : ce fichier peut retarder sur le code.

## Où en est le code — mesuré sur disque le 2026-08-05, pas de mémoire

- **23 effets** au registre (`src/render/effects/registry.ts`) — `texture` puis
  `lightLeak`, tous deux le 2026-08-05.
- `glass` **complet** : 14 matières (9 de feuille + 5 de pavé), 5 profils de
  section, **18 références de pixels — toutes les branches verrouillées**.
- **Les 23 effets portent des sections** et leurs applicabilités déclarées
  (`EffectModule.sections`, `EffectParam.appliesWhen`) — chantier de
  rationalisation des contrôles **soldé le 2026-08-05**, statut dans
  `INDEX.json`. Ce qu'il en reste est du jugement, donc dans le bloc 1.
- Tout ce qui avait un plan exécutable est livré, testé, documenté, poussé.

**Il ne reste donc AUCUN code en attente d'un plan existant.** Ce qui suit se
répartit en quatre natures différentes : du jugement humain (1), un chantier
qui a son cadrage mais ni design d'effet ni plan (2), un PRD entier jamais
commencé (3), et des chantiers dormants retrouvés par mesure (4).

---

## ⚠️ Lire d'abord : une CARTE tient désormais les arbitrages ouverts

**`.scratch/prochain-palier/map.md`** — chartée le 2026-08-11 par `/wayfinder`.
Douze tickets, dont trois de recherche déjà résolus. **Ce fichier-ci dit ce qui
reste ; la carte dit dans quel ORDRE le décider et ce que chaque décision
attend.** Les deux se lisent ensemble, et un arbitrage se tranche dans la carte,
pas ici.

Ce qu'elle porte et que ce document ne portait pas : la forme et la typographie
séparées (les traiter d'un bloc est le premier piège), ce qui reste valide du
design de parité du calque photo, `curves` en linéaire ou en perçu, le sort de
`sat-feather`, les différés de masquage, et deux tickets nés de recherches en
sources primaires sur Photoshop et Lightroom.

Trois corpus de recherche sont sur disque dans `.scratch/prochain-palier/research/`
(~2 600 lignes, une source citée par affirmation) : la faisabilité du 16-bit,
31 mécanismes de lisibilité d'interface, et 12 fonctions candidates avec leur
verdict de doublon et leur **appel de licences**.

---

## 1. Reste immédiat — validation visuelle humaine

**Bloquant, et Antoine seul peut le faire** — mais **moins cher qu'avant**.

✅ **Amendé le 2026-08-05.** Ce bloc disait que le canvas WebGPU rend noir hors
de la vraie fenêtre, donc qu'aucune capture n'était possible. C'est vrai en
headless et **faux par CDP sur la fenêtre réelle** : `Page.captureScreenshot`
rend la photo, l'effet et le dock, vérifié. Un agent peut donc **préparer** le
checkpoint — ouvrir la photo, empiler les calques, poser les réglages, capturer —
et Antoine n'a plus qu'à REGARDER, au lieu de piloter l'app lui-même.

La frontière qui reste est celle du JUGEMENT, pas du constat : un banc dit qu'un
effet agit, jamais qu'il est beau. Voir `/run-shaderlab`
(`.claude/skills/run-shaderlab/`) pour le pilote, et `CLAUDE.md` § Moyen de
preuve (UI).

⚠️ **Point de méthode qui explique pourquoi ce bloc existe.** Une référence de
pixels prouve qu'un effet porte **sa propriété**, jamais qu'il est **beau**. Les
deux sont des questions distinctes ; le harnais ne répond qu'à la première, et
c'est la seconde qui est ouverte ici. Ne pas lire « 18 références vertes » comme
« le verre est validé ».

**Les six sujets sont montés et capturés** — planche de contact publiée le
2026-08-05 : <https://claude.ai/code/artifact/5158aad0-3e3d-44d7-b670-17d099bf963c>
(privée, sur le compte d'Antoine). Elle porte les 14 matières de verre
cliquables, la paire avant/après des courbes, le dock à 2 contre 7 calques, les
panneaux sectionnés et la paire de références du light leak. Chaque vignette
porte sa mesure. Elle se régénère par `/run-shaderlab` puis le pilote de la
skill ; les images sources vivent dans le scratchpad de session, donc elles ne
survivent pas — c'est la page publiée qui est l'artefact durable.

| # | Sujet | Ce qu'il faut juger |
| --- | --- | --- |
| 1 | **Courbes** | Fluidité ET esthétique — mais **un défaut est déjà mesuré**, voir ci-dessous. Il se tranche avant de juger le reste |
| 2 | **Pile / Propriétés / Masque** | Le nouveau flux, sur une pile **dense** — c'est la densité qui est en question, pas le flux à deux calques |
| 3 | **Verre** | Les matières sur une vraie photo. Le **Dépoli** est marqué « à raffiner » par Antoine et n'a pas été retouché depuis |
| 4 | **Les cinq pavés** | À l'usage, et ajuster le rendu si besoin — livrés et verrouillés, jamais regardés sur une photo |
| 5 | **Sections des panneaux** | Le découpage en blocs titrés, livré le 2026-08-05 sur les 23 effets. Aucun n'a été regardé sur une vraie photo, sauf `texture`, `dither` et `duotone` |
| 6 | **Light leak** | Livré le 2026-08-05 avec sa paire de références. Vu une fois sur une photo, jamais jugé — et deux défauts par défaut sont déjà probables : `intensite` à 1,35 sature le cœur en blanc, donc le dégradé chaud ne se lit qu'en marge, et l'irrégularité à 0,38 festonne le bord au point que la coulée se lit comme un nuage plutôt que comme un faisceau. Les deux sont des **valeurs**, pas du code |

### ⚠️ Ce que la préparation du checkpoint a trouvé — `curves` travaille en lumière LINÉAIRE

**Le seul point de cette liste qui demande une décision de CODE et non un
goût.** `src/render/effects/curves.ts` n'importe aucune transformation sRGB : sa
courbe s'applique donc à des valeurs **linéaires**, quand tous les outils de
courbe qu'un photographe connaît travaillent sur la valeur **perçue**.

Mesuré le 2026-08-05 en pilotant l'app, puis vérifié analytiquement — lever le
point noir à 20 % :

| | Sortie en sRGB |
| --- | --- |
| appliqué en **linéaire** — ce que fait shaderlab | **124** / 255 |
| appliqué en **perçu** — ce que fait Photoshop | **51** / 255 |
| milieu à 50 % perçu, en linéaire | 157 / 255 |
| milieu à 50 % perçu, en perçu | 134 / 255 |

À l'écran : la silhouette part en gris moyen au lieu d'un noir délavé, et les
ombres perdent toute séparation d'un coup.

⚠️ **Le dépôt porte déjà la règle inverse, écrite dans `texture.ts` à propos de
ses niveaux** — « étirer en linéaire déplacerait le point médian PERÇU, et le
curseur ne répondrait pas là où l'œil l'attend ». `dither`, `halftone`,
`hatching`, `gradientMap` et `channelMixer` la suivent tous. `curves`, le seul
effet qui *soit* une courbe tonale, ne la suit pas.

Ce n'est pas une finition : corriger change le rendu, donc les deux références
de pixels de `curves` (`effet-courbes-neutre`, `effet-courbes`). C'est un
arbitrage — « linéaire strict » est une décision structurante du projet, et
c'est peut-être elle qu'il faut amender ici plutôt que l'effet.

⚠️ **Amendement du 2026-08-11 — « ce que fait Photoshop » n'est PAS documenté,
et le tableau ci-dessus le présentait comme un fait.** Vérifié en sources
primaires
(`.scratch/prochain-palier/research/10b-sources-primaires-fonctions.md`) :
**Adobe n'énonce nulle part l'encodage sur lequel Curves opère** — sa page ne
dit que « niveaux d'entrée (valeurs originales) ». Aucune phrase Adobe ne dit
que Curves est perçu, ni qu'il est linéaire.

Ce qu'Adobe documente en revanche, et qui est plus utile : l'option *Blend RGB
Colors Using Gamma* est **décochée par défaut**, alors qu'Adobe écrit qu'un
gamma de 1,00 est « colorimétriquement correct » et produit le moins
d'artefacts de bord — et avertit que la COCHER fait diverger le rendu des
autres applications. L'avertissement ne fait sens que si cocher est la
déviation, donc la composition par défaut de Photoshop est l'espace **encodé en
gamma**, pas la lumière linéaire. **Inférence, pas citation.**

**Conséquence pour l'arbitrage** : l'argument « faisons comme Photoshop » perd
son autorité — Photoshop qualifie son propre défaut de non colorimétriquement
correct, en toutes lettres, et le garde quand même. C'est un précédent, pas une
preuve. La question redevient celle du dépôt : le curseur doit-il répondre là
où l'œil l'attend, ou la mathématique rester juste ? Se tranche dans
`.scratch/prochain-palier/issues/06-curves-en-lineaire-ou-en-percu.md`.

⚠️ Et la **fluidité** du tirage de poignée, l'autre moitié de ce point, ne se
capture pas : elle se sent au pointeur. Aucune planche ne peut y répondre.

---

✅ Le seul défaut d'affichage trouvé jusqu'ici est **corrigé** : les trois
sections d'encre de `duotone` répétaient le libellé de la pastille qu'elles
contenaient (« Ton moyen » sous « TON MOYEN »), soit trois lignes pour trois
mots — contre ADR-0001. Retirées le 2026-08-05 ; les trois pastilles reviennent
dans un bloc libre, à leur place, et *Tonalité* reste le seul titre. Il s'était
fait voir par un test, pas à l'œil : `getByText("Ombres")` levait « Found
multiple elements ». **Une story qui rougit sur une requête ambiguë dit qu'un
mot apparaît deux fois à l'écran** — signal gratuit, à ne pas neutraliser sans
regarder ce qu'il montre.

Protocole : `npm run dev:debug` puis `npm run dev:monitor`. Vérifier
`Get-Process -Name shaderlab` avant — le script tue toute instance de la machine.

⚠️ **Des Vite orphelins de sessions mortes squattent 1420/1421 et font échouer
`tauri dev` sur `Port 1420 is already in use`** (vécu le 2026-08-04, deux
instances datant des 1ᵉʳ et 2 août). Le symptôme ne nomme pas la cause : vérifier
les propriétaires des ports avant de conclure à autre chose.

---

## 2. Prochain grand chantier — « éléments et composition »

**Cadrage écrit le 2026-08-05** :
`docs/superpowers/specs/2026-08-05-elements-et-composition-cadrage.md`. Il ne
conçoit rien — il isole la question qui bloquait.

**Voie du modèle tranchée le 2026-08-05 : A.** Un champ optionnel
`contentSource?: { contentId }` sur `LayerState`, résolu par un store dédié hors
state React, sur le patron `imageSource` / `PhotoSourceStore`. Formes et
typographie passent par le même mécanisme. Le design d'effet peut donc
commencer ; il reste à écrire, ainsi que le plan.
Il n'y a plus d'arbitrage ouvert ici.

- ~~textures / scans~~ — **LIVRÉ le 2026-08-05**, design et preuve dans
  `docs/superpowers/specs/2026-08-05-textures-scans-design.md` ;
- ~~masque par tonalité~~ — **IL EXISTE DÉJÀ**, et ce document a écrit deux
  fois le contraire (« qui n'existe toujours pas », « meilleur rapport du
  cahier »). Mesuré sur disque le 2026-08-05 : `mask/sources/luminosity.ts` est
  au registre des sources de masque avec `gradient` et `colorRange`, câblé de
  bout en bout — `MaskPanel` le propose et lui donne ses réglages, `App`
  l'ajoute, `LayerStack` et `MaskTextureResolver` le consomment, son shader
  compile sous `gpu-shader-check` (« masque source:luminosity »), et il a ses
  stories. Deux rampes `smoothstep` sur la luminance Rec.709 en linéaire, plus
  tolérance et inversion. ⚠️ **La leçon vaut plus que l'item** : `git log` et
  ce fichier disaient tous deux qu'il restait à faire ; c'est le registre lu
  sur disque qui a tranché. ✅ Le « l'éprouver » qui restait est fait le
  2026-08-05 : les trois sources ont chacune leur référence de pixels
  (`masque-degrade`, `masque-luminosite`, `masque-range-couleur`), chacune
  comparée au même effet **sans masque** sur la même mire ;
- ~~light leaks~~ — **LIVRÉ le 2026-08-05** : `lightLeak`, 23ᵉ effet, quatrième
  de la famille des halos. Sa couleur n'est pas peinte — trois saturations
  exponentielles à vitesses différentes, une par couche d'émulsion — et deux
  assertions de `renderRefs.test.mjs` rendent ce point opposable. Reste son
  jugement esthétique, ligne 6 du bloc 1 ;
- formes ;
- typographie ;
- finalisation du recadrage ;
- éventuelles extensions du modèle de document / calques.

⚠️ **Les textures ne sont PAS passées par un effet, et le cadrage du même jour
disait le contraire** (« un effet ordinaire à texture d'entrée »). Antoine a
tranché autrement : **une texture est un calque photo, tel quel** — un scan est
un raster, `imageSource` le couvre déjà. Livré **sans toucher `LayerState`**.

⚠️ L'option « effet » n'a PAS été écartée par ADR-0008, contrairement à ce qui a
d'abord été écrit. ADR-0008 interdit d'écrire un `effectId` **sur** le calque
qui porte `imageSource` ; appliquer un effet à une photo reste le flux normal,
par un calque d'effet écrêté au-dessus. Ce qui écarte l'effet est structurel :
`params` est un `Record<string, number>` (uniform `array<f32, 48>`), donc **un
effet n'a aucun champ par lequel désigner une image** — le même mur que la
typographie.

Conséquence pour la voie A ci-dessus : elle reste entière, mais elle porte
**moins** que la liste ne le suggère. Trois natures distinctes, pas une :
`contentSource` est pour formes et typographie ; les textures sont des rasters
déjà couverts ; les **light leaks** sont du contenu SYNTHÉTISÉ (cahier ligne
330 : dégradés rouge/orange/jaune, flou fort, `Screen`, au bord du cadre), donc
un effet du registre avec sa mire et sa référence de pixels.

⚠️ **Le recadrage n'est pas à commencer, il est à FINIR.** `CropRect` et le mode
`crop` de `CanvasMode` existent, garde structurel compris ; `LayerTransform` n'a
pas de champ `crop` et `ui/tools.ts:23` garde l'outil **délibérément hors
palette** en le disant. Manquent le champ de modèle, la géométrie et le
branchement.

⚠️ **CORRECTION DU 2026-08-11 — ce paragraphe disait « et ça ne dépend d'aucun
arbitrage ». C'est FAUX**, mesuré sur disque. Son design existe pourtant en
entier (`2026-07-26-shaderlab-photo-layer-parity-design.md` §3.1) — mais le
modèle sous lui a bougé : le design spécifiait `scale: number` « UNIFORME » et
`flipX`/`flipY` booléens, quand le code porte `scaleX`/`scaleY` depuis le
2026-07-31. Le design avait prévu sa propre réouverture (« alors `scaleX`/
`scaleY` SIGNÉS et le flip devient le signe ») et **elle s'est déclenchée à
moitié** : les deux échelles sont arrivées, mais `clampTransformScale`
(`src/ui/transform.ts:125-127`) les borne au positif, donc le signe ne peut pas
porter le flip — et les booléens n'ont jamais été écrits. **Le miroir est tombé
entre les deux sans qu'aucun test ne rougisse.** Ce qui reste valide du design
se tranche dans
`.scratch/prochain-palier/issues/05-ce-qui-reste-du-design-de-parite-du-calque-photo.md`.

⚠️ **C'est le seul item de ce bloc qui ne dépende pas du design de
`contentSource`** : formes et typographie l'attendent, le recadrage non. Ce
paragraphe disait « le SEUL item prêt à coder » — retiré le 2026-08-11 pour la
raison ci-dessus : il a un design, pas un modèle à jour. C'est aussi le dernier trou FONCTIONNEL de l'app — vingt-trois
effets et pas de recadrage. En contrepartie il touche `LayerState`, la couche la
plus partagée du projet (`render/`, `mask/`, `export/`, `components/`,
`application/`) : plan écrit avant la première ligne.

### La vraie question de design, et ce n'est pas le rendu

Jusqu'ici un calque est **une photo** ou **un effet** (`LayerState`,
`src/layers/types.ts`). « Formes » et « typographie » sont un **troisième
genre** : du contenu vectoriel généré, sans texture source. Le rendu de chacun
est du travail connu ; c'est le **modèle de document** qui est la question
ouverte, et elle touche la couche la plus partagée du projet — `LayerState` est
consommé par `render/`, `mask/`, `export/`, `components/`, `application/`.

À trancher avant de coder : un troisième genre de calque, ou un effet qui
synthétise son propre contenu sur un calque existant ?

⚠️ **« Les deux marchent » était faux, et la mesure du 2026-08-05 le montre.**
`params` est un `Record<string, number>` parce que l'uniform est
`array<f32, 48>` — donc l'effet qui synthétise ne peut PAS porter une
typographie, qui a besoin d'une chaîne. Il bute sur le modèle avant la première
ligne de WGSL. Les formes simples, elles, tiennent en quatre à six flottants et
passent partiellement. **La réponse peut donc différer entre formes et
typographie ; les traiter d'un bloc est le premier piège du chantier.**

Et le troisième genre n'est pas une invention : le DEUXIÈME n'a déjà aucun
discriminant — un calque photo est un calque ordinaire qui porte `imageSource`,
avec `effectId: passthrough`. Un calque qui est du CONTENU plutôt qu'un
traitement existe déjà.

### Matière première déjà sur disque

`docs/superpowers/specs/2026-08-03-references-postproduction.md` — cahier dicté
par Antoine, **666 lignes** de workflows Photoshop/Lightroom. Il alimente
directement ce chantier (§4 textures et matières, §6 collage, ombres graphiques,
scan de tirage) et porte **son propre tri à faire**, écrit en fin de fichier —
cinq points, dont **deux soldés** :

- ✅ beaucoup de ses recettes sont des **piles**, pas des effets — la question
  n'est pas « quel effet écrire » mais « que manque-t-il à la pile ». Sa réponse
  était **un masque par tonalité**, qui n'est pas un effet mais une extension de
  `LayerMask` : **`mask/sources/luminosity.ts`, déjà au registre et câblé**
  (constat du 2026-08-05, voir le bloc 2). Ce point était compté comme ouvert
  dans les deux sens — ici et dans la liste du bloc 2 — alors que le code
  répondait ;
- ✅ la famille des **courbes** y revenait partout : soldée, `curves` est au
  registre depuis le 2026-08-04 ;
- le doublon se **mesure** avant de s'écrire ;
- ce qui **ne se crée pas en postproduction** doit être dit et non simulé ;
- plusieurs recettes demandent une **géométrie posée sur l'image**, pas des
  curseurs — ce que `CanvasControl` et le gabarit de section `pose` couvrent
  déjà pour les effets qui l'ont déclaré (chantier des contrôles, soldé le
  2026-08-05) ; ce qui reste ouvert est de le déclarer là où ça manque.

---

## 3. Export print — un PRD entier, jamais commencé

**`PRD-print-export.md`** (racine, 151 lignes, cadré le 2026-07-20). Il se
termine par « à lancer quand Antoine valide ce document ». **Jamais lancé, et
jamais mentionné dans cette feuille jusqu'au 2026-08-11** — il a passé 22 jours
invisible. Zéro trace en code : aucun TIFF, aucun ICC, aucune conversion de
gamut ; les seuls `16float` du dépôt sont le `rg16float`/`r16float` du masque
edge-aware, sans rapport.

Il vise à vendre des **tirages physiques** : rendu en 16-bit flottant pour
éliminer le banding des dégradés de bloom/halation, sortie TIFF 16 bits en
Adobe RGB avec ICC embarqué, résolution native sans resampling, DPI affiché
avant l'export.

**Arbitrage d'Antoine, 2026-08-11 : réel mais LOINTAIN.** Il n'est donc pas la
destination de la carte — il en est une **contrainte** : aucune décision prise
d'ici là ne doit rendre le passage au 16-bit plus cher.

Instruit le 2026-08-11
(`.scratch/prochain-palier/research/01-16-bit-hors-du-depot.md`, 804 lignes) :

- ✅ **Faisable, et moins cher que le PRD ne le croyait.** `rgba16float` passe
  comme cible de rendu, en blending, en lecture et **en filtrage linéaire**,
  sur un device demandé **sans aucune feature** (établi trois fois : spec W3C
  §26.1.1, source Dawn à commit épinglé, mesure live). La crate qui écrit le
  TIFF 16 bits avec ICC embarqué (`image` 0.25.10, `MIT OR Apache-2.0`) **est
  déjà une dépendance du dépôt**. La matrice sRGB → Adobe RGB ne porte que
  **4 coefficients non triviaux** (les deux espaces partagent leurs primaires
  rouge et bleue et D65).
- ⚠️ **Mais il bute sur une décision verrouillée du projet.** **Aucun format
  flottant n'a de variante `-srgb`** — l'invariant « chaîne de couleur en sRGB
  par le FORMAT, jamais par un gamma manuel en WGSL » (7 modules de
  `src/render/`) ne peut pas s'appliquer à un chemin 16-bit. Or le PRD range
  précisément ce contournement dans ses clauses « inacceptable ». **Le plan du
  PRD porte donc une contradiction interne que personne n'avait vue.**
- ⚠️ Deux autres tensions chiffrées : `rgba16float` n'est **pas** 16 bits
  uniformes (~11 bits utiles près du blanc, 32 à 64× plus grossier qu'un
  16 bits entier) alors que la sortie visée EST un TIFF 16 bits entier ; et
  `MAX_CANVAS_PIXELS = 64 Mpx` dépasse les limites par défaut du device en
  16 bits (relevables, mais plus gratuitement — ADR-0007 à relire).
- ✅ **Le trou déclaré est REFERMÉ le 2026-08-12.** La faisabilité avait été
  mesurée dans Edge 151 et non dans le WebView2 de shaderlab, faute de binaire
  sur disque. Refaite dans la **vraie fenêtre** (`Edg/151.0.4129.78`, app
  lancée avec le port CDP) : **verdict identique**, avec témoin de
  discrimination — `rgba32float` est refusé au filtrage dans la même sonde
  alors que l'adaptateur ANNONCE `float32-filterable`, le device n'ayant rien
  demandé. Détail :
  `.scratch/prochain-palier/research/01b-mesure-webview2-reel.md`.
- ⚠️ **Deux réserves qui restent, et qu'il ne faut pas gommer.** Le nom du
  backend Dawn est inconnu (`chrome://gpu` inaccessible en WebView2) — mais la
  question se DISSOUT, le backend n'étant qu'un proxy pour « la mesure est-elle
  représentative », que mesurer dans le vrai runtime rend inutile. ⚠️ Ne pas
  lire le `glRenderer` d'ANGLE/Direct3D11 rendu par `SystemInfo.getInfo` comme
  le backend WebGPU : c'est le chemin **WebGL**. Et **un seul GPU** reste vrai,
  non refermable ici : la machine n'a que la RTX 2060 et le WARP logiciel,
  `optimus: false`, `amdSwitchable: false`, aucun iGPU. Rien n'est établi pour
  Intel ou AMD — il faudra un autre matériel.

**Ce qui reste avant d'ouvrir ce chantier n'est donc plus technique, c'est de
l'arbitrage** : la contradiction du PRD avec l'invariant « sRGB par le FORMAT »,
et les ~11 bits utiles près du blanc face à une sortie TIFF 16 bits entier.

### La contrainte que ce bloc impose au reste du travail

Mesurée le 2026-08-12
(`.scratch/prochain-palier/issues/02-cout-d-attendre-le-16-bit.md`) : **attendre
ne coûte presque rien, parce que l'architecture porte déjà la propriété qui
rend le 16-bit introduisible.**

> Tout site qui choisit un format de texture COULEUR reçoit `srgbFormat` par
> injection — jamais une constante littérale. Une décision
> (`gpuContext.ts:160`), quatorze lecteurs, zéro format en dur. **Un effet ne
> choisit JAMAIS de format** ; s'il semble en avoir besoin, la conception est
> fausse — le patron est `textureLibraryStore`, où le store choisit et l'effet
> consomme.

Conséquences pour le bloc 2 : **formes, typographie et recadrage ajoutent ZÉRO
site à la facture 16-bit**, un effet ne voyant jamais le format. Et les 77
références de pixels sont sauves **tant que** le 16-bit reste un SECOND point
d'entrée d'export, comme le PRD le pose déjà — en faire un drapeau sur l'export
existant les ferait toutes sauter.

⚠️ Une réserve qui n'était pas prévue : **22 effets sur 23 bornent leur sortie**
(`clamp`/`saturate`), donc la marge au-dessus de 1,0 qu'offre un flottant ne
serait **pas utilisée**. Le gain est purement de la précision dans [0,1], ce qui
rend contraignante — et non anecdotique — la limite des ~11 bits près du blanc,
précisément là où bloom et halation travaillent.

## 4. Chantiers dormants — retrouvés par mesure le 2026-08-11

Aucun n'était dans cette feuille. Tous ont été trouvés en mesurant sur disque,
pas en relisant les documents — plusieurs y étaient contredits.

### `origin/sat-feather` — 12 commits non mergés, et il NE FAUT PAS le merger

Le ledger `.superpowers/sdd/progress.md` disait « si OK : merger sat-feather ».
**Mesuré : le merger ferait RÉGRESSER `master`.** Base de fusion `5b9536c`
(2026-07-24), 8 conflits dont 3 de code. Des trois commits de code :

| Commit | État sur `master` |
| --- | --- |
| `c148d8f` morphologie séparable | **doublé** — `770b7a8` l'a faite indépendamment, avec axes exportés, commentaire chiffré et `test/mask/morphologySeparable.test.ts` |
| `0a33de6` refactor helpers | **dépassé** par `6f3aa80` (plan de passes extrait en fonction pure, `src/mask/refinePlan.ts`) |
| `aee22fb` SAT plein résolution feather | ⚠️ **toujours unique** — 105 lignes de prod + 77 de test |

Sur `master` le feather est déjà séparable (`refinePlan.ts:59-61`, deux box
filters H+V) : **202 échantillons par pixel à r=50 au lieu de 10 201** — le
facteur 50 est acquis. `aee22fb` n'ajoute que le SECOND gain, `O(rayon)` →
`O(1)`.

**Donc la question à poser à Antoine a changé** : non plus « ce travail
fait-il disparaître le lag », mais **« le lag sur *Adoucir le bord* a-t-il déjà
disparu sur `master` ? »**. Si oui, la branche se supprime entière ; sinon, on
cherry-picke `aee22fb` seul. Dans les deux cas elle ne se merge pas. Ça se juge
au pointeur, pas au banc.

### Le dégradé RADIAL du masque n'a jamais été livré

Promis en **vague 1**, pas en différé :
`2026-07-18-shaderlab-layers-masking-prd.md:76` dit « Dégradé linéaire/**radial**
: angle, points de départ/fin, feather, inversion ». Sur disque,
`src/mask/sources/gradient.ts` s'annonce « Dégradé linéaire » et ne porte aucun
radial. Livré à moitié, signalé nulle part pendant 24 jours.

⚠️ Le même PRD (ligne 124) donnait le dégradé radial comme MOTIF pour différer
la sélection géométrique rect/ellipse — « dégradé radial déjà prévu ». **Le
motif n'a donc jamais existé en code.**

### Deux points d'interface décidés puis jamais écrits

- **Largeur du dock redimensionnable** — décidée le 2026-07-21 (« plan séparé
  après celui-ci »), jamais écrite. La mémoire projet
  `dock-largeur-saute-avec-barre-defilement` porte le bug voisin, non résolu :
  326 px pour 320 annoncés dès que la colonne défile, `flex-shrink` et
  `scrollbar-gutter` tous deux testés inefficaces.
- **`docs/design-qa/2026-08-04-dock-flat-workspace.md`** porte deux findings
  P1 ouverts, dont « sens de *plein écran* non déterminé », qui demande
  explicitement un arbitrage avant toute mutation de layout.

### Cinq différés de masquage, avec leurs déclencheurs

`2026-07-18-shaderlab-layers-masking-prd.md` : depth mask (⚠️ modèle de vision
monoculaire **local** type MiDaS/Depth-Anything, **PAS un LLM** — et son
déclencheur « après les masques de base » **est atteint** depuis le
2026-08-05), segmentation sémantique sujet/ciel, pen/path Bézier, sélection
rect/ellipse, lasso. Aucun rouvert depuis.

### La rationalisation des contrôles est OUVERTE sur trois fronts

⚠️ Ce document, `CLAUDE.md` et `docs/INDEX.json` déclaraient tous les trois ce
chantier **soldé le 2026-08-05**. Constat d'Antoine le 2026-08-12, puis mesure
sur les modules réels
(`.scratch/prochain-palier/assets/mesure-controles.ts` — le grep ment, les
paramètres de `curves` sortent d'un `flatMap`) : **les trois fronts sont
ouverts.** Le mécanisme est livré ; le chantier ne l'est pas.

**345 paramètres au total sur 23 effets** — personne n'avait ce chiffre.

- ⚠️ **Applicabilité : 10 % de couverture.** 36 conditions sur 345 paramètres,
  concentrées sur 8 effets. **15 effets sur 23 n'en ont AUCUNE**, et ce sont
  les plus chargés : `curves` (37 params), `lensFlare` (30), `channelMixer`
  (22), `gradientMap` (20), `isolines` (18). Or ADR-0017 donne à `lensFlare`
  **trois blocs distincts** dont les paramètres ne font rien quand leur bloc est
  éteint — rien ne les masque. C'est le « réglages qui ne font rien selon les
  situations » d'Antoine, chiffré.
- ⚠️ **Sections : elles existent partout mais ne sectionnent pas.** `duotone`
  11 params pour **1** section, `lensFlare` **10 par section**, `outlines` 8,7,
  `curves` 7,4. Et le gabarit `liste` représente **54 des 73** sections — des
  empilements verticaux, d'où le défilement. Une section de dix paramètres est
  un scroll avec un titre.
- ⚠️ **Outils sur la toile : 4 effets sur 23**, en trois genres seulement
  (`point`, `disk`, `axis`), six instances. Absents de `warp`, `glass`,
  `lensDistortion`, `gradientMap`, `isolines`, `sliceShift`, `gooeyMerge`,
  `halftone`. Antoine les juge « bâclés, pas du niveau de Photoshop, et pas
  présents partout » — reste à préciser si le manque est le NOMBRE de genres ou
  la QUALITÉ du geste, ce qui change entièrement le chantier.
- ⚠️ **Un orphelin non documenté, et sa cause.** `CLAUDE.md` affirmait que
  quatre effets laissent des orphelins délibérés (16 au total) ; la mesure les
  confirme **et en trouve un cinquième** — `duotone`, 9 orphelins sur 11
  paramètres. Cause probable : le retrait de ses trois sections d'encre le
  2026-08-05 pour violation ADR-0001. **La correction de densité a créé les
  orphelins.** 25 orphelins au total.

⚠️ **Le motif compte plus que les items : c'est la TROISIÈME clôture prématurée
du même chantier.** `INDEX.json` note qu'il avait déjà été rouvert une fois
« parce que le précédent n'avait traité que les contrôles spécialisés et avait
été clôturé comme s'il était complet ». Personne n'a menti — chaque plan décrit
fidèlement ce qu'il a fait, et c'est la CLÔTURE qui a porté sur le chantier
entier. **Avant de refermer, dire quelle MESURE prouvera que c'est fini ; un
compte de déclarations n'en est pas une** (l'erreur commise ici même : 42
déclarations lues comme « couvert », sans demander « sur combien »).

**Découpé le 2026-08-12 en un ticket PAR FRONT**, avec chacun sa mesure de
sortie — précisément parce que la cause des trois clôtures est toujours la
même : un plan couvrant une partie, lu comme couvrant le tout. Trois tickets
nommés rendent cette confusion impossible.

| Ordre | Front | Ce qui prouve que c'est fini |
| --- | --- | --- |
| 1 | `15-l-applicabilite-couvre-10-pourcent.md` | zéro paramètre inerte non masqué, prouvé effet par effet, chaque déclaration éprouvée par `render-check.mjs --applicabilite` |
| 2 | `16-les-sections-ne-sectionnent-pas.md` | un plafond de densité chiffré et opposable, aucun effet au-dessus, zéro orphelin sans raison écrite |
| 3 | `17-les-outils-sur-la-toile.md` | chaque effet dont la géométrie est le sujet porte son outil, et le geste tient une grille écrite AVANT d'implémenter |

L'ordre porte de l'information : **masquer réduit mécaniquement ce qui est à
l'écran**, donc re-sectionner avant de masquer serait sectionner un panneau qui
n'existera plus — le front 2 est explicitement bloqué par le front 1. Le front 3
est le plus cher et le seul qui demande de regarder dehors : sa recherche
(`18-ce-qu-est-un-manipulateur-de-niveau-pro.md`) est AFK et tourne en
parallèle.

⚠️ **Arbitrage d'Antoine, 2026-08-12** : sur les outils, les DEUX manques sont
réels — le nombre de genres **et** la qualité du geste. Le front 3 ne peut donc
pas se clore sur un seul des deux.

Contrainte dure commune : un paramètre ne se retire pas sans casser les presets
qui le citent, contrairement à un effet retiré ; et `test:render` doit rendre
zéro écart après tout travail de panneau.

### La migration shadcn s'est fait dépasser — 17 composants, pas 3

`CLAUDE.md` a annoncé « migration en cours composant par composant » avec trois
composants restants, du 2026-07-20 au 2026-08-12. **Mesuré : 17 composants sur
27 sont en CSS classique PUR**, 1 hybride, 20 fichiers `.css` dans
`src/components/`.

Le plan `docs/superpowers/plans/2026-07-20-shadcn-migration.md` ne visait que
`ErrorBanner`/`Toolbar`/`BrushToolbar` et disait « ne jamais toucher
`LayerPanel`, `ParamPanel`, `Canvas` — hors-scope » : **il a été fini comme
prévu.** Ce qui a bougé, c'est tout ce qui est venu après — `ToolPalette`
(07-31), `CurveControl`, `PropertiesPanel`, `ColorRampControl` (08-04),
`TexturePicker` (08-05), tous en CSS classique.

⚠️ **Nuance qui change l'urgence** : `npm run lint:tokens` est vert sur les 250
fichiers, donc le CSS classique **ne contourne aucun token**. C'est une dette
d'homogénéité, pas de design system.

Ni continuée ni arrêtée, jamais décidée — et l'écart grandit à chaque chantier.
Se tranche dans
`.scratch/prochain-palier/issues/13-la-migration-shadcn-est-elle-encore-la-direction.md`.

### Branches mortes, mesurées

`claude/lucid-vaughan-6f8fc7` est superseded par `master` ;
`claude/wonderful-thompson-fd0488` est **déjà dans `master`** (`87cf44f`) ;
`feature/dock-width-resize`, `claude/quizzical-hofstadter-b276ac` et
`worktree-agent-af9e8ffc69359d5ab` sont à 0 commit d'avance ;
`origin/task-management` porte un commit orphelin cité nulle part. Corvée de
nettoyage, aucune décision — sauf le sort de `sat-feather` ci-dessus.

⚠️ `master` est à **393 commits d'avance** sur `feature/design-system`, qui n'a
rien en retour, et `origin/HEAD` pointe toujours sur `feature/design-system`.
`docs/adr/0003-master-tracks-feature-design-system.md` décrit donc l'inverse de
la réalité.

---

## Ce que cette feuille ne porte pas, et où c'est

| Question | Fichier |
| --- | --- |
| Statut d'un chantier passé | `docs/INDEX.json` |
| Décisions tranchées (ADR) | `.claude/decisions/INDEX.md` |
| Vocabulaire de domaine | `CONTEXT.md` |
| Couches, ports de test, risques | `ARCHITECTURE.md` |
| Règles permanentes, commandes | `CLAUDE.md` |
