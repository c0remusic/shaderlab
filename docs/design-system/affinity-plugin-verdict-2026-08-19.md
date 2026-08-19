# Un plugin Affinity améliorerait-il les PERFS ? La QUALITÉ ? — verdict mesuré

Réponse au [ticket 12](../../.scratch/affinity/issues/12-plugin-perfs-et-qualite.md)
et, en partie, au [ticket 01](../../.scratch/affinity/issues/01-contrat-8bf.md).
Question d'Antoine, le 2026-08-19 : « définir si un port de nos effets via
plugin pourrait améliorer le rendu et les performances ».

**Tout ce qui suit est mesuré**, sur la machine d'Antoine (RTX 2060, WebView2),
la même photo des deux côtés — `DSCF5160-edited.JPG`, 6240 × 4160, exactement
26,0 Mpx, la taille de référence des mesures du dépôt.

---

## Réponse courte

**Non sur les perfs, et ce n'est pas un pari : c'est le sens INVERSE de ce que
l'intuition dit.** Un seul filtre natif d'Affinity coûte 136 à 565 ms sur
26 Mpx. Notre pile ENTIÈRE, cinq calques d'effet sur la même photo, recompose
en 23 ms pendant qu'on tire un curseur. Nous sommes entre 6 et 25 fois plus
rapides que le moteur natif dont on voulait s'approcher.

**Non sur la qualité non plus, et pour une raison différente** : ce qu'on
gagnerait vient de l'HÔTE (16/32 bits, ICC, OCIO, épreuvage), pas de leurs
filtres — et ce gain-là est disponible chez nous sans écrire une ligne de C++
(ticket 11). Sur les filtres eux-mêmes, la mesure dit qu'on est devant sur notre
territoire : leur Halftone piloté par le SDK est MONOCHROME là où le nôtre fait
la quadrichromie et sa rosette.

**Ce qui reste vrai et utile dans la question** : leurs filtres ont des idées
que nous n'avions pas. Deux ont été mesurées puis implémentées le jour même —
voir la dernière section.

---

## Axe 1 — les perfs

### Ce que coûte UN filtre natif d'Affinity sur 26 Mpx

Protocole : document chargé par script, `doc.selectAll()`, puis
`doc.executeCommand(DocumentCommand.createXFilter(...))` chronométré,
`undo` complet entre deux essais, trois essais par filtre. Les chiffres
ci-dessous sont le TROISIÈME (à chaud) ; le premier essai porte la compilation
du noyau et vaut jusqu'à 5 fois plus (`clarity` : 2727 ms au premier passage,
565 au troisième).

| Filtre | 1er | 2e | 3e (à chaud) |
| --- | --- | --- | --- |
| Twirl | 260 | 136 | **146 ms** |
| Unsharp mask r=8 | 425 | 144 | **149 ms** |
| Add noise | 318 | 181 | **171 ms** |
| Gaussien r=16 | 234 | 206 | **173 ms** |
| Gaussien r=64 | 223 | 175 | **181 ms** |
| Gaussien r=256 | 180 | 183 | **184 ms** |
| Bloom | 197 | 203 | **193 ms** |
| Voronoi | 628 | 440 | **438 ms** |
| Lens blur r=64, 9 lames | 599 | 581 | **550 ms** |
| Clarity | 2727 | 569 | **565 ms** |

Deux choses à lire au passage, indépendantes de la question posée :

- **Leur gaussien est INSENSIBLE au rayon** (173 ms à 16 px, 184 ms à 256 px) :
  il est séparable ou pyramidal, comme le nôtre. Ce n'est pas un écart.
- **Leur plancher est à ~140 ms**, quel que soit le filtre. C'est le coût
  d'appliquer quoi que ce soit à 26 Mpx dans leur modèle de document.

### Ce que coûte NOTRE pile, sur la même photo, en build de production

Protocole : `scripts/perf-probe.mjs`, build RELEASE (la sonde refuse de mesurer
si le pont de debug est là), photo passée en argument de lancement, glissement
de souris réel par CDP — pas une rafale d'`input`, qui fabriquerait la lenteur
qu'elle mesure.

| Pile | Images/s | ms par image | Fil principal |
| --- | --- | --- | --- |
| photo + **1** calque d'effet (glow) | 119,7 | **8,4 ms** | 93 % |
| photo + **5** calques (glow, halation, grain, lensBlur, outlines) | 43,2 | **23 ms** | 43 % |

### Ce que ces deux tableaux disent

**Notre pile complète à cinq effets est 6 fois plus rapide que leur filtre le
moins cher, et 25 fois plus rapide que leur lens blur.** Sur un seul effet,
le rapport est de 17 à 67.

La comparaison n'est pas tout à fait à armes égales et il faut le dire : leur
application est DESTRUCTIVE — elle écrit le résultat dans les tuiles du
document et alloue un pas d'historique — là où nous recomposons vers une
texture d'écran. Mais c'est précisément le point : **c'est ce coût-là qu'un
plugin `.8bf` paierait, puisqu'un plugin reçoit et rend des pixels en mémoire
centrale.** Leur aperçu de filtre live, lui, n'est pas pilotable par le SDK et
n'a pas pu être mesuré — je ne prétends donc rien sur lui.

### Le contre-argument structurel, maintenant chiffré

Le ticket 12 le posait comme une hypothèse à écarter en premier. Elle est
CONFIRMÉE, et par leur propre moteur : un `.8bf` reçoit un `FilterRecord`
avec des pointeurs vers de la mémoire centrale. Sur 26 Mpx en RGBA 8 bits, c'est
104 Mo qui descendent et 104 Mo qui remontent, **par effet et par invocation**.
Notre pile compose N calques en ping-pong sur le GPU sans jamais redescendre :
**zéro aller-retour**. Le plancher de ~140 ms mesuré sur leurs filtres les moins
chers est la trace de ce trajet.

### Et la part de l'abstraction dans NOTRE coût

C'était l'étape 1 du ticket, et la réponse est dans la colonne « fil
principal » : **93 % à un calque, 43 % à cinq.** Autrement dit, plus la pile
grossit, plus le temps passe hors du JavaScript — dans le GPU et la
présentation. **La part qu'un portage natif remplacerait est exactement celle
qui RÉTRÉCIT quand le travail augmente.** Le dépôt avait déjà établi par
ablation que notre coût dominant est la cohérence de cache et non la couche
d'abstraction ; cette mesure-ci le dit d'un autre angle et conclut pareil.

**Axe 1 clos : un plugin ne serait pas plus rapide, il serait plus lent.**

---

## Axe 2 — la qualité

Le ticket posait la bonne question : le gain ne viendrait pas de leurs shaders
mais de leur HÔTE. C'est exact, et le tableau du ticket 12 reste valable
(`RGB96Mode`, `Depth16Bit`, ICC, OCIO, `SoftProof`, `LUT3D`, `GainMap`). J'ai
vérifié un point de plus, qui va dans le même sens : leurs préréglages d'export
incluent **TIFF 16 bits, OpenEXR 32 bits linéaire et Radiance HDR** — donc la
chaîne haute précision existe de bout en bout chez eux.

**Mais le ticket 11 montre la voie pour l'avoir chez nous**, et la comparaison
de coût penche du même côté que l'axe 1 : rendre notre chaîne linéaire et
encoder explicitement à la sortie touche `gpuContext.ts` et la passe finale ;
écrire un `.8bf` demande du C++, le SDK Photoshop, le portage de vingt-sept
WGSL sur une API que le plugin ouvrirait lui-même, **et nous ferait perdre notre
pile, nos masques par calque et nos presets** pour hériter des leurs.

### Ce que la mesure a démenti sur leurs filtres

Le relevé de la veille comptait des paramètres. Celui-ci a REGARDÉ ce que les
filtres rendent, et deux conclusions changent.

**Leur Halftone, piloté par le SDK, est MONOCHROME.** Une seule trame noire,
vérifiée à l'image sur un nuancier de 36 cases. Ses paramètres
`greyComponentReplacement` et `underColourRemoval` — que le relevé de la veille
citait comme une idée à prendre — n'ont **aucun effet mesurable** par cette
voie : les quatre variantes (GCR 0/100 × UCR 0/100) rendent des images
identiques au pixel. Notre `halftone` fait la quadrichromie, ses quatre angles
d'écran et sa rosette, plus trois autres modes de couleur.
⚠️ **Et cette absence ne se conclut PAS.** Elle est mesurée à l'endroit où j'ai
regardé — le chemin SDK — et rien ne dit que le filtre de l'interface fasse la
même chose. C'est la faute que ce fil a déjà commise trois fois ; ce qu'il
faudrait pour trancher est de l'ouvrir dans l'application, à la main.

**Leur Bloom n'est pas un halo à seuil, c'est une REDISTRIBUTION TONALE.**
Mesuré sur un escalier de seize tons unis — une mire sans aucune structure, où
un opérateur de halo n'a rien à étaler et où seul un opérateur de TON peut
bouger quelque chose :

```
entree 8 bits :    0    9   28   48   66   84  102  120  137  154  171  188  205  222  239  255
tous curseurs a 0  0    9   28   48   66   84  101  119  138  159  180  201  221  238  249  255
highlightBlend 1   0    9   28   48   66   84  101  119  139  163  191  218  235  246  252  255
midtoneBlend 1     0    9   28   48   66   82   96  116  143  167  186  202  218  235  248  255
shadowBlend 1      0    9   26   43   59   78   99  119  138  158  179  201  221  238  250  255
```

Quatre choses en sortent, et aucune n'était devinable depuis les noms :

1. **Les trois curseurs ne gatent pas la SOURCE du halo, ils décident dans
   quels tons du RECEVEUR la lumière est reposée.** Sur une mire à trois bandes
   de fond avec des sources vives IDENTIQUES dans chacune, le halo apparaît
   dans la bande claire et **exactement 0,000 dans la bande dense**, quelle que
   soit la position des trois.
2. **C'est un plancher, pas une pente** : sous une certaine densité, il ne se
   passe rien du tout.
3. **L'opérateur est SIGNÉ** : `shadowBlend` à 1 *assombrit* les tons 28 à 102
   (−0,001 à −0,012 en linéaire) pendant qu'il éclaircit au-dessus. Il déplace
   de la lumière, il n'en ajoute pas.
4. **Tous curseurs à zéro, il agit déjà** (+0,125 au ton 222) : les trois
   curseurs modulent une action de base, ils ne la composent pas.

Et un détail vérifié pour rien, qui économise une hypothèse : leurs
`*Value`/`Method`/`Strong` relevés au symbole la veille **ne sont pas dans la
structure du SDK**. Passer `highlightValue: 0` ou `highlightValue: 1` rend deux
fichiers de md5 IDENTIQUE. La structure scriptable n'a que quatre champs.

---

## Ce que ce relevé corrige de la veille

⚠️ **« Les LIVE FILTERS d'Affinity n'apparaissent nulle part dans l'API
`Document`. Même les siens ne sont pas pilotables. Le SDK ne donne accès qu'aux
styles de calque. »** — `affinity-porter-les-effets-2026-08-19.md`, constat 2.
**C'est FAUX.** `commands.js` (1 970 lignes) expose une trentaine de filtres et
une vingtaine d'ajustements en commandes de document :

```
Bloom · LensBlur · MotionBlur · RadialBlur · FieldBlur · DepthOfField
GaussianBlur · BoxBlur · MedianBlur · BilateralBlur · Maximum/MinimumBlur
DiffuseGlow · Diffuse · Denoise · DustAndScratch · AddNoise · Clarity
UnsharpMask · HighPass · Halftone · Pixelate · Voronoi · Twirl · Ripple
PinchPunch · Spherical · Vignette · Defringe · ShadowsHighlights
Curves · Levels · HSLShift · SelectiveColour · SplitToning · Recolour
Normals · ToneCompression · ToneStretch · BlackAndWhite · WhiteBalance
Threshold · Posterise · Vibrance · Exposure · ColourBalance · BrightnessContrast
+ SetBlendGamma · SetBlendRanges · DetectDepth · GenerateImage · SelectSubject
```

**C'est la QUATRIÈME conclusion tirée d'une absence dans ce fil**, et la même
mécanique que les trois précédentes : j'avais listé l'API `Document`, je n'y
avais pas trouvé de filtre, j'en avais conclu que le SDK n'en avait pas. Les
filtres ne sont pas des méthodes de `Document` — ils sont des `DocumentCommand`
passées à `doc.executeCommand()`, dans un autre fichier.

**Et c'est cette erreur-là qui coûtait le plus cher**, parce qu'elle fermait le
seul instrument qui permette de répondre honnêtement à la question posée :
**piloter leurs filtres, relire les pixels, et comparer.** Tout ce document en
sort.

Corollaire de méthode, à ajouter aux trois autres : **une absence constatée dans
un fichier de SDK ne se conclut qu'après avoir cherché dans les autres fichiers
du même SDK.** La liste des documents était sous les yeux depuis le début
(`list_sdk_documentation` la rend en entier) ; `commands.js` y était.

Deux autres corrections, plus petites :

- **`PhotoshopPluginWrapper`, `RasterFilterPluginWrapper`,
  `SupportsPhotoshopPlugins`, `AllowUnknownPlugins` et `.8bf` ne sont PAS dans
  `libpersona.dll`** comme l'écrivait `affinity-binaire`, mais dans
  `Serif.Affinity.dll` (l'assembly managé, qui porte aussi 172 occurrences de
  `LiveFilter`). Le fait tient — l'hôte de plugins Photoshop existe — mais le
  module cité était faux.
- **Indice sur le ticket 01, et ce n'est qu'un indice** : dans leur vocabulaire,
  un « RasterFilter » est la famille DESTRUCTIVE (celle du menu Filtres), et un
  filtre non destructif est un « LiveFilter ». Le plugin Photoshop est enveloppé
  par un `RasterFilterPluginWrapper`. Ça penche vers « appliqué une fois », ce
  qui répondrait « non » au ticket 01 pour une raison de produit. **Ce n'est pas
  une preuve** : deux noms voisins dans un tas de chaînes ne disent pas un
  héritage. Ce qui trancherait est d'installer un `.8bf` libre et de regarder la
  pile de calques — et ça demande l'accord d'Antoine, parce que c'est du code
  tiers exécuté dans son application.

---

## Ce qui a été PRIS, et livré le même jour

Le sens inverse de la question — « qu'est-ce que leur code apprend à nos
effets ? » — a donné deux améliorations mesurées puis implémentées. Aucune n'est
une copie : ce qui a été repris est le COMPORTEMENT observé sur des mires, pas
du code.

### 1. `lensBlur` — la courbure des lames

Leur `LensBlurFilterParameters` porte un `bladeCurvature` que nous n'avions pas.
Rendu sur cinq sources ponctuelles, à 5 lames : **pentagone à arêtes droites à
0, disque à 1**. Une lame de diaphragme réelle est un arc, et l'ouverture
s'arrondit en s'ouvrant — un bokeh à arêtes strictement droites est le cas
particulier d'un vieux diaphragme, pas le cas général.

Implémenté dans `effects/aperture.ts`, donc partagé avec `lensFlare` (un
objectif n'a qu'un diaphragme). Le modèle est une interpolation du rayon entre
le polygone et le cercle ; l'écart au vrai arc de cercle est **mesuré et borné
par un test**, 0,16 % à six lames, 3,16 % au pire (le triangle).
⚠️ La première version du commentaire annonçait 0,3 %, borne calculée à la main
sur un seul point — dix fois trop serrée, et c'est le test qui l'a dit.

### 2. `glow` — la retenue des noirs (Pro-Mist contre *Black* Pro-Mist)

C'est la mesure de leur Bloom qui l'a débloquée, et elle vaut par ce qu'elle
révèle de NOTRE effet plutôt que du leur : l'en-tête de `glow.ts` nomme depuis
toujours trois filtres de référence — Pro-Mist, **Black** Pro-Mist,
Glimmerglass — et n'en rendait qu'un. Ce qui sépare le Pro-Mist du Black
Pro-Mist n'est pas un dosage : les particules noires du second absorbent la
lumière diffusée qui retomberait dans les zones denses. Un composite purement
additif ne peut rendre que le premier.

Le plancher mesuré chez eux — sous une certaine densité, exactement rien — est
ce qui a été repris. **Leurs trois bandes ne l'ont pas été** : la carte interdit
de copier une fonctionnalité sans dire quel geste elle débloque, et un seul axe
suffit à nommer un filtre que le module citait déjà.

Deux paramètres, `shadowHold` et `shadowHoldPoint`, neutres à leur défaut
(`mix(1.0, ouverture, 0.0)` rend `1.0` au bit près). Références de pixels
`effet-glow-retenue-temoin` et `effet-glow-retenue`, sur `mireLampes` — la seule
mire du script dont une moitié est dense et l'autre claire sous des sources
identiques.

### Ce qui a été REGARDÉ et écarté

- **GCR / UCR sur `halftone`** : inertes par la voie SDK (voir plus haut). Rien
  à prendre tant que ça n'a pas été vu dans l'interface.
- **Leurs trois bandes tonales sur le bloom** : un axe suffisait, et le geste
  des trois n'est pas identifié.
- **`DetectDepth`** (leur carte de profondeur par IA, qui alimente le mode ZMap
  de leur profondeur de champ) : la pièce existe chez nous —
  `displacementMap` lit déjà une image par le binding 7 — mais
  `validateEffect` refuse `libraryTexture` sur un effet à passes internes, et
  `lensBlur` en a. Ce verrou-là gouverne aussi `lensFlare` ; c'est un chantier,
  pas une amélioration, et il reste ouvert.
- **`SetBlendRanges` / `SetBlendGamma`** (leur « Blend If ») : c'est un
  mécanisme de CALQUE, pas d'effet. Reste au ticket 06.

---

## Ce que ce document ne dit pas

> ⚠️ **CORRIGÉ le soir même (audit des outils internes)** : la phrase
> ci-dessous « le SDK n'applique que des filtres destructifs » décrit les
> `DocumentCommand` de `commands.js`, et ELLE SEULE. **`nodes.js` expose un
> `*FilterRasterNodeDefinition` par live filter et par ajustement**
> (`BloomFilterRasterNodeDefinition`, `LensBlurFilterRasterNodeDefinition`,
> avec structures `*Parameters` typées), posables par `doc.addNode` dans
> l'arbre non destructif — **le chemin live EST pilotable.** Cinquième
> conclusion tirée d'une absence dans ce fil, même mécanique : j'avais
> regardé `document.js` et `commands.js`, la réponse était dans `nodes.js`.
> La réserve ci-dessous reste vraie sur un point : le coût du live pendant un
> drag n'a toujours PAS été mesuré — mais il est devenu mesurable.
> Et une sixième, du même passage : « aucun accès buffer, un pixel à la
> fois » — `PixelBuffer.buffer` et `rasterInterface.createCompatibleBuffer`
> transportent les pixels d'un bloc ; la borne 5,2 s ne vaut que pour
> `readPixel`. Le verdict de CE document tient — il mesure leurs filtres
> natifs, pas le pont — mais l'argument du pont est mort.

- **Rien sur leur chemin de filtre LIVE.** Le SDK n'applique que des filtres
  destructifs (l'annulation dit « Croissance », « Demi-ton », « Flou de
  l'objectif » — et aucun calque n'apparaît dans l'arbre). Leur aperçu
  interactif est peut-être bien plus rapide, et à résolution d'aperçu. Nos
  23 ms, eux, sont à résolution NATIVE.
- **Rien sur ce que coûterait vraiment un `.8bf`.** L'axe 1 est clos par une
  borne — leur propre moteur natif est plus lent que nous — pas par une mesure
  de plugin.
- **Rien sur la beauté de leurs filtres.** Ce document mesure des temps et des
  comportements. « Est-ce beau » se juge sur une photo d'Antoine, et cette
  question-là n'a pas été posée ici.
