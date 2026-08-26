# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Nom provisoire (placeholder, jamais tranché). Repo local `C:\dev\shaderlab`,
> remote origin : `github.com/c0remusic/shaderlab`. Branche courante : se mesure
> (`git rev-parse --abbrev-ref HEAD`), ne s'écrit pas ici.
> **`master` est la branche CANONIQUE et la branche par défaut du dépôt**
> depuis le 2026-08-16 ([ADR-0005](docs/adr/0005-master-est-la-branche-canonique.md),
> qui renverse le 0003). Chaque branche merge vers `master` ; aucune
> synchronisation manuelle n'est due. ⚠️ `feature/design-system` a longtemps été
> la branche par défaut affichée par GitHub alors qu'elle était figée au
> 2026-07-26, 456 commits en retard — si un outil ou un prompt la nomme encore
> comme « main », c'est un reste, pas une consigne.
> Historique complet des chantiers/sessions (2026-07-12 → 2026-07-21) archivé
> dans `docs/archive/claude-md-history-pre-2026-07-22.md` — statut courant des
> tranches/checkpoints dans `docs/INDEX.json` (source de vérité, pas ce
> bandeau). Invariant durable hérité de cet historique : garder les gros
> buffers/textures de masque HORS du state React (cause du crash OOM peinture
> 24MP, résolu `e3c7584` — voir `src/layers/displayProjection.ts`).

## Langage partagé

Glossaire de domaine du projet : `CONTEXT.md` (racine). Le lire avant tout travail
qui manipule le vocabulaire métier ; le maintenir via le skill `interview`.

## Quoi

App desktop **Windows** (Tauri v2) d'effets visuels "shader" temps réel sur
photos JPEG : effets empilables en calques (glow, chromatic bleed, warp,
grain), masque au pinceau par calque, undo/redo en session. Le projet est né
comme **éditeur externe Lightroom** (round-trip type Dehancer : Lightroom
exporte une copie → lance l'app avec le chemin en argument → l'app écrase ce
même fichier → Lightroom réimporte).

**Ce positionnement est abandonné** ([ADR-0002](.claude/decisions/ADR-0002-abandon-round-trip-lightroom.md),
2026-07-27) : shaderlab est un **éditeur autonome**. Décision exécutée en code le
2026-07-30 — `isLaunchFile` et `roundTripActive` n'existent plus, et
`resolveExportTargetAsync` n'a plus de paramètre pour demander un écrasement
(`src/export/exportImage.ts`). Tout export est une copie.

Deux pièces survivent, et ni l'une ni l'autre n'est le round-trip :
- `get_launch_path` (`src/launch.ts`, `src-tauri/src/lib.rs`) ouvre un fichier
  passé en argument de lancement — « Ouvrir avec » de Windows. Ouvrir reste
  ouvrir ; c'est écraser qui est parti.
- `hasImportedPhotoLayer` (`src/layers/photoLayer.ts`) : né en garde du
  round-trip, il a depuis un SECOND appelant sans rapport avec l'export —
  `presets/presetDocument.ts:capture` s'en sert comme frontière de l'avis
  « calque photo exclu » d'un preset (T5). Ne pas le supprimer en croyant
  finir la dépose.

Née d'une frustration : aucun plugin Lightroom natif ne peut faire d'effets
shader GPU (pipeline RAW fermé). C'est cette origine qui explique la barre de
qualité ci-dessous. Positionnement outil perso vs produit partageable : pas
encore tranché.

**Exigence qualité explicite** : pas de rendu "filtre Photoshop 2005".
Chaque effet a une version pipeline (naïve) puis un upgrade qualité
obligatoire (dual-filter bloom, aberration radiale, warp FBM, grain
luminance-dépendant) — un effet qui marche mais rend cheap n'est pas terminé.

## Stack

Tauri v2 (coquille Rust minimale, lib = `shaderlab_lib`) · React 19 + TS ·
Vite · **WebGPU/WGSL brut** (pas de lib de rendu) · Vitest (deux projets :
`unit` en env Node, `storybook` en navigateur Playwright).

**UI** : Tailwind v4 (`@tailwindcss/vite`) + `shadcn/ui` (style `base-nova`,
PAS Radix — `components.json`). Tokens de marque = `src/design/{primitives,
semantic,components}.css`, mappés dans `src/design/tailwind-theme.css`
(jamais redéfinis).

✅ **IL N'Y A PAS DE « MIGRATION SHADCN », et il ne faut pas la réintroduire.**
Arbitrage TRANCHÉ le 2026-08-18 (ticket 13 de `.scratch/prochain-palier/`) : ni
« migrer vers Tailwind », ni « rester en CSS » — **les deux couches ont chacune
leur travail** :

> **Un composant COMPOSE les primitives `src/components/ui/` pour tout ce qui
> est un CONTRÔLE** — bouton, curseur, sélecteur, case, bascule — **et habille
> sa MISE EN PAGE en CSS classique à noms BEM.** Un contrôle écrit à la main est
> le défaut ; une grille de panneau en CSS classique n'en est pas un.

Elle se pose comme ADR-0001 : **au moment où le composant s'écrit, jamais dans
un lot de rattrapage** — c'est la forme qui manquait, et c'est pourquoi cinq
composants sont arrivés en trois semaines dans un style que ce paragraphe
déclarait en cours d'abandon.

Mesuré le 2026-08-18 sur 30 composants applicatifs (hors stories, hors les 13
primitives `ui/`) : **24 sont DÉJÀ conformes**, **4** portent des contrôles
écrits à la main (`CurveControl`, `EffectPicker`, `PropertiesPanel`,
`TexturePicker`), 2 n'ont aucun contrôle. La dette est de **4, pas de 17** — non
qu'on baisse la barre, mais qu'elle était mal placée : elle mesurait le style de
l'HABILLAGE au lieu de la provenance des CONTRÔLES.

⚠️ Deux chiffres que ce paragraphe a portés et qui étaient FAUX. **« 17 sur 27
en CSS classique PUR »** venait d'un test « le composant importe-t-il un
`.css` ? », qui rate tout composant dont la feuille BEM vit ailleurs
(`ToolPalette`, `BrushToolbar`, `EmptyWorkspace`). Et **« `ErrorBanner` /
`Toolbar` / `BrushToolbar` migrés »** : `BrushToolbar` porte son propre
`BrushToolbar.css` et zéro utilitaire, les deux autres sont des HYBRIDES —
**aucun composant n'a jamais été entièrement migré**, le plan de 2026-07-20 a
produit trois hybrides et non trois migrés.
Nuance qui reste vraie : `npm run lint:tokens` est vert sur les 261 fichiers,
CSS classique compris, donc **aucun style ne contourne un token**. Ce n'a jamais
été une dette de design system.
`Inspector.tsx` (aside dockée fixe)
supprimé le 2026-07-20, remplacé par `FloatingPanel`
(panneaux déplaçables/repliables/dockables), lui-même **supprimé le
2026-07-20/21** et remplacé par `PanelColumn`/`DockedPanelCard`
(`src/components/dockedPanel/`, dock fixe **content-sized**, sans splitter —
`react-resizable-panels` a ete RETIRE le 2026-07-21 par `0efdfe4` : chaque carte
prend la hauteur de son contenu.
⚠️ **Depuis le 2026-08-19 la colonne porte des GROUPES À ONGLETS** (modèle
Photoshop, `ui/dockLayout.ts` : `DockGroup { tabs, active, collapsed }`). Un
groupe montre ses panneaux en onglets, un seul visible, un clic pour passer à
l'autre — et **la colonne NE DÉFILE PAS**, ADR-0001 l'interdit en toutes
lettres. Ce fichier a dit « c'est la colonne qui defile » jusqu'à cette date :
c'était la description d'un défaut, pas d'une intention.
⚠️ **DEUX mécanismes ont été construits puis RETIRÉS le même jour** — un
auto-repli déclenché par la hauteur disponible (sans précédent chez Photoshop ni
Lightroom) et le **Solo mode** de Lightroom (qui tenait la colonne mais rendait
Pile et Propriétés exclusives alors qu'on les lit ensemble). **Ne pas les
reproposer comme des idées neuves** ; raisons dans
`.scratch/hybride-lightroom-photoshop/issues/04-le-layout.md`.
— voir `docs/superpowers/specs/2026-07-20-shaderlab-docked-panels-design.md`)
— ne plus citer `FloatingPanel`/`src/components/floatingPanel/` comme
composant existant ou à migrer, le dossier n'existe plus. Voir aussi
`docs/superpowers/specs/2026-07-20-shadcn-migration-design.md`.

Décisions techniques verrouillées (voir design.md pour les preuves) :
- **Chaîne de couleur en sRGB par le FORMAT, jamais par un gamma manuel en
  WGSL.** Sans ça, glow/grain/blur sont mathématiquement faux (constat
  d'audit). Détail d'implémentation à ne pas approximer : `context.configure()`
  n'accepte PAS de variante `-srgb` — on configure le canvas avec
  `navigator.gpu.getPreferredCanvasFormat()` et on déclare la variante srgb en
  `viewFormats`, la vue srgb servant à la passe finale
  (`gpuContext.ts:155-164` — cette référence a pointé 64-78 jusqu'au
  2026-08-11, soit ~90 lignes à côté).
  Ne jamais coder `rgba8unorm-srgb` en dur : c'est `bgra8unorm` sur
  Windows/D3D12. L'ordre des canaux est transparent en WGSL via `textureSample`.
  ⚠️ **Cet invariant ne peut PAS s'appliquer à un chemin de rendu flottant** :
  aucun format flottant n'a de variante `-srgb` (vérifié en spec W3C le
  2026-08-11). Tout travail 16-bit — l'export print du `PRD-print-export.md` —
  bute donc dessus avant sa première ligne. Voir
  `.scratch/prochain-palier/research/01-16-bit-hors-du-depot.md`.
- **Pas de distinction preview/export** — un seul pipeline, résolution
  native, toujours (décision utilisateur explicite, pas de downscale).
- JPEG traité comme sRGB, pas de lecture de profil ICC en v1 (limitation
  documentée, pas silencieuse).
- **Un corps `wgsl:` est un template literal JS**, et un backtick dans un
  commentaire le FERME. Écrire `` \` `` et jamais `` ` `` dans tout `wgsl:` /
  `passes[].wgsl` ; même vigilance pour `${`. Lancer `npx tsc --noEmit` après
  toute édition de shader, avant quoi que ce soit d'autre : l'erreur
  (`TS1005: ',' expected`) désigne une ligne LOIN du commentaire fautif, et un
  fichier qui ne parse pas fait échouer les tests pour une raison sans rapport
  avec ce qu'ils testent. Erreur commise deux fois dans la même session
  (2026-08-03) — le réflexe de citer un identifiant entre backticks vient de la
  prose Markdown des ADR, où il est correct.
  ⚠️ **Le piège n'est PAS limité aux corps `wgsl:`** : le bloc de scénarios de
  `scripts/render-check.mjs` est lui aussi injecté dans la page via un template
  literal, et un backtick de commentaire l'y ferme exactement pareil (3ᵉ
  occurrence le 2026-08-03). Là, `tsc` ne voit rien — c'est le script qui meurt
  au lancement sur un `SyntaxError: Unexpected identifier` désignant le mot qui
  SUIT le backtick, pas le backtick. D'où la convention en vigueur dans ce
  fichier : aucun backtick et pas d'accent dans les commentaires de scénarios.
  Corollaire du même jour : **préférer l'outil `Edit` à un script pour la prose
  française**. Un bloc inséré via heredoc Python est ressorti désaccentué dans un
  fichier qui, lui, est accentué — aucun linter ne regarde ça, seule une relecture
  l'attrape.
  ⚠️ **Élargi le 2026-08-18, et le périmètre « prose française » était trop
  étroit.** Un splice par INDICES (`s[:i] + neuf + s[j:]`) sur
  `src/design/components.css` a **supprimé 267 lignes** — tous les tokens après
  le premier — en laissant du CSS parfaitement valide. Ni `tsc` (opaque au CSS),
  ni `lint:css-comments` (les délimiteurs restaient équilibrés), ni le hook
  d'accents ne l'ont vu ; `lint:tokens` l'aurait attrapé mais avait tourné AVANT.
  Symptôme final : 33 fichiers de stories rouges d'un coup, avec un message
  parlant du serveur de vitest — rien qui désigne un fichier CSS. **Un splice par
  indices ne s'écrit pas** : `Edit` avec son ancre exacte, ou à défaut
  `str.replace(a, b, 1)` précédé d'un `assert a in s` — un remplacement ancré ne
  peut pas manger ce qui suit. Et comparer `wc -l` avant/après toute édition
  scriptée coûte une seconde.
- Effets = modules autonomes enregistrés dans `src/render/effects/registry.ts`
  — en ajouter un = un nouveau fichier ; un effet à paramètres groupés (voir
  `EffectParam.colorGroup`) touche aussi `ParamPanel.tsx` et peut élargir
  `MAX_EFFECT_PARAMS` (`shaderCompose.ts`, **48** depuis le 2026-08-04, élargi
  de 32 pour `curves`) si nécessaire.
  Registre réel au 2026-08-18, dans l'ordre : `glow`, `halation`,
  `lensFlare`, `lightLeak`, `lensDistortion`, `lensBlur`, `motionBlur`,
  `glass`, `warp`, `displacementMap`, `grain`, `duotone`, `hatching`,
  `halftone`, `dither`, `gooeyMerge`, `channelMixer`, `curves`, `nettete`,
  `outlines`, `isolines`, `pixelStretch`, `sliceShift`,
  `gradientMap`, `texture`, `aplat` — **vingt-six**.
  ⚠️ `emboss` (le Relief) EST SORTI le 2026-08-21 sur verdict d'usage
  (ADR-0019, « relief est horrible ») — 27 → 26. Et `noise`, poussé la veille,
  a été REVERTÉ le même jour, aussi refusé (28 → 27). Les deux retraits sont
  indépendants ; ne pas recompter de tête, relire le registre sur disque.
  La TRANCHE 3 du ticket 12 (2026-08-18) n'a donc plus que DEUX effets vivants
  sur trois — `emboss` est le seul à ne pas avoir survécu à l'usage :
  - `nettete` — accentuation et clarté, un seul opérateur à deux BANDES de
    fréquence. Il était donné « doublement bloqué » (pas de mode de fusion
    signé, un effet ne peut lire aucun autre calque) et les deux blocages
    étaient faux : `glow` tient déjà `color` et `prevPass` dans son dernier
    pass, donc la soustraction a lieu DANS l'effet, entre deux échelles de sa
    propre entrée. ⚠️ Second usage d'`EffectPass.enabled` après `outlines`, et
    il exploite une propriété que le runner documente — **un mode dont TOUTES
    les passes sautent reçoit la texture SOURCE en `prevPass`**
    (`effectPassRunner.ts:247`). C'est ce qui loge deux rayons très différents
    dans un seul effet sans pyramide conditionnelle.
  - `displacementMap` — le champ de déplacement devient une DONNÉE au lieu
    d'être du code (`warp` et `glass` calculent le leur). Rendu bon marché par
    le binding 7 d'ADR-0018, générique dès son écriture.
  `aplat` (2026-08-17) est une COULEUR UNIE bornée par un masque ou par une
  primitive posée. Il est le premier à entrer par une question à laquelle il n'a
  pas répondu : né prototype pour trancher « une forme a-t-elle besoin d'un
  troisième genre de calque », il a servi à faire corriger la QUESTION — une
  forme SÉLECTIONNE, elle ne se pose pas. Il reste pour une raison indépendante,
  arbitrée le même jour : la couleur unie manquait, et le cahier la cite (§96).
  ✅ **Deux des trois fronts de son upgrade qualité sont LIVRÉS** le 2026-08-17 :
  remplissage en DÉGRADÉ (linéaire et radial, arrêts interpolés en lumière
  linéaire — un fondu mélangé en gamma passe par un milieu assombri) et POLYGONE
  (3 à 12 côtés ; pas d'étoile, aucun besoin mesuré). Contour et rayon d'angle
  ÉCARTÉS par Antoine. Reste les POIGNÉES, seul front bloqué par le chantier des
  outils sur la toile (ticket 25).
  ✅ Et il se **TRACE à la souris** depuis le même jour — outil Forme, touche `U`,
  Maj pour un carré. Il était né avec un rectangle réglé à quatre curseurs ;
  verdict d'Antoine : « la pire façon de créer un rectangle ». ⚠️ La leçon
  dépasse cet effet : comparer un outil à sa référence se fait sur DEUX axes —
  ce qu'il RÈGLE (les paramètres, qui se lisent dans un panneau) et ce qu'on FAIT
  pour s'en servir (le geste, qui ne se lit dans aucune liste de champs). Le
  second est celui sur lequel un utilisateur juge en premier.
  ⚠️ **CE COMPTE ET CETTE LISTE SE METTENT À JOUR DANS LE COMMIT QUI AJOUTE
  L'EFFET**, jamais au wrap-up. Ils ont dit « vingt-deux » pendant toute la
  durée où le registre en portait vingt-trois (2026-08-05), et `docs/ROADMAP.md`
  avec eux. Rien ne les vérifie — c'est de la prose, et aucun test ne compte les
  entrées d'une phrase : la seule parade est de les traiter comme faisant partie
  du geste d'ajout.
  `texture` (2026-08-05, ADR-0018) est le PREMIER effet qui échantillonne une
  IMAGE au lieu de ce qui est en dessous de lui. Ce qui le rend possible :
  `params` est un `Record<string, number>`, donc **le paramètre porte le RANG**
  de la texture dans le catalogue trié du dossier, **et le binding 7 porte les
  pixels** (`render/textureLibraryStore.ts`). Le mécanisme est GÉNÉRIQUE — tout
  effet peut déclarer `EffectModule.libraryTexture`. ⚠️ `libraryTexture` +
  passes internes est REFUSÉ par `validateEffect` (le binding n'est résolu que
  pour la passe finale), ce qui exclut `lensFlare` aujourd'hui.
  Une taxonomie éditoriale les range en six catégories dans
  `effects/catalog.ts` (`EFFECT_CATEGORIES`) — explicite et centralisée, jamais
  inférée du nom ; elle classe l'EFFET, pas ses paramètres (c'est le chantier 2
  de `docs/ROADMAP.md` qui portera la catégorie au paramètre).
  `glass` (2026-08-03/04) est le portage du système de réfraction d'Antoine
  (`C:\dev\portfolio\src\shaders\verre\site.fs.glsl`) — plan
  `docs/superpowers/specs/2026-08-03-verre-plan-de-portage.md`. **Il est
  COMPLET** : quatorze matières (les neuf de la feuille + les cinq du PAVÉ,
  livrées le 2026-08-04 à la fin de la même liste, PAS dans un second effet),
  cinq profils de section, **dix-huit références de pixels — toutes les
  branches verrouillées**. Un seul mécanisme décliné quatorze fois : chaque
  matière ne fait que fabriquer une PENTE de surface, tout ce qui suit
  (réfraction, dispersion, diffusion, Fresnel, absorption) est commun et ne sait
  rien d'elle.
  Sa mire est `mireVerre`, écrite pour lui et **entièrement achromatique** —
  donc toute couleur dans ses références EST la dispersion.
  ⚠️ Verrouillé ≠ validé, et le jugement est tombé : le **Dépoli** ET les cinq
  pavés ont été regardés sur une vraie photo le 2026-08-13, et **REFUSÉS** —
  « très artificiel, 3D des années 90 ». Une référence de pixels prouve qu'un
  effet porte sa propriété, jamais qu'il est beau (`docs/ROADMAP.md` §1, qui
  porte les quatre corrections que les photos désignent).
  ⚠️ **Corollaire payé le même jour : sur une question d'APPARENCE, un
  raisonnement physique ne remplace pas une image.** Trois constantes ont été
  écrites dans `glass.ts` sur la foi de specs textuelles (largeur de joint en
  mm, rugosité en µm) avant qu'une seule photo soit ouverte — dont « un joint
  opaque est forcément sombre », démentie par la première photo venue, et qui
  avait amputé de moitié la course du curseur `Clarté du mortier`. Une spec
  décrit des GRANDEURS, une photo montre une APPARENCE ; le ratio joint/pavé
  était d'ailleurs le seul chiffre déjà juste.
  **Cinq départs le 2026-08-03**, tous sur arbitrage d'Antoine : `surfaceBlur`
  (ADR-0011, verdict d'usage sur la famille des flous), `posterize` (ADR-0012,
  couvert par `dither` — couverture PROUVÉE avant le retrait, le scénario
  sérigraphie porté mot pour mot rend les mêmes 32 valeurs distinctes),
  `coloredEdges` **absorbé par `outlines`** (ADR-0013, mode d'encre : Encre
  unique ou Roue d'orientation), `echoOutlines` **absorbé par le même**
  (ADR-0015, troisième mode de DÉTECTION : Échos de la forme) et
  `chromaticBleed` **absorbé par `lensDistortion`** (ADR-0016, mode Latérale).
  Retirer un effet ne casse pas les presets qui le citent : `presetDocument.ts`
  ignore le calque et pousse un avertissement, jamais une exception.
  ⚠️ **Un doublon se MESURE avant de se retirer, et la mesure répond souvent
  deux choses.** Sur `chromaticBleed` : 0,005 % de canaux d'écart avec le mode
  Latérale sur le cas radial (le doublon était réel), mais 23,1 % sur
  l'orientation du décalage, que le mode Latérale ne sait pas produire — un
  grandissement dépendant de la longueur d'onde n'est que radial. Le paramètre
  a été PORTÉ avant le retrait. Sans la mesure, c'était un retrait sec présenté
  comme un dédoublonnage.
  **`outlines` porte donc 26 paramètres, deux modes d'encre et trois modes de
  détection**, et il est le SEUL dont le coût dépende d'un choix : ses neuf
  passes de pyramide ne tournent qu'en mode Échos (`EffectPass.enabled`). Avant
  d'y toucher, lire son en-tête : les dix-neuf premiers index sont gelés par
  sept références de pixels et par les presets.
  La question de nom que le cahier laissait ouverte (la fiche Figma appelle
  `Outlines` l'effet à échos, nous appelions `Outlines` le détecteur) est
  ÉTEINTE par la fusion — plus rien à arbitrer.
  ⚠️ Il n'est plus le plus chargé du registre : mesuré le 2026-08-15 sur
  `EffectModule.params.length`, c'est **`curves` (37)**, puis `lensFlare` (33 —
  30 jusqu'au 2026-08-14, plus ses trois interrupteurs de phénomène),
  puis `outlines` (26). Compter les `name:` du fichier source ne le dit PAS —
  les 32 paramètres de `curves` sortent d'un `flatMap`, et le grep n'en voit
  que 5.
  `isolines` trace des courbes de niveau du ton, et `curves` (2026-08-04) est
  la courbe tonale par canal — quatre canaux (maître, R, V, B) à trois points
  mobiles chacun, plus une plage tonale ; son contrôle passe par les champs
  `EffectModule.curveControls` / `tonalRangeControl`, pas par des curseurs.
  Six sont arrivés le 2026-08-01 et AUCUN ne vient du backlog Figma d'origine
  (épuisé le 2026-07-31) : ils sortent du cahier de références
  `docs/superpowers/specs/2026-08-01-references-effets.md` et de demandes
  directes d'Antoine.
- **Le panneau d'un effet est DÉCLARÉ par son module, jamais par `ParamPanel`**
  — le MÉCANISME est livré ; ⚠️ **le CHANTIER ne l'est pas, contrairement à ce
  que ce paragraphe a dit du 2026-08-05 au 2026-08-12** (« chantier soldé »).
  Mesuré sur les modules réels, d'abord le 2026-08-12 puis le 2026-08-15
  (instrument : `.scratch/prochain-palier/assets/mesure-controles.ts`), puis
  re-mesuré le 2026-08-19 : sur **385 paramètres**, **52**
  portent une condition (14 %) et **16 effets sur 27 n'en ont AUCUNE** — dont
  `curves` (37 params), `lensFlare` (33), `channelMixer` (22),
  `gradientMap` (20).
  ⚠️ **Le chiffre « 51 » qu'a porté cette phrase était DÉJÀ faux avant la
  session du 2026-08-19**, et c'est vérifié et non supposé : l'instrument
  relancé sur l'arbre d'AVANT les changements du jour rend 52, pas 51. Le
  2026-08-19 a ajouté 3 paramètres (`glow` ×2, `lensBlur` ×1) et **zéro
  condition** — 382 → 385 est donc entièrement à lui, 51 → 52 ne l'est pas.
  Un compte de prose ne se recopie pas : il se relance.
  ⚠️ **Le ratio n'a PAS bougé et le compte a monté deux fois de suite pour la
  même raison — un effet neuf, pas une correction.** 36 → 48 le 2026-08-17
  (`aplat` seul en apportait 12), 48 → 52 le 2026-08-18 (`nettete` 1,
  `displacementMap` 1, `aplat` 1 de plus avec son inverse). Et le
  DÉNOMINATEUR monte avec : 16 effets sans condition contre 15, `emboss` entrant
  sans aucune — délibérément, il n'a pas d'état caché (point 2 du ticket 15).
  ⚠️ **Ces comptes datent du 2026-08-18 et le 2026-08-21 les a fait DESCENDRE** :
  `emboss` retiré (ADR-0019) et `noise` reverté, deux effets sans condition en
  moins. Ne pas les prendre pour l'état courant — RE-MESURER avec
  `.scratch/prochain-palier/assets/mesure-controles.ts`, ne jamais recopier.
  RE-MESURER avant de s'en servir pour juger l'état du chantier, sinon un ajout
  se lit comme un progrès. ✅ `lensFlare` en est SORTI le 2026-08-14 : ses trois
  phénomènes ont désormais leurs trois interrupteurs, et ses trois sections
  leur condition — c'était le cas qu'ADR-0017 rendait le plus criant (trois
  blocs dont les paramètres ne font rien quand leur bloc est éteint). Le
  registre porte 9 conditions de SECTION en tout. Les sections
  existent partout mais ne sectionnent pas (`duotone` 11 params pour 1 section,
  `outlines` 8,7 par section ; `liste` = **61 des 85** gabarits au 2026-08-19,
  d'où le défilement — et ce chiffre-là aussi était faux avant d'être relancé,
  il disait 63 des 83 quand l'arbre en portait 60 des 84), et
  **5 effets sur 27 seulement** portent un outil sur la toile,
  en trois genres (`disk` ×2, `point` ×3, `axis` ×2) — `aplat` s'y est ajouté le
  2026-08-17 avec un `point` sur le centre de sa forme. Se tranche dans
  `.scratch/prochain-palier/issues/14-la-fusion-des-reglages-redondants.md`.
  ⚠️ **Troisième clôture prématurée du même chantier** — `INDEX.json` note qu'il
  avait déjà été rouvert une fois pour cette raison exacte. Trois champs,
  un seul type de condition partagé — `DisplayCondition` : `EffectParam.appliesWhen`
  masque un curseur sans objet, `EffectModule.sections` regroupe en blocs titrés
  (`SectionLayout` : vocabulaire **fermé** à `liste` · `paire` · `grille` ·
  `pose` · `figure`), et `CanvasControl.visibleWhen` est le précédent dont les
  deux autres sont issus. Une condition vise un paramètre à `choices` et rien
  d'autre — voie A, aucune échappatoire prédicat, donc `validateEffect` relit
  tout au chargement. Corollaires à ne pas approximer :
  **(a)** c'est de l'AFFICHAGE — `params[]` ne se réordonne jamais, ses index
  sont persistés dans les presets, et `test:render` doit rendre **zéro écart**
  après tout travail de panneau (c'est le gate discriminant : un écart prouve
  qu'on a trié le tableau au lieu des items) ;
  **(b)** masquer ne borne pas — le shader garde ses clamps, un preset ne passe
  pas par le panneau ;
  **(c)** **un paramètre qu'aucune section ne cite n'est PAS un défaut** : quatre
  effets en laissent délibérément (`lensFlare` 9, `channelMixer` 4, `gradientMap`
  2, `curves` 1) en disant pourquoi à leur déclaration. La différence entre un
  orphelin voulu et un oubli se LIT dans le commentaire, aucune mesure ne la
  donne. ⚠️ **Mais il y en a un CINQUIÈME, non documenté, et cette phrase a dit
  « quatre » jusqu'au 2026-08-12** : `duotone` laisse **9** orphelins sur ses 11
  paramètres. Cause probable — le retrait de ses trois sections d'encre le
  2026-08-05 (elles répétaient le libellé de leur pastille, violation ADR-0001).
  **La correction de densité a créé les orphelins**, et rien ne l'a signalé.
  Mesure : 25 orphelins au total sur 345 paramètres ;
  **(d)** une applicabilité se MESURE avant de se déclarer —
  `node scripts/render-check.mjs --applicabilite`. Sur 41 déclarations éprouvées
  le 2026-08-05, une était FAUSSE (`glass.flat`, 47 % des canaux en Martelé) ;
  masqué sur sa foi, aucun test n'aurait rougi, un curseur caché ne bougeant plus
  aucun pixel.
  ⚠️ **Cet instrument ne couvre que `EffectParam.appliesWhen`, PAS
  `EffectSection.appliesWhen`** (constat du 2026-08-14). Les trois conditions de
  section de `lensFlare` ont donc dû s'éprouver autrement : six scénarios
  temporaires ajoutés à `render-check.mjs`, chacun poussant TOUS les réglages
  d'une famille éteinte de son minimum à son maximum, puis retirés une fois lus
  — 0,000 % d'écart les trois fois. Tant que l'instrument ne voit pas les
  sections, le front 1 du chantier des contrôles se terminerait sur des
  déclarations non mesurées.
- **La famille des flous est CLOSE, et RÉDUITE À DEUX** depuis le 2026-08-03 :
  `lensBlur` est un noyau d'OBJECTIF (intégration sur la surface de l'ouverture —
  pondération des hautes lumières + diaphragme à N lames, plus quatre géométries
  de champ qui couvrent Iris et Tilt-Shift) ; `motionBlur` intègre le long d'une
  TRAJECTOIRE (directionnelle, rotation, zoom — Path et Spin de la galerie).
  `surfaceBlur` (bilatéral) a été **retiré** (ADR-0011) — ne pas le citer comme
  existant. Le **gaussien reste volontairement dehors** : la référence dit qu'il
  lave l'image, et un test du registre le vérifie — ce garde a déménagé dans
  `registry.test.ts` le jour du retrait, précisément parce qu'il vivait dans le
  fichier de test de l'effet retiré.
  Noyaux de flou pyramidal partagés par glow/halation : `effects/blurChain.ts`.
  Les deux flous ci-dessus n'en sont PAS : un noyau pyramidal ne sait produire
  ni bord franc, ni polygone, ni poids de valeur.
  ⚠️ **Le diaphragme n'est plus un polygone à arêtes DROITES depuis le
  2026-08-19** : `effects/aperture.ts` porte une COURBURE (`bladeCurvature`,
  index 11 de `lensBlur`, défaut 0 donc rendu inchangé au bit près), parce
  qu'une lame réelle est un arc et que l'ouverture s'arrondit en s'ouvrant.
  Le modèle est une interpolation du rayon, PAS un arc exact, et l'écart est
  **borné par `aperture.test.ts`** — 0,16 % à six lames, 3,16 % au pire (le
  triangle). L'arc exact est dans le fichier, en TS seulement : il coûterait un
  `sqrt` et une division PAR TAP dans la boucle la plus chaude de l'app (jusqu'à
  256 taps par pixel), et son rayon part à l'infini à courbure nulle. `lensFlare`
  partage la fonction et passe 0.0 — un objectif n'a qu'un diaphragme, donc le
  jour où il expose la courbure, c'est un paramètre qu'il lit, pas une constante.
- ⚠️ **Demander les photos de l'utilisateur AVANT de raffiner sur des références
  publiques.** Leçon la plus chère du 2026-08-03 : trois passes de raffinement de
  `lensFlare` ont été faites sur des références générales, puis cinq photos
  d'Antoine ont montré que son objectif ne produit ni chaîne de fantômes ni
  anneau — mais une PLUME de diffusion rasante, teintée et coupée droit. Des
  références générales disent ce qu'un effet PEUT être ; les photos de celui qui
  va s'en servir disent ce qu'il DOIT être. Deux passes sur trois auraient été
  économisées.
- **Un flare n'est pas UN phénomène mais TROIS**, et ils diffèrent par l'endroit
  où la lumière se perd, pas par leur apparence : entre deux faces POLIES
  (ghosting — des images nettes de l'ouverture), sur une surface SALE ou rayée
  (diffusion — des stries radiales), par aller-retour avec le CAPTEUR (un
  quadrillage régulier, le « red dot »). Aucun mécanisme unique ne les produit
  toutes ; `lensFlare` porte les trois en blocs distincts (ADR-0017 §amendement).
  ⚠️ **Un fantôme est une image de l'OUVERTURE, pas de la source** (Hullin & al.).
  C'est pourquoi la source POSÉE a ses fantômes DESSINÉS — anneau polygonal,
  liseré vif, découpe en croissant par intersection avec le disque du barillet —
  là où la voie automatique, qui ne sait pas où sont les sources, ne peut que
  PRÉLEVER et rend des taches molles. Tout ce qui part de la source posée est
  analytique, donc valide **hors cadre** ; le prélèvement, lui, ne l'était pas —
  défaut mesuré et corrigé le 2026-08-03.
- **Trois familles d'effets**, chacune découpée d'une façon qui ne se devine pas
  depuis les noms. **Halos, à QUATRE** : `glow` étale sans colorer (diffusion),
  `halation` réexpose en rouge sur fond sombre (film), `lensFlare` RÉFLÉCHIT —
  il produit des copies déplacées de la source au lieu de l'étaler sur place
  (ADR-0017) — et `lightLeak` (2026-08-05) n'a **aucune source dans l'image** :
  il ne lit pas un texel de ce qui est en dessous. C'est ce qui le distingue
  assez pour valoir une entrée et non un mode ; les trois autres partent tous
  des hautes lumières DE L'IMAGE et les transforment, une fuite vient d'un jeu
  du boîtier — en aval de l'objectif, en amont de l'émulsion. Ils s'empilent.
  ⚠️ **`glow` rend DEUX filtres depuis le 2026-08-19, et il n'en rendait qu'un
  pendant que son en-tête en citait trois.** Son composite était purement
  additif : le halo se posait partout où il tombait, donc il délavait les noirs
  — c'est un Pro-Mist. Ce qui sépare le *Black* Pro-Mist n'est pas un dosage,
  ce sont des particules noires qui ABSORBENT la lumière diffusée retombant sur
  les zones denses. D'où `shadowHold` / `shadowHoldPoint` (index 4 et 5, défaut
  0 donc rendu inchangé au bit près) : une porte calculée sur la luminance de ce
  qui est SOUS le halo, jamais sur celle du halo. Idée mesurée chez Affinity
  (leur Bloom a un plancher : sous une certaine densité, exactement rien) mais
  pas leur découpage en trois bandes — voir
  `docs/design-system/affinity-plugin-verdict-2026-08-19.md`.
  La famille a fait l'aller-retour dans la même
  journée : `anamorphicStreak` en est sorti le matin pour `lensDistortion`
  (ADR-0014, une traînée sur un seul axe est ce que fait un verre CYLINDRIQUE),
  et `lensFlare` l'a rouverte le soir. La règle qui décide est la même dans les
  trois sens — **un halo AJOUTE de la lumière, il ne déforme pas l'image** ; une
  famille close par un découpage se rouvre quand un mécanisme qui n'y entre pas
  se présente, jamais pour une nuance. ⚠️ `test/render/effects/lensDistortion.test.ts`
  GÈLE cette liste : l'élargir doit faire rougir un test, sinon la frontière
  entre halos et optique dérive toute seule. Ce qu'un objectif
  fait se range donc en trois questions : ce qu'il RENVOIE (halos), ce qu'il ne
  met pas au point (flous), ce que sa FORME déforme (`lensDistortion` — fisheye
  signé + trois modes d'aberration, dont la longitudinale qui défocalise au lieu
  de déplacer). Son mode Latérale a ABSORBÉ `chromaticBleed` le 2026-08-03
  (ADR-0016) : le doublon déclaré depuis ADR-0014 a été mesuré, puis résolu en
  portant la seule chose qui manquait — `aberrationAngle`, les franges
  tangentielles d'un objectif décentré.
  **Impression** : `dither` (aplats ET trames — il a absorbé `posterize`,
  ADR-0012 : sa `Force du tramage` à 0 EST le rendu sérigraphie), `hatching`
  (taille-douce), `halftone` (trame CMJN et sa rosette). **Flous** : voir
  ci-dessus.
- **Un curseur dont la course est morte est un échec silencieux**, au même titre
  qu'un paramètre non câblé. Deux formes rencontrées sur `sliceShift`, corrigées
  le 2026-08-03 (D11, arbitrage d'Antoine) : une course dont le HAUT dégrade
  l'effet (`P(fusion) = x·(1−x)` retombait à zéro à fond de curseur — remappé sur
  le flanc croissant), et une course dont le maximum déclaré dépasse le maximum
  effectif (`edgeFeather` annonçait 200 px et le shader bornait à `sliceSize`,
  48 par défaut — trois quarts morts). La seconde a produit
  **`EffectParam.maxFrom`**, un maximum dynamique lu par `ParamPanel` sur les
  paramètres résolus, même forme que `EffectPass.enabled`. ⚠️ `maxFrom` borne le
  CURSEUR, jamais la valeur : le clamp du shader reste nécessaire, un preset ou
  un `updateParams` ne passent pas par le panneau (`LayerStack.updateParams`
  n'écrête rien).
- **Tout changement qui ajoute des lectures de texture par pixel se MESURE
  avant d'être committé.** Payé le 2026-08-13 : la diffusion de `glass` est
  passée de 9 à 16 prélèvements pour un gain visuel réel, et a coûté **37 % de
  cadence** (15,9 → 10,0 images/s sur 26 Mpx) — signalé par Antoine en pleine
  session, pas par la mesure. La spirale isotrope apportait déjà tout le gain à
  9 taps : c'était la GÉOMÉTRIE de l'échantillonnage qui comptait, pas son
  nombre de points. ⚠️ Et la mesure se prend en build de **production** :
  le plancher du build de dev est 2,6× celui de la prod (15,4 ms contre 6,2 ms
  de travail synchrone par événement, à 8 calques) et noie les petits signaux —
  une mesure en dev prouve qu'un coût existe, jamais qu'il est négligeable.
- **Garde de câblage** : `test/render/effects/parametresCables.test.ts` vérifie
  que chaque paramètre déclaré est lu à SON index par le shader, sur tous les
  effets du registre. Elle naît d'un défaut réel — `warp` avait quatre contrôles sur sept
  morts ou décalés, invisibles pour le compilateur comme pour le verrou de
  pixels (un curseur mort ne bouge aucun pixel, précisément parce qu'il est
  mort).
- **Détecteur de contours** : `effects/edgeGradient.ts` (Scharr 3x3, huit taps,
  ton perceptuel + chromaticité). Il n'a plus qu'UN lecteur, `outlines`, et le
  garder en fichier à part est délibéré (c'est la copie qui coûte, pas le
  fichier). Ses deux autres lecteurs sont revenus dans `outlines` le même jour :
  « jeter la DIRECTION du gradient pour une encre unique, ou la garder pour en
  faire une teinte » est le paramètre `inkMode` (ADR-0013), et « mesurer une
  DISTANCE à la forme au lieu d'un gradient » est le mode `Échos de la forme`
  (ADR-0015). Deux effets de moins, zéro capacité perdue, les deux prouvées à
  l'octet.
  Les autres fichiers de `effects/` sont des helpers (`aperture`, `bayer`,
  `blendSpace`, `catalog`, `hash`, `hsl`, `inputMode`, `oklab`, `srgbTransfer`,
  `uvSpace`, `validate`, `types`) : la présence d'un fichier n'est pas la
  présence d'un effet, vérifier `registry.ts`.
- **Trois contrôles TRANSVERSAUX.** Les deux premiers sont posés le 2026-08-01
  d'après le §6bis du
  cahier de références (ils sont récurrents chez Figma et étaient absents
  partout ici) : `effects/blendSpace.ts` (espace de mélange — sRGB, Linéaire,
  OKLab, OKLCH ; plus un vocabulaire restreint aux deux courbes de transfert
  pour les opérateurs qui ne sont pas une interpolation, comme la matrice de
  `channelMixer`) et `effects/inputMode.ts` (mode d'entrée — Luminance,
  Luminance inversée, Alpha). Un effet qui les adopte garde son rendu au bit
  près sur son défaut. ⚠️ L'index d'un choix est PERSISTÉ dans les presets :
  on ajoute une entrée à la FIN de la liste, jamais au milieu.
  Le TROISIÈME est `effects/inkTexture.ts` (2026-08-05, ADR-0018), adopté par
  `halftone`, `dither` et `hatching` : la bavure d'une encre RÉELLE sur une
  marque calculée. Ni un effet à part (il n'aurait rien à encrer), ni trois
  modes recopiés — les trois effets calculent une marque à partir du ton, et
  l'encre ne change pas ce calcul mais la façon dont la marque est tracée. Même
  raison d'être que les deux ci-dessus : une propriété récurrente de la famille
  Impression, absente partout. Sa force vaut 0 par défaut, donc les rendus
  existants sont inchangés au bit près.
  `passthrough` (`PASSTHROUGH_EFFECT`) est résolu par `getEffect` mais
  volontairement HORS du registre — c'est l'effectId par défaut d'un calque
  photo, pas un effet choisissable.
- Modes de fusion = modules autonomes dans `src/render/blend/registry.ts`
  (même principe, Tranche 1 2026-07-19) — chaque calque a `opacity`/
  `blendMode` sur `LayerState`. **Dix-sept depuis le 2026-08-18** : les six du
  ticket 12 (Différence, Soustraction, Teinte, Saturation, Couleur, Luminosité)
  se sont ajoutés aux onze, **sans toucher l'interface** — `fn blend(base, top)`
  recevait déjà les deux couleurs entières, ce qu'un mode non séparable demande.
  `blendMode` étant une CHAÎNE, ajouter ou réordonner ne déplace aucun index de
  preset (l'ordre du registre EST celui du sélecteur).
  ⚠️ **L'ESPACE se décide par mode, et le critère n'est PAS « ce que fait
  Photoshop »** — qui calcule tout en gamma — mais « l'opérateur a-t-il une
  lecture physique ? ». `multiply` est en linéaire parce que multiplier deux
  transmittances FILTRE de la lumière ; `difference`/`subtract` le sont pour la
  même raison. `overlay` et sa famille n'ont aucune lecture physique et décodent
  donc en sRGB, et les quatre non séparables aussi — leurs coefficients de
  luminosité (0,3 / 0,59 / 0,11) sont une luma perçue posée sur des valeurs
  ENCODÉES.
  ⚠️ **Le gate `test:wgsl` ne validait QUE `normal`** jusqu'au 2026-08-18 : seize
  modes sur dix-sept n'apparaissaient dans aucun shader composé, et
  `test:gpu-shaders` ne tourne pas en CI. Une variante par mode est désormais
  composée, avec un attendu DÉRIVÉ du registre.
- **Toute lecture de `libraryTexture` DÉCLARE son espace d'échantillonnage.**
  Les scans portent une pyramide de mipmaps (`src/render/mipmapGenerator.ts` —
  WebGPU n'a aucune génération intégrée, il faut la chaîne de blits). ✅ **Sur
  `master` depuis le 2026-08-17**, verdict rendu par la mesure que son commit
  réclamait — scan 8192² sur photo 26 Mpx, temps GPU de la passe `texture` : le
  coût devient **PLAT** (2,2 à 2,4 ms quelle que soit la minification) là où sans
  pyramide il CROÎT (3,0 à 6,0 ms). ⚠️ **Et la prémisse de la branche était
  fausse** : elle annonçait « échantillonné à l'échelle de l'écran, un rapport de
  l'ordre de 1:8 », alors que `presentPass.ts:44` dit que le canvas a la
  résolution NATIVE de l'image et n'est réduit que par CSS. L'échantillonnage se
  fait donc à 6240×4160 — **1,31 × 1,97, un LOD de ~1 au réglage par défaut**, où
  le gain vaut ×1,24 ; le 1:8 n'arrive qu'à `Échelle` ≈ 0,25 (×2,6). Le geste
  était bon, sa raison écrite ne l'était pas. Le LOD
  **automatique** est juste pour un effet qui mappe le scan sur le cadre
  (`texture`), et FAUX pour un effet qui lit en espace TEXEL : `inkTexture` a un
  pas exprimé en texels du scan et un `fract` discontinu, donc la dérivée d'écran
  y explose à chaque couture de tuile et le matériel choisit le mip le plus
  petit. Il force donc `textureSampleLevel(..., 0.0)`.
  ⚠️ Mesuré en l'introduisant : sans ce forçage, `effet-halftone-encre` dérive de
  **max 255, moyenne 57,7** — un seuil transforme un lissage discret en bascule
  binaire. Et le défaut inverse, l'ABSENCE de mipmaps, n'était détectable par
  AUCUN test : un `createTexture` sans `mipLevelCount` compile, valide, rend une
  image correcte, et les références ont été figées avec lui. Un test compare à ce
  qui existe, jamais à ce qui serait possible.

## Commandes

- Dev : `npm run tauri dev` (lance Vite + la fenêtre native, tout-en-un)
- Build frontend seul : `npm run build` (tsc + vite build)
- Tests unitaires : `npm run test` (Vitest, projet `unit` uniquement)
- **Un seul fichier / un seul test** : `npx vitest run --project=unit test/ui/transform.test.ts`
  · filtrer par nom : `npx vitest run --project=unit -t "nom du test"`.
  Toujours passer `--project=unit` (sinon les deux projets démarrent, dont le
  navigateur Playwright).
- Tests de stories : `npm run test-storybook` (Vitest + Playwright chromium, projet `storybook`) · `npm run test:all` pour les deux · `npm run coverage` (v8, projet storybook)
  ⚠️ **Après tout changement de LAYOUT — grille de ligne, piste, padding, hauteur —
  lancer `test-storybook` EN ENTIER avant de committer.** Un changement de grille
  se voit à TROIS échelles, et chacune a son fichier de stories : le composant
  (`LayerPanel.stories.tsx`), la carte et la colonne
  (`dockedPanel/PanelColumn.stories.tsx`). Filtrer sur le fichier qu'on vient
  d'éditer sert à ITÉRER vite, jamais à valider. Payé le 2026-08-16 : l'ajout
  d'une piste à la ligne a laissé `FiveRowDocumentHidesNoRow` — l'une des DEUX
  gardes que l'ADR-0001 nomme pour son point 6 — rouge sur `master` une journée
  entière, parce que seul `LayerPanel.stories.tsx` a été relancé.
- Shaders GPU : `node scripts/gpu-shader-check.mjs --origin http://localhost:1421` — prouve que les shaders COMPILENT. ⚠️ **`npm run test:gpu-shaders` SANS `--origin` compile les modules FIGÉS en cache de la fenêtre, pas ton édition** : vert ET rouge faux (un `import()` d'une URL déjà évaluée rend l'instance en cache). Même prérequis Vite que `test:render` ci-dessous. Avec `--origin`, la page CDP n'est qu'un HÔTE DE GPU — n'importe laquelle fait l'affaire, y compris celle d'un autre projet. ⚠️ **Le port CDP n'est pas forcément libre** : il a été trouvé tenu par Ableton Live le 2026-08-18, qui expose son propre CEF sur 9222. Les DEUX gates prennent désormais `--port` (ajouté à `gpu-shader-check` ce jour-là, `render-check` l'avait déjà) — lancer l'app avec `--remote-debugging-port=<port>` et le passer aux deux, plutôt que fermer le programme fautif.
- Non-régression du **rendu** : `npm run test:render` (`scripts/render-check.mjs`) — prouve que le pipeline produit les MÊMES PIXELS qu'avant. Prérequis : l'app tourne avec le port CDP 9222, ET un Vite du worktree courant sur 1421 (`npx vite --port 1421`). Références versionnées dans `test/render-refs/` ; `--update` les réécrit (les relire à l'œil avant de committer), `--diagnostic` mesure la dépendance à l'horloge de la surface de présentation. Lit les pixels de `Renderer.exportFrame()`, jamais une capture d'écran — voir l'en-tête du script pour pourquoi.
  ⚠️ **Un PNG de référence a DEUX points d'enregistrement, dans le MÊME commit** :
  son scénario dans `render-check.mjs` ET la table `ATTENDU` de
  `test/scripts/renderRefs.test.mjs`. Payé le 2026-08-20 : la paire miroir
  committée sans l'entrée ATTENDU a laissé `npm run test` rouge sur master une
  journée — aucun autre gate ne voit l'omission.
- Validation **statique** du WGSL, sans GPU : `npm run test:wgsl`
  (`test/render/wgslNaga.test.ts`, aussi inclus dans `npm run test`). Prérequis :
  `cargo install naga-cli --locked`. **Seul gate de shader qui tourne en CI** ; il
  ne remplace pas `test:gpu-shaders` — naga valide la SPEC, pas ce que Dawn puis
  le JIT du pilote accepteront.
  ⚠️ **IL EST VERT, EXCEPTION COMPRISE** — mesuré le 2026-08-16 en local ET dans
  la CI (`npm run test`, 128 fichiers, run `31895619303`). Ce paragraphe a dit
  « IL EST ROUGE … cette exception **n'est pas implémentée** » du 2026-08-14 au
  2026-08-16, et c'était faux : `ECART_CONNU_PARAMS` est dans le fichier de test
  **depuis son tout premier commit** (`677a39d`, `wgslNaga.test.ts:73`). La
  dérogation est déjà BORNÉE — elle ne tolère l'erreur que sur la variable
  `params`, et une SECONDE erreur, quelle qu'elle soit, l'annule. ✅ Elle est
  **COMPTÉE depuis le 2026-08-16** (attendu dérivé, `tolerees === liste.length`,
  jamais un littéral qui se périmerait au prochain effet), et
  `seulementEcartConnu` est exportée et testée sur cinq sorties écrites à la
  main.
  ⚠️ **`naga` COLORE SA SORTIE MÊME DERRIÈRE UN TUYAU** (`stdio: "pipe"`), et ça
  rendait la dérogation INERTE : sa borne « une seule erreur » repose sur
  `/^error:/gm`, et les codes ANSI en tête de ligne font que l'ancre ne matche
  AUCUNE ligne. Le gate rougissait donc sur l'écart qu'il tolère — **sous Bash
  seulement**, PowerShell et la CI ne colorant pas. Un gate dont le verdict
  dépend du terminal qui le lance donne raison au dernier qui l'a lancé : la
  sortie est désormais déminée par `sansAnsi()` à l'entrée. Trouvé en éprouvant
  le compteur, pas en lançant le gate.
  Ce qu'elle laisse passer : notre uniform `params: array<f32, 48>` n'est pas
  conforme (stride 4 pour un alignement requis de 16 en espace uniform), Dawn
  l'accepte quand même, et corriger toucherait chaque accès `params[N]` des 26
  effets, index gelés par les presets ET par **121** références de pixels
  (123 PNG dans `test/render-refs/` au 2026-08-21 ; les DEUX qui ne gèlent PAS
  un index, `photo-miroir-temoin` / `photo-miroir`, gèlent le miroir du calque
  photo, donc le compte qui gèle les index est 123 − 2 = 121. ⚠️ **−3 le
  2026-08-21** : les trois références d'`emboss` (`effet-emboss`, `-oppose`,
  `-sur-image`) sont parties avec l'effet retiré (ADR-0019), et le revert de
  `noise` le même jour a défait ses 2. Historique : 126 PNG au 2026-08-20, 124
  gelantes — re-compté le 2026-08-19 au soir : 122 plus la paire
  `masque-feather-fort-temoin` / `masque-feather-fort`, la mire qui MONTRE le
  profil en S du feather ; les trois du relevé Affinity du même jour étaient
  `effet-lens-blur-bokeh-courbe`, `effet-glow-retenue-temoin`,
  `effet-glow-retenue`).
  ⚠️ **Compter les scénarios par un grep sur les clés littérales SOUS-COMPTE de
  quatre** : les quatre trames de `dither` sont générées par un
  `Object.fromEntries([...].map(...))` étalé (`render-check.mjs:1095-1099`), pas
  écrites en clés. Le seul comptage fiable est indépendant de la syntaxe — partir
  des PNG et vérifier que chaque nom est cité dans le script.
  ✅ **La CI est VERTE depuis le 2026-08-16** (run `31986492689`), après 60+ runs
  rouges d'affilée. Le rouge n'a JAMAIS été ce gate : c'était
  `LayerPanel.stories.tsx`, pour une raison sans rapport — voir le § CI ci-dessous
  et le ticket 22.
  ⚠️ **Sa borne était pourtant inerte, et personne ne l'avait vu** : `naga` colore
  sa sortie même derrière un tuyau, donc l'ancre `/^error:/gm` ne matchait aucune
  ligne et la tolérance rendait faux. **Le verdict du gate dépendait du SHELL** —
  vert sous PowerShell et en CI, rouge sous Bash. Déminé par `sansAnsi()` à
  l'entrée, une fois. Toute sortie d'outil externe se démine avant d'être parsée :
  `stdio: "pipe"` ne suffit pas, beaucoup d'outils Rust regardent `CLICOLOR`/`TERM`
  et pas le TTY.
  **Leçon** : attribuer un rouge de CI se fait par `gh run view --log-failed`, pas
  par déduction depuis le gate qu'on vient d'ajouter. Trois commits de docs ont
  porté la mauvaise cause, dont un intitulé « un gate annoncé vert qui est rouge ».
- Cadence en build de **PRODUCTION**, pendant un vrai geste :
  `node scripts/perf-probe.mjs bench <curseur> [passes] [pas] [ms]`
  (`etat`, `sliders`, `add-effect`, `choisir`, `poser` montent la scène).
  L'app se lance alors en RELEASE avec la photo en ARGUMENT — le pont de debug
  n'existe pas en production, donc `openByPath` non plus, et c'est
  `get_launch_path` qui ouvre le fichier. La sonde **refuse de mesurer** si le
  pont de debug est présent : un chiffre de dev serait relu comme un chiffre de
  prod six mois plus tard. Elle compte les images RÉELLEMENT présentées
  (`GPUCanvasContext.getCurrentTexture`) — pas les tics de `requestAnimationFrame`,
  qui suivent l'ÉCRAN et non le rendu, ni le compteur `Frames` de
  `Performance.getMetrics`, qui compte les frames du DOCUMENT et rend un delta
  de zéro. Elle attend en actif sous 12 ms, sinon `setTimeout` plafonne à
  ~63 événements/s sur Windows et ce plafond se lit comme une mesure.
- Chronométrage **GPU par passe** : `__shaderlabDebug.capturerTimingGpu()`
  (`src/render/gpuTiming.ts`, dev seulement). ⚠️ Il **n'ordonne aucun rendu** —
  armer, PUIS provoquer un vrai geste, sinon on mesure une frame fabriquée par la
  sonde. `frameDiagnostics` rend `jsEncodeMs`, un temps d'ENCODAGE JS qui peut
  afficher 2 ms pendant que le GPU en passe 60 : les deux ne mesurent pas la même
  chose.
- Type-check : `npx tsc --noEmit`
- Lint : `npm run lint` (eslint, couvre `src/**/*.{ts,tsx}`)
- Lint tokens design : `npm run lint:tokens` (`scripts/lint-tokens.mjs`) — deux règles distinctes : valeurs en dur qui contournent un token EXISTANT, et depuis le 2026-08-18 **tokens jamais DÉCLARÉS**. La seconde attrape la panne la plus silencieuse : une variable CSS absente rend la déclaration invalide et la propriété simplement ignorée, sans erreur ni avertissement. `--icon-size-xs` et `--disabled-opacity` étaient dans ce cas, le second lu par SIX feuilles — tout état désactivé se rendait exactement comme un état actif. ⚠️ En l'ajoutant, la table de tokens du linter s'est révélée **incomplète depuis toujours** : elle lisait les fichiers de design commentaires compris, et son `[^;]+` traversant les sauts de ligne, un `--token` cité dans un commentaire ouvrait une déclaration fantôme qui avalait la VRAIE déclaration suivante.
- **Commentaires CSS** : `npm run lint:css-comments` (`scripts/css-comment-guard.mjs`).
  ⚠️ **Piège payé TROIS fois le 2026-08-16, dans le même fichier et la même
  session** : éditer un bloc de commentaire en insérant de la prose APRÈS son
  `*/`, puis en refermant par un second `*/`. **Compter les délimiteurs ne le
  voit pas** — le total reste équilibré (mesuré : 53 contre 53). Rien d'autre ne
  l'attrape : `lint:tokens` ne parse pas le CSS, `tsc` ne le voit pas.
  Et **le symptôme ne nomme jamais la cause** : Vite rend
  `Pre-transform error: Unterminated string: 'est la variante C'` — l'apostrophe
  d'un « c'est » situé plus bas — puis **continue de servir l'ANCIEN CSS**. Une
  mesure dans l'app rapporte donc les valeurs d'avant l'édition, ce qui a fait
  chercher un problème de spécificité sur une règle jamais chargée. La garde
  balaye à un seul état et signale toute fermeture ORPHELINE, avec sa ligne.
- Rust : `cd src-tauri && cargo check`
- Storybook (composants React isolés, tokens réels via `src/design/index.css`) : `npm run storybook` (dev, port 6006) · `npm run build-storybook` (static)

**CI** (`.github/workflows/test.yml`, ubuntu) : `npm ci` → `npx playwright
install --with-deps chromium` → `cargo install naga-cli` (avec cache) →
`npm run test` → `npm run test-storybook`. Les tests GPU/rendu ne tournent PAS en
CI (pas de GPU) — ce sont des gates locales. **La seule exception est
`test:wgsl`** (ci-dessus), qui valide le WGSL en CPU pur et tourne donc là-bas.

⚠️ **REPRODUIRE LA CI EN LOCAL SE FAIT EN VIDANT LE CACHE DE PRÉ-BUNDLING, pas en
cherchant une différence d'OS.** La CI tourne TOUJOURS à froid (`npm ci` sur une
machine neuve) ; en local le cache est chaud dès la deuxième exécution, et cet
écart-là suffit à faire diverger les deux.

```powershell
Remove-Item -Recurse -Force node_modules\.cache\storybook, node_modules\.vite
npm run test-storybook
```

Payé deux semaines (2026-08-01 → 08-16, ticket 22) : `LayerPanel.stories.tsx`
échouait en CI et passait en local sur `Cannot read properties of null (reading
'useMemo')`, avec `renderWithHooks` dans la pile — la signature manuelle du
DOUBLE React. Il n'y en avait qu'un. Vite découvrait `react/jsx-dev-runtime` en
cours d'exécution, ré-optimisait et **rechargeait la page** : l'arbre React était
détruit en plein rendu. Corrigé par une ligne d'`optimizeDeps.include`.
**Toute dépendance découverte en cours de route doit y être déclarée** — Vite le
dit lui-même (`For a stable experience, please add mentioned dependencies…`),
mais seulement sur un run à froid, et le message ne contient ni `FAIL` ni
`Error` : un log de CI filtré sur ces mots-là ne le montre jamais.

**Hook pre-commit** : source versionnée dans `scripts/hooks/pre-commit`, à
installer à la main après un clone (`cp` vers `$(git rev-parse
--git-common-dir)/hooks/`, instructions en tête du fichier). Aujourd'hui
**non bloquant** (`BLOCKING=0`) : il affiche les erreurs ESLint et laisse
passer. ⚠️ **En worktree il ne trouve pas `node_modules/.bin/eslint` et saute
le lint en silence** — `npm run lint` y tourne pourtant (résolution par
répertoires parents) : le lancer soi-même avant commit. Les worktrees
partagent `.git/hooks`, une seule installation couvre tout le dépôt.

## Architecture

**`ARCHITECTURE.md` (racine) est la carte détaillée** — couches réelles, module maps Presets et Double exposure, ports de
test, risques ouverts. La lire avant toute modification structurelle plutôt que
de redécouvrir depuis les fichiers. Elle signale elle-même ses sections
périmées (ex. la table des bindings du groupe 0, à recompter dans
`shaderCompose.ts`).

Six couches, dépendances strictement descendantes :

```
src-tauri/src/lib.rs      coquille Rust, ~17 commandes IPC maison
        ▲                 (aucun plugin fs/dialog — voir bug plugin-dialog)
src/launch.ts             wrappers typés, une fonction = une commande
        ▲
src/App.tsx               COMPOSITION ROOT — refs GPU/renderer/session,
        │                 state UI, tous les handlers
   ┌────┴────┬──────────┬──────────┐
application/  render/    mask/      export/
DocumentSession Renderer MaskPainter exportImage
   └────┬────┴──────────┴──────────┘
src/layers/               MODÈLE PARTAGÉ — LayerStack · History ·
                          displayProjection · types
```

Points structurants qu'on ne devine pas en lisant un fichier isolé :
- **`LayerState` (`src/layers/types.ts`) est le type pivot** : consommé par
  `render/`, `mask/`, `export/`, `components/`, `application/`. Il ne dépend que
  de `mask/types`.
- **`Renderer` n'encode plus le rendu** — c'est un assembleur de cycle de vie.
  Le travail réel est chez `FramePipelineExecutor` (boucle par calque,
  ping-pong), `EffectPassRunner` (une passe), `shaderCompose` (la chaîne WGSL
  **est** la clé de cache), `ImageFrameResources`, `MaskTextureResolver`. Les
  trois ports de `framePipelineExecutor.ts` sont la frontière de test la plus
  utile de la couche rendu — toute extension du pipeline doit la préserver.
- **`DocumentSession`** (`src/application/`) est le bon point d'entrée pour
  toute opération document-level, y compris presets et calque photo. Il expose
  deux vues : `layers()` (complet, pour le GPU) et `displayLayers()`
  (projection sans raster, pour React — c'est l'invariant anti-OOM).
  ⚠️ **`replaceLiveLayers` est la porte que les gardes de `LayerStack` NE
  COUVRENT PAS.** `LayerStack` refuse **seize** opérations sur un calque
  verrouillé — réparties entre **QUATRE verrous** depuis le 2026-08-19 :
  `isLocked` (structure : effet, ordre, suppression), `refuseGeometrie`,
  `refuseMasque`. (Dix-sept jusqu'au 2026-08-21 : `setLayerClip` est parti avec
  l'écrêtage, ADR-0020. Compte RE-MESURÉ sur les sites d'appel, pas décrémenté
  de tête.) ⚠️ Le verrou de TRANSPARENCE ne vit même
  pas là : il **ÉCRÊTE au lieu de refuser**, donc il est dans `MaskPainter`, sur
  le chemin réel du pinceau vivant. **`grep isLocked` ne donne donc plus la
  liste complète des refus** — lire les quatre gardes, et
  `layers/layerLocks.ts`, seul endroit où « `all` implique les autres » est
  écrit. Mais AUCUN geste vivant ne passe par
  ses mutateurs : pendant un glissement, `App.tsx` construit le tableau à la main
  et appelle `replaceLiveLayers`, délibérément (`clone()` re-rend la liste
  entière, 34,2 ms de CPU par `pointermove`). Le verrou fuyait donc par là, et le
  commit ne rattrapait rien puisqu'il commite l'état vivant déjà modifié.
  **Toute règle métier posée sur `LayerStack` doit s'exprimer AUSSI sur cette
  porte**, sinon elle ne protège que ce que personne ne fait.
  ⚠️ **`replaceLiveLayers` NE REDEMANDE AUCUN RENDU**, et c'est la seconde
  chausse-trappe de cette porte. Il pose l'état vivant, rien de plus : tout
  chemin vivant doit l'APPAIRER avec `rendererRef.current?.requestRender(...)`,
  comme `handleOpacityChange` le fait depuis toujours. Sans l'appairage, le
  modèle change et l'écran ne repeint jamais — défaut livré le 2026-08-21 sur
  l'aperçu de fusion au survol, invisible à tous les gates (aucun test ne
  regarde le canvas présenté) et signalé par Antoine devant l'app. ⚠️ Et il a
  résisté à DEUX sondes : `frameSignature()` re-rend la pile lui-même, donc il
  voit la mutation du modèle et ne peut rien dire du canvas. Le seul témoin
  honnête est le compte de frames RÉELLEMENT présentées
  (`GPUCanvasContext.getCurrentTexture`).
- **L'espace de coordonnées du masque est celui de la photo de fond**
  (`MaskPainter` alloue aux dimensions de l'image de base), jamais celui d'une
  source d'image transformée.
- **`components/` ne contient aucune logique métier** : aucun composant ne
  connaît `LayerStack` ni le renderer, tous les handlers viennent d'`App.tsx`.
  Cette frontière ne doit pas bouger pour ajouter une carte au dock.
- `exportImage.ts` définit ses propres ports d'IO et se teste avec des doubles :
  **c'est le patron à reproduire** pour toute nouvelle persistance, pas à
  réinventer.

## Décisions (ADR)

`.claude/decisions/INDEX.md` — une ligne par ADR avec son statut. Un ADR
`superseded` (ADR-0003, renversé par ADR-0004) n'est PAS une contrainte active.
Actifs (ADR-0020 est le dernier écrit, 2026-08-21) : densité UI (0001),
abandon round-trip (0002), sens causal
de la pile (0004), rattachement par proximité (0005, ⚠️ son point 2 —
« l'écrêtage garde la priorité » — est CADUC depuis ADR-0020 : la proximité est
seule), fond d'export blanc
(0006), format de toile à la création + `MAX_CANVAS_PIXELS = 64 Mpx` (0007),
un effet ne se pose jamais sur un calque photo (0008), déplacement libre du
viewport (0009), le gaussien reste hors du registre (0010, ⚠️ sa 3ᵉ conséquence
est caduque), retrait de `surfaceBlur` (0011), retrait de `posterize` (0012),
`outlines` absorbe `coloredEdges` (0013), `lensDistortion` absorbe
`anamorphicStreak` (0014), `outlines` absorbe `echoOutlines` (0015),
`lensDistortion` absorbe `chromaticBleed` (0016), `lensFlare` rouvre la famille
des halos (0017), la texture de bibliothèque (0018), retrait de `emboss` (0019),
**retrait de l'ÉCRÊTAGE (0020)**.

⚠️ **L'ÉCRÊTAGE N'EXISTE PLUS** (ADR-0020, 2026-08-21, retrait SEC). La case
« Écrêter sur la photo du dessus », `LayerState.clipToBelow`, `layers/clipping.ts`,
`LayerStack.setLayerClip`, l'option `clipToCoverage` de `shaderCompose` et la
flèche coudée de la ligne sont partis ensemble. Ne pas les citer comme existants,
et ne pas reproposer la case : le libellé contredisait le modèle (« du dessus »
contre « en dessous », les deux vrais dans leur repère depuis qu'ADR-0004 a
inversé l'affichage) ET le geste ne servait pas. **Ce qui est PERDU et n'a aucun
équivalent : borner un effet à la COUVERTURE d'une photo** — les sources de
masque sont une union fermée (`gradient · luminosity · colorRange`), aucune
géométrique. Ça se retrouvera par la sélection géométrique du ticket 11, par un
MASQUE, jamais par une case. Le binding 6 (`coverageTexture`) et le chemin
`hasImageSource` de la double exposure sont INTACTS — ils partageaient le binding,
ils ne partageaient rien d'autre.

⚠️ Cette liste a dit « ADR-0017 reste le dernier écrit » jusqu'au 2026-08-15
alors qu'ADR-0018 était sur disque **et cité deux fois plus haut dans ce même
fichier**. Rien ne relit cette phrase — la tenir fait partie du geste qui écrit
un ADR. ⚠️ Et son titre (« la texture est un effet, pas un calque photo ») dit
l'inverse de ce que `docs/ROADMAP.md` rapporte comme arbitrage d'Antoine (« une
texture est un calque photo, tel quel ») : contradiction ouverte, à trancher.
Les décisions du
projet vivent là, pas dans les docs de design.

## Méthode

- Exécution en cours via `superpowers:subagent-driven-development` : un
  sous-agent frais par tâche du plan, revue spec+qualité après chaque tâche,
  fixes puis re-revue, ledger dans `.superpowers/sdd/progress.md`. **Vérifier
  le ledger avant de (re)dispatcher quoi que ce soit.**
  ⚠️ **Les skills `superpowers:*` ne sont PAS forcément installées** — elles
  étaient absentes le 2026-07-31 (seuls `caveman` et `claude-plugins-official`
  dans `~/.claude/plugins/cache`). Le ledger et `docs/superpowers/` restent
  lisibles, mais la méthode n'est pas exécutable dans cet état : le vérifier
  avant de s'y référer, plutôt que de découvrir l'absence en plein dispatch.
  Sans elles, annoncer le découpage et le faire valider à la main — une tranche
  qui touche le modèle jusqu'au shader mérite un plan, skill ou pas.
- **Avant tout dispatch `subagent-driven-development`, lancer `git worktree
  list`** : plusieurs sessions concurrentes ont déjà collisionné sur ce repo
  (2026-07-13, Task 7 du plan design system — un implémenteur bloqué en
  pleine tâche par une mutation filesystem d'une autre session active sur la
  même branche). Le fix a été d'isoler chaque ligne de travail dans son
  propre worktree (`git worktree add`) — vérifier ceci en amont plutôt que
  de le découvrir après coup. Voir la mémoire projet
  `design-system-branch-reconciliation` pour l'état des lignes en cours.
- **Les sous-agents sont headless** : ils ne peuvent PAS vérifier
  visuellement une fenêtre (leçon Task 1 : un implémenteur a pris la ligne
  "Waiting for frontend dev server" pour une preuve de compilation Rust).
  Toute vérification visuelle passe par un checkpoint humain (décision
  utilisateur : c'est lui qui juge, pas de capture computer-use).
  ⚠️ Essayé et confirmé inefficace (2026-07-13) : `computer-use` ne peut pas
  cibler `shaderlab.exe` car ce n'est pas une app enregistrée au menu
  Démarrer (build dev) — créer un raccourci `.lnk` temporaire dans le menu
  Démarrer ne suffit pas, le résolveur d'apps de computer-use ne le détecte
  pas. Ne pas retenter cette piste ; le checkpoint humain reste la seule
  voie fiable.
- Leçon Task 1 : scaffold Tauri écrit à la main = risque élevé de mélange
  v1/v2 (`shell-open` n'existe plus en v2 ; structure officielle =
  main.rs shim + lib.rs run(), pas l'inverse ; `tauri-build` exige
  `icons/icon.ico` même pour un simple `cargo check`).
- `tauri::generate_context!()` exige que `frontendDist` (`../dist`) existe
  sur disque même pour `cargo check` — lancer `npm run build` d'abord si
  dist/ manque.
- Même philosophie que Sift/track-finder : détective, fail-fast, pas de
  fallback silencieux ; TDD sur la logique pure ; le rendu GPU se vérifie
  visuellement, pas unitairement.
- **Raccourci** : `npm run dev:debug` (= `scripts/dev.ps1`) tue le process
  `shaderlab.exe` restant (sinon `cargo build` échoue avec "Accès refusé"),
  lance `tauri dev` en arrière-plan via PowerShell, active CDP et écrit les
  sorties dans `.dev-logs/`. L'agent lance ensuite `npm run dev:monitor` pour
  suivre Tauri, Vite, `console.*` et les exceptions WebView2. La variante
  `npm run dev:debug:follow` combine lancement et suivi interactif.
  ⚠️ Ce script tue TOUT process nommé `shaderlab` sur la machine
  (`Get-Process -Name shaderlab | Stop-Process -Force`), pas seulement celui
  du worktree courant — si une autre session/worktree a sa propre instance
  en cours, ce script la tue aussi sans prévenir. Vérifier
  `Get-Process -Name shaderlab` avant de lancer `dev:debug` si plusieurs
  lignes de travail sont actives en parallèle (voir la note worktree
  ci-dessus).
  ⚠️ `Get-Process -Name shaderlab` absent ne suffit PAS à garantir une
  fenêtre fraîche : tuer le process Vite (port 1420, souvent `node.exe`,
  pas `shaderlab.exe`) d'une session concurrente ne tue pas forcément la
  fenêtre WebView2 elle-même — elle peut rester vivante, connectable en CDP,
  avec un état de session antérieur (document/calques chargés) intact.
  Vérifier `Get-NetTCPConnection -LocalPort 1420` ET l'état réel de la page
  via CDP (`document.body.innerText`) avant de relancer `dev:debug`/`tauri
  dev`, et confirmer avec Antoine avant d'écraser un état qu'on n'a pas
  soi-même produit (2026-07-25, session double exposure).
- **Autonomie terminal de Claude** : Claude est autorisé à lancer lui-même les
  commandes PowerShell nécessaires au développement, aux tests, au diagnostic
  et au monitoring dans ce repo. Ne pas demander à l'utilisateur de recopier
  une commande ou de lire une console lorsque l'agent peut le faire localement.
  Les opérations destructrices ou extérieures au repo gardent les règles de
  confirmation normales.
- **Boucle de monitoring obligatoire** : après lancement, vérifier le PID et
  lire la sortie réelle avec `npm run dev:monitor`. Ne pas conclure au succès
  sur la seule présence du processus. En cas d'erreur, citer le log pertinent,
  corriger, relancer puis surveiller à nouveau.
- **Logs de `npm run tauri dev` en tâche de fond vides tant que le process
  tourne** (bug de buffering stdout sur ce Git Bash Windows, rencontré aussi
  sur d'autres projets) : ne pas insister à relire le fichier de log avec
  `tail`/`cat`, passer directement à une vérification par liste de process
  (`Get-Process shaderlab`) ou par CDP (ci-dessous).
- **Debug console/DOM sans computer-use** (technique reprise de Sift) :
  lancer `tauri dev` avec `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
  en variable d'env (jamais dans `tauri.conf.json` — fuiterait en prod et
  casserait les args par défaut de wry), puis se connecter en WebSocket brut
  (Node a un `WebSocket` global, pas besoin du package `ws`) à
  `ws://localhost:9222/devtools/page/<id>` (liste des cibles sur
  `http://localhost:9222/json`). Permet `Runtime.evaluate` (état DOM, clic
  de bouton réel via `document.querySelector`, invoke direct de
  `window.__TAURI_INTERNALS__.invoke('cmd')`) et capture des
  `Runtime.consoleAPICalled`/`Runtime.exceptionThrown`. A servi à diagnostiquer
  précisément un invoke qui restait bloqué sans throw ni log (voir bug
  `@tauri-apps/plugin-dialog` ci-dessous) — bien plus fiable que deviner
  depuis des captures d'écran. Outil prêt : `scripts/cdp-console.mjs`.
  ⚠️ Limite connue (2026-07-13) : `Input.dispatchMouseEvent` (CDP) ne peut
  PAS déclencher un vrai drag HTML5 natif — `dragstart` ne se lève que sur
  un vrai geste OS de drag, pas sur des événements souris synthétiques.
  Deux tentatives d'agent ont conclu à tort "non reproductible" sur un bug
  de drag-and-drop réel à cause de cette limite. Pour observer un vrai drag
  sans le simuler : injecter un listener passif
  (`document.addEventListener(type, handler, true)` poussant dans une
  variable globale) via `Runtime.evaluate`, demander à l'humain de faire le
  geste réel, puis relire la variable après coup.
- **`@tauri-apps/plugin-dialog` bug connu** : son `open()` peut rester
  bloqué indéfiniment (jamais résolu ni rejeté, aucune fenêtre native ne
  s'ouvre) — classe de bug IPC connue de l'écosystème Tauri
  (tauri-apps/plugins-workspace#571). Contourné en appelant `rfd`
  directement via notre propre commande Rust (`pick_image_file`), même
  pattern que `get_launch_path`/`read_image_file` qui, eux, marchaient déjà.
  Si un futur besoin de dialogue (dossier, sauvegarde...) refait surface,
  ne PAS reprendre `tauri-plugin-dialog` sans revalider ce point d'abord.

## Moyen de preuve (UI) — déclaré (règle CLAUDE.md global)
**Playwright headless est INADAPTÉ ici** : le canvas WebGPU en WebView2 rend noir
en headless (aucun rendu GPU) — un screenshot Playwright serait un œil aveugle qui
dit « vu ». **Preuve UI = CDP sur la vraie fenêtre WebView2**
(`--remote-debugging-port=9222`, voir Méthode ci-dessus). Le screenshot Playwright
vaut seulement pour les stories sans canvas GPU (projet `storybook`, qui lui
tourne bien en headless chromium).

✅ **AMENDÉ le 2026-08-05 : un agent PEUT voir le rendu, le checkpoint humain
n'est plus la seule voie.** `Page.captureScreenshot` par CDP sur la vraie fenêtre
capture le canvas WebGPU — vérifié, une PNG 3440×1377 où la photo, l'effet
appliqué et le dock sont tous lisibles. Ce paragraphe disait « + checkpoint
visuel humain » comme s'il était obligatoire ; il ne l'est que pour le JUGEMENT
(est-ce beau), plus pour le CONSTAT (est-ce rendu).

⚠️ Une capture se MESURE, elle ne se suppose pas : une PNG de 300 Ko entièrement
noire a l'air d'une réussite jusqu'à ce qu'on l'ouvre. Le pilote rapporte
moyenne et écart-type ; un écart sous 1 signale un aplat.

**Outillage** : `/run-shaderlab` (`.claude/skills/run-shaderlab/`) — lancement
avec le port CDP, puis un pilote qui ouvre une photo, ajoute un effet, pose un
curseur, capture et mesure. Il porte aussi les pièges de sonde vérifiés : lire
les pixels par `drawImage` du canvas rend du NOIR hors frame (passer par
`Renderer.exportFrame()`), et patcher `window.__TAURI_INTERNALS__.invoke`
n'intercepte rien (les modules importent `invoke` depuis `@tauri-apps/api/core`,
une autre référence).

## Moyen de preuve (EFFETS) — un verrou aveugle ne verrouille rien

**Un verrou de pixels (`npm run test:render`) ne vaut que si sa mire peut
MONTRER la propriété que l'effet prétend porter.** Avant d'écrire la référence
d'un effet, se demander ce qui le distingue de sa version naïve, puis vérifier
que la mire peut le montrer. Si elle ne le peut pas, **écrire la mire d'abord**.

Cette règle a été payée le 2026-08-01 : `lensBlur` avait **dix-sept tests
unitaires verts** en floutant au DOUBLE du rayon réglé et en rendant des nuées
granuleuses au lieu d'hexagones. Son premier scénario était posé sur la mire
commune, qui n'a aucun point lumineux isolé — or une tache de bokeh ne se lit
que sur un petit point brillant contre du sombre. Sous un damier, un lens blur
rend exactement ce que rendrait un gaussien : le verrou verrouillait du bruit.
Trois mires ont dû être écrites dans la journée (`mireBokeh`, `mireRampe`,
`mireBruit` — voir `scripts/render-check.mjs`), et les trois ont trouvé un
défaut à leur première exécution.

Corollaire : **le verrou sert aussi à rendre un refactor prouvable**. `outlines`
n'avait aucune référence ; en poser une AVANT d'extraire son gradient de Scharr
vers `effects/edgeGradient.ts` a transformé « ça devrait être neutre » en
`aucun écart`. Poser la preuve avant le geste, pas après.

**Un CLASSEMENT par coût ne donne pas la CAUSE du coût.** Payé le 2026-08-15 :
le temps GPU de `glass` a été relevé pour les quatorze matières (facteur 7,
Dépoli 15,5 ms contre Pavé quadrillé 108,3 ms), et j'en ai conclu que la fonction
de matière — évaluée trois fois par pixel en différences finies — était le poste
dominant. **L'ablation `Creux` prise la veille dit le contraire** : à déplacement
nul, un pavé coûte exactement ce que coûte une feuille (66,9 contre 67,6
images/s). La géométrie est gratuite ; c'est la cohérence de cache qui coûte,
une lecture dispersée valant ~25 fois une lecture cohérente.

Trier ce qui est cher est convaincant et ne prouve rien — **seule une ablation,
un facteur à la fois, désigne une cause**. Conséquence directe : une piste
d'optimisation ALU (dérivées analytiques, 9 appels de bruit ramenés à 3) a été
écrite, mesurée à 8 % de gain dans le bruit contre dix-huit références déplacées,
puis reverté. On ne réduit pas un coût de cache en retirant des multiplications.
Détail et protocoles : `.scratch/prochain-palier/issues/19-le-cout-du-verre.md`.

## Risques ouverts / gates

- VRAM : ~96 Mo par texture RGBA 24MP, multiplié par ping-pong + masques —
  à mesurer à l'usage réel, pas de budget théorique figé. Instrument : mesurer
  le *Total Committed* du process GPU de WebView2, pas `nvidia-smi` (qui compte
  tout le GPU). `MAX_CANVAS_PIXELS = 64 Mpx` (ADR-0007) est calibré sur ces
  mesures.

La dépose du round-trip Lightroom figurait ici comme dette ouverte ; elle a été
faite le 2026-07-30 (voir § Quoi).

Deux gates de la phase MVP ont été retirées d'ici le 2026-07-29 : le go/no-go
WebGPU dans WebView2 (Task 2) est levé depuis longtemps — le pipeline rend, les
shaders compilent (`npm run test:gpu-shaders`) et le rendu est verrouillé au
pixel (`npm run test:render`) ; « valider le round-trip avec un vrai
Lightroom » (Task 3) est sans objet, puisqu'on le retire au lieu de le valider.

## Index des documents docs/

**`docs/ROADMAP.md` répond à une seule question : qu'est-ce qui RESTE ?** C'est
le seul document du dépôt qui le dise ; les autres disent ce qui est fait. À
lire au démarrage d'une session de travail, avant de reconstruire un backlog de
tête. Il ne porte pas de section « fait » — un bloc soldé en sort et son
résultat descend dans `INDEX.json`.

`docs/INDEX.json` (référence, ~280 lignes) — À LIRE À LA DEMANDE (Read tool)
quand tu cherches le statut d'un chantier/plan spécifique, PAS importé
automatiquement : un `@import` charge le fichier entier à chaque session,
quel que soit le besoin réel du tour (doublait le poids de ce CLAUDE.md).
⚠️ `docs/INDEX.json` et `.superpowers/sdd/progress.md` ont déjà été pris en
défaut (statuts optimistes vs état réel du code) : vérifier sur disque avant
de conclure qu'une tranche est faite.

`AGENTS.md` (racine) est le document frère, plus long, à destination des agents
en général : il porte l'historique détaillé des tranches et des bugs. Ce
CLAUDE.md est l'entrée courte ; en cas de contradiction, c'est le CODE qui
tranche, puis `ARCHITECTURE.md`.

## Densité de l'UI — règle permanente (ADR-0001)

**Tout élément d'interface ajouté doit passer la checklist de densité AU MOMENT
où il est ajouté**, jamais dans un lot de rattrapage : `.claude/decisions/ADR-0001-densite-ui-controles-repetes.md`.

Résumé : un contrôle qui se répète sur chaque ligne d'une liste devient UN
contrôle unique dans une zone de contrôles fixe, agissant sur l'élément
sélectionné — avec son corollaire indissociable (zone fixe **en-tête OU pied**,
hors du conteneur défilant + liste défilante DANS le panneau + hauteur de
panneau bornée ; jamais un défilement de colonne). La position de la zone n'est
pas contrainte, son unicité et son hors-scroller le sont (amendement
2026-07-28 : la carte Effets la pose en pied). Ligne au-dessus de 56 px hors
sélection = à justifier par écrit ou à réduire.

Cette règle existe parce qu'elle a été enfreinte le jour même où elle a été
posée : le panneau Photo a été livré avant le lot de densité, portant la colonne
à 1613 px pour 1345 px disponibles avec **deux** calques.

**Une marque de sélection est bornée par ce qu'elle sélectionne.** Payé CINQ fois
le 2026-08-16 sur la barre de sélection de la pile. Le filet d'imbrication
appartient au GROUPE : ses segments débordent d'une demi-gouttière en haut et en
bas pour se rejoindre, par construction. Lui faire porter l'état de sélection —
en le colorant, en le prenant pour barre, en l'éclairant jusqu'à la ligne visée —
la fait donc dépasser du cadre quelle que soit la variante. Les cinq corrections
ont toutes mesuré la BARRE, qui était juste à chaque fois ; c'est le FILET qui
dépassait, et aucune story ne le regardait. Corollaire de méthode : **une mesure
garantit qu'on a fait ce qu'on a dit, jamais qu'on visait la bonne chose** — quand
la même pièce revient une troisième fois, arrêter de corriger et chercher la
contrainte structurelle que toutes les tentatives violent.

⚠️ **Le point 6 de la checklist se mesure DÉRIVÉ, jamais contre un seuil écrit en
dur.** Il demande « le nom garde-t-il une largeur LISIBLE ? », et deux seuils
littéraux (170 px dans `AllRowFormsShareOneGrid`, 145 px dans
`FiveRowDocumentHidesNoRow`) ont rougi le 2026-08-16 pour une troncature qui ne
se produit pas : ils étaient calés sur « Aberration chromatique » (127 px), que
le registre ne porte plus. Mesuré ce jour-là, le plus long des 23 libellés est
`Lens distortion`, **79 px**. Les deux stories mesurent désormais le plus long
libellé qu'elles rendent — le garde tient, sans pouvoir se périmer quand les
libellés changent. Seuls les noms de FICHIER restent hors budget : ils tronquent
à toute largeur, leur repli est le `title`.

## Wireframe & tokens
Source de tokens canonique (à viser pour tout wireframe `interface-design`) :
`src/design/primitives.css` + `src/design/semantic.css` + `src/design/components.css`
(vraies valeurs CSS dans `:root`). _Éviter_ comme source de valeurs :
`docs/design-system/tokens.md` et `.interface-design/system.md` (contrat/résumé
d'intention, peut retarder sur le CSS — ex. `--outline-contrast` existe dans
semantic.css mais pas dans tokens.md). Wireframes de feature → `docs/wireframes/<feature>.html`.

## Outillage / routage skills

⚠️ La règle de routage skills (`~/.claude/CLAUDE.md`) et l'inventaire généré
(`~/.claude/skills-view.md`) ont **tous deux été supprimés** par le reset vanilla
du 2026-07-31 (récupérables au tag `pre-reset-vanilla`). Plus de règle globale
opposable ni d'inventaire : s'en tenir aux skills réellement listées par le
harnais. Packs de contexte (sizing) :
`.claude/rules/context-packs.md`. Décisions d'outillage : cycle complet
`superpowers:brainstorming` → `writing-plans` → `subagent-driven-development` ;
audits de spec via sous-agent `general-purpose` adverse ; recherches
techniques via WebSearch avec vérification des licences (webgpu-image-filter
n'a PAS de licence — inspiration seulement, jamais de copie verbatim).

Verdicts projet uniques (delta du registre supprimé, non déjà dans § Méthode) :
- **Modèles par rôle (sizing)** : haiku = transcription de plan / fixes
  mécaniques ; sonnet = spike / intégration / review (haiku a écrit le scaffold
  main de travers en Task 1 → 2 passes de fix ; sonnet clean du premier coup).
- **`interface-design`** : utilisée en mode « direct et concret », PAS l'exercice
  créatif complet (l'exploration de domaine/signature a été jugée hors-sujet le
  2026-07-13 ; reprise directe sur palette/typo calées sur références validées,
  tokens dans `.interface-design/system.md`).

## Agent skills

### Issue tracker

Markdown local : les issues et les specs vivent sous `.scratch/<feature>/`, une issue par fichier. Le remote GitHub existe et `gh` est authentifié, mais le dépôt n'a AUCUNE issue — ne pas retomber sur `gh issue` au prétexte qu'un remote existe. Les specs antérieures (`docs/superpowers/specs/`, `PRD*.md`) restent où elles sont. Voir `docs/agents/issue-tracker.md`.

### Triage labels

Les cinq rôles canoniques, chaînes inchangées (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). Le tracker étant local, poser un label = éditer la ligne `Status:` du fichier d'issue, pas `gh issue edit --add-label`. Voir `docs/agents/triage-labels.md`.

### Domain docs

Single-context : `CONTEXT.md` à la racine, plus DEUX dossiers d'ADR — `.claude/decisions/` (canonique, entrée par son `INDEX.md`, statuts qui comptent) et `docs/adr/` (**5** ADR d'implémentation, non indexés ; le 0003 est `superseded` par le 0005 depuis le 2026-08-16). ⚠️ Numérotations distinctes qui se recouvrent : citer le dossier, jamais un numéro nu. Voir `docs/agents/domain.md`.

### Wayfinder

Chantier trop gros pour une session : `/wayfinder` charte la carte sur le tracker ci-dessus. Le tracker étant LOCAL, la carte est `.scratch/<effort>/map.md` et ses tickets sont des fichiers numérotés sous `issues/` — blocage par une ligne `Blocked by: NN` en tête de fichier, type par `Type: research|prototype|grilling|task`, réclamation par `Status: claimed`. ⚠️ Cette entrée a annoncé « sous-issues et blocage natif GitHub disponibles — pas de repli par convention de corps » jusqu'au 2026-08-12 : **il n'y a ni sous-issue ni blocage natif ici**, et le repli par convention de corps EST le mécanisme (`docs/agents/issue-tracker.md` § Wayfinding operations).

**Carte ACTIVE : `.scratch/hybride-lightroom-photoshop/`** — chartée le
2026-08-18 sur un retour d'usage d'Antoine : atteindre le geste et la lisibilité
d'un hybride Lightroom/Photoshop. Cinq des sept points de son énoncé ont été
corrigés le jour même ; quatre tickets restent (geste de la forme, verrou
binaire, symétrie panneau/toile, layout). Sa recherche a établi que **la
documentation Adobe ne donne AUCUN gabarit chiffré de layout** — descriptive,
jamais dimensionnelle : ce ticket-là se mesure sur notre app, il ne se lit pas.

**Carte ACTIVE : `.scratch/affinity/`** — chartée le 2026-08-19 (« se baser sur
Affinity », « porter nos effets dans Affinity ? », « full scope »). Sa question
principale — **un plugin `.8bf` améliorerait-il les perfs ou la qualité ?** — est
✅ **CLOSE le 2026-08-19, par mesure des deux côtés : non aux deux, et sur les
perfs c'est l'INVERSE** (leur filtre natif le moins cher coûte 136 ms sur
26 Mpx quand notre pile entière à cinq effets recompose en 23 ms). Verdict et
protocole : `docs/design-system/affinity-plugin-verdict-2026-08-19.md`.
⚠️ **Ne pas rouvrir « porter dans Affinity » sans lire ce document d'abord** :
la question a été posée trois fois et a reçu trois réponses différentes, les
deux premières fausses pour la même raison — une absence conclue à l'endroit où
on avait regardé. Reste ouvert et non bloquant : le contrat `.8bf` (ticket 01),
le langage de la texture procédurale (02), et les prises côté interface
(03, 05 à 11).
⚠️ **Méthode imposée par cet effort** : ce qu'on prend d'Affinity se mesure en
BOÎTE NOIRE — piloter leurs filtres par le SDK (`commands.js` en expose une
trentaine), relire les pixels, réimplémenter chez nous. Recopier leur
implémentation embarquée serait du dérivé, pas de l'interopérabilité.

**Carte CLOSE, et toujours la référence des arbitrages rendus :
`.scratch/prochain-palier/`** — le prochain palier (composition, recadrage, lisibilité de l'interface, dormants), 12 tickets dont 3 recherches résolues. Ses `## Notes` portent les contraintes permanentes de l'effort ; `docs/ROADMAP.md` y renvoie. Un arbitrage ouvert se tranche là, pas dans le ROADMAP.
