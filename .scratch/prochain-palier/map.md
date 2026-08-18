# Carte — Le prochain palier de shaderlab

Label : `wayfinder:map`
Chartée le 2026-08-11, depuis un balayage mesuré sur disque (pas repris des docs).

## Destination

Le prochain palier a sa route dégagée : **composition** (formes, typographie),
**recadrage**, **lisibilité et complétude de l'interface**, et les **chantiers
dormants** trouvés au balayage du 2026-08-11 ont chacun soit une décision prise
et un plan écrivable, soit une sortie de portée écrite — le tout sans rendre
l'export print 16-bit plus cher à introduire ensuite.

L'axe interface est entré le 2026-08-11 sur demande d'Antoine : rendre lisibles
les menus et les fonctions, et compléter par ce qui manque — instruit par
comparaison avec Photoshop et Lightroom, sous la règle du dépôt (« le doublon
se mesure avant de s'écrire ») et sous ADR-0001.

Fin de carte = plus aucun arbitrage bloquant entre ici et le premier
implémenteur. La carte produit des **décisions**, pas du code.

## Notes

**Domaine et lectures obligatoires** : `CLAUDE.md` (règles permanentes),
`CONTEXT.md` (vocabulaire), `ARCHITECTURE.md` (couches, ports de test),
`docs/ROADMAP.md` (ce qui reste), `.claude/decisions/INDEX.md` (ADR actifs —
citer le DOSSIER, jamais un numéro nu : `docs/adr/` a sa propre numérotation
qui recouvre celle-ci).

**Skills à consulter** : `/grilling` et `/domain-modeling` par défaut ;
`/prototype` quand la question est « à quoi ça ressemble » ; `/research` pour
tout ce qui vit hors du dépôt ; `/run-shaderlab` pour toute preuve visuelle.

**Contrainte permanente de cette carte** — issue de la destination : l'export
print est **réel mais lointain**. Aucune décision de cette carte ne doit rendre
le passage en 16-bit plus cher. ✅ **Sa forme opposable est écrite** (mesurée le
2026-08-12, [Ce que coûte d'attendre le 16-bit](issues/02-cout-d-attendre-le-16-bit.md)) :

> **Tout site qui choisit un format de texture COULEUR reçoit `srgbFormat` par
> injection — jamais une constante littérale, jamais un format déduit sur
> place.** Une décision (`gpuContext.ts:160`), quatorze lecteurs, zéro format
> en dur : c'est cette propriété qui rend le 16-bit introduisible plus tard.
> La préserver coûte zéro ; la perdre coûte une chasse dans huit fichiers.
>
> **Corollaire : un effet ne choisit JAMAIS de format.** S'il semble en avoir
> besoin, c'est la conception qui est fausse — le patron est
> `textureLibraryStore`, où le STORE choisit et l'effet consomme.

Bonne nouvelle pour le reste de la carte : **formes, typographie et recadrage
ajoutent ZÉRO site à la facture 16-bit**, un effet ne voyant jamais le format.

**Préférences de méthode, payées cher, non négociables ici** :

- **Mesurer sur disque avant de conclure.** `docs/INDEX.json` et
  `.superpowers/sdd/progress.md` ont tous deux été pris en défaut optimiste.
  Un statut de doc n'est vrai qu'à la date de sa mesure — un champ de
  `INDEX.json` a survécu 9 jours à sa propre réfutation.
- **L'index d'un paramètre est PERSISTÉ dans les presets.** `params[]` ne se
  réordonne jamais ; on ajoute une entrée à la FIN d'une liste de choix,
  jamais au milieu.
- **Un doublon se mesure avant de se retirer**, et la mesure répond souvent
  deux choses (cf. ADR-0016 : 0,005 % d'écart sur un axe, 23,1 % sur l'autre).
- **Demander les photos d'Antoine avant de raffiner sur des références
  publiques** — deux passes sur trois économisées sur `lensFlare`.
- **Avant tout dispatch** : `git worktree list` ET `git log --oneline -3`.
  Des sessions concurrentes ont déjà collisionné sur ce dépôt.

## Notes de sortie de session — 2026-08-16

⚠️ **La CI de `master` est VERTE** (run `31986492689`), pour la première fois
depuis au moins le 2026-08-01. Les trois tickets ouverts par les sessions des 15
et 16 août — [20](issues/20-ou-vit-l-etat-de-repli-de-la-pile.md),
[21](issues/21-le-gate-wgsl-est-rouge-en-ci.md),
[22](issues/22-layerpanel-rouge-en-ci-vert-en-local.md) — sont tous `resolved`.

**Ce qui reste sur cette carte est ce qui y était avant** : onze tickets
d'arbitrage de fond (formes, typographie, parité du calque photo, masquage,
lisibilité, migration shadcn, les trois fronts des contrôles, le coût du verre).
Aucun n'est un reste de ces deux sessions.

## Decisions so far

- **Arbitrages d'Antoine du 2026-08-15**, pris sur planches et sur mesures :
  - **Le verre reçoit son mipmap de diffusion.** Seul levier qui attaque les
    7,4 ms par lecture au lieu de les compter. Écartées explicitement : ne rien
    changer (~10 images/s), et baisser la résolution pendant le geste — qui
    contredirait « pas de distinction preview/export ». Prix connu d'avance :
    18 références de verre à régénérer et à relire.
    Détail : [19](issues/19-le-cout-du-verre.md).
  - **`lensFlare` : trois interrupteurs CUMULABLES**, pas un sélecteur exclusif
    — un objectif produit les trois phénomènes à la fois (ADR-0017). Livré le
    2026-08-14, applicabilité mesurée à 0,000 % avant d'être déclarée.
  - **La pile se replie par groupes**, avec le filet, et la ligne sélectionnée
    devient un bloc décalé dont la barre bleue est l'arête (variante C,
    implantation c1) ; décalage porté de 14 à 20 px. Trois wireframes sous
    `docs/wireframes/pile-longue*.html`. Ce qui reste ouvert est le MODÈLE :
    [20](issues/20-ou-vit-l-etat-de-repli-de-la-pile.md).



- [Quelles fonctions retenir, et dans quel ordre](issues/12-quelles-fonctions-retenir.md)
  — **RÉSOLU le 2026-08-18. Périmètre : tout, netteté comprise** (Antoine), et
  l'inverse d'`aplat` adopté (un booléen en fin de `params[]`, qui rend
  atteignables les vignettes hexagonale et octogonale déjà géométriquement
  livrées).
  ⚠️ **La mesure a renversé la prémisse la plus lourde du ticket : la netteté
  n'est pas doublement bloquée, elle ne l'est pas du tout.** Le dernier pass de
  `glow` tient DÉJÀ les deux images — `color` (son entrée non floutée) et
  `prevPass` (sa pyramide) — donc un masque flou est `color + (color − bloom)·f`,
  la même forme au signe près. Pas besoin d'un mode signé (la soustraction est
  DANS l'effet), pas besoin de lire un autre calque (il faut sa propre entrée à
  deux échelles, ce que `passes` fournit). **Elle passe de « chère et bloquée » à
  la même case qu'emboss.**
  ⚠️ **Et une justification tombe avec** : les modes signés étaient en partie
  justifiés comme prérequis de la netteté. Ils entrent désormais pour eux-mêmes.
  Ordre en trois tranches : **socle de fusion** (6 modes d'un coup — l'interface
  est `blend(base, top)`, elle reçoit déjà les deux couleurs entières, et
  `blendMode` étant une CHAÎNE aucun index de preset ne bouge ; solde le
  split-tone différé depuis le 2026-07-20) → **levées de contrainte** (courbe
  libre, inverse d'`aplat`) → **effets à machinerie existante** (netteté, emboss,
  carte de déplacement — trois fois le même patron, donc parallélisables).

<!-- une ligne par ticket clos : le gist, puis le lien pour le détail -->

- [Quels mécanismes de lisibilité adopter](issues/11-quels-mecanismes-de-lisibilite-adopter.md)
  — **RÉSOLU le 2026-08-18.** Quatre adoptés (filtre par nom dans Presets et
  Textures · avant/après par touche maintenue · retour au défaut au double-clic ·
  mode Solo des cartes), un **refusé** (l'œil par section — il franchit vers le
  MODÈLE, et `lensFlare` a déjà résolu ce besoin par des interrupteurs déclarés
  dans l'effet).
  **La question de fond est tranchée devant une planche, pas sur un principe :
  on garde le MASQUAGE.** Planche `docs/wireframes/faner-ou-masquer.html`, sur
  le pire cas réel (`glass` sur Poli, 13 des 22 paramètres sans objet), et qui
  **mesure ses propres hauteurs** : masquer 445 px, faner tout **1030 px = 76,6 %
  du budget de colonne pour UNE carte**, faner en section 489 px. Ce qui a tué la
  troisième voie est ce chiffre, pas ADR-0001.
  ⚠️ L'écart B/C ne vient pas du NOMBRE de conditions mais de leur RÉPARTITION —
  8 paramètres groupés se replient en une ligne, 5 isolés ne se replient pas.
  🆕 **Enrichissement demandé par Antoine devant la planche** : montrer la valeur
  par DÉFAUT grisée, uniquement quand la valeur en diffère. Née d'un malentendu
  fécond — il a lu des défauts là où la planche montrait des valeurs courantes
  fanées, et l'idée lue vaut mieux que celle qui était dessinée.
  ⚠️ Elle **ne couvre que les curseurs** : un `choices` n'a pas de valeur grisée
  à afficher, les courbes de `curves` encore moins.

- [Ce que coûte un modèle de vision embarqué](issues/29-ce-que-coute-un-modele-de-vision-embarque.md)
  — recherche **RENDUE le 2026-08-18**, le jour de son ouverture.
  **Le mur n'est pas le coût, c'est la NETTETÉ DE BORD, et elle est plafonnée
  avant qu'un modèle entre en jeu** : ces modèles voient **784 × 518**, soit
  1,6 % d'une photo 26 Mpx ; 1 pixel inféré = 8 pixels sur la photo ; **F1 de
  frontière plafonné à 0,065 même avec une profondeur PARFAITE**. Pour doser un
  effet par la distance, c'est ça qui décide. Le seul modèle qui déplace le
  plafond a des poids « recherche seulement » — **plafond et licence sont
  corrélés**.
  ⚠️ **Depth-Anything V2 scinde sa licence PAR TAILLE** (Small Apache, Base et
  au-delà CC-BY-NC) alors que **V1 est permissif partout** : « prendre le plus
  récent » est le geste qui perd la licence.
  Coût, mythes retirés : `onnxruntime.dll` = **15,40 Mio mesuré** (les 76 Mo qui
  circulent sont à 95 % du `.pdb`), exe 20,47 Mo contre 9,1 aujourd'hui, et le
  temps **ne dépend pas** des 26 Mpx. En Tauri v2 le Rust ne voit pas le
  `GPUDevice` de la WebView : la piste WebGPU n'existe qu'en JS.
  ✅ Trou n°2 comblé le jour même par sonde CDP : `shader-f16` **est** disponible
  ici — mais `gpuContext.ts:120-125` ne la demande pas, et une feature ne
  s'ajoute pas après création. Pas une limite du matériel, une ligne de notre
  code.
  **La décision produit reste ENTIÈRE** : la recherche rapporte, elle ne tranche
  pas.

- [Lesquels des cinq différés de masquage entrent dans ce palier](issues/08-lesquels-des-cinq-differes-de-masquage.md)
  — **RÉSOLU le 2026-08-18. Quatre des six étaient déjà tombées avant qu'on
  ouvre le ticket.** Pen/path, géométrique rect-ellipse et lasso sont **mot pour
  mot** ce que la sortie de portée de l'outil de sélection décrit la veille
  (« détourer à la main, tracer une silhouette », la primitive nommée) — ils y
  vont ensemble. Et l'addendum « dégradé radial jamais livré » est **livré**
  depuis le 2026-08-14 (`22c8049`), verrouillé par deux références.
  Reste 1 et 2 (depth mask, segmentation), même famille, même dépendance : un
  modèle de vision local embarqué. Arbitrage d'Antoine — **ni entrée ni sortie,
  une recherche d'abord**, personne n'ayant les chiffres qui rendent la décision
  produit possible (licence des POIDS avant tout, l'app étant distribuée).
  Sorti en [ticket 29](issues/29-ce-que-coute-un-modele-de-vision-embarque.md).
  ⚠️ **Leçon de carte** : ce ticket a été écrit sur une question qu'un AUTRE
  ticket allait clore, et sa résolution ne cite aucun numéro. Rien ne le
  signalait — le repérage vient de relire ce qu'une décision DIT, jamais d'une
  recherche par identifiant.

- [Le sélecteur de fichier refuse ce que le glisser-déposer accepte](issues/26-le-selecteur-refuse-ce-que-le-glisser-depose-accepte.md)
  — **RÉSOLU le 2026-08-18.** Filtre levé, et la forme choisie fait que le
  sélecteur ne peut plus redevenir le chemin le plus étroit : deux filtres, dont
  un **attrape-tout**. Ça répond au « quels formats » du ticket en retirant sa
  portée — seuls JPEG et PNG sont NOMMÉS (les deux mesurés), rien n'est interdit.
  Sûr parce que structurel : le glisser-déposer n'a jamais eu de filtre, donc un
  format indécodable échoue déjà identiquement sur les deux chemins. Retiré dans
  le même geste : le `{ type: "image/jpeg" }` revendiqué sur des octets inconnus
  (personne ne lit `.type` — vérifié), et « Dépose un JPEG ici ».
  Preuve en fenêtre réelle : PNG 600×400 RGBA à disque opaque sur fond
  transparent — le transparent laisse passer la photo jusqu'au bord du disque.
  ⚠️ **Piège de sonde payé ici** : un chemin Windows en antislashs passé à
  `driver.mjs eval` perd ses séparateurs, et `importPhotoByPath` échoue alors en
  rendant une promesse RÉSOLUE (faute avalée par son `catch`). La sonde
  rapportait « import OK, zéro calque » — indiscernable d'un bug de l'app. C'est
  le TÉMOIN JPEG, qui échouait pareil, qui a désigné la sonde. Slashes avant
  dans tout chemin passé à `eval`.

- [Ce qui reste du design de parité du calque photo](issues/05-ce-qui-reste-du-design-de-parite-du-calque-photo.md)
  — **RÉSOLU le 2026-08-18. Le modèle est confirmé, le design §3.1 reste
  écrivable**, moyennant trois corrections nommées. Deux arbitrages d'Antoine :
  **les DEUX recadrages sont demandés** (le geste TOILE n'est pas dans §3.1 —
  sorti en [ticket 28](issues/28-recadrer-la-toile-deja-ouverte.md)), et **le
  miroir reste, en échelles SIGNÉES** — la réouverture que le design nommait,
  déclenchée en entier.
  ⚠️ **Le ticket lisait « le miroir est tombé entre les deux ». C'est la tranche
  T3 ENTIÈRE qui n'a jamais été livrée**, et elle portait trois prérequis du
  crop sans rapport avec le miroir : `transformsEqual` (0 occurrence — donc
  valider un crop ne produirait aucune entrée d'undo, la comparaison énumérée ne
  voyant que 5 champs scalaires), `clone()` qui ne recopie toujours pas
  `transform`, et `updateLayerTransform` toujours vivant à zéro appelant. Le
  ROADMAP se trompait donc deux fois.
  ⚠️ **Et le signé porte un défaut MUET**, trouvé en mesurant : le feather
  multiplie une DISTANCE par l'échelle (`photoLayerInput.ts:80-84`). Correction
  d'un mot (`abs`), mais aucune référence ne l'aurait attrapé : elles ne
  miroitent rien, puisque le miroir n'existe pas. **La référence de pixels du
  miroir se pose AVANT le geste**, et sa mire doit montrer le bord ET quelques
  pixels autour. En contrepartie le signé EFFACE le livrable le plus risqué de
  T3 (branche de flip CPU + WGSL, `PHOTO_INVERSE_TRANSFORM_WGSL`, harnais
  `gpu-parity.mjs`) — l'inverse-transform divise déjà par l'échelle.
  ⚠️⚠️ **J'avais écrit « le calque miroité disparaît entièrement ». FAUX** —
  Antoine a demandé la vérification, la formule a été repliée en Node, et elle
  renverse la description : l'alpha s'INVERSE sur l'axe miroité (0 à l'intérieur
  de la photo, **1,0 juste en dehors**). Un trou à la place de l'image et une
  bande opaque à côté — pire qu'une disparition, un trou faisant chercher là où
  une bande se regarde comme un rendu. **Un défaut décrit de tête au lieu d'être
  replié en dix lignes de Node ressort plausible et faux** ; c'est la même faute
  que la prémisse du mipmap de bibliothèque, deux jours plus tôt.
  ⚠️ Au passage : **le compte de références de ce document était périmé** —
  mesuré, **102 PNG, tous déclarés**. `CLAUDE.md` disait 97, ce document 77 ;
  les deux sont corrigés.
  ⚠️⚠️ **Et j'ai d'abord annoncé « 4 orphelins », ce qui était FAUX** : un
  artefact de mon propre grep, poussé en tâche avant vérification. Quatre
  scénarios sont générés par un `Object.fromEntries` étalé au lieu d'être écrits
  en clés, donc invisibles à un motif calé sur la syntaxe des clés. **Un
  comptage qui dépend d'une FORME syntaxique n'est pas une mesure** — partir de
  l'artefact (les PNG) et non du code. Deuxième constat faux de la même
  session, après « disparaît entièrement » : les deux avaient l'air décisifs,
  et les deux venaient d'avoir sauté l'épreuve.

- [Aplat passe à la qualité](issues/24-aplat-passe-a-la-qualite.md) — **RÉSOLU le
  2026-08-17** sur deux de ses trois fronts. Livrés : le remplissage en DÉGRADÉ
  (linéaire et radial, arrêts interpolés en LINÉAIRE — un fondu mélangé en gamma
  passe par un milieu assombri) et le POLYGONE (3 à 12 côtés ; pas d'étoile,
  aucun besoin mesuré). Écartés par Antoine : contour et rayon d'angle. Le
  troisième front est sorti dans le [ticket 25](issues/25-les-poignees-de-l-aplat.md),
  seul à dépendre du 17. ⚠️ La garde de câblage a attrapé quatre index décalés
  qui lisaient tous du plausible.

- [Le coût du verre](issues/19-le-cout-du-verre.md) — **RÉSOLU le 2026-08-17.**
  Le mipmap de diffusion est livré et mesuré en production : **13,6 → 39,9
  images/s** au réglage courant, 47,4 sur la course complète d'Épaisseur. La
  cible d'usage d'Antoine (« le confort au pointeur ») est atteinte. Mécanisme :
  `EffectModule.sourceMipmaps`, un drapeau déclaratif servi par une COPIE à
  pyramide — donner la pyramide aux cibles de ping-pong faisait sortir la frame
  NOIRE, sans que `tsc` en dise rien. ⚠️ Le plafond de niveau a d'abord été posé
  à 1 sur une mesure « à niveau forcé » qui ne prédisait pas une implantation « à
  niveau dérivé » : la corriger a doublé le gain. Un plafond vérifié à UN point
  de fonctionnement ne vaut pas sur toute la course.

- [Une forme a-t-elle besoin de `contentSource`](issues/03-une-forme-a-t-elle-besoin-de-contentsource.md)
  — **NON, et la question était mal posée**. Arbitrage d'Antoine du 2026-08-17,
  devant le prototype : « c'était pour les masques et la sélection, pas pour un
  effet ». Une forme n'est ni un troisième genre de calque ni un effet — c'est
  une façon de SÉLECTIONNER une région. La voie A perd donc sa justification
  côté formes ; elle est à réexaminer pour la typographie seule (ticket 04).
  ⚠️ Les documents disaient le contraire de lui — le cadrage du 2026-08-05 ne
  contient pas une fois le mot « sélection » — et **c'est le CODE qui a tranché** :
  `mask/sources/types.ts:2` porte une union fermée à trois sources, sans aucune
  source géométrique. Trou franc que ni le ROADMAP, ni le cadrage, ni cette carte
  ne signalaient.
- [À quoi ressemble une forme dans shaderlab](issues/23-a-quoi-ressemble-une-forme-dans-shaderlab.md)
  — ouvert et **résolu le 2026-08-17**. Antoine, mis devant le périmètre du
  ticket 03 : « je ne sais pas encore — montre-moi ». Prototype construit
  (`src/render/effects/aplat.ts`, une couleur unie bornée par un masque ou par
  une primitive posée) et trois scènes capturées sur sa photo. ⚠️ Il établit que
  **les deux demandes du cahier de postproduction se rendent sans aucune
  géométrie nouvelle** — l'ombre graphique du §393 sort d'une couleur unie plus
  un masque de luminosité, deux pièces qui existaient déjà ; ce qui manquait au
  registre était la couleur unie. Et il montre en creux le seul niveau qui bute
  vraiment sur le modèle : la forme LIBRE, qu'un `array<f32, 48>` ne peut pas
  porter. **Le ticket 03 est débloqué et prêt à trancher.**

- **Arbitrages d'Antoine du 2026-08-13**, pris devant l'app et non sur document —
  ils tranchent des tickets ouverts et en ouvrent d'autres :
  - **`curves` passe en PERÇU** (« pas les points rouges ni l'effet délavé ») —
    tranche le ticket 06 dans le sens « corriger l'effet », pas « amender la
    règle linéaire du dépôt. Casse les deux références de pixels de `curves`, à
    relire à l'œil avant de committer.
  - **`lensFlare` : ses trois phénomènes deviennent trois options
    SÉLECTIONNABLES dans l'effet** — pas trois entrées du registre. La famille
    des halos ne se rouvre donc pas une seconde fois (ADR-0017 tient).
  - **Light leak refusé en l'état** : « très lampe torche, très grossier ». Ce
    n'est pas qu'un réglage de valeurs — la FORME est en cause.
  - **Verre : le grain doit être plus fin, et les matières comparées à de
    vraies photos** avant d'être crédibles. Les espacements des pavés sont
    « très moches » — mesuré depuis : notre rapport joint/pavé (8 px sur 132,
    soit 6,1 %) est pourtant DANS la fourchette réelle (9–15 mm pour 190–200,
    soit 5–8 %), donc le défaut est ailleurs que dans la largeur.
  - **Un wireframe est demandé pour la pile à 7 calques et plus.**
  - **La perf du masque est un blocage d'usage**, re-signalée deux fois.

- [Où vit l'état de repli de la pile](issues/20-ou-vit-l-etat-de-repli-de-la-pile.md)
  — ouvert le 2026-08-15, **RÉSOLU ET IMPLANTÉ le 2026-08-16**. État
  d'INTERFACE (`useCollapsedGroups`), sélection qui remonte au parent au repli
  et revient à l'enfant quitté au dépliage. ⚠️ La mesure a d'abord **réfuté
  l'énoncé** : la question opposait « persisté » à « perdu à la réouverture »
  alors que le projet n'a **aucune persistance de document** — les deux branches
  perdaient. Ce qui les séparait vraiment était l'ANNULABILITÉ (`History.push`
  snapshotte la pile, donc un champ de `LayerState` serait rejoué par l'undo).
  Livré avec chevron, pastille et moignon ; le repli cassait silencieusement la
  conversion d'index du glisser-déposer, refermée par
  `visibleInsertToModelInsert`.
- [La dérogation du gate WGSL est bornée, mais pas comptée](issues/21-le-gate-wgsl-est-rouge-en-ci.md)
  — ouvert le 2026-08-15, requalifié le 2026-08-16, **RÉSOLU le même jour**. La
  dérogation est comptée (attendu DÉRIVÉ, jamais littéral). ⚠️ Et l'épreuve du
  compteur a trouvé pire que ce qu'il comptait : **`naga` colore sa sortie même
  derrière un tuyau**, l'ancre `/^error:/gm` ne matchait donc plus rien, et la
  dérogation était INERTE — gate rouge sous Bash, vert sous PowerShell et en CI.
  Un gate dont le verdict dépend du terminal donne raison au dernier qui l'a
  lancé.
- [`LayerPanel.stories` est rouge en CI et vert en local](issues/22-layerpanel-rouge-en-ci-vert-en-local.md)
  — ouvert le 2026-08-16, **RÉSOLU le même jour**. Ni React, ni ubuntu : c'est
  l'état du **cache de pré-bundling**. Vite découvrait `react/jsx-dev-runtime` en
  cours d'exécution, ré-optimisait et RECHARGEAIT la page — l'arbre React détruit
  en plein rendu, d'où un dispatcher nul. Une ligne d'`optimizeDeps.include`.
  ⚠️ **Vider le cache reproduit la CI en local** : à froid, 5 fichiers tombent ;
  à chaud, 32/32 vert. C'est la manipulation qui manquait, l'énoncé proposant
  trois pistes coûteuses et toutes fausses. Et Vite annonçait la cause en toutes
  lettres — dans un message qui ne contient ni `FAIL` ni `Error`, donc invisible
  dans un log de CI filtré.
- [Ce dont le 16-bit a besoin hors du dépôt](issues/01-ce-dont-le-16-bit-a-besoin-hors-du-depot.md)
  — faisabilité **acquise** (`rgba16float` sans aucune feature, crate TIFF+ICC
  déjà en dépendance, matrice à 4 coefficients) ; mais l'invariant « sRGB par
  le FORMAT » **ne survit pas** au flottant, et toute la mesure a été prise
  dans Edge, pas dans le WebView2 réel.
- [Ce qu'est un manipulateur direct de niveau professionnel](issues/18-ce-qu-est-un-manipulateur-de-niveau-pro.md)
  — **42 lignes de grille** (17 genres, 25 points d'anatomie du geste), dont
  **11 déjà faites** chez nous. Écarts chiffrés : zéro `:hover` dans les quatre
  CSS d'overlay, poignées de 12 px pour 24 recommandés, aucune valeur affichée
  pendant le geste. ⚠️ **14 des 42 lignes supposent qu'un manipulateur soit un
  OBJET** — le même mur que la typographie et les formes, lien non prévu qui
  peut réordonner la carte.
- [La rationalisation des contrôles n'est pas terminée](issues/14-la-fusion-des-reglages-redondants.md)
  — **résolu en CADRAGE** : trois documents la déclaraient soldée, la mesure dit
  le contraire sur ses **trois** fronts. 345 paramètres au total ; 10 % portent
  une condition et 15 effets sur 23 n'en ont aucune ; `liste` = 54 des 73
  sections ; 4 effets sur 23 ont un outil sur la toile. Découpée en
  [15](issues/15-l-applicabilite-couvre-10-pourcent.md) →
  [16](issues/16-les-sections-ne-sectionnent-pas.md) →
  [17](issues/17-les-outils-sur-la-toile.md), **un ticket par front avec sa
  mesure de sortie**, parce que c'est la 3ᵉ clôture prématurée du même chantier
  et que la cause est toujours un plan partiel lu comme un chantier entier.
- [Ce que coûte d'attendre le 16-bit](issues/02-cout-d-attendre-le-16-bit.md)
  — **presque rien** : le chemin couleur n'a qu'UNE décision de format
  (`srgbFormat`, injecté, 14 lecteurs, zéro format en dur) et les 23 effets ne
  voient jamais le format, donc formes/typo/recadrage n'ajoutent aucun site.
  La rupture est aux BORNES (présentation, export), et les références de
  pixels sont sauves tant que le 16-bit reste un SECOND point d'entrée.
  (Le « 77 » que portait cette ligne est périmé — re-mesuré le 2026-08-18 :
  **102**, tous déclarés.) ⚠️ 22
  effets sur 23 bornent leur sortie, donc la marge au-dessus de 1,0 serait
  inutilisée — seule la précision dans [0,1] compte, ce qui rend contraignante
  la limite des ~11 bits près du blanc.
- [Ce que Photoshop et Lightroom rendent lisible](issues/09-ce-que-photoshop-et-lightroom-rendent-lisible.md)
  — 31 mécanismes sourcés, dont cinq à accrochage existant ; et une troisième
  voie sur `appliesWhen` (faner au lieu de masquer) que nous n'avions jamais
  instruite. Trois absences que le ticket AFFIRMAIT étaient fausses.
- [Quelles fonctions de Photoshop et Lightroom compléteraient les nôtres](issues/10-quelles-fonctions-completeraient-les-notres.md)
  — 12 instruites, 8 écartées en doublons, 5 rejetées sur la règle « ce qui ne
  se crée pas en postproduction doit être dit » ; les **quatre modes de fusion
  non séparables** dominent, seul candidat dont l'absence se prouve par la
  FORME de l'opérateur.

## Not yet specified

Brouillard en portée, pas encore assez net pour être ticketé.

- ~~**Le design d'effet des formes**~~ — **sans objet depuis le 2026-08-17.** Le
  ticket 03 a répondu que ce n'est ni un effet ni un genre de calque, donc il n'y
  a pas de « design d'effet des formes » à écrire. Ce qui le remplace — un outil
  de SÉLECTION — est plus gros que cette carte : voir **Out of scope**.
- ~~**Le plan du recadrage et du miroir**~~ — **sorti du brouillard le
  2026-08-18.** Le ticket 05 a confirmé le modèle : le plan est écrivable, et
  plus aucun arbitrage ne le bloque. Il reste « plan avant la première ligne »
  (le geste touche `LayerState`), mais c'est une contrainte d'exécution, pas du
  brouillard. La part qui n'était pas dans §3.1 — recadrer la TOILE — est
  devenue le [ticket 28](issues/28-recadrer-la-toile-deja-ouverte.md).
- **Ce que devient le dock** — trois questions voisines dont on ne sait pas
  encore si elles font un ticket ou trois : la largeur redimensionnable
  (décidée le 2026-07-21, « plan séparé après celui-ci », jamais écrit) ; le
  saut de 6 px quand la barre de défilement apparaît (326 px pour 320 annoncés
  — `flex-shrink` et `scrollbar-gutter` tous deux testés inefficaces) ; et le
  finding P1 de `docs/design-qa/2026-08-04-dock-flat-workspace.md`, « sens de
  *plein écran* non déterminé », qui demande explicitement un arbitrage avant
  toute mutation de layout.
- **Le tri restant du cahier de postproduction** — trois des cinq points de
  `docs/superpowers/specs/2026-08-03-references-postproduction.md` sont
  ouverts. Le plus flou : « ce qui ne se crée pas en postproduction doit être
  DIT et non simulé » — on ne sait pas encore si c'est de la documentation, un
  refus d'effet à écrire en ADR, ou rien.
- **Ce que le jugement esthétique fera remonter** — bloc 1 du ROADMAP, six
  sujets, planche de contact déjà publiée. Ce sont des VALEURS à ajuster et
  non du code (le Dépoli du verre, les cinq pavés jamais vus sur photo, les
  deux défauts probables du light leak), mais on ne sait pas lesquelles avant
  qu'Antoine ait regardé.

## Out of scope

Ruled beyond the destination. Ne graduent jamais.

- 🆕 **La TYPOGRAPHIE — hors portée le 2026-08-17.** Arbitrage d'Antoine devant
  la mesure : « ni l'un ni l'autre pour l'instant » — ni l'import comme chantier,
  ni le texte éditable.
  [Le ticket](issues/04-la-typographie-entre-t-elle-dans-ce-palier.md) est clos
  ici et non dans *Decisions so far* : une frontière de portée n'est pas une
  étape de la route.
  ⚠️ **Sa mesure reste vraie et vaut d'être retenue** : le mur `array<f32, 48>`
  que le ROADMAP donne pour bloquant ne bloque qu'un effet qui SYNTHÉTISERAIT des
  glyphes — que le cahier de postproduction ne demande nulle part. Ses quatre
  mentions décrivent ce qu'on fait SUBIR à un texte déjà composé. Et un PNG à
  alpha s'importe et se compose **déjà**, vérifié dans la vraie fenêtre, sans une
  ligne de code : `createImageBitmap` renifle le format, la texture a quatre
  canaux, `photoLayerInput` écrit la couverture dans l'alpha.
  Le seul blocage — un filtre de trois mots qui contredit le glisser-déposer —
  **ne sort PAS avec la typographie** : il touche tout PNG à alpha. Il est
  ticketé à part.

- 🆕 **L'outil de SÉLECTION — hors périmètre le 2026-08-17, et il lui faut sa
  propre carte.** Le ticket 03 a établi qu'une forme sélectionne au lieu de se
  poser ; Antoine ne s'arrête pas à la primitive géométrique — il veut détourer à
  la main, tracer une silhouette, combiner des régions (ajouter, soustraire).
  Ça dépasse les six flottants d'un rectangle, et le sujet devient l'OUTIL, pas
  la forme.
  Ce que le dépôt a déjà et qui compte pour cet effort : quatre façons de borner
  (pinceau, `gradient`, `luminosity`, `colorRange`), un `MaskSourceModule` à
  huit flottants, un `CanvasControl` à trois genres, et un prototype de
  géométrie transférable (`src/render/effects/aplat.ts`, ticket 23).
  Ce qui lui manque : toute source géométrique, et toute composition de régions.
  ⚠️ Ce n'est PAS une exclusion de valeur — c'est une exclusion de TAILLE. Cette
  carte-ci produit des décisions pour le prochain palier ; un outil de sélection
  est un palier à lui seul.
  🆕 **Cette sortie de portée en emporte TROIS de plus, constaté le 2026-08-18**
  en résolvant le [ticket 08](issues/08-lesquels-des-cinq-differes-de-masquage.md) :
  les différés « pen/path Bézier », « sélection géométrique rect/ellipse » et
  « lasso libre/polygonal/magnétique » du PRD de masquage
  (`docs/superpowers/specs/2026-07-18-shaderlab-layers-masking-prd.md`) sont
  exactement ce que décrivent « détourer à la main, tracer une silhouette,
  combiner des régions » ci-dessus. Ils ne diffèrent que par le GESTE, pas par
  ce qu'ils produisent — donc ils partent avec l'outil, jamais séparément. La
  carte de l'outil de sélection devra les reprendre comme entrées, pas les
  redécouvrir.

- **L'implémentation de l'export print elle-même** — pipeline 16-bit,
  encodeur TIFF, conversion de gamut, ICC. Réel mais lointain (arbitrage
  d'Antoine, 2026-08-11) : cette carte n'y va pas, elle en garde seulement la
  contrainte. `PRD-print-export.md` reste valide et dormant ; le rouvrir sera
  une carte à lui.
- ✅ **La suppression des branches mortes — FAITE le 2026-08-16.** Sept branches
  distantes retirées, chacune vérifiée avant le geste. ⚠️ Et ce n'était pas la
  corvée annoncée : `claude/mattpocock-skills-wayfinder-6lxjiz` portait depuis le
  2026-08-11 un correctif du défaut CI du ticket 22, **plus complet que celui
  trouvé le 2026-08-16** — récolté avant suppression. Deux affirmations de cette
  carte étaient par ailleurs fausses (« déjà dans master », « superseded » sur des
  branches qui portaient des commits uniques : vrai en contenu, faux en commits).
  ✅ **`mipmaps-bibliotheque` a reçu son verdict le 2026-08-17 et est fusionnée** —
  rendu par la mesure que son propre commit réclamait (scan 8192² sur photo
  26 Mpx : le coût de la passe devient PLAT au lieu de croître avec la
  minification). ⚠️ Sa prémisse écrite était pourtant FAUSSE — « échantillonné à
  l'échelle de l'écran, 1:8 », alors que le canvas est à la résolution native et
  n'est réduit que par CSS : au défaut c'est ~2:1. **Un geste juste pour une
  raison fausse se fusionne quand même, mais sa raison se corrige** — sinon elle
  sert de prémisse au chantier suivant, qui est ici le mipmap de diffusion du
  verre. Reste `task-management` (480 lignes orphelines — décision, pas corvée).
  Détail dans `docs/ROADMAP.md` § 4.

- **`PRD-floating-panel-rail.md`** — cadre un rail pour `FloatingPanel`,
  composant supprimé le 2026-07-21, et le rail a été livré autrement (panneaux
  contextuels, 2026-07-25/26). PRD zombie : une suppression et une ligne de
  note, aucune décision.
- ✅ **`docs/adr/0003-master-tracks-feature-design-system.md` — RÉGLÉ le
  2026-08-16, et ce n'était pas une corvée.** Cette entrée le rangeait en
  « corvée de documentation » ; c'en était une décision. Tant que l'ADR restait
  `active`, il prescrivait une synchronisation manuelle que personne ne faisait,
  et la branche par défaut du dépôt montrait un instantané de trois semaines.
  `master` est désormais canonique et par défaut
  ([ADR-0005](../../docs/adr/0005-master-est-la-branche-canonique.md)).

### Corrections de documentation mesurées — ✅ SOLDÉES le 2026-08-13

Aucune n'était une décision — ce sont des faits vérifiés le 2026-08-11 contre
des documents qui disaient autre chose. Elles étaient consignées ICI parce que
la faute que cette carte diagnostique est précisément celle-là : signaler et
oublier.

**Re-mesurées une par une le 2026-08-13 avant d'y toucher : les cinq étaient
déjà appliquées.** Elles l'ont été au fil des sessions des 11 et 12 août, sans
que personne raye la table — donc la table listait comme « en attente » un
travail fait, ce qui est la même faute vue de l'autre côté. Leçon opposable :
**une liste de corrections se re-mesure avant de s'appliquer**, sinon on
réécrit du correct par-dessus du correct.

| Document | Ce qu'il disait | Ce que le disque dit | État au 2026-08-13 |
| --- | --- | --- | --- |
| `CONTEXT.md:259`, `ARCHITECTURE.md:565`, `ARCHITECTURE.md:618` | `MAX_PHOTO_LAYERS = 4` | **5**, fond compris (`src/layers/photoLayer.ts:66`) | ✅ déjà corrigé, R1 compris (« MESURÉ, deux fois ») |
| `CLAUDE.md:84` | config du canvas en `gpuContext.ts:64-78` | **lignes 155-164** | ✅ déjà corrigé, avec la trace de l'écart |
| `docs/ROADMAP.md` §2 | le recadrage « ne dépend d'aucun arbitrage », « le SEUL item prêt à coder » | design §3.1 renversé par le passage à deux échelles du 2026-07-31 | ✅ déjà corrigé, renvoie au [ticket 05](issues/05-ce-qui-reste-du-design-de-parite-du-calque-photo.md) |
| `docs/design-system/photoshop-web-reference-tokens.md` § Constat structurel majeur | met en garde contre un dock empilé, au nom de `FloatingPanel` | supprimé le 2026-07-21 | ✅ section réécrite, l'écart réel (splitter vs content-sized) isolé |
| `docs/INDEX.json` | aucune entrée pour `2026-07-26-shaderlab-photo-layer-parity-design.md` | — | ✅ entrée présente |

**Le seul reste était HORS de cette table** : `PRD.md` portait le même plafond
faux à trois endroits (`= 4`, « plus de 2 photos sources » en hors-scope,
« limite 2 photos respectée » en critère de fin) **et une seconde erreur que
personne n'avait relevée** — « borne de sécurité VRAM non encore mesurée »,
alors que c'est la mesure du 2026-07-30 qui a fixé la valeur. Corrigé le
2026-08-13. Ce qui l'a fait sortir : avoir cherché la CONSTANTE dans tout le
dépôt au lieu de relire les lignes citées par la table.
