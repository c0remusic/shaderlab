# Audit full scope — ce qu'Affinity fait mieux que shaderlab, et comment le prendre

Question d'Antoine, le 2026-08-19 : « qu'est-ce qu'Affinity fait mieux que
shaderlab : outillage, effets, code, UI, UX — comment il le fait, comment
implémenter ça dans shaderlab ? »

**Ce document est le chapeau.** Il consolide les six relevés du jour et les
cinq catalogues bruts (`.scratch/affinity/research/`), ordonne la réponse par
les cinq axes de la question, et pour chaque écart donne : ce qu'ils font,
comment, et le chemin d'implémentation chez nous. Il ajoute trois morceaux que
les catalogues portaient et qu'aucun relevé n'avait synthétisés (raccourcis
clavier, historique à instantanés, système d'export). Le détail vit dans les
relevés ; la décision vit dans les tickets de `.scratch/affinity/`.

**Niveaux de preuve, à lire sur chaque item** — la carte l'exige :

| Marque | Ce que ça vaut |
| --- | --- |
| `[mesuré]` | piloté par le SDK, pixels relus, comparé aux nôtres |
| `[écran]` | vu sur la fenêtre d'Antoine (captures du relevé observations) |
| `[symbole]` | un nom dans un binaire : prouve l'EXISTENCE, jamais la qualité ni le comportement |

**Un item `[symbole]` se regarde dans Affinity avant d'écrire une ligne de
code.** Quatre conclusions fausses dans ce fil sont toutes venues de sauter
cette étape ou son inverse (conclure d'une absence).

> ⚠️ **AMENDÉ le soir même, deux fois.**
> **(1) Le territoire.** La première version écartait les ajustements
> photographiques et les pinceaux de retouche au motif que « notre territoire
> est l'effet d'auteur, pas la retouche ». Antoine a corrigé : **la retouche
> EST notre territoire — l'app est un hybride Photoshop/Lightroom.** Les
> sections marquées « territoire » ci-dessous sont réécrites en conséquence.
> **(2) Le compte des absences fausses passe de quatre à SIX**, découvertes en
> auditant les outils internes : « le chemin live n'est pas pilotable par le
> SDK » (faux — `nodes.js` expose un `*FilterRasterNodeDefinition` par live
> filter et par ajustement, posables par `doc.addNode`) et « pas d'accès
> buffer, un pixel à la fois » (faux — `PixelBuffer.buffer` est un
> `ArrayBuffer` plein bloc, lisible et inscriptible en `Uint8Array`, et
> `rasterInterface.createCompatibleBuffer(true)` rend les pixels d'un calque
> d'un coup). Même mécanique que les quatre premières : l'absence était dans
> le fichier où je regardais. La seconde révise la borne « 5,2 s par passe »
> du relevé SDK — elle ne vaut que pour `readPixel` ; le verdict perfs, lui,
> tient toujours, car il est mesuré sur leurs filtres natifs, pas sur le pont.

---

## Réponse courte, par axe

| Axe | Verdict |
| --- | --- |
| **Effets** | Sur l'optique, l'analogique et l'imprimé : ils ne font pas mieux — 18 de nos effets n'ont aucun équivalent chez eux, et leur Halftone piloté par SDK est monochrome quand le nôtre fait la quadrichromie. Sur la retouche photographique — **qui est AUSSI notre territoire** (hybride Photoshop/Lightroom, Antoine, 2026-08-19) : oui — ajustements, flou par carte de profondeur, éclairage, équations utilisateur. Deux idées déjà prises et livrées le jour même. |
| **Outils internes** | Pinceau, sélections, retouche : **l'écart le plus profond après les masques, et trois différences de NATURE mesurées au pixel ce jour** — leur feather est une courbe en S quand le nôtre est une rampe, leur grow est un disque euclidien quand le nôtre est un carré, leur smooth arrondit la géométrie quand le nôtre floute tout. Leur pinceau est un moteur (12 contrôleurs de dynamique par propriété) quand le nôtre est 5 scalaires. Et toute la famille retouche (clone, healing, inpainting, dodge/burn) manque — désormais dans le territoire. |
| **Masques** | **Le plus gros écart en notre défaveur, tous axes confondus.** Six mécanismes absents chez nous, dont deux alignés sur notre positionnement (texturer le masque, bande de fréquence). |
| **UI** | Trois idées mesurées à l'écran : deux zones fixes aux rôles distincts, hiérarchie de valeurs inversée sur le chrome, sélection en aplat franc. Notre dock à onglets du jour est validé par leur colonne de Studios. |
| **UX** | Le geste en UN coup (pinceau d'effet), le magnétisme comme système, les raccourcis configurables, l'historique VISIBLE. Notre modèle couvre déjà leur `FadeRewind` gratuitement. |
| **Code / moteur** | Ils sont devant sur la PROFONDEUR (16/32 bits, ICC, OCIO, épreuvage) — et c'est l'HÔTE, pas les filtres. Nous sommes devant sur la LATENCE : 6 à 25× plus rapides, mesuré des deux côtés. |
| **Outillage** | Côté utilisateur, ils ont ce que nous n'avons pas du tout : export multi-formats avec presets, batch, macros, scripting. Côté développement, rien à copier — leur SDK nous sert d'instrument de mesure, et notre outillage de preuve (122 références de pixels, gates) n'a pas d'équivalent visible chez eux. |

---

## Axe 1 — Effets

### Déjà pris, livré le 2026-08-19 — rappel d'une ligne chacun

1. ✅ `[mesuré]` **Le plancher du Bloom** → `glow` a désormais la retenue des
   noirs (`shadowHold`/`shadowHoldPoint`), le *Black* Pro-Mist que son en-tête
   citait sans le rendre. Leur mécanisme réel — redistribution tonale signée,
   pas halo à seuil — est documenté dans le
   [verdict](affinity-plugin-verdict-2026-08-19.md).
2. ✅ `[mesuré]` **La courbure des lames** (`bladeCurvature`) → `effects/aperture.ts`,
   partagé `lensBlur`/`lensFlare`, écart au vrai arc borné par test.

### À prendre — le geste est nommé, le mécanisme existe chez nous

3. `[symbole+SDK]` **Le flou piloté par une CARTE DE PROFONDEUR** (leur
   DepthOfField mode `ZMap`, alimenté par `DetectDepth`).
   *Comment ils font* : le mode lit une image de profondeur au lieu d'une
   géométrie ; les trois autres modes (elliptique, bascule, champ) sont des
   géométries que notre `lensBlur` a déjà.
   *Chez nous* : la pièce existe — `displacementMap` lit une image par le
   binding 7 (ADR-0018) — mais `validateEffect` refuse `libraryTexture` sur un
   effet à passes internes, et `lensBlur` en a. **Lever ce verrou est la prise
   la plus rentable de l'axe : elle débloque le ZMap sur `lensBlur` ET la
   texture sur `lensFlare`, deux d'un coup.** C'est un chantier de
   `effectPassRunner` (résoudre le binding 7 sur toutes les passes, pas
   seulement la finale), pas un effet neuf.
4. `[symbole]` **Le décalage par CANAL du Glitch** (`GlitchChannel`,
   `ChannelCoefficients`, forces horizontale/verticale séparées, `Stagger`,
   `ShredSpacing`).
   *Chez nous* : `sliceShift` a un `chromaSplit` scalaire — l'amorce existe.
   Prise petite : des paramètres de plus sur un effet existant, dans les règles
   du dépôt (index ajoutés en fin, clamps shader, garde `parametresCables`).
5. `[symbole]` **LUT 3D** comme ajustement.
   *Chez nous* : une LUT est un cas particulier de texture de bibliothèque — le
   binding 7 charge déjà l'image. Le geste : appliquer un look partagé
   (les LUT `.cube` circulent partout en photo). Demande un chargeur `.cube` →
   texture 3D ou 2D dépliée, et un effet d'une passe. ⚠️ L'échantillonnage
   d'une LUT se fait en linéaire ou en encodé selon la LUT — c'est le genre de
   détail qui se REGARDE (une LUT creative log ≠ une LUT technique).

### À prendre seulement si Antoine nomme le geste

6. `[symbole]` **L'éclairage depuis une carte de relief** (`Lighting` : Phong
   complet, plusieurs lumières, `BumpMapOpacity`). Notre `emboss` ne garde que
   la direction du gradient et une lumière implicite. C'est un chantier
   (nouvel effet, contrôles de lumières sur la toile — dépend du ticket 25 des
   outils sur toile) ; à regarder à l'écran d'abord.
7. `[symbole]` **Les ajustements photographiques** que nous n'avons pas :
   `Levels`, `Exposure`, `WhiteBalance`, `Vibrance`, `SelectiveColour`,
   `SplitToning`, `Threshold`, `HSL`.
   ⚠️ **Réécrit le soir même** : la première version les écartait (« notre
   territoire est l'effet d'auteur, pas la retouche ») ; Antoine a corrigé —
   **hybride Photoshop/Lightroom, la retouche est dedans**. Le geste est donc
   nommé : développer la photo dans l'app au lieu d'y arriver déjà développée.
   Ils deviennent des candidats réels, à trier en deux paquets :
   — couverts en partie par l'existant : `Levels` ⊂ `curves`, `SplitToning`
   proche de `gradientMap`/`duotone` — à ne prendre que si le geste dédié
   manque à l'usage ;
   — sans recouvrement : `WhiteBalance` (température/teinte), `Exposure`,
   `Vibrance` (saturation qui protège peaux et tons déjà saturés), `HSL` par
   plage de teinte, `SelectiveColour`. Tous par-pixel, une passe, aucun
   mécanisme neuf — le patron `curves`/`channelMixer` les loge. C'est un LOT
   à charter, pas huit tickets.
8. `[symbole]` **Les équations écrites par l'utilisateur**
   (`EquationTransform`, `ApplyImage`, `ProceduralTexture`) — trois filtres où
   l'utilisateur écrit du code, sur le même chemin OpenCL que les filtres
   intégrés. Le ticket [02](../../.scratch/affinity/issues/02-langage-texture-procedurale.md)
   a réorienté sa valeur : prototyper un effet avant de l'écrire en WGSL. Le
   langage n'a jamais été relevé (aucune commande SDK — interface humaine
   seulement).

### Où NOUS sommes devant — pour que l'audit soit un audit

- `[mesuré]` Leur Halftone par SDK est **monochrome** ; le nôtre fait la
  quadrichromie, ses quatre angles d'écran et sa rosette.
- `[symbole]` **Dix-huit de nos effets sans équivalent chez eux** : `halation`,
  `glass`, `warp`, `duotone`, `hatching`, `dither`, `gooeyMerge`, `curves`
  (4 canaux × 3 points + plage), `isolines`, `pixelStretch`, `gradientMap`,
  `aplat`, `outlines`, `lensFlare`, `lensDistortion`, `channelMixer`,
  `displacementMap`†, `emboss`† († les leurs existent mais réduits : leur
  Emboss a 5 paramètres plats, leur DisplacementMap est sans les modes du
  nôtre).
- `[symbole]` Sur les effets communs, nos paramètres sont plus riches :
  `motionBlur` 7 contre 2, `texture` 9 contre 3, `grain` 5 contre 3. ⚠️ Un
  compte n'est pas une capacité — c'est ce tableau-là qui avait raté
  `bladeCurvature`. La leçon tient dans les deux sens.

---

## Axe 2 — Masques et sélections : le plus gros écart

Chez nous : quatre sources (`brush`, `gradient`, `luminosity`, `colorRange`),
trois modes de combinaison, un affinage de bord (`RefineEdgeParams`),
inversion. Chez eux, tout ça existe AUSSI — plus six mécanismes que nous
n'avons pas :

| Leur mécanisme | Preuve | Le geste | Chez nous | Ticket |
| --- | --- | --- | --- | --- |
| `MaskTexture`/`Mode`/`Scale` — texturer le masque | `[symbole]` | bords sales, mangés, organiques — la matière de notre positionnement | binding 7 existe ; l'appliquer au masque RÉSOLU (famille `RefineEdgeParams`), pas comme 5ᵉ source. ⚠️ Le binding n'est résolu que sur le chemin des effets, pas dans `MaskTextureResolver` — à vérifier avant de s'engager | [03](../../.scratch/affinity/issues/03-texturer-le-masque.md) ⭐ |
| `BandpassMaskRasterNode` — masquer par bande de fréquence | `[symbole]` | grain sur la peau, pas sur le ciel ; flou qui épargne les cils | `nettete` prouve le deux-bandes côté effet ; `MaskTextureResolver` n'a aucune pyramide — prototype d'abord, sur une vraie photo | [09](../../.scratch/affinity/issues/09-masque-bandpass.md) |
| `MaskColour`/`SetMaskColour` — surimpression réglable | `[symbole]` | peindre un masque sur une photo rouge sans être aveugle | une préférence + `ColorGroupControl` (cible outil depuis le 2026-08-18) ; le contour animé doit suivre | [05](../../.scratch/affinity/issues/05-couleur-surimpression.md) — le moins cher de la carte |
| `CreateMaskPresetCommand` — presets de MASQUE | `[symbole]` | réutiliser un masque de luminosité réglé finement | notre système de presets ne couvre que les effets ; étendre `presetDocument` aux `mask.sources` d'un calque | candidat, sans ticket |
| `MaskToBelow` · `ApplyMask` · `ReleaseMask` · `RasteriseToMask` — le masque circule | `[symbole]` | copier le masque d'un calque à un autre sans le repeindre | les sources sont des données sur `LayerState` — une copie de `mask.sources` entre calques est un mutateur `LayerStack` + verrous | candidat, sans ticket |
| `QuickMask` — peindre la sélection en surimpression | `[symbole]` | voir ce qu'on sélectionne pendant qu'on le peint | dépend de la position sélection/masque | [07](../../.scratch/affinity/issues/07-selection-ou-masque.md) |

Et deux familles entières :

- **Sélections** — quinze outils chez eux (`RasterSelectionBrushTool`,
  baguette, marquees, `ObjectSelectionTool`…), zéro concept chez nous. ⚠️ Ce
  n'est peut-être pas un manque : une sélection est un état caché, notre
  modèle « tout est masque de calque » le rend visible et annulable. **La
  position est défendable et n'a jamais été écrite** — c'est le ticket 07, et
  sa vraie question est ailleurs : copier/recadrer/exporter une RÉGION, gestes
  qui n'ont rien à voir avec le masquage et que nous n'avons pas non plus.
- **L'affinage comme OUTIL** (`RefineSelectionTool` : une brosse qui affine
  localement) là où nous n'avons que des curseurs globaux par masque.

L'`ObjectSelectionMask` (sélection du sujet par IA, `SelectSubject` dans le
SDK) est noté et écarté : modèle embarqué, un autre produit.

---

## Axe 2 bis — Outils internes : pinceau, sélection, retouche

Ajouté le soir du 2026-08-19, sur deux demandes d'Antoine : « Outillage c'est
aussi les outils internes de l'app » et « regarde leur code pour améliorer le
nôtre ». **Méthode tenue** : leur code compilé reste fermé — ce qui a été lu
est ce qui se lit légitimement (les fichiers JS du SDK, les enums exposés dans
l'app, les symboles des binaires en lecture seule), et ce qui a été mesuré
l'a été en boîte noire : **sélections raster pilotées par le SDK sur un
document de test, pixels relus par `PixelBuffer` — zéro export, zéro capture,
zéro décompilation.**

### Le pinceau — un moteur contre cinq scalaires

`[SDK lu]` Leur pinceau raster (`rasterbrush.js`) n'est pas une liste de
réglages : **onze propriétés** (`size`, `flow`, `accumulation`, `hardness`,
`angle`, `scatterX/Y`, `shape`, `hueShift`/`satShift`/`lumShift`) **sont
chacune une `BrushDynamic`** — un quadruplet `{ value, variance,
controllerType, spline }` : la valeur de base, un aléa, un CONTRÔLEUR parmi
douze (lu dans l'app : `None · Random · Pressure · Angle · Tilt · Rotation ·
Cyclic · Velocity · VelocityInverse · Direction · Wheel · Distance`), et une
courbe de réponse. S'y ajoutent des scalaires : `spacing` RÉGLABLE, `opacity`,
un `blendMode` PAR PINCEAU, `wetEdges` (avec spline personnalisable —
`[symbole]`), `shouldInterpolateTips`. Et `[symbole]` : un stabilisateur de
trait à DEUX modes (corde avec `StringLength`, moyenne avec `SampleSize`), une
symétrie de peinture (N axes, miroir, verrou) appliquée au NOZZLE, des
pointes bitmap avec générateur, des profils de pression enregistrés PAR TRAIT
et optimisables.

⭐ `[SDK lu]` **`maskTextureMode` vaut `None · Nozzle · Final`** — c'est la
réponse au « comment » que le [ticket 03](../../.scratch/affinity/issues/03-texturer-le-masque.md)
attendait : `Nozzle` texture chaque TAMPON, `Final` ancre la texture à la
TOILE et le trait la révèle. « Texturer le masque » chez eux est d'abord une
propriété du pinceau — la forme « modificateur du masque résolu » que le
ticket privilégiait reste défendable, mais elle a maintenant une alternative
mesurée chez la référence.

**Le nôtre en face** ([maskPainter.ts](../../src/mask/maskPainter.ts)) : cinq
scalaires (`radius`, `hardness`, `erase`, `opacity`, `flow`), un falloff
LINÉAIRE (`1 − (d − r·hardness)/span`), un spacing FIGÉ à 25 % du rayon. Deux
choses à dire pour l'honnêteté : notre couple `opacity`/`flow`
(plafond/débit, plafond réancré par trait) est la BONNE sémantique — là-dessus
nous ne sommes pas en retard ; et nous ne peignons que des masques, donc les
dynamiques de couleur (`hueShift`…) sont hors sujet. Ce qui vaut pour un
masque : le PROFIL du tampon (le leur n'est pas scriptable — protocole
manuel noté en fin de document), le `scatter` et la texture de tampon (bords
organiques — la matière du ticket 03), le stabilisateur (un détourage à main
levée en profite directement), le spacing réglable.

### La sélection — trois différences de NATURE, mesurées au pixel

Protocole : `Document.create(512, 512)`, calque pixel noir posé par
`PixelBuffer`, sélection rectangulaire NETTE par
`setRasterSelectionFromPolygon` (128..384), UNE opération, `deleteSelection`,
lecture du canal alpha par `rasterInterface.createCompatibleBuffer(true)`.
L'alpha après suppression EST le masque de l'opération.

**1. Leur feather est une courbe en S ; le nôtre est une rampe.**
Profil mesuré à `featherRasterSelection(32)`, ligne y=256 (alpha/255, bord
nominal à x=128) :

```
x     100   104   108   112   116   120   124   128   132   136   140   144   148   152
alpha 0.99  0.97  0.93  0.86  0.75  0.62  0.48  0.34  0.22  0.12  0.06  0.02  0.008 0
```

Pentes douces aux DEUX extrémités, maximum au centre, ~50 % au bord nominal —
un profil gaussien (erf), pas une rampe. Notre `featherSat`
([refinePlan.ts](../../src/mask/refinePlan.ts)) est un box UNE passe : rampe
linéaire, deux coins durs (C0) visibles sur un bord franc.
*Chemin chez nous, petit* : itérer la passe SAT — deux passes rendent un
triangle (C1), **trois passes une B-spline quadratique visuellement
indistinguable d'une gaussienne** ; le coût par passe est un lookup par pixel,
toujours indépendant du rayon, et le rayon par passe se recalibre (≈ r/√n)
pour garder la course du curseur. Les références de pixels des masques
adoucis bougent — c'est un changement d'apparence ASSUMÉ, à valider sur photo
avant `--update`.

**2. Leur grow est un disque euclidien ; le nôtre est un carré.**
`growShrinkRasterSelection(radius, circular)` — le flag est dans la
signature. Mesuré à +32 : le coin du rectangle devient un ARC à ~32 px de
distance EUCLIDIENNE du coin. Notre morphologie
([refineEdgeWgsl.ts](../../src/mask/refineEdgeWgsl.ts)) est un min/max
séparable H/V : élément CARRÉ — un coin dilaté déborde à 45 px sur la
diagonale, **41 % de trop**, et ça se voit sur tout masque à coins ou à
pointes (`contract`/dilate du panneau Affiner).
*Chemin chez nous, moyen* : ajouter deux passes DIAGONALES au plan de
morphologie (élément octogonal, écart au disque ~8 %, même patron de passes
1D, coût ×2) ; si l'octogone se lit encore, passer au champ de distance.

**3. Leur smooth est GÉOMÉTRIQUE et net ; le nôtre est un flou.**
Mesuré à `smoothRasterSelection(24)` : le bord DROIT reste strictement net
(255→0 sur un pixel, inchangé) et le COIN est arrondi — c'est une
ouverture/fermeture morphologique (la géométrie change, l'alpha reste
binaire). Notre `smooth` est N itérations de box 3×3 : il ADOUCIT tout, bords
droits compris — une différence de nature, pas de dosage.
*Chemin chez nous, moyen* : `close ∘ open` avec l'élément circulaire du
point 2 — réutilise la morphologie existante ; notre `smooth` actuel garde
son rôle d'anti-crénelage léger.

**4. `[symbole]` Leur affinage est un PIPELINE avec matting.**
`RefineSelection` : Initialise → brosse LOCALE → PostProcess →
`ShowMattingArea` → Tidy → Commit. Le matting (extraction douce — cheveux,
poils) n'a aucun équivalent chez nous ; notre `edgeAware` (guided filter) est
l'amorce la plus proche, et il est GLOBAL au masque là où leur brosse affine
LOCALEMENT. À regarder à l'écran avant tout ticket.

### La retouche — absente chez nous, et le territoire la revendique

Reclassée par l'amendement de territoire (hybride Photoshop/Lightroom). Ce
qu'ils ont `[symbole+catalogue]` :

- **Clone multi-SOURCES** : des sources NOMMÉES, avec vignettes, une page
  dédiée (`CloneSourceCount`, `GetCloneBrushSourceName/Thumbnail`) — pas un
  simple point d'ancrage Alt-clic.
- **Healing / blemish / patch** : clone + égalisation de luminosité et de
  couleur au raccord.
- **Inpainting, DEUX familles** : par synthèse de patchs (`InpaintMontage`,
  sans IA) et génératif (IA — écarté, autre produit).
- **Dodge / burn / sponge / tone** avec `ProtectTones` et `Range` — le geste
  porte sa PLAGE TONALE (le catalogue du 2026-08-19 les listait déjà :
  BurnBrush 4 params dont `ProtectTones`, ToneBrush 9 dont
  `ToneBrushTonalRange`).

⚠️ **Le préalable est STRUCTUREL, pas un outil de plus.** Tous ces gestes
écrivent des PIXELS ; notre modèle n'a aucun calque de pixels peints — le
seul buffer peint du dépôt est `BrushMaskSource.raster` (un masque). Un
« calque de retouche » est un nouveau GENRE de contenu (raster RGBA peint,
composité dans la pile, hors du chemin des effets), avec ses verrous, son
historique (le refcount de `History` sait déjà compter des buffers partagés),
et une position à prendre face à ADR-0008. **C'est le premier ticket à
charter si la retouche entre au roadmap — les pinceaux viennent après le
support.** Nuance Lightroom : `WhiteBalance`/`Exposure`/`Vibrance` (axe 1,
point 7) sont la moitié LIGHTROOM de l'hybride et n'ont PAS ce préalable —
ce sont des effets par pixel ordinaires, disponibles tout de suite.

---

## Axe 3 — UI

1. `[écran]` **Deux zones fixes aux rôles DISTINCTS** dans le panneau Calques :
   l'en-tête porte ce qui DÉCRIT le calque sélectionné (opacité, fusion,
   engrenage, verrou), le pied ce qui AGIT sur la pile (ajouter, grouper,
   supprimer). Notre zone unique mélange les deux familles.
   *Chez nous* : ADR-0001 dit « en-tête OU pied » — l'amender en « en-tête ET
   pied, si les rôles sont distincts » est une évolution de la lettre qui sert
   l'esprit (aucun contrôle répété par ligne). Toucher `LayerPanel.tsx` +
   stories des trois échelles + `test-storybook` ENTIER (leçon du 2026-08-16).
2. `[écran]` **La hiérarchie de valeurs est inversée sur le chrome** :
   pasteboard le plus sombre (`#1C1C1C`), panneaux au milieu (`#1F1F1F`),
   chrome le plus clair (`#404040`) — la photo est l'endroit le plus sombre de
   l'écran, rien ne la concurrence. Nos tokens font l'inverse
   (`--surface-window` est notre valeur la plus sombre).
   *Chez nous* : réordonner trois tokens dans `semantic.css` — mais c'est un
   choix de DESIGN à faire valider sur capture, pas un correctif.
3. `[écran]` **Le verrou est UN cadenas** dans l'en-tête — quand nous avons
   livré QUATRE verrous le même jour (modèle Photoshop). ⚠️ Contradiction
   ouverte, déjà actée dans le relevé observations : ne rien défaire avant
   d'avoir éprouvé ce que leur cadenas REFUSE sur un document réel. Un booléen
   d'interface peut geler plusieurs choses.
4. `[écran]` **L'œil de visibilité est à DROITE** de la ligne, la poignée à
   gauche ; la sélection est un aplat franc (`#205D9F`), pas une teinte
   discrète. Deux micro-choix cohérents avec « la ligne se lit de gauche à
   droite : identité d'abord, états ensuite ».
5. `[symbole]` **Panneaux virtualisés** (`VirtualizingPanel` et famille) — ne
   rendent que les lignes visibles. Invisible à cinq calques, obligatoire à
   deux cents. À noter, pas à faire.
6. `[symbole]` **Deux studios, gauche ET droite** (`IsLeftStudio`/`IsRightStudio`)
   — la surcharge se répartit. Notre dock est à droite seulement, et c'est lui
   qui débordait à 1280×720. Nourrit le ticket layout de la carte hybride
   (`.scratch/hybride-lightroom-photoshop/issues/04-le-layout.md`).
7. ✅ `[écran]` **Notre dock à onglets du 2026-08-19 est VALIDÉ** par leur
   colonne de Studios : groupes à onglets empilés, chevron de repli, un panneau
   visible par groupe. Les deux références (Photoshop, Affinity) font pareil.

---

## Axe 4 — UX, le geste

1. `[symbole]` **Le pinceau d'effet** (`FilterBrush`/`AdjustmentBrush` :
   choisir un filtre, peindre — un geste). Notre équivalent fait DEUX gestes
   (ajouter le calque, peindre le masque) et fait MIEUX après coup (modifiable,
   annulable, visible dans la pile).
   *Chez nous* : la piste à 5 % du coût est un raccourci « ajouter cet effet
   avec masque vide + passer au pinceau » — tout existe (`ui/tools.ts`,
   `setCanvasMode`). À chiffrer contre le pinceau complet AVANT de choisir —
   [ticket 10](../../.scratch/affinity/issues/10-pinceau-d-effet.md), verdict
   d'Antoine sur le geste requis.
2. `[symbole]` **Le magnétisme est un SYSTÈME** (`SnappingGrid`, presets,
   plans, cube, rotation) — chez nous il n'existe que sur `TransformHandles`.
   Le geste chez nous : poser une forme `aplat` alignée sur une autre, caler un
   dégradé au tiers. Prise moyenne : un `SnappingOptions` central que les
   outils consultent, pas une grille 3D.
3. `[symbole]` ⚠️ **NEUF — les raccourcis clavier sont ENTIÈREMENT
   configurables** : `ChangeShortcut`, `GetShortcutConflicts` (détection de
   conflits), `ImportShortcuts`/`SaveShortcuts`, `ShortcutCycles` (une touche
   cycle entre outils), une page de préférences dédiée. Aucun relevé n'avait
   synthétisé ce bloc du catalogue.
   *Chez nous* : les raccourcis sont en dur, dispersés dans les `keydown` de
   `App.tsx`/`Canvas.tsx`/`LayerPanel.tsx`. Une prise en deux temps :
   (a) centraliser la table touche→commande (préalable de toute
   configurabilité, et déjà un gain de code) ; (b) la page de préférences, si
   le besoin est réel. Candidat, sans ticket.
4. `[symbole+écran]` ⚠️ **NEUF — l'historique est VISIBLE et a des
   INSTANTANÉS** : un panneau Historique (onglet du groupe 3 des Studios,
   relevé à l'écran), des snapshots avec vignette et horodatage
   (`HistorySnapshotIndex`, `HistoryThumbnail`, `HistoryTime`), et
   `HasAlternateFutures` — un redo à BRANCHES.
   *Chez nous* : `History` est solide (budget 512 Mo, refcount des buffers de
   masque) et totalement INVISIBLE — aucun panneau, aucun libellé d'entrée.
   Prise en deux temps : (a) un panneau qui LISTE les entrées avec libellés —
   demande d'abord que `History.push` porte un libellé, petit chantier de
   modèle ; (b) les snapshots nommés ensuite. Les branches : écartées, coût
   réel et geste non identifié. Candidat, sans ticket.
5. `[écran]` **La barre contextuelle est PAR OUTIL et flottante** au-dessus de
   la toile (`ContextBarPanel`, `SubToolPanel` — des sous-outils par outil), là
   où notre barre d'options unique coûte 75 px de hauteur permanente.
6. ✅ `[symbole]` **`FadeRewind` (Atténuer) — déjà couvert chez nous,
   gratuitement** : un calque d'effet a `opacity` et `blendMode`. Leur
   mécanisme est un correctif d'historique pour modèle destructif ; notre
   modèle n'en a pas besoin. Rien à faire.
7. `[symbole]` **`CanMergeLiveFilterDown`** — fusionner un filtre dans le
   calque du dessous. Chez nous : aucun aplatissement de calque d'effet.
   Candidat mineur — notre pile est assez rapide pour que le besoin ne presse
   pas.
8. `[symbole]` **Les macros** (`MacroTool`, import/export) : enregistrer une
   séquence d'actions. Écarté : nos presets d'effet couvrent le cas « recette
   reproductible », et une macro générale est un autre produit.

---

## Axe 5 — Code / moteur

1. `[mesuré]` **Latence : NOUS sommes devant, 6 à 25×.** Leur filtre natif le
   moins cher : 136 ms sur 26 Mpx ; notre pile entière à cinq effets : 23 ms
   pendant un geste. Leur plancher ~140 ms est le coût de leur modèle de
   document (application destructive : tuiles + historique), le nôtre est une
   recomposition GPU sans aller-retour. Chiffres et protocole :
   [verdict](affinity-plugin-verdict-2026-08-19.md). ⚠️ Rien n'est dit sur leur
   aperçu LIVE, non pilotable par SDK.
2. `[binaire]` **Profondeur et gestion de la couleur : ILS sont devant, et
   c'est l'HÔTE.** 16 bits de document, 32 bits HDR avec persona dédié, ICC
   accéléré (`CreateHardwareICCTransform`), OCIO, LUT 3D, épreuvage
   (`SoftProof`), gain maps. **Comment ils font est la leçon** : aucun drapeau
   sRGB de format — l'espace est une DONNÉE portée par un profil (`IsLinear`,
   `GetLinearRGBProfile`), l'encodage une étape nommée.
   *Chez nous* : c'est la troisième voie du
   [ticket 11](../../.scratch/affinity/issues/11-debloquer-le-16-bit.md), qui
   débloque l'export print arrêté en toutes lettres. Trois mesures avant de
   trancher : coût de l'encodage explicite en prod, les sept modules qui
   consomment `srgbFormat`, le sort des 122 références de pixels.
3. `[binaire]` **Un même source de filtre compile en OpenCL OU en C++ CPU**
   (gabarit `KERNEL_PREAMBLE`). C'est leur portabilité, pas un manque chez
   nous : notre WGSL est validé CPU par naga (`test:wgsl`) et exécuté par un
   seul moteur. Rien à prendre.
4. ✅ `[mesuré]` **Mipmaps sur les scans** — déjà pris (2026-08-17), coût plat
   2,2–2,4 ms mesuré. Leur moteur fait forcément l'équivalent ; nous l'avons.
5. **Leur modèle à TUILES** borne la mémoire sur les très grands documents ;
   nous, textures pleines + `MAX_CANVAS_PIXELS = 64 Mpx` (ADR-0007). Position
   tenue tant que la borne existe — pas un manque, un choix différent avec un
   garde-fou.
6. `[binaire]` **Le masque est une entrée de PREMIÈRE CLASSE de chaque noyau.**
   Le gabarit OpenCL de `libraster.dll` signe TOUT filtre avec
   `mask_pixels` ET `secondary_mask_pixels` à côté des pixels source — le
   masquage n'est pas un composite après coup, chaque noyau peut le lire.
   Chez nous le masque gate le COMPOSITE du calque
   (`MaskTextureResolver` → fusion), et aucun effet ne peut le lire pendant
   son calcul. Ce n'est pas un défaut aujourd'hui — aucun effet du registre
   n'en a eu besoin — mais c'est la pièce qui rendrait un jour un effet
   « conscient du masque » (une diffusion qui s'arrête au bord du masque au
   lieu d'être coupée par lui). À noter, pas à faire.
7. `[mesuré au SDK]` **Deux corrections du relevé d'hier, même famille que
   les quatre premières.** (a) Les LIVE FILTERS et les ajustements SONT
   pilotables : `nodes.js` expose `BloomFilterRasterNodeDefinition`,
   `LensBlurFilterRasterNodeDefinition`, `CurvesAdjustmentRasterNodeDefinition`…
   avec leurs structures `*Parameters` typées — posables par `doc.addNode`,
   modifiables, dans l'arbre non destructif. La réserve du verdict (« rien
   sur leur chemin live ») est donc LEVABLE par mesure ; personne ne l'a
   encore prise. (b) L'accès aux pixels par BUFFER existe
   (`PixelBuffer.buffer`, `rasterInterface.createCompatibleBuffer`) — la
   borne « 5,2 s par passe » du relevé SDK ne vaut que pour `readPixel`
   pixel-à-pixel. Le verdict perfs tient (il mesure leurs filtres NATIFS,
   ~140 ms de plancher), mais l'argument « le SDK ne sait pas transporter des
   pixels » tombe : c'est par cette voie que toutes les mesures de ce
   document ont relu leurs rendus.

---

## Axe 6 — Outillage

### Côté utilisateur — là où l'écart est réel

1. `[symbole]` ⚠️ **NEUF — le système d'EXPORT est un produit dans le
   produit** : `QuickExport`, des SETUPS d'export en presets (copiables,
   renommables), l'export par tranches (`SliceTool`, auto-export), par calque,
   en batch (`CanExportBatch`), et les formats — TIFF 16 bits, OpenEXR,
   Radiance HDR, PSD, WebP, JPEG-XL.
   *Chez nous* : l'export est UNE copie JPEG à qualité 0,95 **en dur**
   (`exportImage.ts:107`). Prise en trois crans, chacun utile seul :
   (a) qualité réglable + PNG — petit, `convertToBlob` sait déjà faire ;
   (b) TIFF 16 bits — dépend du ticket 11, c'est le PRD print ;
   (c) batch « appliquer un preset à un dossier » — le vrai geste séries
   d'Antoine, à charter s'il le nomme. Candidat, sans ticket.
2. `[SDK]` **Le scripting utilisateur** (console JS, macros, batch jobs) :
   rien d'équivalent chez nous, et rien à copier tel quel — notre surface
   d'automatisation est le pont de debug CDP, qui est un outil de dev, pas un
   outil d'utilisateur. S'il y a un besoin un jour, il commencera par le batch
   d'export ci-dessus, pas par une console.

### Côté développement — rien à copier, un instrument à garder

- **Leur SDK est notre INSTRUMENT DE MESURE** — c'est la méthode de la carte
  (boîte noire : piloter, relire les pixels, réimplémenter), et elle a déjà
  produit deux améliorations livrées. À garder pour chaque item `[symbole]`
  qui monte en ticket.
- **Notre outillage de preuve n'a pas d'équivalent visible chez eux** : 122
  références de pixels verrouillées, gate de câblage des paramètres, sonde de
  perf qui refuse le build de dev, mires écrites par effet. C'est notre
  avantage de méthode ; rien côté Affinity ne le remplace.

---

## Récapitulatif — toutes les prises, classées

**Livré le 2026-08-19** : plancher du Bloom (`glow`), courbure des lames
(`lensBlur`/`lensFlare`), et la validation externe du dock à onglets.

**Tickets ouverts, dans l'ordre gain/coût de cet audit :**

| # | Prise | Coût | Ticket |
| --- | --- | --- | --- |
| 1 | Couleur de surimpression du masque | XS | [05](../../.scratch/affinity/issues/05-couleur-surimpression.md) |
| 2 | Texturer le masque ⭐ | S–M (binding 7 côté masque à vérifier) | [03](../../.scratch/affinity/issues/03-texturer-le-masque.md) |
| 3 | Lever `libraryTexture` + passes internes → ZMap + `lensFlare` texturé | M | noté au verdict, sans ticket dédié |
| 4 | Modes de fusion : `BlendRanges` d'abord, les 15 modes ensuite | M | [06](../../.scratch/affinity/issues/06-modes-de-fusion.md) |
| 5 | 16 bits par la troisième voie (chaîne linéaire, encodage explicite) | L, 3 mesures préalables | [11](../../.scratch/affinity/issues/11-debloquer-le-16-bit.md) |
| 6 | Pinceau d'effet — d'abord le raccourci à 5 % | S (raccourci) / L (outil) | [10](../../.scratch/affinity/issues/10-pinceau-d-effet.md) |
| 7 | Masque bandpass — prototype sur vraie photo | M | [09](../../.scratch/affinity/issues/09-masque-bandpass.md) |
| 8 | Sélection ou masque — ADR à écrire | grilling | [07](../../.scratch/affinity/issues/07-selection-ou-masque.md) |
| 9 | Ajustement contre filtre — mesurer nos « par pixel » d'abord | grilling | [08](../../.scratch/affinity/issues/08-ajustement-contre-filtre.md) |

**Candidats NOUVEAUX de cet audit, sans ticket — à charter si Antoine les
veut** (aucun n'est ouvert d'office, la carte interdit de copier sans geste
nommé) :

| Candidat | Le geste | Coût |
| --- | --- | --- |
| ⭐ Feather en 3 passes SAT (profil en S mesuré chez eux) | un bord adouci sans les deux cassures de la rampe | S — passes déjà écrites, itération + recalibrage |
| ⭐ Morphologie octogonale (leur grow est un disque, mesuré) | contract/dilate qui ne déforme plus les coins de 41 % | M — deux passes diagonales de plus |
| Smooth géométrique (close∘open, leur nature mesurée) | arrondir la forme sans flouter les bords droits | M — dépend du précédent |
| Stabilisateur de trait (corde/moyenne) | détourer à main levée sans tremblement | S–M |
| Lot « développement » : WhiteBalance, Exposure, Vibrance, HSL | développer la photo dans l'app (moitié Lightroom de l'hybride) | M — par-pixel, patron `curves`/`channelMixer`, aucun mécanisme neuf |
| ⚠️ CHANTIER calque de retouche (pixels peints) | clone, healing, inpainting patch, dodge/burn | L — nouveau genre de contenu, ADR d'abord ; les pinceaux suivent le support |
| Export : qualité réglable + PNG | sortir autre chose qu'un JPEG 0,95 | XS |
| Panneau Historique (libellés d'entrées) | voir et viser un état d'annulation | M (libellés sur `History.push` d'abord) |
| Raccourcis centralisés, puis configurables | table touche→commande unique | S puis M |
| Presets de masque | réutiliser un masque de luminosité réglé | S |
| Copie de masque entre calques | ne pas repeindre deux fois | S |
| Snapping système (aplat, dégradés) | aligner une forme posée | M |
| Deux zones fixes dans le panneau Calques | séparer décrire/agir | S + amendement ADR-0001 |
| Glitch par canal sur `sliceShift` | franges RVB décalées séparément | S |
| LUT 3D | appliquer un look `.cube` partagé | M |

**Écartés, avec raison** : bilatéral (ADR-0011, décision inverse déjà prise) ·
Mixbox et les dynamiques de COULEUR du pinceau (`hueShift`… — nous ne
peignons pas de couleur ; les dynamiques de FORME, scatter et texture de
tampon, elles, sont reclassées côté masque) · macros générales (les presets
couvrent le cas) · branches d'historique (geste non identifié) · IA
(sélection sujet, inpainting génératif, super-résolution, portrait — un autre
produit ; l'inpainting par PATCHS, lui, est reclassé dans le chantier
retouche) · `FadeRewind` (déjà couvert par `opacity`/`blendMode`) · personas
(un seul métier ici) · tuiles (ADR-0007 borne autrement) · les trois bandes
tonales du Bloom (un axe suffisait — pris sous forme de retenue des noirs) ·
symétrie de peinture (aucun geste nommé sur un masque ; à rouvrir si un
masque symétrique manque un jour).

---

## Ce que cet audit ne dit pas

- **Tout item `[symbole]` reste à regarder dans Affinity avant d'écrire du
  code** — en particulier : le comportement réel de `BlendRanges`, le langage
  de la texture procédurale, ce que le cadenas unique refuse. (`MaskTexture`
  est sorti de cette liste : ses trois modes sont lus dans l'app —
  `None · Nozzle · Final`.)
- **Le profil du TAMPON de pinceau n'a pas pu être mesuré** : aucune API de
  trait dans le SDK. Protocole manuel, cinq minutes avec Antoine : un dab
  isolé à dureté 0 %, 50 %, 100 % sur un document vierge, lecture des pixels
  par le même chemin `PixelBuffer` que les mesures de sélection — le profil
  radial dit si leur dureté est la rampe que nous avons ou la courbe en S que
  leur feather laisse attendre.
- **Le chemin LIVE est désormais mesurable** (`nodes.js`, axe 5 point 7) et
  ne l'a pas encore été : coût d'un live filter pendant un drag de paramètre,
  à quelle résolution d'aperçu — la dernière réserve du verdict perfs peut
  tomber par une mesure, dans un sens ou dans l'autre.
- **Rien sur la beauté de leurs rendus.** Les mesures portent des temps et des
  comportements ; « est-ce beau » se juge sur une photo d'Antoine.
- **Les dimensions relevées à l'écran ne sont pas transposables** (facteur
  d'échelle inconnu) — structures oui, pixels non.
- **Leur aperçu de filtre live n'a pas pu être mesuré** ; la victoire de
  latence est contre leur application destructive, qui est le régime d'un
  `.8bf` — c'est précisément pour ça qu'elle clôt la question du plugin.
