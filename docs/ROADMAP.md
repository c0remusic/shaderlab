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

- **26 effets** au registre (`src/render/effects/registry.ts`) — `texture` puis
  `lightLeak` le 2026-08-05, `aplat` le 2026-08-17, et la tranche 3 du ticket 12
  le 2026-08-18 : `nettete`, `displacementMap` (`emboss` en faisait partie, RETIRÉ
  le 2026-08-21, ADR-0019). ⚠️ Deux retraits le 2026-08-21, indépendants :
  `emboss` (verdict « relief est horrible ») et `noise`, poussé la veille puis
  reverté (refusé aussi). 28 → 27 → 26. Mesurer sur disque, ne pas recompter.
  ✅ `aplat` (couleur unie bornée par un masque ou une primitive posée) a reçu
  **deux des trois fronts de son upgrade qualité** le 2026-08-17 : remplissage en
  DÉGRADÉ (linéaire et radial, arrêts interpolés en lumière linéaire) et
  POLYGONE (3 à 12 côtés). Écartés par Antoine : contour et rayon d'angle.
  Reste le troisième front — les POIGNÉES —
  [ticket 25](../.scratch/prochain-palier/issues/25-les-poignees-de-l-aplat.md),
  seul à dépendre du chantier des outils sur la toile.
  ✅ Et il se **trace à la souris** depuis le même jour (outil Forme, touche `U`).
  Il était né avec un rectangle réglé à quatre curseurs ; verdict d'Antoine :
  « la pire façon de créer un rectangle ». Un rectangle se trace, les curseurs
  retouchent ce qui existe.
- `glass` **complet** : 14 matières (9 de feuille + 5 de pavé), 5 profils de
  section, **18 références de pixels — toutes les branches verrouillées**.
- **381 paramètres, 124 références de pixels** — re-mesurés le 2026-08-26
  (l'instrument, pas la prose : les « 385 » d'avant portaient encore `emboss` et
  `noise`, retirés le 2026-08-21 ; le +1 param et la +1 référence du 2026-08-26
  sont le mode « L'image en dessous » de `displacementMap`, ticket 22). Ces
  chiffres sont relancés, pas recopiés — deux des chiffres que ce dépôt portait
  en prose étaient déjà faux avant qu'on y touche : 51 conditions au lieu de 52,
  63 gabarits `liste` sur 83 au lieu de 60 sur 84. Le +3 de paramètres du
  2026-08-19 est le relevé Affinity :
  `glow.shadowHold` / `shadowHoldPoint` et `lensBlur.bladeCurvature`. Les +2
  références (122 → 124) sont la paire `masque-feather-fort` qui MONTRE le
  profil en S du feather — les prises masque de l'après-midi ne touchent pas
  `params[]`, elles vivent dans `RefineEdgeParams`, déjà compté.
- **Les 26 effets portent des sections** et leurs applicabilités déclarées
  (`EffectModule.sections`, `EffectParam.appliesWhen`) — chantier de
  rationalisation des contrôles **soldé le 2026-08-05**, statut dans
  `INDEX.json`. Ce qu'il en reste est du jugement, donc dans le bloc 1.
- Tout ce qui avait un plan exécutable est livré, testé, documenté, poussé.

**Il ne reste donc AUCUN code en attente d'un plan existant.** Ce qui suit se
répartit en quatre natures différentes : du jugement humain (1), un chantier
qui a son cadrage mais ni design d'effet ni plan (2), un PRD entier jamais
commencé (3), et des chantiers dormants retrouvés par mesure (4).

---

## ⚠️ TROIS cartes désormais, et la question qui débordait tout est CLOSE

⭐ **`.scratch/affinity/` est chartée le 2026-08-19**, sur quatre relevés faits
dans l'application Affinity et dans ses binaires. Elle portait douze tickets, et
surtout **une question qui débordait tout le reste de cette feuille** :

> **Faire un plugin Affinity améliorerait-il les PERFS de nos effets ? Leur
> QUALITÉ ?**

✅ **RÉPONDUE LE MÊME JOUR, ET C'EST NON AUX DEUX.**
[Ticket 12](../.scratch/affinity/issues/12-plugin-perfs-et-qualite.md), verdict
et protocole complets dans
[`affinity-plugin-verdict`](design-system/affinity-plugin-verdict-2026-08-19.md).

- **PERF — et le résultat est l'INVERSE de l'intuition.** Mesuré sur la même
  photo des deux côtés (26,0 Mpx) : un SEUL filtre natif d'Affinity coûte
  **136 à 565 ms** ; notre pile ENTIÈRE, cinq calques d'effet en build de
  production pendant un vrai glissement, recompose en **23 ms**. Nous sommes
  6 à 25 fois plus rapides que le moteur natif dont on voulait s'approcher.
  L'hypothèse à écarter en premier — les allers-retours CPU↔GPU d'un `.8bf` —
  est confirmée par leur propre plancher de ~140 ms.
  Et la part de l'abstraction dans NOTRE coût : 93 % de fil principal à un
  calque, **43 % à cinq**. Ce qu'un portage natif remplacerait est exactement
  ce qui rétrécit quand le travail augmente.
- **QUALITÉ — le tableau reste juste, la conclusion change.** Affinity a
  `RGB96Mode`, l'ICC, OCIO, le soft proof, les LUT 3D, et exporte en TIFF 16
  bits comme en OpenEXR 32 bits linéaire. **Nous n'avons rien de tout ça.**
  Mais ce gain vient de l'HÔTE, il est atteignable chez nous
  ([ticket 11](../.scratch/affinity/issues/11-debloquer-le-16-bit.md)) pour
  bien moins qu'un `.8bf` — qui nous ferait en plus perdre notre pile, nos
  masques par calque et nos presets.

⚠️ **La réponse « oui, du natif c'est plus rapide » était fausse, et elle
l'était de 6 à 25 fois.** C'est le quatrième raisonnement de tête démenti par la
mesure dans ce fil.

**Ce que la carte a rapporté au passage, et qui est livré** : **QUATRE**
améliorations de nos effets, mesurées en boîte noire chez eux puis
réimplémentées chez nous. Deux le matin — la **courbure des lames** du
diaphragme (`lensBlur`, partagée avec `lensFlare`) et la **retenue des noirs**
du `glow`, qui lui donne enfin le *Black* Pro-Mist que son en-tête citait sans
le rendre. Deux l'après-midi, sur les OUTILS INTERNES (pinceau/masque/
sélection) mesurés au pixel — le **feather en S** (leur profil est un erf, le
nôtre était une rampe box ; livré en une passe par quatre fenêtres pondérées
sur la SAT, cache intact, écart borné par test) et la **morphologie
octogonale** (leur grow est un disque euclidien, notre carré débordait de 41 %
en diagonale ; passes D1/D2 + `octagonRadii`, preuve de Minkowski au test).

**Et l'audit full scope a été REFAIT en v2 l'après-midi**, sur le constat
d'Antoine que la première passe manquait des choses — elle consolidait des
sondages. La v2 balaie six canaux en entier : le SDK JavaScript lu
intégralement (105 fichiers BSD-3), les 22 773 identifiants de
`Serif.Affinity.dll`, l'inventaire vivant de la surface API, les ajustements
du territoire retouche mesurés au pixel. Trois documents chapeau :
[`affinity-audit`](design-system/affinity-audit-2026-08-19.md) (le récap par
axe), [`affinity-code`](design-system/affinity-code-2026-08-19.md) (leur
architecture mappée sur la nôtre — preview transactionnel, commande-valeur,
historique-arbre, spline universelle) et
[`affinity-angles-morts`](design-system/affinity-angles-morts-2026-08-19.md)
(Develop RAW, métadonnées XMP/IPTC/EXIF, scopes vidéo, avant/après…).
**Vingt candidats sans ticket** en sortent, aucun ouvert d'office (la règle
tient : un geste nommé chez nous) — métadonnées d'export et réification du
geste vivant (mort de `replaceLiveLayers`) en tête.

⚠️ **Reste OUVERT à l'arbitrage d'Antoine, créé cet après-midi** : le
**smooth géométrique** (leur `smooth` arrondit la FORME en gardant le bord
net, le nôtre floute tout — c'est une différence de nature, pas de dosage).
Il change le SENS du curseur `smooth` (d'itérations de box à rayon d'arrondi),
donc c'est une décision, pas un correctif — et les passes diagonales D1/D2
dont il a besoin existent depuis les prises ci-dessus.

**Ce qui RESTE de cette carte** : le contrat `.8bf` (ticket 01, plus bloquant),
le langage de la texture procédurale (02), et les prises côté interface — les
masques texturés (03), la couleur de surimpression (05), les modes de fusion
manquants et `BlendRanges` (06), sélection contre masque (07), ajustement contre
filtre (08), masque par bande de fréquence (09), pinceau d'effet (10), et le
16 bits (11).

### ⚠️ OUVERT le 2026-08-19 — quatre restes que la session a créés, pas hérités

Aucun n'est bloquant, et chacun porte sa mesure : c'est elle qui permettra de
trancher plus tard, pas le souvenir de la session.

1. **`validateEffect` refuse `libraryTexture` sur un effet à passes internes**,
   et ce verrou est maintenant en TÊTE de la liste des prises. Il gouverne deux
   effets d'un coup : le **ZMap** sur `lensBlur` (un flou dont le rayon se lit
   dans une carte au lieu d'une géométrie — Affinity en fait son quatrième mode
   de champ, et leur SDK expose même un `createDetectDepth` qui la fabrique par
   IA) et la texture de bibliothèque sur `lensFlare`. La pièce existe déjà chez
   nous : `displacementMap` lit une image par le binding 7 d'ADR-0018, et le
   mécanisme est générique dès son écriture. Le blocage n'est pas la capacité,
   c'est la validation.
2. **`lensFlare` passe une courbure de lames de `0.0` en dur.** Volontaire — ses
   sept références de pixels sont d'avant l'ajout du quatrième argument — mais
   c'est une incohérence de domaine tant que ça dure : `aperture.ts` est partagé
   parce qu'**un objectif n'a qu'un diaphragme**, donc celui qui décide de la
   forme du bokeh décide aussi de celle des fantômes. Le jour où `lensFlare`
   l'expose, c'est un paramètre qu'il lit, pas une constante remise en dur.
3. **Leur bloom est un opérateur SIGNÉ, et nous n'avons pris que sa moitié.**
   Mesuré sur un escalier de seize tons unis : `shadowBlend` à 1 assombrit les
   tons 28 à 102 (−0,001 à −0,012 en linéaire) pendant qu'il éclaircit au-dessus
   — il DÉPLACE de la lumière au lieu d'en ajouter, ce qui préserve le contraste
   au lieu de le laver. Notre `glow` reste purement additif ; sa `shadowHold`
   retient le halo, elle ne compense pas. À décider si ça vaut un second axe.
4. **GCR / UCR de leur `halftone` : NON TRANCHÉ, et l'absence ne se conclut pas.**
   Piloté par le SDK, leur demi-ton est monochrome et les quatre combinaisons
   (GCR 0/100 × UCR 0/100) rendent des images **identiques au pixel**, vérifié
   sur un nuancier de 36 cases. Notre `halftone` fait déjà la quadrichromie, ses
   quatre angles d'écran et sa rosette — mais le remplacement de la composante
   grise par du noir reste une idée du domaine de l'imprimé que nous n'avons
   pas. Ce qui manque pour trancher : **l'ouvrir dans l'interface d'Affinity, à
   la main**. Mesuré sur le chemin SDK ne veut pas dire mesuré.
   ⚠️ Confirmé le soir du 2026-08-19 : le chemin LIVE ne se laisse pas piloter
   non plus — `HalftoneScreenType` énumère bien `Mono · Colour · Line ·
   Circular`, mais l'écriture de `screenType` échoue EN SILENCE par les trois
   voies essayées (le setter direct est inerte, seul
   `createSetXxxParameters(selection, params)` écrit). L'interface à la main
   reste la seule voie ouverte.

## ⚠️ NOUVELLE carte ACTIVE — le retour d'usage du 2026-08-20

**`.scratch/retour-usage-2026-08-20/` est chartée le 2026-08-21**, sur ~23
remarques d'Antoine lâchées devant l'app. Diagnostic complet au pixel (Fable +
4 sous-agents) : sur les ~8 « bugs francs » supposés, **UN SEUL** était un bug de
code. Le reste est calibration, lisibilité ou esthétique.

**Trois calibrations LIVRÉES** (Decisions-so-far de la carte, `test:render` zéro
écart chacune) :
- `warp` (`6e44dd0`) — courses mortes masquées hors mode Bruit fractal
  (octaves/roughness/seed mesurés inertes dans 8 modes sur 9), centerY sur les 7
  formes qui le lisent, rugosité 0.8→0.95 (le shader tolérait déjà).
- `sliceShift` (`b5f4c2b`) — « Fondu des bords » borné à `sliceSize/3` : à
  `sliceSize` il couvrait toute la tranche (« floute tout »).
- `outlines` (`ad3e76c`) — défaut d'effacement du fond `wash` 0,2→0 : le voile
  blanc (« blanchit tout l'écran », surtout en Échos) venait de ce seul défaut,
  ni du SDF ni des échos.
- Et `lensDistortion` était **déjà corrigé** (masquage vérifié en direct) ; les
  icônes pinceau/transparence ne sont pas mortes, ce sont des **verrous**.

**Onze tickets, sept OUVERTS** — esthétique verre (01, le gros, refusé 3×, à
faire devant références visuelles), isolines noisy (02), displacementMap
nom/attente (04), lisibilité des verrous (05),
doublon encre/textures (06), et QUATRE décisions produit à griller : fenêtre
latérale des réglages (07), prévisualisation en hover (08), aplat dessinable en
barre d'outils (09), params en section calque (10), plus lensBlur perf (11). La
carte se reprend par `/wayfinder`.
✅ **`emboss` (03) RÉSOLU le 2026-08-21** — grilling tranché SUPPRIMER,
effet retiré du registre (ADR-0019). Et `noise`, né du ticket 02 la veille,
REVERTÉ le même jour (refusé).

### ⭐ LE TRAVAIL VIT MAINTENANT DANS `.scratch/retour-usage-execution/`

**Chartée le 2026-08-21 par `/to-tickets`**, après un grilling de 16 questions
qui a tranché les huit sujets ouverts de la carte ci-dessus. **23 tickets**,
numérotés en ordre de dépendance, `README.md` en tête avec le graphe. C'est là
qu'on prend le travail — la carte `retour-usage-2026-08-20` reste la trace des
ARBITRAGES, elle n'est plus la file.

**Principe récurrent du grilling, et il a renversé ma reco deux fois :**
« comme photoshop/affinity ». Vérifier leur convention AVANT de recommander,
pas après (`displacementMap` était déjà rangé où PS le range ; le glyphe `Brush`
du verrou de masque est celui de PS et devait rester).

**Soldé le 2026-08-21** — 01 aperçu de fusion au survol (livré puis CORRIGÉ, il
changeait le modèle sans repeindre l'écran), 02 dock à deux colonnes, 03 verrous
redescendus au niveau du calque, 04 coût d'un aperçu mesuré, 23 retrait de
l'écrêtage (ADR-0020). Détail dans `docs/INDEX.json`.

**Frontière prenable, sans décision préalable** : 17 (reflet d'environnement du
verre — première VRAIE tranche de la chaîne, sa méthode s'arrête à l'œil avec
Antoine ; chaque tranche régénère les 18 références et se juge devant photo).
✅ **16 CLOS EN CONSTAT le 2026-08-26, zéro ligne de code** : la rampe de Schlick
demandée est dans `glass.ts:889` **depuis le premier commit du verre**, par
pixel, sur le bon `cos θ`. Le voile plat vient de `glass.ts:890` (mélange vers
une couleur FIXE — l'environnement est gelé, pas le Fresnel) ; la recherche
`01-glass-shading.md` affirmait « comme nous le faisons » sans avoir ouvert le
shader — amendée. Le blocage du 17 est levé de fait.
⚠️ **05 (vignettes de galerie) est CADRÉ le 2026-08-26 et attend UNE décision
d'Antoine** : la fidélité de l'aperçu se tranche sur la planche
<https://claude.ai/code/artifact/c80e3b93-cfd8-4cb3-863e-928314271ceb>
(composite réduit contre crop 1:1, 14 rendus réels — reco : réduit).
L'architecture est retenue et écrite dans le ticket (mini-pile + second
Renderer offscreen, précédent `render-check.mjs`) ; le code n'attend que ce
choix.
✅ **20 et 22 LIVRÉS le 2026-08-26** (code, tests, références, gates vertes,
geste vérifié par CDP sur la vraie fenêtre) — il ne leur reste que la validation
à l'œil d'Antoine (`ready-for-human` sur les deux tickets). Limite connue du
22 : « Source de la carte » s'affiche en FIN de section (l'ordre d'affichage EST
celui de `params[]`, jamais réordonné — corollaire (a) du chantier des
contrôles ; un param neuf va en fin de liste, donc en fin de bloc).

**Bloqué sur un arbitrage d'Antoine** : 21 (quels effets créatifs gagnent un
lieu — il COMMANDE le 20), 06 (encre procédurale), 09 (source de textures),
10 (modèle de la forme), 14 (mesure lensBlur en prod, que le sandbox interdit à
l'agent).

### ⚠️ CE QUE LA SESSION DU 2026-08-21 A OUVERT

Quatre restes créés, pas hérités. Chacun porte sa mesure — c'est elle qui
permettra de trancher, pas le souvenir.

1. **Le retrait de l'écrêtage a coûté une capacité SANS remplaçant** : borner un
   effet à la COUVERTURE d'une photo. Les sources de masque sont une union
   fermée (`gradient · luminosity · colorRange`), sans géométrie. Décidé en
   connaissance de cause (ADR-0020, portée « retrait sec »), à retrouver par la
   sélection géométrique du ticket 11 — jamais par une case.
2. **La bibliothèque de textures ne porte AUCUN relief**, et c'est ce qui faisait
   passer `displacementMap` pour cassé (« l'effet est le même selon les
   textures »). Ses sept scans sont des albédos PBR d'ambientCG (`Cardboard*`,
   `Paper*`), mesurés à ~10 niveaux sur 255 par la recherche du ticket 08 —
   quasi plats. Une carte de déplacement lit une PENTE ; une image plate n'en a
   pas. L'effet marchait, son entrée ne portait pas d'information. Deux suites :
   ticket 22 (lire l'image) et ticket 09 (un vrai catalogue — la recherche a
   nommé la source, Texture Ninja, CC0, scans photographiques).
3. **L'outil Déplacer ignore les calques d'effet**, y compris les cinq qui ONT un
   ancrage sur la toile. Mesuré : `if (!layer?.imageSource || !layer.transform)
   return;` dans `usePhotoLayer.ts`, deux fois. Et **21 effets sur 26 n'ont aucun
   lieu** — c'est le vrai facteur limitant (tickets 20 et 21).
4. **Un aperçu d'effet à taille vignette coûte 4,0 ms**, quel que soit l'effet
   (`glass`, le plus cher du registre, ne se distingue pas de la photo nue à
   cette taille). ⚠️ **MAIS ce chiffre ne dit PAS que l'aperçu est gratuit** : il
   n'existe aucun chemin de rendu à résolution réduite dans le dépôt, donc un
   aperçu de la photo réelle coûte **261 ms** et les 26 en coûteraient 6,8 s. Le
   premier travail du ticket 05 est cette pièce, pas l'UI. Second reste non
   mesuré : les effets à paramètres en PIXELS (rayon de `lensBlur`, grain, pas de
   trame) ne montrent pas la même chose à 1/30 d'échelle — un aperçu peut être
   bon marché ET mensonger.

## ⚠️ DEUX cartes de plus, et la première est CLOSE

**`.scratch/prochain-palier/` est SOLDÉE le 2026-08-18** — 29 tickets sur 29
`resolved`. Elle reste la référence des arbitrages rendus (formes, typographie,
masquage, lisibilité, les trois fronts des contrôles, le coût du verre) : un
sujet qu'elle a tranché ne se rouvre pas sans une raison neuve.

**`.scratch/hybride-lightroom-photoshop/` est la carte ACTIVE**, chartée le
2026-08-18 sur un retour d'usage d'Antoine. Destination : un hybride de
Lightroom et de Photoshop qui facilite le travail créatif — le GESTE et la
LISIBILITÉ, pas le rendu, qui reste ici.

Les sept points de son énoncé sont traités le jour même : le verrou qui ne
verrouillait pas, l'icône de cadenas, le double-clic de retour au défaut, sa
marque, le sélecteur de couleur de la forme, ce que le pinceau dit faire, le
geste de la forme et le layout.

**Sur ses quatre tickets, deux sont `resolved` et deux restent OUVERTS** :

- ✅ **Le geste de la forme** — on trace et on ajuste sans quitter l'outil, et la
  mesure s'affiche pendant le tracé. ⚠️ Un des cinq écarts n'en était pas un : le
  rectangle noir **est** la convention de Photoshop (couleur de premier plan).
- ✅ **Le layout** — RÉSOLU le 2026-08-19 par des groupes à ONGLETS (modèle
  Photoshop), après deux mécanismes construits puis retirés. La colonne tient
  sans toucher au plancher des listes ; la carte « Textures » est partie avec.
- ✅ **[Le verrou](../.scratch/hybride-lightroom-photoshop/issues/02-le-verrou-binaire.md) —
  QUATRE verrous LIVRÉS le 2026-08-19** (Position, Masque, Transparence, Tout),
  avec le cadenas **plein** (total) contre **creux** (partiel) d'Adobe.
  ⚠️ **Le faux ami s'est levé par une lecture de domaine, pas par une analogie** :
  « un calque d'effet n'a pas de pixels » est vrai des pixels et rate ce qu'il
  possède — **le MASQUE d'un calque d'effet EST son canal alpha**. Là où
  Photoshop distingue pixels transparents et pixels d'image, nous distinguons le
  masque à ZÉRO et le masque tout court.
  ⚠️ Et le verrou de TRANSPARENCE n'est pas de la même nature que les trois
  autres : il ÉCRÊTE au lieu de refuser, donc il vit dans `MaskPainter` et non
  dans `LayerStack` — même piège que `replaceLiveLayers`.
- ✅ **[La symétrie panneau / toile](../.scratch/hybride-lightroom-photoshop/issues/03-symetrie-panneau-toile.md)
  — LIVRÉE le 2026-08-20.** Le panneau montre les contrôles spatiaux en PIXELS
  (affichage ET saisie), la fraction reste stockée (presets inchangés). Source
  unique de l'axe pixel dans `render/effects/spatialPixels.ts` (× W, × H,
  × √(W·H)), calquée sur la toile et liée par test ; `LabeledSlider` reçoit une
  prop `parse` (le même nom et le même contrat que celle de `NumberField`), le
  curseur reste en fraction (round-trip et défaut
  exacts, `test:render` inchangé). Portée : quatre effets sur cinq entièrement
  (`aplat`, `lensFlare`, `pixelStretch`, centre de `motionBlur`) plus l'origine
  de `lightLeak`. La longueur d'axe est exclue et documentée — `amount` est déjà
  en pixels, `portee` a une convention non réconciliée qu'un affichage pixel
  rendrait faux. **C'était le seul reste de code de cette carte.**

⚠️ **Sa recherche a établi une chose qui vaut d'être sue avant d'en lancer une
autre** : la documentation Adobe ne donne AUCUN gabarit chiffré de layout. Elle
est descriptive, jamais dimensionnelle. Le ticket layout se résoudra donc par des
mesures sur notre app, pas par de la lecture.

## ⚠️ Lire aussi : la carte close tient les arbitrages rendus

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

**Cinq des six sujets ont été jugés par Antoine le 2026-08-13**, devant l'app.
La colonne de droite dit ce qu'il en reste APRÈS son verdict, pas ce qu'il
fallait juger.

| # | Sujet | Ce qu'il en reste |
| --- | --- | --- |
| 1 | **Courbes** | ✅ **JUGÉ ET CORRIGÉ.** Verdict : « pas les points rouges ni l'effet délavé ». `curves` travaille en perçu depuis `ffe47c2`, et le gain du canal maître est borné — c'était lui, la vraie cause des pixels colorés. Détail et mesures : [ticket 06](../.scratch/prochain-palier/issues/06-curves-en-lineaire-ou-en-percu.md) |
| 2 | **Pile / Propriétés / Masque** | ⚠️ **DÉFAUT CORRIGÉ, WIREFRAME ÉCRIT — reste le choix.** La sélection est ramenée dans la vue depuis le 2026-08-14 (`scrollIntoView({ block: "nearest" })` au changement de sélection, story `SelectionScrollsIntoView` qui rougit sans le correctif). Le **wireframe pour 7 calques et plus** est écrit ET tranché : trois planches, Antoine retient le **repli des groupes** avec le filet, barre et lavis partant de l'axe du filet (variante C/c1). Reste à coder, et deux points de modèle à décider — voir le bloc « trois restes » plus bas. La borne à 5 lignes (`--dock-card-list-rows: 5`) est voulue, pas un défaut |
| 3 | **Verre** | ⚠️ **REFUSÉ, partiellement corrigé.** Le Dépoli rendait des paquets : sa diffusion était directionnelle (9 taps sur un axe), elle est isotrope depuis `da86f3d`. Mais l'ensemble reste jugé « très artificiel, 3D des années 90 » — voir le bloc dédié plus bas |
| 4 | **Les cinq pavés** | ⚠️ **REFUSÉ.** « Les espacements sont très moches », puis « je n'aime pas l'aspect du mortier ». Trois corrections livrées (joint adouci, variation par pavé, granulométrie), le verdict reste négatif. Ce qui manque est identifié par PHOTOS, voir plus bas |
| 5 | **Sections des panneaux** | Inchangé — le découpage en blocs titrés, livré le 2026-08-05 sur les 23 effets, n'a toujours pas été regardé sujet par sujet |
| 6 | **Light leak** | ⚠️ **REFUSÉ, reformé.** Les deux défauts prédits étaient réels et sont corrigés (`6fdc1da`), mais le verdict portait plus loin : « très lampe torche, très grossier » désignait la FORME, pas les valeurs. Le profil latéral n'a plus de contour. **Reste du goût** : la zone dense tire vers le rose pâle là où les sources décrivent un orange franc |

### ✅ SOLDÉ le 2026-08-13 — `curves` travaillait en lumière LINÉAIRE

**Tranché par Antoine devant l'image** (« fais en sorte qu'on n'ait pas les
points rouges et l'effet délavé ») : c'est l'EFFET qui se corrige, pas la règle
« linéaire strict » du dépôt. Livré en `ffe47c2`, verdict complet et mesures
dans [le ticket 06](../.scratch/prochain-palier/issues/06-curves-en-lineaire-ou-en-percu.md).

**Ce que la correction a appris et qui ne se devinait pas** : il y avait DEUX
défauts, et le second ne s'est vu qu'une fois le premier corrigé. Passer en
perçu supprimait ~80 % des pixels colorés — assez pour croire que c'était réglé.
Le reste venait du canal maître, qui préserve la teinte en multipliant par
`mappedLuma / luma` : dans les ombres profondes ce facteur explose (0,001 en
entrée et 0,25 en sortie donnent un gain de 250) et amplifie le bruit
chromatique du JPEG. Gain désormais plafonné à 4, avec complément vers le gris
neutre au-delà ; sous le plafond, le résultat est identique au bit près à
l'ancienne formule. **Ce sont les captures relues à l'œil, pas les chiffres, qui
ont montré qu'il en restait.**

Mesure de sortie : écart-type de l'image passé de **19,1 à 44,7** au même
réglage (point noir à 25 %, photo nue à 60,7), et `effet-courbes-neutre` reste
inchangé **au bit près** — la courbe identité court-circuite avant toute
conversion, ce qui prouve que le changement ne touche que ce qu'il devait
toucher.

<details>
<summary>Le constat d'origine, conservé pour la trace</summary>

`src/render/effects/curves.ts` n'importait aucune transformation sRGB : sa
courbe s'appliquait donc à des valeurs **linéaires**, quand tous les outils de
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
où l'œil l'attend, ou la mathématique rester juste ?

</details>

⚠️ Et la **fluidité** du tirage de poignée, l'autre moitié de ce point, ne se
capture pas : elle se sent au pointeur. Aucune planche ne peut y répondre.

### ⚠️ OUVERT le 2026-08-13 — l'aspect du verre, et la méthode qui l'a raté

**Refusé trois fois par Antoine** : « les espacements entre les pavés sont très
moches », « je n'aime pas non plus l'aspect du mortier », « trop artificiel /
3D des années 90 ». Trois corrections livrées (`da86f3d`, `6bffc3c`) et le
verdict reste négatif.

**La cause du ratage est de méthode, et elle est notée ici parce qu'elle se
répétera** : Antoine avait demandé de « chercher des exemples en ligne » et de
comparer à « de vrais exemples réels ». J'ai fait deux recherches qui ont rendu
du TEXTE — 9 à 15 mm de joint, Ra de 0,4 à 1,2 µm, « distribution gaussienne » —
et j'ai traité ces chiffres comme s'ils remplaçaient des images. **Trois
constantes ont été écrites dans le shader avant qu'une seule photo soit
ouverte**, dont une (« un joint opaque est forcément sombre ») que la première
photo venue a démentie et qui a amputé de moitié la course d'un curseur. Une
APPARENCE ne se déduit pas d'une spécification.

Ce que les photos établissent, et qui reste à faire :

1. **Un pavé ne transmet pas une image, il transmet de la lumière.** Sur toutes
   les références, aucune scène n'est reconnaissable derrière — seulement des
   carrés lumineux à dégradés doux. Notre `Diffusion` vaut **8 %** par défaut,
   ce qui laisse tout lisible. C'est probablement le point structurant.
2. **Le cadre lisse périphérique** — une bordure de verre lisse et brillante
   encadre le motif, qui n'occupe que le carré central. Nous étalons le motif
   jusqu'au joint. `Biseau` existe mais ne produit pas ça.
3. **Baisser le contraste général** : sur un mur réel vu à distance, les joints
   sont une trame fine et l'ensemble est sourd. Le nôtre individualise trop.
4. **Atténuer la variation par cellule** ajoutée le 2026-08-13, trop marquée au
   vu des murs réels.

⚠️ **Le joint peut être clair OU sombre** — ciment blanc en intérieur moderne,
mortier sali à l'ombre. C'est le curseur `Clarté du mortier` qui en décide, et
aucune constante ne doit trancher à sa place.

Cinq photos de référence ont été récupérées dans le scratchpad de session
(`refs-verre/`) ; **elles ne survivront pas à la session** — les retélécharger
depuis Wikimedia Commons (catégories `Glass blocks` et `Frosted glass`) ou
repartir d'une recherche d'images.

### ⚠️ OUVERT — le coût du verre, désormais instruit et attribué

`glass` est de loin l'effet le plus cher du registre. **Mesuré en PRODUCTION le
2026-08-14, et la cause n'est pas celle qu'on croyait** : ni le mortier, ni
l'arête, ni le moulage, ni la géométrie. À `Creux = 0` un pavé coûte exactement
ce que coûte une feuille (66,9 contre 67,6 images/s) — c'est le **déplacement**
qui disperse les lectures de texture, et une lecture dispersée coûte **~25 fois**
une lecture cohérente. Cadence réelle : **10 à 12 images/s** sur un Pavé
quadrillé à 26 Mpx.

Complété le 2026-08-15 par un **coût GPU par matière** (14 matières, facteur 7,
Dépoli 15,5 ms contre Pavé quadrillé 108,3 ms), rendu possible par le
chronométrage par passe livré le même jour (`src/render/gpuTiming.ts`).

⚠️ **Deux pistes sont désormais CONDAMNÉES par la mesure, ne pas les redémarrer** :
réduire le nombre de prélèvements, et réécrire les fonctions de matière en
dérivées analytiques (essayé, mesuré : 8 % de gain dans le bruit contre 18
références de pixels déplacées). On ne réduit pas un coût de cache en retirant
des multiplications.

✅ **ARBITRÉ PAR ANTOINE LE 2026-08-15 : on fait le mipmap de diffusion.** C'est
le seul levier qui attaque les 7,4 ms par lecture au lieu de les compter — un
niveau grossier rend les lectures LOCALES en plus d'être moins nombreuses. ✅ Son
obstacle d'implémentation est levé **et la brique est sur `master` depuis le
2026-08-17** (`src/render/mipmapGenerator.ts`, verdict rendu — voir le bloc
soldé plus bas). Le levier est en place, et il a été **éprouvé sur un cas réel
avant d'être appliqué ici** : sur la passe `texture`, la pyramide rend le coût
PLAT au lieu de croissant avec la minification.

⚠️ **Ce que le verdict des mipmaps NE dit PAS de `glass`.** Là-bas la pyramide se
construit UNE FOIS au chargement du scan ; ici la source de `verre_lire` est une
cible de ping-pong, créée à un seul niveau
(`effectPassRunner.ts:209`, `imageFrameResources`) et réécrite à chaque frame.
La mipmapper coûterait une chaîne de blits PAR IMAGE, et ce coût-là n'est pas
mesuré. Le gain/coût est à refaire entièrement — le verdict valide le MÉCANISME,
pas son prix dans ce contexte.

⚠️ **Rien n'est écrit côté code, et le prix est connu d'avance** : le rendu
CHANGE, donc les **18 références de pixels du verre** sont à régénérer et à
relire à l'œil, et le résultat est à juger devant une photo — une référence
prouve qu'un effet porte sa propriété, jamais qu'il est beau. La question de
CIBLE reste ouverte : 10 images/s est inutilisable au pointeur, 60 demanderait
de diviser par six, et rien ne dit lequel des deux vise juste.

⚠️ **Croisement avec le bloc « aspect du verre » ci-dessus** : trois des quatre
matières les plus chères — Quadrillé, Alvéolaire, Nuage — sont exactement celles
qu'Antoine a refusées à l'œil. Même code, même fenêtre. Et le **Dépoli est la
moins chère de toutes** : son problème est esthétique, pas de coût.

Tout le détail, les protocoles et les ablations :
[19 — Le coût du verre](../.scratch/prochain-palier/issues/19-le-cout-du-verre.md).

### ⚠️ OUVERT — trois restes du 2026-08-13, chacun décidé mais pas fait

- ~~**`lensFlare` : ses trois phénomènes deviennent trois options
  SÉLECTIONNABLES**~~ ✅ **FAIT le 2026-08-14.** Trois interrupteurs
  **cumulables** (`ghostsOn` / `diffusionOn` / `sensorOn`) — la forme du contrôle
  n'était écrite nulle part et a été tranchée là : un sélecteur exclusif aurait
  retiré une capacité, un objectif produisant les trois à la fois (ADR-0017).
  Section de tête « Phénomènes », les trois sections de détail conditionnées par
  eux, et ils **coupent le rendu** — éteindre les fantômes fait sauter les cinq
  passes de pyramide. Applicabilité **mesurée avant d'être déclarée** : 0,000 %
  d'écart sur chaque famille éteinte, du min au max de tous ses réglages. Les six
  références de flare sont inchangées au bit près.
- ~~**Le wireframe de la pile à 7 calques et plus**~~ ✅ **ÉCRIT ET TRANCHÉ les
  2026-08-14/15.** Trois planches, dans cet ordre — chacune répond à ce que la
  précédente a fait surgir :
  1. `docs/wireframes/pile-longue.html` — quatre réponses au débordement, aux
     dimensions réelles (ligne 52 px, liste 292 px, dock 320 px ; une pile de 7
     demande 412 px). **Antoine retient D, le repli des groupes** ;
  2. `docs/wireframes/pile-longue-repli.html` — D avec le filet, qui **existe
     déjà** (`.layer-panel__rail`, `LayerPanel.css:223`) et que ma première
     planche avait oublié. Trois traitements du groupe replié : filet supprimé,
     moignon de 14 px, filet pointillé ;
  3. `docs/wireframes/pile-longue-hierarchie.html` — **la décision d'Antoine :
     variante C, implantation c1**, c'est-à-dire lavis ET barre qui partent de
     l'axe du filet, la barre étant l'ARÊTE du bloc (écart mesuré au filet :
     0,0 px). Décalage recommandé **20 px** au lieu de 14 : premier cran où les
     deux niveaux ne partagent plus aucune verticale, pour un nom qui passe de
     190 à 184 px (mesuré, pas estimé).

  ✅ **CODÉ le 2026-08-16** — les deux questions que ces planches laissaient
  ouvertes sont tranchées et implantées ([ticket 20](../.scratch/prochain-palier/issues/20-ou-vit-l-etat-de-repli-de-la-pile.md)).
  L'état de repli est d'INTERFACE (`useCollapsedGroups`, règles pures dans
  `src/components/pileCollapse.ts`) ; replier remonte la sélection au parent et
  déplier la rend à l'enfant quitté. Chevron en septième piste, pastille du
  nombre d'enfants masqués, moignon de 14 px sous la photo repliée.

  ⚠️ **La mesure a réfuté l'énoncé de la question avant d'y répondre** : elle
  opposait « persisté » à « perdu à la réouverture », alors que le projet n'a
  **aucune persistance de document** — les deux branches perdaient. Ce qui les
  sépare vraiment est l'ANNULABILITÉ : `History.push` snapshotte la pile
  entière, donc un champ de `LayerState` serait rejoué par l'undo, et replier un
  groupe puis annuler un coup de pinceau le rouvrirait.

  ⚠️ **Un piège qui n'aurait fait rougir personne** : `displayInsertToModelInsert`
  suppose que la liste affichée est la pile ENTIÈRE. Avec un groupe replié, le
  calque atterrissait ailleurs que là où on le lâche. Refermé par
  `visibleInsertToModelInsert`, qui passe par les identités des lignes visibles.

  ⚠️ **Un plancher de largeur périmé, trouvé par la septième piste.** La story
  `AllRowFormsShareOneGrid` exigeait 170 px de nom et a rougi. Le seuil datait du
  2026-07-29 et était calé sur « Aberration chromatique » (127 px), libellé que
  le registre ne porte plus : le plus long des 23 effets est `Lens distortion`,
  **79 px**. Le seuil n'a pas été baissé mais **dérivé** — la story mesure
  désormais le plus long libellé rendu. Le commentaire de `LayerPanel.css` qui
  annonçait 152 px est amendé : mesuré dans la fenêtre, **148 px** sur une ligne
  racine, **134 px** sur une imbriquée.

  ✅ **TRANCHÉ le 2026-08-16 — la piste du chevron coûte 30 px au nom, et c'est
  accepté.** Mesuré sur la vraie carte (dock 320 px) : le nom passe de
  **148/134 px** (racine/imbriqué) à **118/104**. La cause n'est pas la piste
  (14 px) mais son élargissement à `--control-height-sm` (28 px), fait pour
  donner au chevron la respiration demandée — le correctif d'ergonomie a doublé
  le coût de largeur. Écartées, chiffrées : piste à 20 px (126/112), à 14 px
  (132/118, mais le chevron et la poignée se retouchent).

  Ce qui a permis de trancher : le plus long libellé du registre est
  `Lens distortion`, **79 px**. Aucun effet ne tronque, même à 104. Ce qui tronque
  est un NOM DE FICHIER, qui tronquait déjà à 152 et qu'aucune largeur ne sauve.
  Les DEUX gardes du point 6 de l'ADR-0001 mesurent désormais le plus long
  libellé RENDU au lieu d'un seuil écrit en dur — voir `CLAUDE.md` § Densité.

  ✅ **c1 EST COMPLÈTE depuis le 2026-08-16.** L'indentation est passée de 14 à
  20 px (`--layer-nest-indent`, `--space-4 + --space-5`), dernière pièce de
  l'arbitrage. Mesuré : indentation 20 px, axe du filet 18, barre de sélection à
  18 px sur 1 px de large et 52 px de haut pour un lavis de 52.

  Le changement n'a demandé qu'UN point : padding de la ligne imbriquée, axe du
  filet, axe de la barre et coupure du dégradé de lavis lisent tous le même
  token. ⚠️ Il aurait été bien plus cher pendant les cinq passes du même jour,
  où la barre dépendait du FILET au lieu du lavis — une pièce mal accrochée
  n'est pas seulement fausse, elle rend cher tout ce qui la touche ensuite.

  Une coïncidence fortuite a été défaite au passage : le moignon du groupe replié
  mesure aussi 14 px, et son commentaire affirmait tenir la même dérivation que
  l'indentation. Il reste à 14 — c'est une longueur VERTICALE bornée par la
  gouttière, l'indentation une largeur bornée par le dock.

- ~~**L'overlay de masque n'a AUCUNE référence de pixels.**~~ ✅ **FAIT le
  2026-08-14** — quatre références, deux paires témoin/overlay
  (`masque-overlay-pinceau` sur masque peint, `masque-overlay-tonalite` sur
  masque par tonalité posé sur du bruit). Chaque paire rend la MÊME pile, la
  seconde avec `setMaskOverlay` : l'écart entre les deux EST l'aide de visée.
  Ce qu'il a fallu pour que ce soit verrouillable : **l'horloge de l'overlay
  est devenue un port** de `FramePipelineExecutor` (le contour est pointillé et
  sa phase avance avec le temps, donc deux rendus de la même pile ne donnaient
  pas les mêmes octets) ; le harnais la fixe, l'application garde
  `performance.now`. Le lissage à 25 taps du 2026-08-13 est désormais opposable
  par DEUX gardes indépendantes — la référence de pixels et une mesure
  (« le contour est une ligne, pas une surface », `renderRefs.test.mjs`), toutes
  deux calées en **rejouant la régression** : sans lissage, la mesure passe de
  0,19 % à 2,03 % et l'écart de pixels atteint 162 valeurs.

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

~~**Voie du modèle tranchée le 2026-08-05 : A.**~~ ⚠️ **CADUQUE depuis le
2026-08-17 : la voie A a perdu SES DEUX justifications, l'une après l'autre.**

Elle existait pour porter formes ET typographie par un même
`contentSource?: { contentId }` sur `LayerState`. Or :

- **les formes n'en ont pas besoin** — arbitrage d'Antoine devant le prototype :
  « c'était pour les masques et la sélection, pas pour un effet ». Une forme
  SÉLECTIONNE ; ce qu'elle demande vit du côté de `mask/sources/`
  ([ticket 03](../.scratch/prochain-palier/issues/03-une-forme-a-t-elle-besoin-de-contentsource.md)) ;
- **la typographie sort du palier** — « ni l'un ni l'autre pour l'instant »
  ([ticket 04](../.scratch/prochain-palier/issues/04-la-typographie-entre-t-elle-dans-ce-palier.md)).

**Rien ne réclame donc plus `contentSource` aujourd'hui.** Ne pas le rouvrir sans
un besoin mesuré : c'est une migration de la couche la plus partagée du projet
pour un bénéfice qui n'a plus de porteur.

⚠️ **Et la mesure du 2026-08-17 renverse l'argument technique qui le soutenait.**
Ce document affirme que la typographie « bute sur le modèle avant la première
ligne de WGSL » parce que `params` ne peut pas porter une chaîne. C'est vrai d'un
effet qui SYNTHÉTISERAIT des glyphes — que le cahier de postproduction ne demande
nulle part. Vérifié dans la vraie fenêtre : **un PNG à alpha s'importe et se
compose déjà**, texte compris, sans une ligne de code, et le calque garde ses
poignées. Le seul blocage est un filtre de trois mots sur le sélecteur de
fichier, qui contredit le glisser-déposer — et il est ticketé à part parce qu'il
touche tout PNG à alpha, pas seulement du texte
([ticket 26](../.scratch/prochain-palier/issues/26-le-selecteur-refuse-ce-que-le-glisser-depose-accepte.md)).

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
- ~~formes~~ — **RÉORIENTÉ le 2026-08-17.** Ce n'est ni un genre de calque ni un
  effet : c'est une façon de SÉLECTIONNER. `mask/sources/types.ts:2` porte une
  union FERMÉE (`gradient` / `luminosity` / `colorRange`) sans aucune source
  géométrique — pas de rectangle, pas d'ellipse, aucun équivalent du marquee.
  Trou franc qu'aucun document ne signalait. L'outil de SÉLECTION qui le comble
  est plus gros que cette carte et attend la sienne ;
- ~~typographie~~ — **HORS PORTÉE le 2026-08-17** (voir plus haut) ;
- finalisation du recadrage ;
- éventuelles extensions du modèle de document / calques.

⚠️ **Les textures ne sont PAS passées par un effet, et le cadrage du même jour
disait le contraire** (« un effet ordinaire à texture d'entrée »). Antoine a
tranché autrement : **une texture est un calque photo, tel quel** — un scan est
un raster, `imageSource` le couvre déjà. Livré **sans toucher `LayerState`**.

⚠️ L'option « effet » n'a PAS été écartée par ADR-0008, contrairement à ce qui a
d'abord été écrit. ADR-0008 interdit d'écrire un `effectId` **sur** le calque
qui porte `imageSource` ; appliquer un effet à une photo reste le flux normal,
par un calque d'effet posé au-dessus (il était ÉCRÊTÉ sur elle jusqu'au
2026-08-21 — l'écrêtage est retiré, ADR-0020, et le flux ne change pas). Ce qui
écarte l'effet est structurel :
`params` est un `Record<string, number>` (uniform `array<f32, 48>`), donc **un
effet n'a aucun champ par lequel désigner une image** — le même mur que la
typographie.

~~Conséquence pour la voie A ci-dessus : elle reste entière…~~ ⚠️ **Ce paragraphe
énumérait trois natures dont `contentSource` en couvrait deux — formes et
typographie. Le 2026-08-17 les a retirées toutes les deux**, donc il n'en reste
aucune : les textures sont des rasters déjà couverts, et les **light leaks** sont
du contenu SYNTHÉTISÉ (cahier ligne 330 : dégradés rouge/orange/jaune, flou fort,
`Screen`, au bord du cadre), livrés comme effet du registre avec leur mire et
leur référence de pixels.

C'est ce qui rend la voie A caduque plutôt que « diminuée » : elle n'a plus
d'objet, pas seulement moins d'objets.

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
porter le flip — et les booléens n'ont jamais été écrits.

### ✅ LIVRÉ le 2026-08-20 — le MIROIR (échelles signées)

[Ticket 05](../.scratch/prochain-palier/issues/05-ce-qui-reste-du-design-de-parite-du-calque-photo.md).
Le miroir est codé de bout en bout : `clampTransformScale` conserve le signe en
bornant la magnitude, `withScaleSign` reporte le signe courant (drag, saisie,
« Ajuster »), `constrainRatio` travaille sur les magnitudes, le WGSL de
`photoLayerInput.ts` passe le feather en `abs()` (le DÉFAUT MUET du §5, corrigé),
et `PhotoPanel` porte deux boutons Miroir H/V avec l'affichage en magnitude. La
paire de références `photo-miroir-temoin` / `photo-miroir` est posée AVANT le
geste, mire plus petite que la toile pour montrer le bord ET le passe-partout —
elle prouve la couverture intacte et gèle l'abs(). Gates verts : tsc, lint, unit
(2087), storybook (330), `test:render` (126 scénarios, aucune régression).

⚠️ **Ce qui RESTE du ticket 05, hors miroir** : les prérequis de CROP
(`transformsEqual`, `clone()` qui recopie `transform`) — ils vivent avec le
recadrage de toile ([ticket 28](../.scratch/prochain-palier/issues/28-recadrer-la-toile-deja-ouverte.md)),
pas avec le miroir. Le design §3.1 (rogner un CALQUE photo) reste écrivable,
moyennant trois corrections nommées.

⚠️ **Ce n'est pas « le miroir est tombé entre les deux » : c'est la tranche T3
ENTIÈRE qui n'a jamais été livrée**, et elle portait **trois prérequis du CROP**
sans rapport avec le miroir — `transformsEqual` (0 occurrence, donc valider un
crop ne produirait **aucune entrée d'undo**, la comparaison énumérée de
`usePhotoLayer.ts:273` ne voyant que 5 champs scalaires), `clone()` qui ne
recopie toujours pas `transform` (`layerStack.ts:653`, alors que
`duplicateLayer` le fait dans le même fichier), et `updateLayerTransform`
toujours vivant à zéro appelant. **Le recadrage dépend donc d'un arbitrage ET
d'une tranche jamais construite.**

**Arbitrages d'Antoine** : le miroir reste, en **échelles SIGNÉES** (la
réouverture que le design nommait, déclenchée en entier) — et **les DEUX
recadrages sont demandés**, gestes distincts.

Le signé est **moins cher** que le design ne le chiffrait : il **efface** le
livrable le plus risqué de T3 (branche de flip CPU + WGSL,
`PHOTO_INVERSE_TRANSFORM_WGSL`, harnais `gpu-parity.mjs`), l'inverse-transform
divisant déjà par l'échelle.

✅ **Le défaut MUET a été trouvé et corrigé (§5).** Le feather de couverture
multipliait une DISTANCE par l'échelle (`photoLayerInput.ts`). À échelle
négative, **l'alpha s'INVERSAIT sur l'axe miroité** — couverture 0,000 au centre
de la photo, 1,000 à dix pixels EN DEHORS : un trou à la place de l'image, une
bande opaque à côté. Ça compilait, validait sous naga, rendait — et aucune des
références d'alors ne l'attrapait, puisqu'aucune ne miroitait. Corrigé en
`abs()`, gardé par `photoLayerInput.test` (les deux côtés du contrat : feather
en magnitude, division signée) ET par la nouvelle référence `photo-miroir`, dont
la mire montre le bord ET le passe-partout autour — une mire cadrée sur l'image
seule aurait vu le trou et raté la bande.

Corrigé aussi : la formule de `recenterForCrop` du design est **fausse à deux
échelles** — il faut mettre à l'échelle par axe AVANT la rotation, sinon le
sujet saute dès qu'une photo est étirée, ce que §3.1 existe précisément pour
empêcher.

### ⚠️ OUVERT le 2026-08-18 — recadrer la TOILE : ARBITRÉ et MODÉLISÉ, reste le CÂBLAGE

✅ **Antoine a tranché le 2026-08-18 : le recadrage n'est PAS destructif.** Cette
réponse-là fait disparaître les trois issues du design montage au lieu d'en
choisir une — si on change le CADRE et pas les données, il n'y a aucun raster à
découper, à invalider ni à rééchantillonner. **L'empreinte d'historique tombe à
zéro**, là où la découpe valait 104 → 156 Mo sur 512 à 26 Mpx.

✅ **Modèle livré en TDD le même jour** : `src/layers/canvasFrame.ts`,
`LayerStack.cadre`, `DocumentSession.recadrerToile / cadreToile /
annulerRecadrage`, 7 tests. Trois choses sont sorties de la boucle rouge→vert :
un CADRE et non de nouvelles dimensions (c'est ce qui rend l'annulation
gratuite) ; la COMPOSITION est le vrai piège — un recadrage d'un recadrage est
exprimé dans le cadre COURANT alors que le cadre stocké est ABSOLU ; et le cadre
vit sur `LayerStack`, donc `History` l'annule sans second canal d'undo.

✅ **Le second défaut silencieux du ticket tombe avec** : le dégradé de masque qui
glissait (points en UV) n'a plus rien à remapper, puisque rien ne quitte l'espace
d'origine. Conséquence, pas seconde décision — écrite dans le ticket pour que la
tranche de câblage ne réintroduise pas le remappage « parce que le ticket le
disait ».

⚠️ **CE QUI RESTE : le CÂBLAGE.** `Renderer.allocateDocument` alloue toujours la
toile entière, il n'y a pas d'outil de recadrage, et le renderer devra évaluer
les masques dans l'espace d'ORIGINE — l'évaluer dans l'espace du cadre rouvrirait
le défaut du dégradé exactement tel qu'il était décrit. Passe par les gates GPU.
[Ticket 28](../.scratch/prochain-palier/issues/28-recadrer-la-toile-deja-ouverte.md).

Le constat de mesure qui a mené là est conservé ci-dessous : il porte les chiffres
qui rendaient la découpe coûteuse, et c'est lui qui a fait poser la bonne
question.

Mesuré le 2026-08-18, et l'énoncé du différé est trop grossier — **« le sort des
masques » est TROIS questions, dont une seule porte des pixels** :

| Nature | Sort sous un recadrage de toile |
| --- | --- |
| `brush` | un `Uint8Array` de W×H — **le seul vrai sujet** |
| `gradient` | quatre flottants en **UV** — **casse en SILENCE**, coût nul |
| `luminosity`, `colorRange` | **survivent intactes, gratuitement** |

Le dégradé n'est **pas** une des issues à arbitrer : ses points se remappent
exactement, c'est de l'arithmétique. Mais **rien ne le signale aujourd'hui**.

Et la troisième issue du design (« rééchantillonner ») **n'en est pas une** :
elle a un sens pour un REDIMENSIONNEMENT et aucun pour un RECADRAGE, où les
pixels conservés n'ont pas bougé d'un texel.

Chiffres : un raster = **1 octet par pixel de DOCUMENT** (~26 Mo à 26 Mpx, 64 Mo
au plafond) ; historique borné à **512 Mo**, refcompté par buffer UNIQUE — donc
dix entrées portant le même masque coûtent UN raster aujourd'hui. **C'est cette
économie que découper casse.**

**La vraie question, et elle n'était pas dans la liste d'origine : le recadrage
est-il DESTRUCTIF ?** S'il ne l'est pas, il ne faut PAS découper les rasters du
tout — on change le cadre, pas les données, et l'empreinte d'historique tombe à
zéro. C'est elle qui gouverne les autres.

⚠️ **C'est le seul item de ce bloc qui ne dépende pas du design de
`contentSource`** : formes et typographie l'attendent, le recadrage non. Ce
paragraphe disait « le SEUL item prêt à coder » — retiré le 2026-08-11 pour la
raison ci-dessus : il a un design, pas un modèle à jour. C'est aussi le dernier
trou FONCTIONNEL de l'app — **vingt-sept** effets et pas de recadrage. En contrepartie il touche `LayerState`, la couche la
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

## 2bis. Les fonctions à ajouter — ORDRE TRANCHÉ le 2026-08-18

Périmètre arbitré par Antoine : **tout, netteté comprise**
([ticket 12](../.scratch/prochain-palier/issues/12-quelles-fonctions-retenir.md)).
Trois tranches, du moins cher au plus cher — l'ordre porte de l'information que
la liste ne porte pas.

✅ **Tranche 1 — le socle de fusion : LIVRÉE le 2026-08-18.** Les six modes sont
au registre, qui passe de **onze à dix-sept**. Zéro changement d'interface, comme
annoncé : `fn blend(base, top)` recevait déjà les deux couleurs entières. Six
références de pixels neuves (`fusion-*`), les 102 anciennes inchangées, et le
**split-tone** différé depuis le 2026-07-20 devient atteignable par la pile.

⚠️ **L'annonce disait « le registre porte 7 modes » — il en portait onze.** Le
chiffre venait du ticket, pas d'un comptage ; il ne changeait aucune conclusion,
mais c'est le troisième dénombrement de prose pris en défaut sur cette carte.

⚠️ **Ce que la livraison a corrigé et qui n'était pas au plan** : `test:wgsl` ne
validait QUE `normal` — seize modes sur dix-sept n'apparaissaient dans aucun
shader composé du gate, et `test:gpu-shaders` ne tourne pas en CI. Une variante
par mode y est désormais composée.

⚠️ **Un témoin écrit dans un commentaire n'était pas lisible dans l'image qu'il
commentait.** Les bandes 0 et 1 de la mire de fusion ont la même luminosité, donc
en Luminosité elles devaient rendre la même chose — sauf que le FOND varie lui
aussi avec y, si bien qu'aucun couple de pixels de la référence n'a le même
dessous. Mesuré à part par quatre scénarios temporaires (dessus UNI rouge contre
dessus UNI gris, même fond) : **Luminosité max 1 / moyenne 0,136** contre
**Couleur max 120 / moyenne 51,2**. Le témoin tient ; c'est l'endroit où le lire
qui était faux.

**Décision d'espace, à connaître avant de comparer une capture à Photoshop** :
`difference` et `subtract` calculent en LUMIÈRE, pas en valeurs codées. Le critère
du dépôt n'est pas « ce que fait Photoshop » (qui fait tout en gamma) mais
« l'opérateur a-t-il une lecture physique ? » — `multiply` est déjà en linéaire
pour cette raison. Les quatre non séparables, eux, décodent en sRGB : leurs
coefficients 0,3 / 0,59 / 0,11 sont une luma perçue sur des valeurs encodées.

✅ **Tranche 2 — LIVRÉE le 2026-08-18.** La courbe libre n'a coûté qu'une
suppression : `constrainCurvePoint` clampait l'ordonnée d'un point entre celles
de ses voisins, et cette contrainte-là ne servait rien — seul l'ordre en X en a
une (`curve_eval` balaye `xs` de gauche à droite). Le shader évaluait déjà une
courbe descendante, sa cubique de Hermite étant celle de Fritsch-Carlson, qui
préserve la monotonie PAR SEGMENT et non sur toute la courbe. L'inverse d'`aplat`
est un booléen en fin de `params[]` et une ligne de shader, posé sur la
couverture ANTICRÉNELÉE plutôt que sur le mélange — sinon le bord de la vignette
redeviendrait dur.

⚠️ **Une thèse « le rendu sait déjà le faire » se vérifie sur des PIXELS.** Le
jumeau TypeScript de la courbe partage son code avec l'aperçu du contrôle : il
aurait très bien pu être le seul des deux à savoir descendre, et les tests
unitaires seraient restés verts. D'où `effet-courbes-solarisation`.

✅ **Tranche 3 — LIVRÉE le 2026-08-18.** Trois effets, aucun mécanisme neuf, le
registre passe de 24 à **27** (⚠️ `emboss` depuis RETIRÉ le 2026-08-21, ADR-0019 —
il ne reste que `nettete` et `displacementMap` de cette tranche).

- **`nettete`** — accentuation et clarté, un seul opérateur à deux BANDES. Il
  exploite une propriété que `effectPassRunner.ts:247` documente et que rien
  n'utilisait : **un mode dont TOUTES les passes sautent reçoit la texture
  SOURCE en `prevPass`**. En Accentuation, les sept passes de pyramide sont
  éteintes et le flou se fait en tente 3×3 dans la passe finale ; en Clarté la
  pyramide tourne. Deux rayons très éloignés dans un seul effet, sans pyramide
  conditionnelle. Trois choses tiennent la barre de qualité (le liseré) :
  compresseur doux sur l'amplitude, masquage des zones plates, et correction sur
  la LUMINANCE seule — additive, jamais multiplicative, la forme `sortie/entrée`
  ayant déjà explosé dans les ombres de `curves` le 2026-08-13.
- ~~**`emboss`**~~ — ⚠️ **RETIRÉ le 2026-08-21** (ADR-0019, « relief est
  horrible »). Il était le troisième lecteur d'`edgeGradient.ts` (gardait la
  DIRECTION du gradient, `outlines` en garde la MAGNITUDE). La leçon qu'il a
  payée survit à son retrait — son signe pris à l'envers a passé shader, référence
  et gate de signal, vu seulement à l'œil (« un relief inversé ressemble à un
  relief »), consignée en mémoire `un-verrou-fort-ne-dit-pas-le-sens`.
- **`displacementMap`** — le champ de déplacement devient une DONNÉE au lieu
  d'être du code. Son défaut n'est PAS la convention Photoshop (rouge = X,
  vert = Y) mais la pente du gris, et c'est mesurable dans le dossier : la
  bibliothèque est faite de scans, donc d'images grises, où R et V sont égaux et
  où le mode Photoshop ne produit qu'un cisaillement à 45°. Le défaut doit
  marcher avec ce que la bibliothèque CONTIENT.

⚠️ **La netteté n'est PAS bloquée, contrairement à ce qui a été écrit.** Elle
était donnée « DOUBLEMENT bloquée : aucun mode signé, et un effet ne peut lire
aucun autre calque ». Les deux tombent, mesuré sur `glow`, dont le dernier pass
tient **déjà les deux images** — `color` (son entrée non floutée) et `prevPass`
(sa pyramide) :

| | opérateur |
| --- | --- |
| `glow` | `color + bloom · intensité` |
| netteté | `color + (color − bloom) · force` |

Pas besoin d'un mode signé (la soustraction est DANS l'effet), pas besoin de
lire un autre calque (il faut sa propre entrée à deux échelles, ce que
`EffectModule.passes` fournit et que `blurChain.ts` partage déjà).
**Et une justification tombe avec** : les modes signés étaient en partie
justifiés comme prérequis de la netteté. Ils entrent désormais pour eux-mêmes.

Hors de ce palier, et pas refusés : groupes de calques, déformation peinte,
pixel sorting, et du catalogue d'effect.app — Bevel (retombe sur la sélection),
Scatter, la famille « écran » (ASCII / LED / CRT / VHS / NTSC — une DA, pas une
fonction, à décider en bloc), Risograph, palette adaptative.

## 3. Export print — un PRD entier, jamais commencé

> ⭐ **DÉBLOQUÉ le 2026-08-19, au moins sur le papier.** Ce chantier butait sur
> une contradiction que `01-16-bit-hors-du-depot.md` §1.7 a mesurée puis laissée
> ouverte en toutes lettres (« ce document ne choisit pas lequel céder ») :
> « sRGB par le FORMAT » contre « aucun format flottant n'a de variante
> `-srgb` ». Le relevé du binaire d'Affinity montre une **troisième voie** —
> retirer au FORMAT le rôle de porter l'espace, chaîne linéaire de bout en bout
> et encodage explicite unique à la sortie. Détail et ce qu'il reste à mesurer :
> [ticket 11](../.scratch/affinity/issues/11-debloquer-le-16-bit.md).
>
> ⚠️ Trois mesures avant d'y toucher : le coût de l'encodage explicite en build
> de PRODUCTION, les sept modules qui consomment `srgbFormat`, et si les **119**
> références de pixels se déplacent TOUTES ou AUCUNE.

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
site à la facture 16-bit**, un effet ne voyant jamais le format. Et les **102**
références de pixels (re-mesuré le 2026-08-18 ; ce nombre disait 77) sont
sauves **tant que** le 16-bit reste un SECOND point
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

### ✅ SOLDÉ le 2026-08-13 — `origin/sat-feather` : `aee22fb` porté, la branche peut partir

**Antoine a répondu à la question ci-dessous : le lag n'avait PAS disparu.**
`aee22fb` a donc été porté — pas cherry-pické, parce que `master` a depuis
extrait le plan de passes en fonction pure : le feather y devient une passe
`featherSat` (`578d67a`). Toutes les briques SAT existaient déjà sur `master`,
donc zéro WGSL importé.

**Gain mesuré à protocole identique** — même build de production, même photo de
26 Mpx, l'ancien chemin rebâti exprès pour servir de témoin : **48,9 → 143,1
images/s**, soit **×2,9**. Les deux autres commits restent écartés pour la
raison mesurée le 2026-08-11. La branche ne se merge toujours pas et peut être
supprimée.

⚠️ **Il a fallu rebâtir l'ancien chemin pour pouvoir l'affirmer.** Les deux
chiffres disponibles ne comparaient rien : 48,4 venait d'une sonde synthétique
depuis discréditée, 175,5 d'un vrai glissement mais avec edge-aware actif. Un
gain ne s'affirme qu'entre deux mesures dont SEULE la chose testée diffère.

**Autre défaut de perf trouvé et corrigé au passage** (`f172f95`) : la chaîne de
guides comparait les calques par IDENTITÉ D'OBJET, or un appelant recopie le
calque du bas à chaque frame — mesuré 89 fois sur 89. La SAT du filtre
edge-aware de chaque masque de la pile était donc rebâtie à chaque image, ~25
passes, même en éditant un calque sans rapport. Elle compare désormais le
CONTENU quand l'identité diverge, comme le cache du fold le faisait déjà.

<details>
<summary>Le constat d'origine, conservé pour la trace</summary>

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

</details>

### ~~Le dégradé RADIAL du masque n'a jamais été livré~~ ✅ LIVRÉ le 2026-08-14

Promis en **vague 1**, pas en différé
(`2026-07-18-shaderlab-layers-masking-prd.md:76`), livré à moitié, signalé nulle
part pendant 27 jours — et le même PRD (ligne 124) s'en servait comme MOTIF pour
différer la sélection géométrique rect/ellipse, un motif qui n'existait donc pas
en code.

Livré comme un `mode` sur la source existante, **en dernière clé** de
`defaultParams` : le résolveur sérialise les clés dans l'ordre, donc un masque
enregistré avant reçoit le défaut 0 et rend le linéaire **au bit près** — la
référence `masque-degrade` est inchangée. Les deux formes partagent leurs deux
points (en radial, `start` est le centre et `end` un point du bord), donc aucun
paramètre en plus et aucun réglage perdu en basculant.

⚠️ Ce que le chantier a fait apparaître et qui n'était pas prévu : un radial
doit être **circulaire sur la TOILE**, et l'espace UV ne l'est pas. Les
dimensions du document sont désormais un uniform du wrapper de source
(`maskDims`) — surtout pas `textureDimensions(srcColor)`, qui est la photo la
plus basse de la pile et dont l'aspect diverge dès qu'une toile est créée à un
autre format (ADR-0007). La paire de références est donc sur une toile
**320 × 192** à dessein : sur une toile carrée, la propriété serait verrouillée
par accident. Mesuré, en rejouant le défaut : empreinte 132 × 134 px avec la
correction, **132 × 80** sans.

Reste ouverte, et elle est plus large que le dégradé : la **sélection
géométrique rect/ellipse**, que ce motif ne bloque plus.

### ⚠️ OUVERT le 2026-08-15 — notre uniform de paramètres n'est pas conforme à la spec

Trouvé à la **première exécution** du gate `naga` (`test/render/wgslNaga.test.ts`,
livré ce jour-là — le premier gate de shader du dépôt qui tourne en CI) :

```
@group(0) @binding(2) var<uniform> params: array<f32, 48>;
-> The array stride 4 is not a multiple of the required alignment 16
```

naga a raison sur la spec : en espace `uniform`, l'alignement requis d'un
`array<E,N>` vaut `roundUp(16, align(E))`, soit **16** pour un f32, quand le pas
naturel du tableau est **4**. La forme conforme serait `array<vec4<f32>, 12>`.

**Dawn l'accepte pourtant** — les 160 shaders composés compilent dans WebView2 et
l'app rend. Ce n'est donc **pas** un défaut visible sur cette machine : c'est un
risque de **PORTABILITÉ**, sur une implémentation plus stricte ou une version
future de Tint.

Ce qui rend l'arbitrage non trivial : les **vingt-trois effets** lisent
`params[N]`, et ces index sont **gelés par les presets et par les références de
pixels**. Passer en `vec4` change chaque accès. Une garde existe déjà pour la
cohérence des index (`test/render/effects/parametresCables.test.ts`), mais elle
ne dit rien de la conformité.

En attendant, le gate porte une **exception bornée** : il tolère cette erreur
uniquement sur la variable `params`, et uniquement si c'est la seule de la
sortie. La même erreur ailleurs, ou une seconde à côté, fait rougir.

**Décision attendue** : corriger (ADR + chantier traversant), ou assumer par
écrit que shaderlab cible Dawn et rien d'autre.

### ✅ SOLDÉ le 2026-08-17 — les mipmaps de bibliothèque, verdict rendu et fusionné

Le verdict attendait depuis le 2026-08-15 **la mesure que le commit de la branche
réclamait lui-même** — « le vrai cas (un scan 8K sur une photo, temps GPU avec et
sans) reste à mesurer ». Prise ce jour, scan 8192² sur photo 26 Mpx, minimum sur
cinq captures par point :

| Échelle (minification) | sans mips | avec mips | rapport |
| --- | --- | --- | --- |
| 1,00 (~2:1) | 3,01 ms | 2,42 ms | ×1,24 |
| 0,25 (~8:1) | 6,03 ms | 2,29 ms | **×2,63** |
| 0,10 (~20:1) | 5,05 ms | 2,23 ms | ×2,26 |

**Ce qui a tranché n'est pas le gain, c'est la FORME** : avec la pyramide le coût
est PLAT quelle que soit la minification, sans elle il CROÎT avec. Signature d'un
coût de cache — donc ce verdict valide sur un cas réel le levier que le mipmap de
diffusion de `glass` doit appliquer, avant qu'il coûte 18 références.

⚠️ **La prémisse de la branche était fausse, et le geste restait bon.** Elle
annonçait « échantillonné à l'échelle de l'écran, un rapport de l'ordre de 1:8 » ;
`presentPass.ts:44` dit que le canvas a la résolution NATIVE de l'image et n'est
réduit que par CSS. L'échantillonnage se fait à 6240×4160 : **1,31 × 1,97, un LOD
de ~1 au défaut**, et le 1:8 n'arrive qu'à `Échelle` ≈ 0,25. Au réglage par défaut
le gain vaut donc ×1,24, pas ×2,6.

⚠️ **Ce défaut ne pouvait être attrapé par AUCUN test** : un `createTexture` sans
`mipLevelCount` compile, valide, et rend une image correcte — les références ont
été figées AVEC le défaut. Un test compare à ce qui existe, jamais à ce qui
serait possible.

⚠️ **Et l'image ne pouvait pas trancher non plus.** `effet-texture` bouge de
`max 66, moyenne 1,83` ; les deux références relues côte à côte sont
INDISCERNABLES, parce que la mire fait 256 px et n'exerce aucune minification. Un
crénelage de minification se voit en SCINTILLEMENT pendant un mouvement — aucune
capture figée ne peut y répondre. **C'est la mesure qui a rendu le verdict, pas
l'œil, et c'était le seul moyen disponible.**

⚠️ Un piège trouvé au passage, et déjà corrigé : le LOD **automatique** est faux
pour `inkTexture`, qui échantillonne en espace TEXEL et derrière un `fract`
discontinu. Il lavait le grain d'encre, que `halftone` amplifiait en bascules
binaires (`max 255`). Forcé au niveau 0 — et `effet-halftone-encre` rend AUCUN
écart après fusion, ce qui le prouve. Toute nouvelle lecture de la texture de
bibliothèque doit se demander si son échantillonnage est cohérent avec l'écran.
⚠️ **`texture.ts` échantillonne lui aussi derrière un `fract`** (ligne 235) et
garde le LOD automatique : au défaut la couture tombe sur le bord du cadre, donc
sans effet — mais dès que `Décalage X/Y` la ramène à l'intérieur, elle est une
ligne d'un pixel au mip le plus grossier. Non mesuré, non corrigé.

### Deux points d'interface décidés puis jamais écrits

- **Largeur du dock redimensionnable** — décidée le 2026-07-21 (« plan séparé
  après celui-ci »), jamais écrite. La mémoire projet
  `dock-largeur-saute-avec-barre-defilement` porte le bug voisin, non résolu :
  326 px pour 320 annoncés dès que la colonne défile, `flex-shrink` et
  `scrollbar-gutter` tous deux testés inefficaces.
  ⚠️ **CE BUG ET « la colonne du dock défile à 1280 × 720 » (plus bas) SONT LE
  MÊME**, constaté le 2026-08-18 : la mesure qui trouve 326 px trouve aussi
  `scrollHeight` 630 pour 556. Les 6 px sont la barre de défilement d'une colonne
  **qui ne devrait pas défiler du tout** — ADR-0001 l'interdit. Chercher un
  correctif de largeur (`flex-shrink`, `scrollbar-gutter`) traitait donc le
  symptôme ; les deux items se ferment ensemble ou pas du tout.
- **`docs/design-qa/2026-08-04-dock-flat-workspace.md`** porte deux findings
  P1 ouverts, dont « sens de *plein écran* non déterminé », qui demande
  explicitement un arbitrage avant toute mutation de layout.

### ✅ SOLDÉ le 2026-08-18 — la palette d'outils ne saute plus, mesurée à 0 px

La barre d'options est PERMANENTE et à hauteur constante (voie A,
[ticket 27](../.scratch/prochain-palier/issues/27-la-barre-d-options-regle-l-outil-ou-le-calque.md)),
et ses valeurs appartiennent à l'OUTIL — « le prochain rectangle sera bleu ».
Re-mesuré par CDP dans la vraie fenêtre, document ouvert, sur les quatre outils :
haut de la palette **identique (0 px d'écart)** contre +75 px avant, hauteur de
toile identique, barre à 75 px constants.

Le coût qu'ADR-0001 refuse — deux surfaces pour une même valeur — n'est pas
dissous mais **borné par le typage** : le modèle ne connaît aucun calque, et son
seul canal vers un calque est `paramsPourNouveauCalque`, appelé à la création.

⚠️ **Deux défauts trouvés en câblant, aucun par un test.** La hauteur constante
ne l'était pas aux deux premiers essais (36 px puis 68 px contre 75 px de contenu
réel), et le sélecteur de primitive affichait « 0 » — le défaut de `borne` dans
`aplat` vaut « aucune borne », une valeur absente de sa propre liste de choix.
Celui-là s'est vu sur une CAPTURE, pas dans le code.

⚠️ **ET LA BARRE A UN SECOND PRIX, QUI EST RESTÉ OUVERT** — voir « la colonne du
dock défile à 1280 × 720 » plus bas. Le prix de la voie A ne se paie pas que sur
la toile, et personne ne l'avait mesuré de ce côté-là.

### ✅ SOLDÉ le 2026-08-19 — la colonne du dock ne défile plus : des groupes à ONGLETS

**Résolu par le modèle Photoshop, pas par l'arbitrage que ce bloc annonçait.**
`DockLayout` passe de « colonnes de lignes » à « colonnes de GROUPES à
onglets » ; disposition livrée : Presets et Propriétés en onglets d'un groupe,
la Pile seule dans le sien. La carte « Textures » est partie le même jour
(demande d'Antoine — son geste avait perdu sa raison d'être depuis ADR-0018).

**Débord 194 px sur sept calques → la colonne TIENT**, et
`--dock-card-list-rows` n'a PAS eu à être abaissé : la note « la borne à 5
lignes est voulue » reste intacte. Aucune des deux voies que ce bloc opposait
n'a été prise.

⚠️ **DEUX mécanismes ont été construits puis RETIRÉS avant celui-là**, chacun
sur une mesure : un auto-repli déclenché par la hauteur disponible (sans
précédent chez Photoshop ni Lightroom — une carte qui se referme pendant qu'on
travaille est un mouvement qu'on n'a pas demandé), et le **Solo mode** de
Lightroom, qui TENAIT la colonne mais rendait Pile et Propriétés mutuellement
exclusives alors qu'on les lit ensemble. Son coût n'était pas des pixels mais un
geste.

⚠️ **Et un constat de ce bloc était FAUX** : « baisser le plancher des listes
libérerait les ~70 px manquants » valait sur DEUX calques et pas sur SEPT, où
chaque ligne retirée rend exactement 60 px (194 → 134 → 74 → 14 de 5 à 2
lignes). Un relevé borné à un scénario, présenté comme général — et il a failli
faire trancher de travers.

Détail et mesures : [ticket 04 de la carte hybride](../.scratch/hybride-lightroom-photoshop/issues/04-le-layout.md).

#### Le diagnostic d'origine, conservé pour ses mesures

Trouvé en mesurant le layout, et **causé par la barre d'options permanente** de
la veille : ses 75 px sortent de la hauteur de la colonne.

Reproduit dans l'état exact où il apparaît — document ouvert, aplat tracé et
SÉLECTIONNÉ, donc carte Propriétés chargée de ses dix-huit réglages :

```
grille : hauteur 556  ·  scrollHeight 630  ·  clientHeight 556
cartes : Presets 184 · Pile 224 · Textures 52 · Propriétés 112  (572 + 24 de gouttières)
→ « Propriétés · Aplat » finit 24 px SOUS le bord de la fenêtre, hors de la grille
```

À 1440 × 810 tout rentre (646 disponibles pour 622 nécessaires) : le défaut
n'existe qu'en dessous d'un seuil. ⚠️ Et 1280 × 720 est une taille **pleinement
supportée** — `--window-min-height` vaut 600 px — donc ce n'est pas un cas limite.

**Le mécanisme est clair, et ce n'est pas une compression qui manque** : la chaîne
fonctionne, Propriétés est déjà à son plancher. C'est que la SOMME des planchers
dépasse la hauteur disponible, et la colonne retombe sur son `overflow-y: auto`.
ADR-0001 l'interdit dans sa lettre : « jamais un défilement de colonne ».

⚠️ **Baisser la barre ne corrige pas, et l'essai a été fait plutôt que supposé** :
les libellés en ligne la ramènent à 55 px, soit **20 px rendus pour 40
manquants**, et cassent le nom accessible des quatre curseurs (Base UI porte
`aria-labelledby` sur le POUCE, pas sur l'input) — la garde d'accessibilité l'a
attrapé. Piste abandonnée, mesure conservée dans le token.

**Ce qui reste est un ARBITRAGE, pas un correctif**, parce que chaque voie défait
une décision écrite :

1. **Baisser le plancher des listes sous pression** — `--dock-card-list-rows: 5`
   libérerait les ~70 px manquants à 3 lignes. Mais `CLAUDE.md` note que la borne
   à 5 lignes est VOULUE, pas un défaut.
2. **Replier une carte plutôt que laisser la colonne défiler** — conforme à
   ADR-0001, mais il faut dire LAQUELLE, et replier celle qu'on vient de
   sélectionner serait absurde.

[Ticket layout](../.scratch/hybride-lightroom-photoshop/issues/04-le-layout.md),
qui porte aussi les proportions mesurées aux trois tailles de fenêtre (le
pasteboard tient plus de quatre cinquièmes partout — **la disposition n'a pas
d'écart de principe**).

### ✅ SOLDÉ le 2026-08-18 — le sélecteur de fichier accepte ce que la toile acceptait

Le filtre `["jpg", "jpeg"]` de `pick_image_file` est levé. **Deux filtres, dont
un attrape-tout** (`Tous les fichiers`, `*`) — ce qui répond au « quels
formats » en retirant sa portée : seuls JPEG et PNG sont NOMMÉS (les deux
mesurés), rien n'est interdit. Sûr parce que structurel : le glisser-déposer
n'ayant jamais eu de filtre, un format indécodable échouait déjà identiquement
sur les deux chemins.
Retiré dans le même geste, le mensonge attenant : le `{ type: "image/jpeg" }`
revendiqué sur des octets inconnus (personne ne lit `.type` — vérifié), et
« Dépose un JPEG ici ». L'export n'a pas bougé, et l'avertissement est écrit
dans l'en-tête de `pick_image_file`, sur le code qu'on lira en voulant élargir.

### ✅ SOLDÉ le 2026-08-18 — les cinq différés de masquage : quatre étaient déjà tombés

`2026-07-18-shaderlab-layers-masking-prd.md`. Tranché par le
[ticket 08](../.scratch/prochain-palier/issues/08-lesquels-des-cinq-differes-de-masquage.md).

**Trois sortent avec l'outil de sélection** (hors portée depuis le 2026-08-17,
sa propre carte) : pen/path Bézier, sélection rect/ellipse, lasso. C'est mot
pour mot ce que cette sortie de portée décrit — « détourer à la main, tracer une
silhouette, combiner des régions ». Ils ne diffèrent que par le GESTE.

**Le dégradé radial** (donné pour jamais livré) l'est depuis le 2026-08-14.

**Restent depth mask et segmentation sémantique**, même dépendance : un modèle
de vision monoculaire LOCAL. Le déclencheur du depth mask EST atteint, mais un
déclencheur atteint ne vaut pas décision → recherche demandée et **RENDUE le
2026-08-18** (voir le bloc ci-dessous).

### ⚠️ OUVERT le 2026-08-18 — embarque-t-on un modèle de vision ? La recherche est rendue, la décision non

[`research/29-modele-de-vision-embarque.md`](../.scratch/prochain-palier/research/29-modele-de-vision-embarque.md)
— 1135 lignes, provenance marquée par affirmation, 63 incertitudes nommées.

**Le mur n'est pas le coût, c'est la NETTETÉ DE BORD, et elle est plafonnée
avant qu'un modèle entre en jeu.** Ces modèles voient **784 × 518**, soit 1,6 %
d'une photo 26 Mpx ; une erreur d'1 pixel inféré vaut **8 pixels** sur la photo ;
et le **F1 de frontière plafonne à 0,065 même avec une profondeur PARFAITE**.
Pour doser un effet par la distance, c'est ça qui décide. Le seul modèle qui
déplace le plafond (Depth Pro, 0,311) a des poids « recherche seulement » :
**plafond et licence sont corrélés.**

⚠️ Piège de licence contre-intuitif : **Depth-Anything V2 scinde sa licence PAR
TAILLE** (Small Apache, Base et au-delà CC-BY-NC) alors que **V1 est permissif
partout**. Prendre le plus récent est le geste qui perd la licence.

Mythes retirés : `onnxruntime.dll` = **15,40 Mio mesuré** (les 76 Mo qui
circulent sont à 95 % du `.pdb`) ; exe 20,47 Mo contre 9,1 aujourd'hui ; et le
temps **ne dépend pas** des 26 Mpx, l'entrée étant fixe. En Tauri v2 le Rust ne
voit pas le `GPUDevice` de la WebView — la piste WebGPU n'existe qu'en JS.
✅ `shader-f16` **est** disponible sur cette machine (sonde CDP, 2026-08-18),
mais `gpuContext.ts:120-125` ne la demande pas et une feature ne s'ajoute pas
après création : pas une limite du matériel, une ligne de notre code.

**Trou n°1, non comblé et le plus lourd : aucun chiffre de latence Windows grand
public n'existe pour aucun de ces modèles.**

### ✅ SOLDÉ le 2026-08-18 — les trois fronts des contrôles, et deux n'avaient rien à faire

⚠️ Ce document, `CLAUDE.md` et `docs/INDEX.json` avaient déjà déclaré ce chantier
soldé le 2026-08-05, à tort. **Il l'est cette fois, et sur mesure** — mais le
détail compte, parce que deux des trois fronts se sont révélés beaucoup plus
petits que ce bloc ne le disait.

**Front 1 (applicabilité) — le champ était COUVERT.** Il ne restait qu'UNE
déclaration à écrire, pas six effets. Le cadrage confondait trois choses : un
`choices` qui nomme un ESPACE (`transferSpace`) ou une ENTRÉE (`inputMode`) ne
gouverne rien — il change comment TOUS les réglages agissent, pas lesquels
existent. Seul un `choices` qui nomme un MODE peut rendre un paramètre inerte, et
les deux vrais modes restants (`halftone.rotation`, `grain.size`) ont été mesurés
VIVANTS. La seule dette était `glass.flat`, **seul VIVANT des 41 déclarations
depuis quatorze jours**, sur une déclaration que le code ne portait plus.
Sortie : **41/41 inertes**, le gate propre pour la première fois.
⚠️ **Le couple de valeurs a produit un FAUX « inerte »** : `0` vs `90` sur un
réseau CARRÉ le ramène sur lui-même. C'est le sens DANGEREUX de l'erreur —
masquer un curseur vivant ne fait rougir personne.

**Front 2 (sections) — le levier était le GABARIT, pas le découpage.** Quatre
sections passées en `grille`, **aucune scindée ni renommée**, zéro code écrit. Le
tableau de densité portait un SECOND dénominateur faux, propre à ce front : la
ligne VISUELLE, pas la rangée. `grille` et `paire` posent deux colonnes, ce qui
inversait le classement (`glass.pave` 8 rangées = 4 lignes contre
`gooeyMerge.fusion` 7 rangées = 7 lignes). Plafond opposable à **6 lignes**,
exception écrite pour `outlines.encre`. Garde `densiteSections.test.ts` : 16
orphelins déclarés avec leur raison, `duotone` corrigé.

**Front 3 (outils sur la toile) — livré avec sa portée DÉCLARÉE.** Les trois
écarts d'overlay étaient IDENTIQUES dans les quatre fichiers, donc un défaut de
SOCLE (`canvasHandle.css`) et non quatre défauts. Cible tactile à 24 px, peinture
à 12 : la recommandation porte sur la CIBLE. Plus le quatrième genre `box`, qui
débloque les poignées de l'aplat sans demander aucun manipulateur neuf.
**Hors portée, dit** : les 14 lignes qui supposent un manipulateur-OBJET (mur
partagé avec la typographie et les formes), et deux écarts séparables — l'origine
d'un `axis` clouée au centre, le magnétisme hors `TransformHandles`. Le troisième
(valeur affichée pendant le geste) est tombé le même jour pour l'outil Forme.

⚠️ **Le contexte historique de ce bloc, conservé** : c'est le constat d'Antoine du
2026-08-12 puis la mesure sur les modules réels
(`.scratch/prochain-palier/assets/mesure-controles.ts` — le grep ment, les
paramètres de `curves` sortent d'un `flatMap`) qui avaient rouvert les trois
fronts après une clôture prématurée. Le mécanisme était livré ; le chantier ne
l'était pas.

⚠️ **RE-MESURÉ le 2026-08-18, et le DÉNOMINATEUR de ce bloc était faux.** Un
`EffectParam` n'est pas une rangée de panneau : **76 des 365 sont consommés par
un contrôle composite** (points de `curveControls`, arrêts de
`colorRampControls`, bornes de `tonalRangeControl`, satellites d'un
`colorGroup`) et n'ont jamais de ligne à masquer.

**Parc réel : 24 effets · 365 params déclarés · 289 RANGÉES · 48 conditions de
paramètre (16,6 % des rangées) · 77 sections · 10 conditions de section.**

⚠️ **Chiffres du 2026-08-17, périmés depuis la tranche 3.** Re-mesuré le
2026-08-18 sur le même instrument : **27 effets · 382 params · 51 conditions de
paramètre · 83 sections · 16 effets sur 27 sans aucune condition**. Le RATIO n'a
pas bougé — les trois effets neufs apportent 2 conditions et 16 paramètres, donc
le numérateur et le dénominateur montent ensemble. Le décompte des RANGÉES (celui
qui compte, un contrôle composite ne faisant qu'une ligne) n'a pas été refait :
il demande le tableau de `--applicabilite`, pas ce script.

⚠️ **Ces chiffres du 2026-08-18 sont eux aussi périmés depuis le 2026-08-21** :
`emboss` retiré (ADR-0019) et `noise` reverté — deux effets sans condition en
moins, 27 → 26 effets. Ne pas les prendre pour l'état courant ; relancer
`.scratch/prochain-palier/assets/mesure-controles.ts`, jamais recopier.

Deux corrections qui changent le travail, pas seulement les chiffres :

- **`curves` s'effondre** — 37 déclarés, **13 rangées**. Il ouvrait le tableau
  des « plus chargés sans conditions » ; il est en milieu de peloton.
- ⚠️ **Pour HUIT effets, une condition est STRUCTURELLEMENT IMPOSSIBLE.** La
  voie A ne vise qu'un paramètre à `choices`, et le parc n'en compte que 25 :
  `curves`, `lightLeak`, `pixelStretch`, `texture`, `sliceShift`, `halation`,
  `duotone`, `glow` n'en ont **aucun**. **69 rangées** où la réponse n'est pas
  « il manque des conditions » mais « il n'y a rien sur quoi conditionner ».
- Le cas de démonstration du front 1 (`lensFlare`, « 30 params, 0 condition »)
  est **réparé depuis le 2026-08-14** : trois conditions de SECTION.

⚠️ **Front 3 : le vocabulaire est SATURÉ, pas sous-employé.** `CanvasControl`
est une union fermée à trois variantes, et le registre les utilise **toutes les
trois** (5 effets, 7 instances). Élargir la couverture demande d'étendre un
TYPE, pas de rattraper des déclarations oubliées — ce n'est pas du rattrapage,
c'est de la conception.

**L'inversion qui vaut pour tout le chantier** : les outils sur la toile portent
une condition à **43 %** (3/7), les paramètres à 17 %, les sections à 13 %. Le
plus jeune et le plus petit mécanisme est le mieux couvert — **la couverture
suit la TAILLE du parc à déclarer, pas la maturité du mécanisme.** Les fronts 1
et 2 ne se rattraperont donc pas par de la discipline seule.

**345 paramètres au total sur 23 effets** — chiffre du 2026-08-12, périmé, gardé
pour la trace.

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
| 1 | `15-l-applicabilite-couvre-10-pourcent.md` | zéro paramètre inerte non masqué, prouvé effet par effet, chaque déclaration éprouvée par `render-check.mjs --applicabilite` — ⚠️ **qui ne couvre que `EffectParam.appliesWhen`, pas `EffectSection.appliesWhen`** (constat du 2026-08-14 : les trois conditions de section de `lensFlare` ont dû s'éprouver par six scénarios jetables, écrits puis retirés). Étendre l'instrument aux sections, ou le front 1 se terminera sur des déclarations non mesurées |
| 2 | `16-les-sections-ne-sectionnent-pas.md` | un plafond de densité chiffré et opposable, aucun effet au-dessus, zéro orphelin sans raison écrite |
| 3 | `17-les-outils-sur-la-toile.md` | chaque effet dont la géométrie est le sujet porte son outil, et le geste tient une grille écrite AVANT d'implémenter |

L'ordre porte de l'information : **masquer réduit mécaniquement ce qui est à
l'écran**, donc re-sectionner avant de masquer serait sectionner un panneau qui
n'existera plus — le front 2 est explicitement bloqué par le front 1.

⚠️ **Arbitrage d'Antoine, 2026-08-12** : sur les outils, les DEUX manques sont
réels — le nombre de genres **et** la qualité du geste. Le front 3 ne peut donc
pas se clore sur un seul des deux.

#### ✅ La grille du front 3 est ÉCRITE — recherche résolue le 2026-08-12

`.scratch/prochain-palier/research/18-manipulateurs-directs.md` : **42 lignes**
(17 genres, 25 points d'anatomie du geste), sources citées, deux passes de
navigateur indépendantes. Le front 3 n'a plus à deviner ce que « niveau
Photoshop » veut dire — il a un critère de sortie vérifiable.

**11 des 42 lignes sont déjà faites** chez nous en tout ou partie : le socle
n'est pas à refaire, il est inégal. Écarts mesurés indépendamment :

- ✅ **zéro règle `:hover`** dans les quatre CSS d'overlay — CORRIGÉ le
  2026-08-18 : les trois écarts étaient IDENTIQUES dans les quatre fichiers, donc
  un défaut de SOCLE (`canvasHandle.css`) et non quatre défauts ;
- ✅ **poignées de 12 px** pour 24×24 recommandés — CORRIGÉ, et la lecture
  comptait : **la recommandation porte sur la CIBLE, jamais sur la peinture**.
  Deux tokens désormais — `--canvas-handle-size` (12 px, ce qu'on voit) et
  `--canvas-handle-target` (24 px, ce qu'on attrape, par un pseudo-élément qui
  déborde). Une poignée de 24 px peinte sur une petite forme la recouvrirait.
  ⚠️ Le découplage d'avec `--slider-thumb-size` — le token du POUCE DE SLIDER,
  que les quatre lisaient — était bien le préalable qu'annonçait ce bloc : sans
  lui, agrandir la poignée d'un manipulateur grossissait le pouce de tous les
  curseurs du dock ;
- `src/ui/snap.ts` **existe déjà** (`SNAP_THRESHOLD_SCREEN_PX = 8`,
  `SnapGuide`, `boundingBox`) et calcule la géométrie du magnétisme qui manque
  partout sauf dans `TransformHandles` ;
- ⚠️ **valeur de paramètre pendant le geste** : tombée pour l'outil FORME le
  2026-08-18 (dimensions en pixels de l'image pendant le tracé), **toujours
  absente pour les quatre genres de `CanvasControl`**. Ce n'est pas une
  correction de socle mais un ajout : il demande de décider CE QU'ON MONTRE pour
  chacun, et en quelle unité ;
- ⚠️ l'origine d'un `axis` est **toujours** clouée au centre, d'où dans
  `lightLeak` une « Entrée de la lumière » et un « Trajet » sans aucun lien
  géométrique. C'est un changement de CONTRAT (un axe gagnerait une origine,
  donc un cinquième rôle de paramètre), pas un réglage de CSS ;
- ⚠️ le **magnétisme hors `TransformHandles`** reste à faire : `src/ui/snap.ts`
  calcule la géométrie, mais les cibles d'accroche d'un point d'effet ne sont pas
  celles d'une photo, et personne n'a dit lesquelles.

Trois pièges contraires à l'intuition, à ne pas réapprendre : l'accroche
d'angle n'est **pas** un seul nombre (15° en rotation, **45°** sur un point de
chemin, même touche) ; **`Maj` dans Photoshop depuis 2019 n'a pas de sens
fixe** — c'est une bascule d'un état PERSISTANT, invisible dans le geste ; et
« Photoshop masque ses poignées sur une petite sélection » n'est confirmé par
aucune page. Un candidat a été **infirmé** : la poignée d'angle des *live
shapes* n'existe pas, c'est un champ de la barre d'options.

#### ⚠️ Un lien NON PRÉVU, qui peut réordonner tout le palier

**14 des 42 lignes supposent qu'un manipulateur soit un OBJET** —
sélectionnable, duplicable, supprimable, à cardinalité variable — là où le
nôtre est une projection de paramètres nommés sur un `Record<string, number>`.

**C'est exactement le mur de la typographie et des formes** (bloc 2 ci-dessus,
et `.scratch/prochain-palier/issues/03-…` / `04-…`). Le front des outils et la
question du modèle de document ne sont donc **pas indépendants**, ce qu'aucun
des deux chantiers n'avait anticipé : une réponse sur `contentSource`
déciderait aussi du plafond des manipulateurs.

**Les 28 autres lignes ne demandent pas ce changement.** Il existe donc un
palier atteignable sans toucher au modèle, et un au-delà qui en dépend — le
front 3 doit déclarer où il s'arrête.

⚠️ Note de conservation : **la référence de raccourcis Photoshop a été SUPPRIMÉE
du site d'Adobe.** Le §Méthode du document de recherche liste les dix pages
survivantes en style ancien — à archiver si le front 3 doit s'y appuyer dans six
mois.

Contrainte dure commune : un paramètre ne se retire pas sans casser les presets
qui le citent, contrairement à un effet retiré ; et `test:render` doit rendre
zéro écart après tout travail de panneau.

### ✅ SOLDÉ le 2026-08-18 — il n'y a pas de « migration shadcn », et la dette est de 4

Ni oui ni non : la mesure a montré un TROISIÈME patron que personne n'avait
décidé et que tout le monde suivait. **Il est désormais la règle**, écrite dans
`CLAUDE.md` § Stack :

> Un composant **COMPOSE** les primitives `src/components/ui/` pour tout ce qui
> est un **CONTRÔLE**, et habille sa **MISE EN PAGE** en CSS classique à noms
> BEM. Posée comme ADR-0001 : au moment où le composant s'écrit, jamais en lot
> de rattrapage.

**24 des 30 composants applicatifs sont DÉJÀ conformes.** Restent **quatre** :
`CurveControl`, `EffectPicker`, `PropertiesPanel`, `TexturePicker`. La dette ne
tombe pas parce qu'on baisse la barre — elle était mal placée : elle mesurait le
style de l'HABILLAGE au lieu de la provenance des CONTRÔLES.

⚠️ Deux chiffres de ce document étaient faux. **« 17 sur 27 »** venait d'un test
« le composant importe-t-il un `.css` ? », qui rate tout composant dont la
feuille BEM vit ailleurs. Et **aucun composant n'a jamais été entièrement
migré** — zéro Tailwind pur dans tout le parc ; les « trois migrés » sont trois
hybrides, dont `BrushToolbar` qui porte en fait son propre `.css` et zéro
utilitaire.
Reste vrai : `lint:tokens` vert sur 261 fichiers, **aucun style ne contourne un
token**. Ce n'a jamais été une dette de design system.

### ✅ Branches mortes — SUPPRIMÉES le 2026-08-16

Sept branches distantes retirées, chacune **vérifiée avant le geste** et non sur
la foi de ce que ce document en disait :

| branche | uniques | pourquoi elle pouvait partir |
| --- | --- | --- |
| `claude/quizzical-hofstadter-b276ac` | 0 | rien d'unique |
| `feature/dock-width-resize` | 0 | rien d'unique |
| `worktree-agent-af9e8ffc69359d5ab` | 0 | rien d'unique |
| `claude/lucid-vaughan-6f8fc7` | 4 | dépose du round-trip — faite autrement sur `master` : `isLaunchFile`/`roundTripActive` n'y existent plus qu'en commentaires |
| `claude/wonderful-thompson-fd0488` | 2 | garde overlay/export — sur `master` sous une MEILLEURE forme (`maskOverlayFor`, plus trois tests dont un témoin) |
| `claude/mattpocock-skills-wayfinder-6lxjiz` | 2 | son correctif Vite a été RÉCOLTÉ avant suppression (voir ci-dessous) ; le reste est un `settings.json` de plugin et une story déjà verte |
| `sat-feather` | 12 | verdict rendu le 2026-08-13 : `aee22fb` porté en passe `featherSat` |

⚠️ **UNE BRANCHE MORTE PEUT PORTER UN CORRECTIF QU'ON N'A PAS.**
`claude/mattpocock-skills-wayfinder-6lxjiz` portait déjà, depuis le 2026-08-11,
un correctif du défaut CI du ticket 22 — et **plus complet que celui trouvé le
2026-08-16** : elle pré-bundlait TOUT le jeu d'entrées React, là où le mien ne
couvrait que l'entrée que Vite avait découverte ce jour-là. Récolté (`a53cf18`)
avant de supprimer. **Mesurer les branches avant de les jeter n'est pas une
formalité de nettoyage.**

⚠️ **Et deux affirmations de ce document étaient fausses** : il donnait
`claude/wonderful-thompson-fd0488` pour « déjà dans master » et
`claude/lucid-vaughan-6f8fc7` pour « superseded », alors que les deux portaient
des commits uniques. Elles l'étaient en CONTENU, pas en commits — la conclusion
tenait, la raison écrite était fausse, et seule la vérification le montre.

### Ce qui RESTE, et pourquoi

- ~~**`mipmaps-bibliotheque`**~~ — ✅ **verdict rendu et branche FUSIONNÉE le
  2026-08-17.** Ne plus la citer comme en attente.
- **`task-management`** (1 commit unique) — `DesignPreview.tsx`, **480 lignes
  jamais fusionnées et citées nulle part**. Ce n'est pas un reliquat, c'est du
  travail orphelin : le supprimer perd le code. Décision à prendre.
- `feature/design-system` — miroir de `master` (ADR-0005), gardée telle quelle.

---

## Ce que cette feuille ne porte pas, et où c'est

| Question | Fichier |
| --- | --- |
| Statut d'un chantier passé | `docs/INDEX.json` |
| Décisions tranchées (ADR) | `.claude/decisions/INDEX.md` |
| Vocabulaire de domaine | `CONTEXT.md` |
| Couches, ports de test, risques | `ARCHITECTURE.md` |
| Règles permanentes, commandes | `CLAUDE.md` |
