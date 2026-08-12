# Ce qu'est un manipulateur direct de niveau professionnel

Recherche du ticket [18](../issues/18-ce-qu-est-un-manipulateur-de-niveau-pro.md).
Fournit la grille que le ticket [17](../issues/17-les-outils-sur-la-toile.md) utilisera
comme critère de sortie. **Ce document n'arbitre rien** : il ne dit pas ce qu'il
faut construire, il dit ce qui existe, où c'est écrit, et à quel fichier de chez
nous ça se rattacherait.

---

## Méthode et niveau de preuve — à lire avant de citer quoi que ce soit

Le ticket prévient que le résumeur de recherche fabrique. Chaque affirmation
porte donc son **niveau de preuve**, et il n'est pas le même partout :

| Niveau | Ce que ça veut dire | Marque |
|---|---|---|
| **DOM** | Page rendue dans un vrai navigateur, texte extrait du DOM, citation relue dans ce texte | (aucune marque — c'est le défaut) |
| **RÉSUMÉ** | Passé par un extracteur qui résume. Citation plausible, pas relue sur la page rendue | `[résumé]` |
| **NON VÉRIFIÉ** | Rapporté par un moteur de recherche, jamais confirmé sur une page rendue | `[non vérifié]` |
| **CODE** | Lu dans le dépôt, à la ligne citée | `[code]` |

**Deux passes de navigateur indépendantes** ont été faites : l'une directe (§A1
à §A5, §A10, §B1 à §B5 sur Camera Raw et Blur Gallery), l'autre déléguée à un
agent dédié à Photoshop et Lightroom Classic. Les deux ont rendu les pages et lu
le DOM ; elles **se recoupent sur le Filtre radial** et donnent le même compte de
poignées, ce qui est le seul contrôle croisé disponible ici.

### Ce que le blocage d'Adobe a réellement donné

`helpx.adobe.com` refuse bien les clients HTTP : mesuré à nouveau ce jour,
**timeout à 60 s** sur `transforming-objects.html`, et **HTTP 403** sur
`docs.blender.org`. En revanche **le navigateur passe sans difficulté** — toutes
les pages Adobe citées ici ont été rendues. Le piège du ticket est exact sur le
diagnostic, et il a une sortie fiable.

### La réécriture de 2026-02-23 est confirmée, et elle a coûté plus que prévu

La page de masquage courante de Camera Raw (18 juin 2026) ne décrit plus le
manipulateur radial que par « Select and drag the tool into the area you want to
edit ». La page de *référence* du Filtre radial, elle, n'a pas bougé depuis le
**3 novembre 2023** et porte une section entière de mécanisme. **Les deux
coexistent ; c'est la plus vieille qui documente.**

**La perte la plus lourde : la référence de raccourcis Photoshop n'existe plus.**
`photoshop/using/default-keyboard-shortcuts.html` redirige vers
`…/view-keyboard-shortcuts.html` (23 févr. 2026), dont le `<main>` fait
**2 098 caractères** et dont l'instruction complète est « Select Edit > Keyboard
Shortcuts ». Il n'y a plus **aucune table de raccourcis** sur helpx pour
Photoshop : Adobe renvoie à la boîte de dialogue de l'application. Tout le §B a
donc dû être reconstitué depuis les pages de *fonctionnalité* qui ont survécu.

**Pages qui ont survécu en style de référence ancien** — à citer en priorité, et
à archiver si le ticket 17 doit s'y appuyer dans six mois :
`editing-paths.html` · `free-transformations-images-shapes-paths.html` ·
`positioning-elements-snapping.html` · `vanishing-point.html` ·
`correcting-image-distortion-noise.html` · `adjusting-crop-rotation-canvas.html` ·
`modify-shapes.html` · `radial-filters-camera-raw.html` ·
`lightroom-radial-filter.html` · `apply-local-adjustments.html`.

**Une contradiction entre deux pages Adobe vivantes, signalée et non résolue :**
le raccourci des repères commentés est donné comme `Ctrl+Shift+;` sur
`show-or-hide-guides-grids-and-smart-guides.html` et comme `Ctrl+U` sur
`work-efficiently-with-smart-guides.html`. Les deux rendues le même jour, les
deux datées du 23 févr. 2026.

---

## 0. Notre socle, mesuré — à ne pas redécouvrir ni re-supposer

Le ticket dit « le socle existe et il est inégal ». Mesuré le 2026-08-13, il l'est
plus qu'on ne le croit, et les écarts ne sont pas où on les attend.

### 0.1 — Ce que nous avons

| Élément | Fichier | État |
|---|---|---|
| Trois genres `point` · `disk` · `axis` | `src/render/effects/types.ts:151-154` | union fermée, validée au chargement |
| Condition d'apparition d'un manipulateur | `types.ts` `CanvasControlVisibility.visibleWhen` | partagée avec `appliesWhen` (même `DisplayCondition`) |
| Dispatch déclaratif, sans `if (effectId)` | `src/components/CanvasControls.tsx` | 66 lignes, aucun branchement par effet |
| Géométrie pure, testable en Node | `src/ui/canvasControls.ts`, `src/ui/regionHandles.ts`, `src/ui/transform.ts` | aucune dépendance DOM |
| Overlay aligné sur le canvas réellement affiché | `transform.ts:103` `overlayRectFromClientRects` | deux rects **mesurés**, aucune hypothèse de mise en page |
| Magnétisme de position et d'échelle | `src/ui/snap.ts` | seuil en **pixels écran** (`SNAP_THRESHOLD_SCREEN_PX = 8`) |
| Accroche d'angle à 15° | `transform.ts:167` `ANGLE_SNAP_DEGREES` | déclencheur `Shift` maintenu |
| Désignation par clic sur la toile | `src/ui/hitTest.ts` | géométrie stricte, aucune tolérance |
| Abandon sur `pointercancel` sans commit | les 4 composants d'overlay | alt-tab / interruption OS ne laisse pas de drag armé |
| Une entrée d'historique par geste | commit au `pointerup` / `keyup` | `RegionHandles.tsx:195-202` dit pourquoi |

Les quatre effets porteurs `[code]` :

- `lensFlare.ts:315` — `disk` (`sourceX`, `sourceY`, `sourceRadius`)
- `lightLeak.ts:158-161` — `point` (`origineX`/`origineY`) **et** `axis` (`direction`/`portee`)
- `motionBlur.ts:342-345` — `axis` et `point`, chacun sous `visibleWhen`
- `pixelStretch.ts:148` — `disk` (`regionX`, `regionY`, `regionRadius`)

### 0.2 — Ce qui est mesurablement absent ou inégal

Sept mesures sur le code au 2026-08-13, pas des impressions. Elles servent de
**ligne de base** aux parties A et B.

1. **Aucune règle `:hover` dans les quatre CSS d'overlay.** Vérifié sur
   `TransformHandles.css`, `RegionHandles.css`, `PointHandles.css`,
   `AxisHandles.css` — zéro occurrence. Une poignée ne réagit pas au survol. Le
   seul retour de survol existant est le **curseur** (§0.3).
2. **Aucun affichage de valeur sur la toile pendant le geste.** Aucun `<output>`
   ni `aria-live` dans les quatre composants ; les seuls du dépôt sont dans
   `ColorRampControl.tsx:152`, `CurveControl.tsx:84`, `Toolbar.tsx:167`.
3. **L'origine d'un `axis` est clouée au centre de l'image.**
   `canvasControls.ts:75` et `:95` posent `center = { x: 0.5, y: 0.5 }` en défaut,
   et `AxisHandles.tsx:46` ne passe **jamais** de centre. Conséquence visible :
   dans `lightLeak`, l'« Entrée de la lumière » (un `point` déplaçable) et le
   « Trajet » (un `axis`) sont **deux manipulateurs sans lien géométrique** — le
   trajet part du centre du cadre, pas de l'entrée.
4. **Deux poignées sur cinq sautent sous le curseur.** `PointHandles.tsx:73` et
   `TransformHandles.tsx:199-210` retranchent l'écart de saisie ; en face,
   `RegionHandles.tsx:134` pose explicitement `{ dx: 0, dy: 0 }` pour le rayon, et
   `AxisHandles.tsx:37` n'en a aucun. Attraper le bord d'une de ces deux poignées
   la téléporte au pointeur.
5. **Aucun magnétisme sur `point` / `disk` / `axis`.** `src/ui/snap.ts` n'est
   importé que par `TransformHandles.tsx`.
6. **Échap n'annule aucun geste.** `TransformHandles.tsx:318-327` le dit
   lui-même : Échap **rend le focus, rien de plus**, l'annulation est `Ctrl+Z`.
   Les trois autres composants n'écoutent pas Échap.
7. **Poignées de 12 px.** `--slider-thumb-size: 12px`
   (`src/design/components.css:58`) sert de taille aux poignées de `PointHandles`,
   `AxisHandles`, `RegionHandles` et aux coins de `TransformHandles`. Voir §B4.

### 0.3 — Ce que nous avons DÉJÀ et qui est au niveau visé

À ne pas reconstruire.

- **Le cadre en deux traits** — halo sombre large + trait clair fin, pour se lire
  sur une photo claire comme sur une sombre (`TransformHandles.css`, repris par
  `RegionHandles.css`). Fait de contraste, pas réglage.
- **Trait plein vs tireté** : « objet du document » (cadre photo) contre « zone
  d'action » (cercle d'effet) — `RegionHandles.css`.
- **Curseurs différenciés par axe** : `nwse-resize` / `nesw-resize` selon la
  diagonale du coin, `ns-resize` / `ew-resize` sur les côtés, `grab` sur la
  rotation, `move` sur le corps. La **forme** des poignées de côté (plate en
  haut/bas, haute à gauche/droite) annonce l'axe **avant** le survol — c'est
  exactement le mécanisme du §A9.
- **L'overlay rend la main pendant un déplacement de vue** (`Espace` maintenu) via
  `.pasteboard__view--pan`.

---

# PARTIE A — Le vocabulaire de genres

Nous en avons trois. Chaque entrée dit : **le mécanisme**, **la source**, **où ça
se rattacherait chez nous**.

## A1 — L'ÉPINGLE (*pin*) : un point qui porte une valeur, et qui se compose

**Mécanisme.** Ce n'est pas notre `point` (une coordonnée). C'est un point qui
**porte un réglage scalaire propre**, dont plusieurs instances **se composent**,
et qui existe comme objet.

> « Use Field Blur to build a gradient of blurs, by defining multiple blur
> points with different amounts of blur. Add multiple pins to the image and
> specify a blur amount for each pin. »

> « The final result is combined effect of all blur pins on the image. **You can
> even add a pin outside the image**, to apply the blur at corners. »

Trois corollaires documentés, tous absents chez nous : un **état
sélectionné/non sélectionné visible** (« A. Unselected blur pin B. Selected blur
pin »), une pose **hors cadre** qui agit quand même, et **`Suppr` qui supprime**
(« Press Delete to remove it. »).

Puppet Warp ajoute une propriété qu'aucun curseur ne porte — **la profondeur
relative de deux épingles** :

> « To reveal overlapped mesh areas, select **Pin Depth** icons in the Options
> bar. »

Camera Raw a le même objet avec un **réglage de visibilité global** :

> « **Show Unselected Mask Pins** Select this option to show pins for masks not
> selected on the photo. »
> « **Show Pins and Tools** - Deselect this to not show pins and tool icons on
> the photo. »

**Sources.** `blur-gallery.html` (Field blur) ·
`…/distort-specific-image-areas-with-puppet-warp.html` ·
`camera-raw/using/masking.html` (§ More overlay settings)

**Où ça s'appliquerait chez nous.** L'union `CanvasControl` (`types.ts:151-154`)
ne peut pas exprimer ce genre : un `point` y est **une paire de paramètres
nommés**, donc un nombre d'instances fixé par l'effet. Une épingle composable
demande une cardinalité variable, que `params: Record<string, number>` ne porte
pas. Le réglage de visibilité global, lui, se poserait dans `CanvasControls.tsx`
sans toucher au modèle.

## A2 — L'ANNEAU DE VALEUR (*blur ring* / *blur amount wheel*)

**Mécanisme.** Un scalaire réglé par un **anneau posé autour de l'épingle**, pas
par un curseur de panneau — et qui n'apparaît **qu'au survol**.

> « Drag the blur handle to increase or decrease the blur. You can also use the
> Blur Tools panel to specify a blur value. »
> « **Hover the mouse pointer near a selected endpoint** to view the blur amount
> wheel control. »

La légende de Spin Blur nomme l'anatomie complète, en quatre pièces :

> « A. Rotation point B. Blur ring C. Feather handles D. Ellipse handles »

**Source.** `blur-gallery.html` (§ Field blur, § Path blur, § Spin blur)

**Où ça s'appliquerait chez nous.** Un quatrième genre dans `CanvasControl`
(`types.ts:151`) : un contrôle qui lie **un** paramètre scalaire à une géométrie
angulaire, là où `disk` en lie trois et `axis` deux. Son rendu serait un frère de
`AxisHandles.tsx`. « N'apparaît qu'au survol » suppose un état de survol, que le
§0.2-1 dit inexistant.

## A3 — L'ÉPINGLE-CURSEUR : le pin EST un curseur 1-D

**Mécanisme.** Variante distincte de §A2 : pas d'anneau, l'épingle elle-même se
tire latéralement pour régler la valeur.

> « Increase/decrease Amount — **Drag adjustment pin right/left** »
> « Move the pointer over the pin and **drag the double-pointing arrow to the
> right to increase** »

**Source.** `lightroom-classic/…/keyboard-shortcuts.html` ·
`…/apply-local-adjustments.html`

**Où ça s'appliquerait chez nous.** Ce serait le genre le moins coûteux à ajouter :
il lie **un** paramètre existant à un geste horizontal sur un point déjà dessiné —
`PointHandles.tsx` porte déjà le point et la capture de pointeur.

## A4 — LE DISQUE À QUATRE POIGNÉES, ROTATION PRISE SUR LE BORD

**Mécanisme.** Le ticket demandait de confirmer « masque radial ». **Confirmé,
par deux passes indépendantes**, et plus riche que notre `disk` :

> « Click and drag the center of the filter to move and reposition it. »
> « **Hover the pointer over any of the four filter handles**, and when the
> pointer icon changes, click and drag to change the size of the filter. »
> « **Hover the pointer close to the edge of the filter**, and when the pointer
> icon changes, click and drag the edge of the filter to change the orientation. »

Donc : **une ellipse**, **quatre** poignées de taille, et **la rotation se prend
sur le BORD lui-même** — il n'y a **aucune poignée de rotation dédiée**.

> « To edit a Radial filter, click any of the **gray handles** on the photo. When
> selected, **the handle turns red**. »
> « The Radial Filter is represented by an **elliptical marquee** »

**Le fondu reste un curseur ici** — « The Feather slider adjusts the falloff of
the applied effect » — alors que Blur Gallery en fait des poignées (§A2,
« C. Feather handles »). **Les deux réponses coexistent chez Adobe** ; ce n'est
pas une règle unique. De même le sens de l'effet est une case, pas une poignée
(ACR « Outside » / « Inside » ; Lightroom « Invert »).

**Sources.** `camera-raw/using/radial-filters-camera-raw.html` (3 nov. 2023) ·
`lightroom-classic/…/lightroom-radial-filter.html`

**Où ça s'appliquerait chez nous.** Directement sur le genre `disk`
(`types.ts:153`), qui déclare `x`, `y`, `radius` — un **cercle** à **une** poignée.
`src/ui/regionHandles.ts` (`radiusFromOverlayPoint`, `clampRegionRadius`) et
`RegionHandles.tsx` en portent la géométrie. Passer à l'ellipse touche les deux
porteurs actuels, `pixelStretch.ts:148` et `lensFlare.ts:315`, dont les rayons
sont scalaires.

## A5 — LES TROIS ZONES CONCENTRIQUES (net / fondu / flou)

**Mécanisme.** Des poignées qui ne bornent pas **une** forme mais **la transition
entre deux** — la légende nomme trois zones :

> « A. Sharp area B. Fade area C. Blur area »
> « Drag the handles to move them to redefine the various areas. »

Le pinceau applique le même principe **au curseur de souris**, et c'est la
définition la plus exploitable qu'Adobe donne d'un fondu :

> « **The distance between the inner and outer circle is the Feather amount in
> the Brush cursor.** »

**Sources.** `blur-gallery.html` (Iris blur, Tilt-Shift) ·
`camera-raw/using/masking.html` (§ Brush mask)

**Où ça s'appliquerait chez nous.** `RegionHandles.tsx` dessine **un** anneau
tireté (`.region-handles__ring`). Un second anneau concentrique dont l'écart EST
le fondu se poserait là, et demanderait au genre `disk` un quatrième nom de
paramètre dans `types.ts:153`.

## A6 — LE DÉGRADÉ POSÉ SUR PHOTO : TROIS LIGNES

**Mécanisme.** Le ticket le posait en candidat. **Confirmé** — mais uniquement
sur une page qu'**Adobe marque lui-même comme périmée** (voir l'avertissement
ci-dessous).

> « **three white guides** represent the **center, low, and high ranges** of the
> effect »
> « Drag the **pin** to move the center point of the effect. »
> « Position the pointer over the **center white line** until a curved,
> double-pointing arrow appears » → rotation
> « Drag an **outer white line** toward the edge of the photo to **expand** the
> effect » / « Drag toward the center of the photo to **contract** the effect »

Donc trois lignes de rôles distincts : la **centrale** tourne, les **deux
extérieures** règlent chacune son côté du fondu, et **l'épingle** déplace le tout.

> ⚠️ La page s'ouvre sur : « Starting from Lightroom Classic 11.0 (October 2021
> release), the following workflows **no longer apply**. » À traiter comme
> historiquement exact, pas comme garanti aujourd'hui.

Ce que la page **courante** de Camera Raw en conserve, au DOM :

> « To accurately mask a section of the image, select **Bidirectional**. **Drag
> the points from either sides** to control the area of masking in both
> directions. To flip the masking area, **right-click the full point in the
> gradient** » → « Flip Orientation »

Soit : des points aux deux extrémités, et **un point qui porte un menu
contextuel au clic droit**. L'anatomie détaillée, elle, n'est plus documentée
nulle part en cours de validité.

**Sources.** `lightroom-classic/…/apply-local-adjustments.html` (marquée périmée) ·
`camera-raw/…/masking.html` · l'ancienne
`make-local-adjustments-camera-raw.html` **redirige** désormais, miroir `/ie/`
compris.

**Où ça s'appliquerait chez nous.** C'est l'exact analogue de notre genre `axis`
(`types.ts:154`), qui déclare `angle` + `length` **et rien d'autre** : pas
d'origine, pas de fin indépendante, donc pas de « resserrer un seul côté ».
`src/ui/canvasControls.ts:70-104` et `AxisHandles.tsx` en portent tout. Le §0.2-3
(origine clouée au centre) est le premier écart.

## A7 — LE DÉGRADÉ POSÉ DE PHOTOSHOP : LIGNE + ARRÊTS + MILIEU

**Mécanisme.** Genre différent du précédent, et **actuellement documenté** (page
du 28 avril 2026, dont le sous-titre dit « using on-canvas controls and the
Properties panel ») :

> « Drag the **gradient line** on the canvas to change direction and length. »
> « Select a **color stop** to change its color. »
> « Drag color stops to adjust how colors transition. »
> « **Select along the gradient line to add** a new color stop. »
> « **Drag a stop away from the line to remove it.** »
> « Adjust the **midpoint** between stops to control the blend balance. »

Trois mécanismes qu'aucun de nos genres ne porte : **créer** une poignée en
cliquant sur la géométrie, **supprimer** une poignée en l'éloignant, et une
poignée de **milieu** qui règle la courbe entre deux autres.

Et un fait de conception à noter :

> « The Options bar settings **apply only when creating new gradients** »

— c'est-à-dire que le widget posé est le **seul** chemin d'édition d'un dégradé
existant.

**Source.** `photoshop/desktop/adjust-color/color-effects-techniques/edit-a-gradient.html`

**Où ça s'appliquerait chez nous.** `ColorRampControl` (`types.ts:189-195`) porte
déjà exactement ce modèle — trois arrêts, `blackPoint`/`whitePoint`, `position`
optionnelle — mais **dans le dock**, pas sur l'image (`ColorRampControl.tsx`).
C'est le contrôle du dépôt le plus proche d'un widget posé, et il n'est pas posé.

## A8 — LE CHEMIN À POINTS DE COURBE

**Mécanisme.** Le ticket demandait « courbe posée ». **Confirmée**, à deux
niveaux de poignées superposés :

> « you first define a path for the blur (blue). You can then define a curve for
> the path, thereby creating new curve points in the path. Once the path has been
> defined, you can define **blur shape guides** (red). »
> « A. Beginning point for the path B. Curve point created while defining a path
> C. Endpoint for the path along with the blur amount wheel control »

Le second niveau ne s'affiche **qu'au double-clic** — de la divulgation
progressive appliquée aux poignées :

> « **Double-click an endpoint** to view the red blur shape guides. »

Et le **type** d'un point se change par modificateur, dans les deux sens :

> « Opt/Alt-click a curve point along the blur path to convert it into a corner
> point. Opt/Alt-click a corner point to convert it back to a curve point. »

**Source.** `blur-gallery.html` (§ Path blur)

**Où ça s'appliquerait chez nous.** Aucun équivalent. `CurveControl`
(`types.ts:166-170`) est une courbe **dans un panneau** à trois points fixes
(`CurvePointSlot`), pas une courbe posée. Un chemin sur la toile serait le premier
genre à cardinalité variable (§A1).

## A9 — LE CHEMIN VECTORIEL : LA FORME DE LA POIGNÉE ENCODE SON ÉTAT

**Mécanisme.** C'est la source la plus précise du site sur le vocabulaire visuel
des poignées, et elle vaut bien au-delà des chemins :

> « each selected anchor point displays **one or two direction lines**, ending in
> **direction points** »
> « **Direction handles appear as filled circles**, selected anchor points as
> **filled squares** », « unselected anchor points as **hollow squares** »

Soit **trois états lisibles sans survol et sans couleur** : rond plein = poignée
de direction, carré plein = point sélectionné, carré creux = point non
sélectionné.

Deux mécanismes de plus, qui n'existent nulle part ailleurs dans cette recherche :

> « the curved segments on **both sides** of the point are adjusted
> simultaneously » (point lisse) vs « only the curve on the **same side** of the
> point » (point d'angle)
> « **Adjusting a path segment also adjusts the related segments** » — avec une
> échappatoire déclarée : « select **Constrain Path Dragging** in the options bar »

Et l'apparence de l'overlay est un **réglage utilisateur** : « specify the color
and thickness of path lines ».

**Source.** `photoshop/using/editing-paths.html` (18 juil. 2024)

**Où ça s'appliquerait chez nous.** `PointHandles.css`, `AxisHandles.css` et les
deux poignées de `RegionHandles.css` sont **toutes des disques de 12 px** ; seule
la couleur distingue le centre (`--text-value`) du rayon (`--focus-color`).
`TransformHandles.css`, lui, différencie déjà par la forme (§0.3).

## A10 — LE CADRE DE TRANSFORMATION LIBRE, ET SON POINT DE RÉFÉRENCE

**Mécanisme.** Le candidat « rectangle à poignées » du ticket. **Confirmé**, avec
une pièce que nous n'avons pas : **le point de référence**.

> « drag a **corner handle** to scale the layer proportionally »
> « move the pointer **outside the bounding border** » … « it becomes a curved,
> two-sided arrow » → rotation
> « and drag a **side handle** » (avec Ctrl+Shift) → inclinaison
> « and drag a **corner handle** » (avec Ctrl+Alt+Shift) → perspective

Le point de référence, sur sa page dédiée :

> « Transformations start from the object's **center by default** »
> « The reference point is **hidden by default** and must be made visible. »
> « **Drag the reference point** to a new position **inside or outside** the
> bounding box »

Plus un doublon numérique complet dans la barre d'options : L/H en pourcentage,
rotation en degrés, inclinaison H et V, position X/Y, et un bouton de
positionnement **relatif**.

**Sources.** `photoshop/using/free-transformations-images-shapes-paths.html`
(13 sept. 2024) ·
`…/transform-manipulate-reshape/move-reference-point-for-transformations.html`

**Où ça s'appliquerait chez nous.** `src/ui/transform.ts` : `rotationFromPointer`
(l.487) mesure l'angle **depuis `transform.x`/`transform.y`**, et
`computeHandleGeometry` (l.292) pose la poignée de rotation à
`ROTATION_HANDLE_OFFSET_PX = 32` au-dessus de ce même centre. Un point de
référence déplaçable demanderait un champ dans `LayerTransform`
(`src/layers/types.ts`), donc une migration de presets. À noter : nous avons déjà
le doublon numérique (champs Largeur/Hauteur/Angle du panneau Photo).

## A11 — LE PIVOT DÉPLAÇABLE, ET DÉPLAÇABLE HORS CADRE

**Mécanisme.** Le centre de rotation est **lui-même une poignée** — quatre
sources indépendantes, quatre conventions différentes, ce qui montre que le
mécanisme est acquis et que sa commande ne l'est pas.

Photoshop (Spin Blur), par modificateur :

> « To move a rotation point off-center […] **Alt+drag** »
> « Repositioning the rotation point is helpful while working with objects viewed
> at an angle. »

GIMP, comme poignée de plein droit, **posable hors de l'image** : `[résumé]`

> « A **circle with a cross inside** at the center of the image window for the
> pivot. Click and drag this circle to move the pivot. **It can be placed out of
> the image window, and even where you want on screen.** »

Figma, sans modificateur : `[résumé]` « Click and drag the target to move the
rotation origin. »

Krita, où le modificateur **borne** au lieu de libérer : `[résumé]` « When you
move the center pivot point, pressing Alt will allow you to limit it to the
transformation bounds. »

**Sources.** `blur-gallery.html` · `docs.gimp.org/2.10/en/gimp-tool-unified-transform.html` ·
`help.figma.com/…/360039956914` · `docs.krita.org/en/reference_manual/tools/transform.html`

**Où ça s'appliquerait chez nous.** Même point que §A10.

## A12 — LE MAILLAGE (*warp*) ET SA POLITIQUE DE GUIDES

**Mécanisme.** Quatre sortes de poignées dans un seul manipulateur :

> « Drag **control points**, a **segment** of the bounding box or **mesh** »
> « Use **control point handles** to adjust curves, like those in vector
> graphics. »
> « select an **anchor point** (where grid lines intersect) to edit its
> surrounding points »

La densité du maillage est **choisie**, pas fixe : « Select a grid size -
Default, 3x3, 4x4, or 5x5 » plus des colonnes/lignes personnalisées, et des
découpes (« Split Warp Horizontally, Split Warp Vertically, or Split Warp
Crosswise »).

**Et l'affichage des guides est un réglage de premier plan**, ce qui est le point
le plus transférable de cette section :

> « **Auto Show Guides, Always Show Guides (default), or Never Show Guides** »
> plus « **Color and Opacity** of the visual guides » et une « **Density** option
> to set how many lines appear between each Split Warp line »

**Source.** `…/effects-filters/artistic-stylize-filters/reshape-and-distort-images-with-transform-warp.html`

**Où ça s'appliquerait chez nous.** Aucun maillage. En revanche la **politique de
guides** (Auto / Toujours / Jamais + couleur + opacité) s'appliquerait telle
quelle à `CanvasControls.tsx`, qui est le point de passage unique des trois
genres, et rejoindrait le §B3.4.

## A13 — LE QUADRILATÈRE À ARÊTES VERROUILLABLES (*perspective warp*)

**Mécanisme.** L'unité est un **quad** dont les coins **sont** des épingles, et
dont une arête peut être **figée** pendant qu'on manipule le reste :

> « Slightly move a corner of a quad (pin). » (flèches du clavier)
> « **Straighten the edge of a quad and lock it** during adjustments. »
> (Maj+clic en mode Warp) — « **Shift-click again to unlock.** »
> « Constrain the shape of a plane while extending it. » (Maj+glisser, mode Layout)

Deux modes explicites, *Layout* puis *Warp*, où le même geste ne fait pas la même
chose.

**Source.** `…/repair-retouch/clean-restore-images/keyboard-shortcuts-to-adjust-perspective.html`

**Où ça s'appliquerait chez nous.** Aucun équivalent. Le verrouillage d'une partie
du manipulateur pendant qu'on manipule le reste n'existe nulle part chez nous.

## A14 — LA GRILLE DE PERSPECTIVE, ET LA VALIDITÉ ENCODÉE PAR LA COULEUR

**Mécanisme.** Découpage net entre les trois zones de saisie :

> « To reshape the perspective plane, drag a **corner node**. »
> « To scale the plane, drag an **edge node** »
> « To move the plane, **click inside the plane** and drag. »

Et surtout — le manipulateur **dit lui-même s'il est valide**, par sa couleur :

> « **Blue** Indicates a valid plane. »
> « **Red** Indicates an invalid plane. » (rapport d'aspect insoluble)
> « **Yellow** Indicates an invalid plane. » — « Some vanishing points of the
> plane cannot be resolved. »

Plus deux gestes composés : Ctrl+glisser d'un nœud d'arête détache un nouveau
plan (« The new plane is torn off at a 90° angle »), Alt+glisser du nœud d'arête
opposé règle l'angle du plan.

**Source.** `photoshop/using/vanishing-point.html` (14 oct. 2024)

**Où ça s'appliquerait chez nous.** La couleur-validité est le mécanisme le plus
transférable : nos manipulateurs n'ont **aucun** état d'invalidité affiché, alors
que le cas existe déjà — `RegionHandles.tsx:210` calcule un état `rabattue` quand
le cercle sort de la vue, et ne l'exprime que par un creux dans la pastille.

## A15 — LE PINCEAU EST UN MANIPULATEUR, PAS UN CURSEUR

**Mécanisme.** Il se règle **sur la toile**, sans quitter le geste, et sur **deux
axes de glissement** :

> « and **drag left or right** to resize the brush cursor »
> « and **drag up or down** to change the brush hardness »
> (Alt + clic droit glissé sous Windows)

Et l'anneau est un **affichage calibré dont Adobe admet l'approximation** :

> « **Normal Brush Tip:** Displays an outline corresponding to about **50%** of
> the area »
> « **Full Size Brush Tip:** Displays an outline corresponding to nearly **100%** »
> « **Show Crosshair in Brush Tip:** Displays cross hairs in the center »
> « **Show Only Crosshair While Painting:** Improves performance with large
> brushes. »

Les raccourcis publiés côté Camera Raw, tels qu'ils apparaissent au DOM :

| Résultat | Windows |
|---|---|
| Decrease / Increase current brush size | `[` / `]` |
| Decrease / Increase current feather size | `Shift + [` / `Shift + ]` |
| Decrease / Increase **other** brush size | `Alt + [` / `Alt + ]` |
| Set density to 10 … 100 | `1` … `0` |
| Toggle brush overlay | `V` |
| Temporarily switch from brush to Eraser | `Alt-drag` |
| Paint a horizontal or vertical line | `Shift-drag` |

Noter les deux dernières lignes : **l'autre outil s'emprunte par modificateur**,
et **le trait se contraint pendant qu'on peint**.

**Sources.** `…/settings-and-preferences/change-tool-pointers.html` ·
`camera-raw/using/default-keyboard-shortcuts.html` ·
`lightroom-classic/…/keyboard-shortcuts.html`

**Où ça s'appliquerait chez nous.** `BrushToolbar.tsx` et le curseur
`.pasteboard__brush-cursor` (`Canvas.css:199-213`) — le seul manipulateur du dépôt
qui a déjà un curseur dessiné sur la toile (`cursor: none` + pseudo-éléments).

## A16 — L'ÉCHANTILLONNEUR POSÉ, ET LE MARQUEUR QUI SE CORRIGE

**Mécanisme.** Un manipulateur **sans géométrie persistante** : on clique pour
désigner une valeur, les modificateurs gèrent l'accumulation.

> « **Shift+click to add multiple color samples.** You can add up to **five**
> color samples […] To remove a color sample, press **Option (macOS)/Alt
> (Windows) and click** the sample. »
> « You can adjust the brightness value […] by clicking a point or **clicking +
> dragging an area** around it. »

Variante notable — **l'application corrige le geste après coup** :

> « Drag a selection in the photo around the affected eye. »
> « **Camera Raw sizes the selection to match the pupil.** »
> « You can adjust the size of the selection by dragging its edges. »

C'est le seul mécanisme de la recherche où le manipulateur n'obéit pas
littéralement : le geste est une *indication*, l'application pose la géométrie,
et l'utilisateur peut la reprendre.

**Sources.** `camera-raw/using/masking.html` (§ Range Masks) ·
`…/masking-and-local-adjustments/red-eye-camera-raw.html`

**Où ça s'appliquerait chez nous.** Aucun équivalent posé. Le plus proche est
`ColorRangeControl.tsx` / `ColorPickerPanel.tsx`, qui vivent dans le dock.

## A17 — LES LIGNES ET LEURS POIGNÉES D'INCLINAISON (*tilt-shift*)

**Mécanisme.** Des **lignes déplaçables** plus des poignées qui les font tourner —
distinct de l'axe comme du disque.

> « Drag the lines to move them. » · « Drag the handles and rotate. »

**Source.** `blur-gallery.html` (§ Tilt-Shift)

**Où ça s'appliquerait chez nous.** Aucun équivalent ; le plus proche est `axis`,
qui n'a qu'une extrémité saisissable.

## A18 — CE QUE LE TICKET LISTAIT, ET CE QUE ÇA A DONNÉ

| Candidat du ticket | Verdict |
|---|---|
| Rectangle à poignées | **Confirmé**, + point de référence déplaçable (§A10) |
| Courbe posée | **Confirmée**, à deux niveaux (§A8) |
| Poignée d'angle | **Confirmée** — mais souvent **pas une poignée** : rotation prise sur le bord (§A4) ou hors du cadre (§A10) |
| Dégradé posé (deux points + rampe) | **Confirmé deux fois**, et ce sont **deux genres différents** : trois lignes sur photo (§A6), ligne + arrêts + milieu dans Photoshop (§A7) |
| Masque radial | **Confirmé**, plus riche que notre `disk` (§A4) |
| Pinceau de correction locale | **Confirmé** (§A15) |
| **Poignée de rayon d'angle (*live shape*)** | **INFIRMÉ.** `modify-shapes.html` ne dit que « You can easily edit your shape properties directly using on-canvas controls » ; le rayon est documenté comme un **champ de la barre d'options** (« Radius of rounded corners: Manually set the radius »), jamais comme une poignée. `non documenté` |
| — épingle composable | Non listée par le ticket, **trouvée** (§A1) |
| — anneau de valeur | Non listé, **trouvé** (§A2) |
| — épingle-curseur | Non listée, **trouvée** (§A3) |
| — maillage + politique de guides | Non listé, **trouvé** (§A12) |
| — validité encodée par la couleur | Non listée, **trouvée** (§A14) |

---

# PARTIE B — L'anatomie du geste

Les cinq rubriques du ticket, dans son ordre.

## B1 — ACCROCHE

### B1.1 — Le seuil se mesure à l'écran, jamais dans l'image

Déjà tranché et écrit chez nous — `SNAP_THRESHOLD_SCREEN_PX = 8`
(`src/ui/snap.ts:28`) : « Un seuil exprimé en pixels image vaudrait, sur une photo
6000 px affichée à 20 %, cinq fois moins de course de souris qu'à 100 % ». `[code]`

**⚠️ Adobe ne publie aucune valeur de tolérance.** `positioning-elements-snapping.html`
a été rendue en entier : **aucun nombre**. La seule valeur chiffrée de ce document
est la nôtre. `non documenté`

### B1.2 — Ce à quoi on accroche

Adobe donne la liste exhaustive des cibles, et elle est courte :

> **Guides · Grid · Layer · Slices · Document Bounds · All · None**
> « Snapping helps with precise placement of selection edges, cropping marquees,
> slices, shapes, and paths. »

Chez nous, `buildSnapTargets` (`snap.ts:77`) pose bords + médianes de la toile
**en tête**, puis bords et centres des autres calques ; à égalité d'écart la toile
gagne, et les **trois** lignes de la boîte concourent sur chaque axe. `[code]`

Un mécanisme d'Adobe que nous n'avons pas — **isoler une seule cible** :

> « make sure the Snap command is disabled », puis cocher une seule option →
> « This automatically enables snapping for the selected option, and **deselects
> all other Snap To options**. »

### B1.3 — Une accroche vers une VALEUR remarquable, pas seulement vers une ligne

`snapScales` (`snap.ts:169`) accroche à 100 % et au **ratio d'origine**, tolérance
**relative** (`SCALE_SNAP_TOLERANCE = 0.02`) et non absolue. Sa raison est écrite :
sans elle, « l'utilisateur pourrait étirer une photo, mais plus jamais la
redresser d'un geste ». `[code]`

GIMP documente le pendant sur le pivot : `Shift` « to snap pivot to center or
corner ». `[résumé]`

### B1.4 — L'accroche a une échappatoire, et elle est tenue des deux côtés

> « To **temporarily disable snapping** while using the Move tool, **hold down
> Ctrl**. »

Chez nous, même touche et même sens : `Ctrl` maintenu désactive l'accroche
pendant le drag (`TransformHandles.tsx:265`), avec sa raison — « Un magnétisme
sans échappatoire empêche le placement délibérément proche d'une ligne ». `[code]`

**Source.** `photoshop/using/positioning-elements-snapping.html`

### B1.5 — L'accroche d'angle N'EST PAS un seul nombre

C'est le point où une généralisation naïve se casse. Mesuré, par manipulateur :

| Manipulateur | Pas | Verbatim |
|---|---|---|
| Free Transform, rotation | **15°** | « Press Shift to constrain the rotation to **15°** increments. » |
| **Point / segment de chemin** | **45°** | « Shift-drag to constrain the adjustment to multiples of **45°**. » |
| Camera Raw, rotation radiale | **15°** | « press and hold Shift to snap the rotation to **15-degree** increments » |
| Vanishing Point, ligne de mesure | **15°** | « constrain its angle changes to **15 degree** increments » |
| Photoshop iPad, rotation de recadrage | **15°** | « snap rotation in every **15°** » |
| Figma, rotation | **15°** | « snap rotation values to increments of **15** » `[résumé]` |
| Perspective Warp / VP, plan détaché | **90°** | « torn off at a **90°** angle » |

Notre `ANGLE_SNAP_DEGREES = 15` (`transform.ts:167`) est donc **sourcé et
correct pour une rotation** — et il ne se généralise pas : le même `Shift` vaut
45° sur un point de chemin.

### B1.6 — Une accroche NE S'APPLIQUE PAS au clavier

Documenté chez nous avec sa raison : « Au clavier on demande exactement un pixel —
un pas qui se ferait avaler par une accroche serait un pas qui ne fait rien »
(`TransformHandles.tsx:309-313`). `[code]`

## B2 — MODIFICATEURS

La rubrique la mieux documentée. Elle se range en **sept rôles**, pas en trois
touches : la même touche change de rôle selon ce qu'on tire.

### B2.1 — ⚠️ Le rôle de `Maj` n'est PAS fixe : c'est une BASCULE d'un état persistant

Le piège annoncé par le ticket est **réel, et plus retors que « Maj
déconstraint »**. Sous un titre daté « Updated in Photoshop 21.0 (November 2019
release) » :

> « dragging a corner handle now **scales the layer proportionally by default** »
> « the **Shift key now acts as a toggle** for the Maintain Aspect Ratio button »
> « **If the Maintain Aspect Ratio button is ON, the Shift key toggles it OFF** »

Deux corollaires qui rendent le comportement non déterministe depuis le seul
geste :

> « Photoshop **remembers your last transform behavior setting** »
> réversible par « Preferences > General, then select **Legacy Free Transform** »

Donc `Maj` ne *signifie* rien en soi : il **inverse** un état persistant que
l'utilisateur ne voit que dans la barre d'options.

**Chez nous**, `Maj` a un sens fixe (contraindre), et `constrainRatio`
(`transform.ts:421`) garde le rapport **COURANT** au lieu de forcer un carré —
avec sa raison : « Forcer `scaleY = scaleX` réparerait la déformation sans qu'on
l'ait demandé ». `[code]` C'est un écart **assumé et documenté**, pas un oubli.

### B2.2 — Contraindre la FORME pendant la création

> « Press and hold **Shift while dragging to create** an adjustment that is
> constrained to a circle. » — Camera Raw
> « Hold the Shift key to constrain the selection to a **square that's in
> perspective**. » — Vanishing Point

### B2.3 — Contraindre le DÉPLACEMENT à un axe

> « While dragging inside an adjustment to move it, press and hold **Shift** to
> constrain the movement in the **horizontal or vertical direction**. »
> « Hold down the Shift key to constrain the move so it is **aligned with the
> grid** » — Vanishing Point

### B2.4 — Changer l'ANCRE du geste

> « To distort **relative to the center point** of the bounding border, press
> **Alt** » — Free Transform
> « Press Alt (Windows) or Option (Mac OS) **to scale from the center**. »
> — Vanishing Point
> « **Crop from center of photo** — Alt-drag » — Lightroom

⚠️ Noter le décalage : sur Free Transform, Adobe écrit **« distort relative to
the center point »**, pas « scale from center ». Les deux formulations coexistent
selon l'outil ; ne pas les fondre.

**Chez nous** : `e.altKey ? "center" : "oppositeCorner"`
(`TransformHandles.tsx:239`, `:248`), avec l'invariant que l'ancre reste
**rigoureusement immobile** rotation comprise (`transform.ts:340-359`). `[code]`

### B2.5 — Dissocier les deux termes d'un geste

Mécanisme absent chez nous, et propre : régler **un** des deux paramètres d'un
manipulateur bidimensionnel.

> Alt-glisser = « change the **length** […] **without changing its
> orientation** » · Shift-glisser = « change the **orientation** […] **without
> changing its length** » — Vanishing Point, ligne de mesure

C'est exactement le geste que notre `axis` ne sait pas faire : `axisFromOverlay`
(`canvasControls.ts:88`) recalcule **toujours** angle **et** longueur ensemble.

### B2.6 — Promouvoir le geste : DÉPLACER LE TOUT, DUPLIQUER, SUPPRIMER, RÉINITIALISER

Le rôle que nous n'avons nulle part.

> « Use the **Cmd/Ctrl+drag** combination to **move** a path blur. »
> « Use the **Opt/Alt+Cmd/Ctrl+drag** combination to **duplicate** a path blur. »
> « **Alt-drag** […] the selection with the Marquee tool to **create a copy** »
> « **Press Option/Alt + click** an existing adjustment to **delete** it. »
> « **Shift-drag** the red blur shape to move **both** blur shapes together. »
> « **Cmd/Ctrl-click** an endpoint to **reduce its blur shape guide to zero**. »
> « **Press Command/Control and double-click** an empty area to create an
> adjustment that is **centered and covers the cropped image area**. »

Le dernier est remarquable : un **double-clic modifié qui CRÉE** un manipulateur à
couverture maximale, avec une variante qui **étend** celui déjà présent.

### B2.7 — Emprunter un AUTRE OUTIL sans quitter le geste

> « press **Ctrl** (Windows) or Command (Mac OS) **while drawing** » → active
> temporairement la Sélection directe
> « position the pointer over an anchor point, and press **Ctrl+Alt** » → active
> Convertir le point
> « hold down the **'X' key** » → zoom temporaire, « especially helpful for
> placing the corner nodes » — Vanishing Point
> « Temporarily switch from brush A or B to **Eraser** — Alt-drag » — Lightroom

### B2.8 — Suspendre le geste en cours pour en faire un autre

Le mécanisme le plus absent chez nous, et le plus simple à énoncer :

> « **While dragging**, press and hold the **spacebar to move the ellipse**;
> release the spacebar to **resume defining the shape** of the new adjustment. »

On crée une forme, on décide qu'elle n'est pas au bon endroit, on la déplace
**sans lâcher le bouton**, puis on reprend la création. C'est un sous-mode dans le
geste.

**Sources §B2.** `free-transformations-images-shapes-paths.html` ·
`radial-filters-camera-raw.html` · `blur-gallery.html` · `vanishing-point.html` ·
`editing-paths.html` · `lightroom-classic/…/keyboard-shortcuts.html` ·
`docs.krita.org/…/transform.html`

**Où ça s'appliquerait chez nous.** Les quatre composants d'overlay lisent déjà
les modificateurs **sur l'événement pointeur**, sans listener clavier
(`TransformHandles.tsx:239-265`) — c'est le bon patron et il est en place. Les
rôles B2.6 et B2.8 ne s'y branchent pas : ils supposent qu'un manipulateur soit un
**objet**, pas une paire de paramètres. Même limite qu'au §A1.

## B3 — RETOUR VISUEL

### B3.1 — Le curseur CHANGE au survol, et Adobe décrit sa FORME

C'est le retour le mieux documenté du site — Adobe nomme la forme du curseur pour
presque chaque manipulateur, ce qui en fait une grille directement utilisable :

| Manipulateur | Le curseur devient | Source |
|---|---|---|
| Free Transform, rotation | « a **curved, two-sided arrow** » | free-transformations… |
| Free Transform, inclinaison (côté) | « a **white arrowhead with a small double arrow** » | idem |
| Free Transform, perspective (coin) | « a **gray arrowhead** » | idem |
| Recadrage, rotation | « the **curved arrow** appears » | crop-photos |
| Vanishing Point, rotation | « a **curved double arrow** » | vanishing-point |
| Vanishing Point, échelle | « a **straight double arrow** » | idem |
| Dégradé Lightroom, rotation | « a **curved, double-pointing arrow** » | apply-local-adjustments |
| Épingle Lightroom, valeur | « the **double-pointing arrow** » | idem |
| Puppet Warp, rotation | « drag when a **circle** appears » | puppet-warp |
| Plume sur extrémité | « The pointer **changes** when it's precisely positioned over the endpoint. » | editing-paths |
| Plume, jonction de chemins | « a small **merge symbol** appears next to the pointer » | idem |
| Poignée radiale ACR | (pas le curseur) « the handle **turns red** » | radial-filters |

Le vocabulaire disponible est normatif côté CSS : `crosshair` « A simple
crosshair », `move` « Indicates something is to be moved », `grab` / `grabbing`,
`ew-resize` / `ns-resize` / `nesw-resize` / `nwse-resize` « Indicates a
bidirectional resize cursor », `not-allowed` « Indicates that the requested action
will not be carried out ». `[résumé]`

**Chez nous** : les curseurs existent et sont différenciés par axe sur
`TransformHandles.css` (§0.3), mais `PointHandles` est `move`, `AxisHandles` est
`crosshair`, `RegionHandles` est `move` + `ew-resize` — et **aucun `:hover`**
(§0.2-1).

### B3.2 — L'état de la poignée est VISIBLE, par trois canaux distincts

**Par la couleur :** « click any of the **gray** handles […] When selected, **the
handle turns red**. » (ACR) · « A selected pin has a **black center**.
Non-selected pins are **solid white**. » (Lightroom)

**Par la forme :** « Direction handles appear as **filled circles**, selected
anchor points as **filled squares** », « unselected anchor points as **hollow
squares** » (chemins, §A9)

**Par la validité :** bleu / rouge / jaune sur les plans de Vanishing Point (§A14)

### B3.3 — La prévisualisation est PLEINE TAILLE, LIVE, et DÉBRAYABLE

> « Photoshop provides a **full-size, live preview** when you work with the Blur
> Gallery effects. »
> « You can **disable preview** from the blur tool Options bar. »

### B3.4 — Une touche efface l'overlay — et c'est un CYCLE, pas une bascule

Deux mécanismes différents, tous deux documentés, à ne pas confondre :

> « **Hold down the H key** to temporarily hide the overlay controls. »
> — Photoshop, Spin Blur (touche **maintenue**)

> « Press H **once** to show the selected pin; press H **again** to hide all
> pins; press H a **third time** to show all pins. »
> — Lightroom Classic (cycle **à trois états**)

Plus la vue de diagnostic : « press the **M** key to view the **blur mask**
applied to the image. The black areas are not blurred, while lighter areas
indicate the amount of blurring applied. »

Et la version *réglage* plutôt que *touche* : la politique de guides du §A12
(Auto / Toujours / Jamais), et « Show Pins and Tools » d'ACR (§A1).

**Chez nous** : rien ne masque `PointHandles` / `AxisHandles` / `RegionHandles`.
Le point d'accroche serait `CanvasControls.tsx`, seul endroit où les trois
passent.

### B3.5 — La valeur pendant le geste : RÉSOLU, et ce n'est pas un nombre au curseur

J'avais marqué ce point `[non vérifié]` ; la seconde passe l'a trouvé. Adobe
n'affiche pas la valeur *du paramètre* près du pointeur — il affiche **la distance
aux voisins**, en pixels, pendant le déplacement :

> « **Smart Guides will show the distance in pixels between objects as you move
> them.** »
> « view **pink** Smart Guides when your element aligns with the **edges,
> centers, or boundaries** »
> « Smart Guides appear **dynamically as you work**, showing alignment
> opportunities and measurements **in real-time** »

La valeur du paramètre, elle, vit dans la barre d'options ou le panneau : Free
Transform (L, H, rotation, inclinaison H/V, X/Y), Warp (« Bend, H, and V boxes »),
et la ligne de mesure de Vanishing Point qui « displays **two text boxes**: one
for the **length** and one showing the **angle** ». Blur Gallery renvoie
explicitement au panneau : « You can also use the Blur Tools panel to specify a
blur value ».

**Source.** `…/alignment-grids-guides/work-efficiently-with-smart-guides.html`

**Où ça s'appliquerait chez nous.** `src/ui/snap.ts` calcule **déjà** tout ce
qu'il faut : `SnapResult.guides` porte l'axe et la valeur de chaque ligne
d'accroche, et `TransformHandles.tsx:272` les dessine (`.transform-handles__guide`).
Ce qui manque est la **distance chiffrée**, pas la géométrie.

### B3.6 — Animation et transition : `non documenté`

**Aucune page rendue ne décrit d'accélération, d'apparition animée de poignée, ni
de durée de transition.** Le ticket interdit de le déduire d'une capture. Le trou
est déclaré, pas comblé.

## B4 — CIBLES

### B4.1 — 24 × 24 px CSS, avec deux notes qui changent l'application

La seule **norme** de cette recherche, donc la seule ligne opposable :

> « The size of the target for pointer inputs is **at least 24 by 24 CSS
> pixels**, except when: »

> « **Spacing:** Undersized targets (those less than 24 by 24 CSS pixels) are
> positioned so that if a **24 CSS pixel diameter circle is centered on the
> bounding box** of each, the circles **do not intersect** another target or the
> circle for another undersized target »

**⚠️ NOTE 1 — un manipulateur spatial peut compter pour UNE cible :**

> « Targets that allow for **values to be selected spatially based on position
> within the target** are considered **one target** for the purpose of the
> success criterion. Examples include sliders, color pickers displaying a
> gradient of colors, or editable areas where you position the cursor. »

Une zone où l'on pose une valeur *par la position* est donc une cible unique,
quelle que soit sa finesse. Savoir si nos pastilles sont « la cible » ou si le
manipulateur entier l'est n'est pas tranché par la note — et ce document
n'arbitre pas.

**⚠️ L'exception « Essential » vise explicitement des repères rapprochés sur une
image**, ce qui est notre cas exact (voir §B4.2) :

> « For example, in digital maps, the position of pins is analogous to the
> position of places shown on the map. If there are many pins close together, the
> spacing between pins and neighboring pins will often be **below 24 CSS
> pixels**. It is essential to show the pins at the correct map location,
> therefore the **Essential exception applies**. »

Enfin, la norme recommande d'elle-même d'aller au-delà :

> « As a best practice it is recommended to at least meet the minimum size
> requirement […] **regardless of spacing**. For important links/controls,
> consider aiming for the stricter **2.5.5 Target Size (Enhanced)**. »

**Source.** https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
(WCAG 2.2, critère 2.5.8, niveau AA — rendue au navigateur, lue au DOM)

**⚠️ Adobe ne publie AUCUNE taille de poignée ni rayon de saisie.**
`display-layer-edges-and-handles.html` n'explique que comment les **afficher**
(« In the Options bar, select Show Transform Controls »). **La croyance
courante selon laquelle « Photoshop masque ou rétrécit ses poignées sur une
petite sélection » n'est confirmée par aucune page rendue — à ne pas asserter.**
`non documenté`

**Où ça s'appliquerait chez nous.** `--slider-thumb-size: 12px`
(`src/design/components.css:58`) est utilisé tel quel comme **taille de cible** par
`PointHandles.css`, `AxisHandles.css`, `RegionHandles.css` et
`.transform-handles__corner`. Soit **12 px pour 24 recommandés**. Noter que le
critère parle de la **cible**, pas du dessin : une poignée peut rester dessinée à
12 px et porter une zone de saisie de 24 px (marge transparente ou `<rect>`
invisible) — les deux ne sont pas liés.

### B4.2 — Poignées qui se recouvrent : un mécanisme trouvé, un principe trouvé

**Le mécanisme**, documenté à un seul endroit — on **cycle** au lieu de viser :

> « If you have **overlapping planes**, **Ctrl-click** […] to **cycle through**
> the overlapping planes. » — Vanishing Point

**Le principe**, par WCAG : des repères rapprochés sur une image restent
conformes **précisément parce qu'ils doivent être à leur place** (exception
« Essential », §B4.1). La norme n'exige pas de les écarter.

**Ce qui reste `non documenté`** : ce que fait Photoshop quand deux poignées d'un
*même* manipulateur se recouvrent. Ce qui est documenté est ce qui l'**évite** :
le second niveau au double-clic (§A8), le survol qui révèle l'anneau au lieu de le
dessiner en permanence (§A2), et la touche qui efface tout (§B3.4).

**Chez nous, le cas est déjà atteignable** : `lensFlare.ts:234` déclare
`sourceRadius` avec `min: 0.005`, donc centre et poignée de rayon peuvent se
superposer, sans aucun mécanisme de désambiguïsation.

### B4.3 — La poignée ne saute pas sous le curseur

Non documenté par les sources, mais **déjà résolu chez nous à deux endroits sur
cinq** et énoncé proprement : `handleScaleHandleDown` mesure l'écart de saisie
avant d'ouvrir le drag, « donc l'écart est exact et pas une approximation »
(`TransformHandles.tsx:196-210`) ; `PointHandles.tsx:73` fait de même. Les deux
manquants sont au §0.2-4. `[code]`

### B4.4 — Une cible hors cadre reste une cible

Trois sources indépendantes :

> « You can even **add a pin outside the image**, to apply the blur at corners. »
> — Blur Gallery
> « Drag the reference point to a new position **inside or outside** the bounding
> box » — Free Transform
> « It can be placed **out of the image window**, and even where you want on
> screen. » `[résumé]` — GIMP, pivot

**Chez nous**, c'est interdit par construction :
`pointFromOverlayWithinRanges` et `clampRegionCenter`
(`canvasControls.ts:25-37`, `regionHandles.ts`) bornent le centre aux bornes des
paramètres. Le besoin affleure déjà : `RegionHandles.tsx:210` calcule un état
`rabattue` pour la poignée de rayon quand le cercle sort de la vue.

## B5 — ANNULATION ET HISTORIQUE

### B5.1 — `Échap` annule : RÉSOLU

J'avais marqué ce point `[non vérifié]` ; la seconde passe l'a trouvé, sur la page
de Free Transform :

> « press **Esc** or click the **Cancel** button in the options bar »

Et sur une autre surface : « **Press Esc key to exit color sampling.** » (Camera
Raw).

### B5.2 — Un geste modal a un COMMIT explicite, et Photoshop en documente SIX

> « Select a new tool. »
> « Click a layer in the Layers panel. » — « This action **auto-commits** changes »
> « Click outside the canvas area in the document window. »
> « Click outside the bounding box in the canvas area. »
> Entrée / Retour
> « **double-click inside the transformation marquee** »

Autres surfaces : Perspective Warp (Entrée « commit perspective changes in Warp
mode ») · Blur Gallery (« In the blur tool Options bar, **click OK to commit** ») ·
Lightroom (« **Double-click** without pressing the Cmd/Ctrl key **commits and
dismisses** the Radial Gradient tool ») · GIMP (« Reset […] Readjust, Cancel and
Transform buttons ») `[résumé]`.

Et un cas explicitement **non annulable**, signalé comme tel par Adobe : ACR
« Clear All (**this action cannot be undone**) ».

**Chez nous, il n'y a pas de session modale du tout**, et c'est écrit comme un
choix : « « Annuler la transformation » au sens de Photoshop demanderait une
session modale avec un instantané d'avant, que cet overlay n'a pas : il est
affiché en permanence et chaque geste committe déjà dans l'historique »
(`TransformHandles.tsx:318-327`). `[code]` **C'est la différence structurelle la
plus lourde entre notre socle et les sources.**

### B5.3 — La granularité : Adobe dit « la poignée », pas « le geste »

> « To undo **the last handle adjustment**, choose Edit > Undo. »

Que le glissement complet se replie en **une** entrée d'historique reste
`non documenté`. Adobe donne en revanche une raison *destructive* de différer le
commit, qui ne s'applique pas à nous (notre pipeline est non destructif) mais
explique leur modèle :

> « the image becomes **slightly less sharp each time you commit** a
> transformation » → « performing multiple commands **before applying** the
> cumulative transformation is preferable »

**Chez nous**, tranché et écrit dans l'autre sens : commit au `pointerup`, et au
`keyup` pour le clavier — « Un appui maintenu répète le `keydown` et n'émet qu'un
seul `keyup` : une entrée d'historique par appui, au lieu d'une dizaine par
seconde » (`RegionHandles.tsx:195-202`). `pointercancel` abandonne **sans**
committer, dans les quatre composants. `[code]`

### B5.4 — `Suppr` supprime le manipulateur sélectionné

> « Press Delete to remove it. » — Blur Gallery
> « To delete a path blur, with an endpoint selected, press the Delete key. »
> « While an adjustment is selected, press **Delete** to delete the adjustment. »
> — Camera Raw
> « you can delete the last node […] by pressing the **Backspace** key »
> — Vanishing Point
> « Delete object or mask — **Backspace** » — raccourcis ACR

**Chez nous** : sans objet tant qu'un manipulateur n'est pas un objet (§A1).

### B5.5 — Le clavier traverse les poignées, et règle à deux vitesses

Camera Raw publie la traversée **et** le double pas, sur les points de courbe :

| Résultat | Windows |
|---|---|
| Select next / previous point | `Ctrl + Tab` / `Ctrl + Shift + Tab` |
| Deselect curve point | `D` |
| Increase input value **by one point** | `Right arrow` |
| Increase input value **by 10 points** | `Shift + Right Arrow` |

Et Perspective Warp confirme le pas fin au clavier sur un manipulateur posé :
« **Slightly move** a corner of a quad (pin). »

**Chez nous**, le double pas existe partout et **la traversée nulle part** :
`PointHandles` `STEP = 0.005` / `LARGE_STEP = 0.05` (l.17-18), `AxisHandles`
`1` / `10` (l.58), `RegionHandles` `NUDGE_STEP` / `NUDGE_STEP_LARGE` (l.185),
`TransformHandles` `NUDGE_STEP_PX` / `NUDGE_STEP_LARGE_PX` (l.332). Aucun
composant ne permet de passer d'une poignée à l'autre au clavier. `[code]`

---

## C — Ce qui n'a pas pu être établi

À traiter comme des trous, jamais comme des absences prouvées.

| Trou | Cause |
|---|---|
| Anatomie détaillée du **dégradé posé sur photo** (§A6) | La seule page qui la porte est marquée périmée par Adobe depuis LrC 11.0 ; l'ancienne page Camera Raw redirige |
| **Poignée de rayon d'angle** (*live shape*, §A18) | Documentée comme champ de la barre d'options, jamais comme poignée — **candidat infirmé** |
| **Tolérance d'accroche** (§B1.1) | Aucune valeur publiée par Adobe. La seule de ce document est la nôtre (8 px écran) |
| **Taille de poignée / rayon de saisie** (§B4.1) | Aucune valeur publiée. La croyance « Photoshop masque ses poignées sur une petite sélection » est **non confirmée** — ne pas l'asserter |
| **Poignées d'un même manipulateur qui se recouvrent** (§B4.2) | Un mécanisme trouvé (cycle par Ctrl-clic entre *plans*), rien sur les poignées |
| **Repli d'un glissement en une entrée d'historique** (§B5.3) | Adobe parle de « la dernière poignée », jamais du glissement complet |
| **Animation / transition** (§B3.6) | Aucune source ; interdit de le déduire d'une capture |
| **Référence de raccourcis Photoshop** | **Supprimée du site** (§ Méthode). Tout le §B vient de pages de fonctionnalité |

---

## D — La grille, en une liste

Pour le ticket 17, sans arbitrage. Chaque ligne renvoie à sa section, où vivent le
mécanisme, la source et le fichier.

**Genres (A)**

| # | Genre | § | Chez nous |
|---|---|---|---|
| 1 | Épingle composable, état sélectionné visible, posable hors cadre, avec profondeur | A1 | absent |
| 2 | Anneau de valeur, révélé au survol | A2 | absent |
| 3 | Épingle-curseur (le pin se tire pour régler) | A3 | absent |
| 4 | Ellipse à quatre poignées, rotation prise **sur le bord** | A4 | `disk` = cercle, 1 poignée |
| 5 | Trois zones concentriques (net / fondu / flou) | A5 | 1 anneau |
| 6 | Dégradé sur photo : trois lignes, deux fondus indépendants | A6 | `axis` = angle+longueur, origine figée |
| 7 | Dégradé Photoshop : ligne + arrêts créés/supprimés au geste + milieu | A7 | `ColorRampControl`, dans le dock |
| 8 | Chemin à points de courbe, second niveau au double-clic | A8 | absent |
| 9 | Forme de la poignée = son état (rond plein / carré plein / carré creux) | A9 | fait sur `TransformHandles` seul |
| 10 | Cadre de transformation + point de référence déplaçable | A10 | cadre fait, point de référence absent |
| 11 | Pivot déplaçable, y compris hors cadre | A11 | absent |
| 12 | Maillage + **politique de guides** (Auto/Toujours/Jamais, couleur, opacité) | A12 | absent |
| 13 | Quadrilatère à arêtes **verrouillables** | A13 | absent |
| 14 | Validité du manipulateur **encodée par la couleur** | A14 | absent (`rabattue` existe, non exprimé) |
| 15 | Pinceau réglé sur la toile, deux axes de glissement | A15 | partiellement fait |
| 16 | Échantillonneur posé ; marqueur que l'app **corrige** | A16 | absent |
| 17 | Lignes déplaçables + poignées d'inclinaison | A17 | absent |

**Anatomie du geste (B)**

| # | Mécanisme | § | Chez nous |
|---|---|---|---|
| 18 | Seuil d'accroche en pixels **écran** | B1.1 | fait, non généralisé aux 3 genres |
| 19 | Cibles d'accroche déclarées, priorité déclarée, isolation d'une cible | B1.2 | fait sauf l'isolation |
| 20 | Accroche vers une **valeur** remarquable, tolérance relative | B1.3 | fait |
| 21 | Échappatoire d'accroche par `Ctrl` | B1.4 | fait, même touche qu'Adobe |
| 22 | Accroche d'angle : **15° en rotation, 45° sur un point de chemin** | B1.5 | 15° fait |
| 23 | Pas d'accroche au clavier | B1.6 | fait |
| 24 | ⚠️ `Maj` peut être une **bascule d'état persistant**, pas un sens fixe | B2.1 | sens fixe, écart assumé |
| 25 | Sept rôles de modificateur, pas trois touches | B2.1-B2.7 | 3 rôles sur 7 |
| 26 | Dissocier les deux termes d'un geste (longueur **ou** angle) | B2.5 | absent |
| 27 | Suspendre le geste (Espace) pour repositionner sans lâcher | B2.8 | absent |
| 28 | Curseur qui change **au survol**, forme décrite par manipulateur | B3.1 | curseurs oui, `:hover` non |
| 29 | État lisible par **trois** canaux : couleur, forme, validité | B3.2 | couleur seule, partielle |
| 30 | Prévisualisation pleine taille, live, **débrayable** | B3.3 | live oui, débrayable non |
| 31 | Effacer l'overlay : touche **maintenue** ou **cycle à trois états** | B3.4 | absent |
| 32 | Retour chiffré pendant le geste = **distance aux voisins, en pixels** | B3.5 | guides dessinés, distance non chiffrée |
| 33 | Animation / transition | B3.6 | `non documenté` partout |
| 34 | Cible ≥ 24 × 24 px CSS ; NOTE 1 et exception « Essential » | B4.1 | 12 px |
| 35 | Poignées superposées : **cycler** plutôt que viser | B4.2 | absent, cas atteignable |
| 36 | La poignée ne saute pas sous le curseur | B4.3 | fait 2 fois sur 5 |
| 37 | Une cible hors cadre reste une cible | B4.4 | interdit par clamp |
| 38 | `Échap` annule le geste | B5.1 | absent, délibérément |
| 39 | Commit explicite, et Photoshop en documente **six** chemins | B5.2 | pas de session modale |
| 40 | Granularité d'historique : Adobe dit « la poignée » | B5.3 | 1 geste = 1 entrée |
| 41 | `Suppr` supprime le manipulateur sélectionné | B5.4 | sans objet |
| 42 | Traversée des poignées au clavier + double pas | B5.5 | double pas fait, traversée absente |

**Le constat de forme, qui traverse la grille et n'est pas un arbitrage.**
Quatorze des quarante-deux lignes (1, 2, 3, 8, 11, 13, 14, 25-B2.6, 27, 35, 37,
38, 39, 41) supposent qu'un manipulateur soit un **objet** — sélectionnable,
duplicable, supprimable, à cardinalité variable, doté d'un état. Le nôtre est une
**projection de paramètres nommés** (`CanvasControl`,
`src/render/effects/types.ts:151-154`, sur `params: Record<string, number>`). Les
vingt-huit autres lignes ne demandent pas ce changement, et onze d'entre elles
sont déjà faites en tout ou partie.

---

## Sources, en un endroit

| # | URL | Route | Dernière mise à jour annoncée |
|---|---|---|---|
| S1 | https://helpx.adobe.com/camera-raw/using/radial-filters-camera-raw.html | navigateur, DOM (deux passes) | 3 nov. 2023 |
| S2 | https://helpx.adobe.com/photoshop/using/blur-gallery.html | navigateur, DOM | 15 oct. 2025 |
| S3 | https://helpx.adobe.com/camera-raw/using/masking.html | navigateur, DOM | 18 juin 2026 |
| S4 | https://helpx.adobe.com/camera-raw/using/default-keyboard-shortcuts.html | navigateur, DOM | 20 août 2025 |
| S5 | https://helpx.adobe.com/photoshop/using/free-transformations-images-shapes-paths.html | navigateur, DOM | 13 sept. 2024 |
| S6 | https://helpx.adobe.com/photoshop/using/editing-paths.html | navigateur, DOM | 18 juil. 2024 |
| S7 | https://helpx.adobe.com/photoshop/using/vanishing-point.html | navigateur, DOM | 14 oct. 2024 |
| S8 | https://helpx.adobe.com/photoshop/using/positioning-elements-snapping.html | navigateur, DOM | — |
| S9 | https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/edit-a-gradient.html | navigateur, DOM | 28 avr. 2026 |
| S10 | https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/apply-local-adjustments.html | navigateur, DOM | **marquée périmée depuis LrC 11.0** |
| S11 | https://helpx.adobe.com/photoshop/desktop/use-grids-measurement-guides/alignment-grids-guides/work-efficiently-with-smart-guides.html | navigateur, DOM | 23 févr. 2026 |
| S12 | https://helpx.adobe.com/photoshop/desktop/get-started/settings-and-preferences/change-tool-pointers.html | navigateur, DOM | — |
| S13 | https://helpx.adobe.com/photoshop/desktop/effects-filters/artistic-stylize-filters/reshape-and-distort-images-with-transform-warp.html | navigateur, DOM | — |
| S14 | https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/keyboard-shortcuts-to-adjust-perspective.html | navigateur, DOM | — |
| S15 | https://helpx.adobe.com/lightroom-classic/desktop/introduction-to-lightroom-classic/keyboard-shortcuts.html | navigateur, DOM | — |
| S16 | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html | navigateur, DOM | WCAG 2.2 |
| S17 | https://www.w3.org/TR/css-ui-4/ | extracteur `[résumé]` | — |
| S18 | https://docs.krita.org/en/reference_manual/tools/transform.html | extracteur `[résumé]` | — |
| S19 | https://docs.gimp.org/2.10/en/gimp-tool-unified-transform.html | extracteur `[résumé]` | — |
| S20 | https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-and-position | extracteur `[résumé]` | — |
| — | `photoshop/using/transforming-objects.html` | **timeout WebFetch**, redirige vers une page réécrite | 23 févr. 2026 |
| — | `photoshop/using/default-keyboard-shortcuts.html` | **redirige**, table supprimée | 23 févr. 2026 |
| — | `camera-raw/using/make-local-adjustments-camera-raw.html` | **redirige**, page perdue (miroir `/ie/` idem) | — |
| — | `photoshop/using/keys-vanishing-point.html` | **404**, et un lien vivant d'Adobe pointe dessus | — |
| — | `docs.blender.org/manual/…` | **HTTP 403** | — |
