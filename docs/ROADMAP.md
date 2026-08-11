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
répartit en deux natures très différentes : du jugement humain (1), et un
chantier qui a son cadrage mais ni design d'effet ni plan (2).

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

| # | Sujet | Ce qu'il faut juger |
| --- | --- | --- |
| 1 | **Courbes** | Fluidité ET esthétique, définitivement, sur une vraie photo |
| 2 | **Pile / Propriétés / Masque** | Le nouveau flux, sur une pile **dense** — c'est la densité qui est en question, pas le flux à deux calques |
| 3 | **Verre** | Les matières sur une vraie photo. Le **Dépoli** est marqué « à raffiner » par Antoine et n'a pas été retouché depuis |
| 4 | **Les cinq pavés** | À l'usage, et ajuster le rendu si besoin — livrés et verrouillés, jamais regardés sur une photo |
| 5 | **Sections des panneaux** | Le découpage en blocs titrés, livré le 2026-08-05 sur les 23 effets. Aucun n'a été regardé sur une vraie photo, sauf `texture`, `dither` et `duotone` |
| 6 | **Light leak** | Livré le 2026-08-05 avec sa paire de références. Vu une fois sur une photo, jamais jugé — et deux défauts par défaut sont déjà probables : `intensite` à 1,35 sature le cœur en blanc, donc le dégradé chaud ne se lit qu'en marge, et l'irrégularité à 0,38 festonne le bord au point que la coulée se lit comme un nuage plutôt que comme un faisceau. Les deux sont des **valeurs**, pas du code |

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
branchement — et ça ne dépend d'aucun arbitrage.

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

## Ce que cette feuille ne porte pas, et où c'est

| Question | Fichier |
| --- | --- |
| Statut d'un chantier passé | `docs/INDEX.json` |
| Décisions tranchées (ADR) | `.claude/decisions/INDEX.md` |
| Vocabulaire de domaine | `CONTEXT.md` |
| Couches, ports de test, risques | `ARCHITECTURE.md` |
| Règles permanentes, commandes | `CLAUDE.md` |
