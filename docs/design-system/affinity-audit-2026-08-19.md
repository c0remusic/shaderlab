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

---

## Réponse courte, par axe

| Axe | Verdict |
| --- | --- |
| **Effets** | Sur NOTRE territoire (optique, analogique, imprimé) : ils ne font pas mieux — 18 de nos effets n'ont aucun équivalent chez eux, et leur Halftone piloté par SDK est monochrome quand le nôtre fait la quadrichromie. Sur LEUR territoire (retouche photographique) : oui — ajustements, flou par carte de profondeur, éclairage, équations utilisateur. Deux idées déjà prises et livrées le jour même. |
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
   `SplitToning`, `Threshold`. ⚠️ Notre territoire est l'effet d'auteur, pas la
   retouche — `curves` couvre déjà l'essentiel de `Levels`, `gradientMap` et
   `duotone` mordent sur `SplitToning`. La carte interdit de copier sans
   nommer le geste débloqué : aucun de ces sept n'en a un aujourd'hui.
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
moteur de pinceau/Mixbox (nous peignons des masques) · macros générales
(les presets couvrent le cas) · branches d'historique (geste non identifié) ·
IA (sélection sujet, super-résolution, portrait — un autre produit) ·
`FadeRewind` (déjà couvert par `opacity`/`blendMode`) · personas (un seul
métier ici) · tuiles (ADR-0007 borne autrement) · les trois bandes tonales du
Bloom (un axe suffisait — pris sous forme de retenue des noirs).

---

## Ce que cet audit ne dit pas

- **Tout item `[symbole]` reste à regarder dans Affinity avant d'écrire du
  code** — en particulier : le mode de combinaison de `MaskTexture`, le
  comportement réel de `BlendRanges`, le langage de la texture procédurale,
  ce que le cadenas unique refuse.
- **Rien sur la beauté de leurs rendus.** Les mesures portent des temps et des
  comportements ; « est-ce beau » se juge sur une photo d'Antoine.
- **Les dimensions relevées à l'écran ne sont pas transposables** (facteur
  d'échelle inconnu) — structures oui, pixels non.
- **Leur aperçu de filtre live n'a pas pu être mesuré** ; la victoire de
  latence est contre leur application destructive, qui est le régime d'un
  `.8bf` — c'est précisément pour ça qu'elle clôt la question du plugin.
