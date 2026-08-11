# Ce que Photoshop et Lightroom rendent lisible que nous ne rendons pas

> Réponse au ticket `.scratch/prochain-palier/issues/09-ce-que-photoshop-et-lightroom-rendent-lisible.md`.
> **Ce document n'arbitre rien.** Il fournit la matière d'un grilling ultérieur.
> Chaque mécanisme porte : ce qu'ILS font (avec sa source), où ça s'appliquerait
> CHEZ NOUS (fichier réel), et ce que ça coûterait.

---

## Méthode et limites — à lire avant de citer quoi que ce soit

**Extraction.** Toutes les pages Adobe ont été lues en **texte brut de page**
(navigateur réel, extraction du DOM), jamais par un résumeur — le ticket signale
que WebFetch hallucine et tronque sur les grandes tables, et la table des
raccourcis de Lightroom Classic en est une. `curl` depuis le shell est bloqué
dans cet environnement (exit 56), ce qui rend le navigateur obligatoire, pas
optionnel.

**Aucune inférence de mouvement.** Rien ici ne décrit une animation ou une
transition : tout ce qui est écrit vient d'une phrase de documentation, jamais
d'une image. Quand une source dit « survoler pour prévisualiser », c'est écrit
dans la source, pas déduit.

**Observation directe de `photoshop.adobe.com` : TENTÉE, ÉCHOUÉE, et c'est une
information.** L'application charge (titre « Adobe Photoshop ») mais ne rend
**aucun texte lisible** par extraction DOM classique : son interface vit dans le
Shadow DOM des composants web Adobe (`UE-*` / `PSW-*` / `SP-*`). C'est
exactement ce que note le relevé du 2026-07-20, qui avait dû le **percer** par
`getComputedStyle`. Je ne l'ai pas fait : cela veut dire exécuter du JS dans la
session Photoshop authentifiée d'Antoine, et la valeur marginale (des tokens,
déjà relevés) ne justifiait pas de toucher à un éditeur vivant.

**Ce qui a changé depuis `docs/design-system/photoshop-web-reference-tokens.md`
(2026-07-20) — et ce n'est pas côté Adobe.** Je n'écrase rien de ce fichier ; ses
valeurs (fond `#222222`, titre 16 px/700 sans capitales, panneau 320 px, aucune
ombre) ne sont ni confirmées ni contredites par cette session. En revanche, sa
section « **Constat structurel majeur** » est **périmée de NOTRE côté** : elle
met en garde contre une migration vers un dock empilé « sans validation
explicite d'Antoine », au motif que cela casserait `FloatingPanel`. Or
`FloatingPanel` **n'existe plus** (supprimé les 2026-07-20/21, remplacé par
`PanelColumn`/`DockedPanelCard`), et le dock empilé **est** l'architecture
actuelle. Cet avertissement est éteint : la question qu'il posait a été tranchée
dans le sens de la référence. Le reste du fichier (les valeurs) reste valable.

**Sources.** Aide Photoshop et Lightroom Classic (`helpx.adobe.com`) et
guidelines Adobe Spectrum (`spectrum.adobe.com`). Une seule source est de rang
inférieur et signalée comme telle : la page « Tone Control Adjustment » est un
**article contribué** (Todd R. Shaner), publié par Adobe mais pas écrit par
Adobe — ses deux mécanismes sont recoupés ailleurs et je le dis à chaque fois.
Aucun blog de tutoriel n'est cité.

---

## 0. Ce que le ticket croit que nous n'avons pas, et que nous avons

À vérifier avant tout grilling, sinon la conversation partira d'une prémisse
fausse (nous avons déjà payé ce défaut : « conclusion tirée du code seul », et
son symétrique).

| Affirmation du ticket | État réel du code |
|---|---|
| « À 23 effets nous n'avons **ni recherche ni filtre** » | **FAUX pour le menu d'ajout.** `src/components/EffectPicker.tsx:29-38` porte un vrai champ (`Rechercher…`, icône `Search`, `sr-only` « Rechercher un effet », état vide « Aucun effet trouvé. »), qui appelle `buildEffectCatalog(effects, query)` et rend les six catégories en `<section>`. Le `query` se vide à la fermeture du popover (`:18`). **Vrai partout ailleurs** : ni Presets, ni Textures, ni Pile n'ont de filtre. |
| « Nous avons un undo/redo **sans surface** » | Vrai pour l'historique (`src/layers/history.ts` n'est importé par aucun composant), **mais** deux boutons existent, avec état désactivé et raccourci en infobulle : `src/components/Toolbar.tsx:126-145`. |
| « Nous en avons très peu » (clavier) | Nous en avons **plus que ne le dit le ticket** : V/B/E (outils), Échap, Espace maintenu (pan), Ctrl+Z / Ctrl+Y / **Ctrl+I (isoler)**, flèches + **Maj = pas large** sur les cinq manipulateurs (`TransformHandles`, `RegionHandles`, `AxisHandles`, `PointHandles`, `CurveControl`), Maj/Alt/Ctrl **pendant** un drag de transformation, Alt+clic sur l'œil = isoler, molette sur contrôle focalisé, Ctrl+molette sur le dernier contrôle touché (`src/ui/activeControl.ts:103-131`). |
| « nous avons une bannière de dérive sur les presets **et rien d'autre** » | Exact, et c'est `src/App.tsx:1990-2000` (« Preset modifié. » + « Mettre à jour » / « Créer une copie »). |

Trois manques sont en revanche **confirmés sur le code** et structurent tout ce
qui suit : **aucun retour au défaut** d'un paramètre d'effet (ni bouton ni
double-clic — `ParamPanel.tsx` ne contient pas une occurrence de `reset`),
**aucun indicateur « hors défaut »**, **aucun avant/après** (aucune bascule
« sans effets » ; l'isolation, `src/layers/isolation.ts:142-168`, n'affiche
qu'UN calque, ce qui est autre chose).

---

## 1. Nommer

### M1 — Le nom est un SUBSTANTIF, la glose est un VERBE, et les deux coexistent

Les dix-neuf calques de réglage de Photoshop sont nommés par le **substantif de
ce sur quoi on agit**, jamais par l'action : `Levels`, `Curves`, `Exposure`,
`Hue/Saturation`, `Color Balance`, `Channel Mixer`, `Selective Color`,
`Gradient Map`, `Threshold`, `Posterize`. Et chacun porte, **dans le menu de
création lui-même**, une glose d'un souffle qui est, elle, un **verbe à la
troisième personne** : « *Adjusts shadows, midtones, highlights* », « *Finetunes
tonal range with curve control* », « *Rebalances color channels* », « *Maps
tones to gradient colors* », « *Reduces image to flat color levels* »
([Adjustment layer options](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/adjustment-layers-options.html) ·
[Create adjustment and fill layers](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/work-with-adjustment-and-fill-layers.html)).

Le nom ne cherche donc pas à être auto-explicatif : c'est une **étiquette
courte et stable**, et la charge d'explication est déportée sur une glose
adjacente qu'on lit au moment du choix.

**Où ça s'appliquerait.** Le menu d'ajout (`src/components/EffectPicker.tsx`) ne
rend aujourd'hui **que** `effect.name`, dans six `<section>` de catégorie. Une
glose par effet demanderait un champ sur `EffectModule`
(`src/render/effects/types.ts:266`) — mettons `summary?: string` — rendu sous le
nom dans le popover. C'est aussi la seule surface où une ligne de texte par
entrée ne coûte rien à ADR-0001 : le popover n'est pas une carte du dock, il ne
défile pas la colonne, et il n'est pas une liste à contrôles répétés (une entrée
= un bouton).

**Coût.** Un champ optionnel + 23 phrases à écrire (la matière existe : les
en-têtes de fichier des effets la contiennent déjà en prose). Aucune contrainte
touchée. `validateEffect` peut exiger le champ pour forcer l'exhaustivité, ou
non — c'est une décision, pas une conséquence.

### M2 — Casse de phrase, obligatoirement une étiquette, et le débordement se replie

Spectrum est explicite : « *Every slider should have a label. A slider without a
label is ambiguous and not accessible. **Write the label in sentence case**.* »
Et sur le débordement : « *When the label is too long for the available
horizontal space, it wraps to form another line* » — le nom long **ne se tronque
pas**, il passe à la ligne
([Spectrum · Slider](https://spectrum.adobe.com/page/slider/)).

**Où ça s'appliquerait.** Nos noms sont déjà en casse de phrase (« Contracter /
dilater », « Rayon des contours »). Le point vivant est le **repli** :
`src/components/ui/labeled-slider.tsx:140-142` rend un `<label>` nu, et le
comportement en cas de nom long à 320 px de dock n'est pas déclaré. À rapprocher
du sixième point de la checklist ADR-0001, qui impose déjà de **mesurer** la
largeur laissée au contenu élastique — mais sur la ligne de calque, pas sur
l'étiquette d'un curseur.

**Coût.** Une règle CSS et une story de mesure. Pas de modèle touché.

### M3 — L'unité est affichée à côté de la valeur, et elle DISPARAÎT au focus

« *Slider values can be shown with a unit when it helps provide context (e.g.,
"%" or "px"). **When the value is shown within a text field, the unit disappears
on focus.*** » (Spectrum · Slider). La raison est mécanique : à la saisie,
l'unité est du bruit qu'il faut effacer avant de taper.

**Où ça s'appliquerait.** Nous affichons l'unité **collée dans la même chaîne**
que la valeur : `formatEffectParamValue` (`src/components/ParamPanel.tsx:267-282`)
rend `"12 px"`, `"45°"`, `"30 %"`, et cette chaîne devient le `displayValue` de
`LabeledSlider`, c'est-à-dire **le contenu du champ éditable**
(`src/components/ui/labeled-slider.tsx:159-173`). Le parseur s'en sort
(`src/ui/formatValue.ts:14-25` tolère l'unité collée par regex, et la virgule
décimale), mais l'utilisateur, lui, doit effacer `" px"` à la main.
`NumberField` fait déjà la bonne chose — unité **hors du champ**, en
`aria-hidden` (`src/components/ui/number-field.tsx:155-159`). Les deux primitives
divergent sur le même problème.

**Coût.** Faible et bien localisé : donner à `LabeledSlider` un `unit` séparé du
`displayValue`, comme `NumberField`. Le point de vigilance est que
`displayValue` est aussi ce qui porte les **arrondis** (`percent` → `%` entier),
donc la séparation doit garder la valeur formatée, pas la valeur brute.

### M4 — Une plage bipolaire préfixe son signe

« *If the value ranges from negative to positive, prefix the value with a plus
(+) or minus (-) sign.* » Et surtout, côté piste : « **Fill start** — *if the
value represents an offset, the fill start can be set to represent the point of
origin. This allows the slider fill to start from inside the track.* »
(Spectrum · Slider).

**Où ça s'appliquerait.** Nous avons des paramètres bipolaires (un fisheye
**signé** dans `lensDistortion`, une dérive de teinte, un dehaze négatif de
principe). `LabeledSlider` remplit toujours depuis la gauche — sur une plage
−1…+1, le remplissage à 0 est donc à moitié plein et ne dit pas que 0 est le
neutre. Le champ existe déjà pour le décider : `EffectParam.min`
(`src/render/effects/types.ts:33`) suffit à savoir qu'une plage est bipolaire ;
rien à ajouter au modèle.

**Coût.** Une règle de rendu dans `labeled-slider.tsx` (origine du remplissage =
0 quand `min < 0 < max`) + le préfixe dans `formatEffectParamValue`. **Aucun
pixel de rendu GPU touché** — c'est de l'affichage pur, donc `npm run test:render`
doit rendre zéro écart, ce qui en fait sa propre preuve.

### M5 — Le nom d'un groupe est un CONTRÔLE, pas une décoration

Voir M25 : dans Lightroom, **double-cliquer le nom d'un curseur le remet à son
défaut**, et **Alt-cliquer le nom d'un groupe remet tout le groupe**. Le titre
de section n'est pas du texte mort. C'est le mécanisme de nommage qui rapporte
le plus ici, parce que nous venons de poser `EffectSection.label` et qu'il est
inerte.

---

## 2. Grouper

### M6 — Le critère de groupement est l'ORDRE DU GESTE, pas la fonction

Les panneaux du module Développement se lisent de haut en bas dans l'ordre où on
les emploie : Histogramme, outils locaux, **Basic**, Courbe des tonalités,
Mélangeur de couleurs, Étalonnage, Détail, Lens Blur, Corrections de l'objectif,
Transformation, Effets, Calibration
([Develop module basics](https://helpx.adobe.com/lightroom-classic/help/develop-module-tools.html)).
Et cet ordre est **prescriptif**, pas indicatif : la procédure de réglage
publiée par Adobe dit « *adjust the controls **from the top-down in the order
shown below*** » et affirme qu'un ordre au hasard est « *an exercise in
frustration* », parce que les contrôles de tonalité sont adaptatifs et
interagissent
([Tone Control Adjustment](https://helpx.adobe.com/lightroom-classic/help/tone-control-adjustment.html) —
⚠️ **article contribué**, pas de la plume d'Adobe ; je ne m'en sers que pour ce
que le premier lien confirme, à savoir l'ordre des panneaux).

**Où ça s'appliquerait.** Nos six catégories
(`src/render/effects/catalog.ts:3-10` : Lumière · Optique · Déformation ·
Couleur · Impression · Texture) sont un classement **par nature du phénomène**,
pas par ordre d'emploi — c'est une taxonomie de bibliothécaire, et c'est
délibéré (« explicite et centralisée, jamais inférée du nom »). Le constat utile
n'est pas qu'elle soit mauvaise : c'est qu'elle répond à **« qu'est-ce que
c'est »** quand un ordre de geste répondrait à **« quand est-ce que je m'en
sers »**. Les deux questions n'ont pas la même réponse pour une pile où
`grain` se pose en dernier et `lensDistortion` en premier.

**Coût.** Nul en code si on ne change rien — c'est un cadrage pour la
conversation. Si on voulait le faire : `EFFECT_CATEGORIES` est déjà un tableau
ordonné, donc l'ordre d'affichage du menu est **déjà** une donnée, pas une
inférence.

### M7 — L'ordre ET la visibilité des groupes sont réglables par l'utilisateur, avec un retour à l'ordre par défaut

Clic droit sur l'en-tête de n'importe quel panneau → **Customize Develop
Panel** → on **glisse les noms** dans l'ordre voulu, on **décoche** ceux qu'on
ne veut pas voir, et un bouton **Default Order** restaure. Le changement demande
un redémarrage
([Develop module basics](https://helpx.adobe.com/lightroom-classic/help/develop-module-tools.html)).
Même chose, plus léger, par clic droit sur un en-tête → cocher/décocher un
panneau
([Workspace basics](https://helpx.adobe.com/lightroom-classic/help/workspace-basics.html)).

**Où ça s'appliquerait.** Nous avons déjà l'infrastructure : `dockLayout`
(`src/App.tsx:239`) est un tableau de colonnes d'`id` de cartes, et la
visibilité est calculée en `src/App.tsx:1613-1621` avec un fail-fast sur id
inconnu. Ce qui manque est **la persistance** — inexistante : les quatre
`*Folded`, `dockLayout` et `dockWidth` sont des `useState` nus, et
`src/layers/layerStack.ts:196-207` documente qu'aucun `localStorage` n'existe
côté document. Les deux seules persistances de l'app sont le dossier de textures
(`src/hooks/useTextureLibrary.ts:6-26`) et le journal d'erreurs GPU.

**Coût.** Réel mais borné, et **il ne touche pas le document** : c'est de la
préférence d'espace de travail, pas de l'état de calque. Le patron existe déjà
(`useTextureLibrary`). Piège identifié : `LayerPanel`/`ParamPanel` n'ont pas à
le connaître — `components/` ne contient aucune logique métier, la persistance
vit dans un hook appelé par `App.tsx`.

### M8 — Les effets sont des ENFANTS de leur cible, repliables d'un seul triangle

Les Smart Filters « *appear in the Layers panel **below the Smart Object layer**
to which they are applied* », et : « *To expand or collapse the view of Smart
Filters, click the **triangle** next to the Smart Filter icon* ». Ils s'appliquent
**du bas vers le haut**, se glissent d'un objet à l'autre, et se dupliquent en
Alt-glissant
([Apply Smart Filters](https://helpx.adobe.com/photoshop/using/applying-smart-filters.html)).

C'est **notre modèle exact** : une photo, ses effets rattachés, une pile causale.
La différence est qu'un seul triangle **replie toute la chaîne d'une photo**.

**Où ça s'appliquerait.** `src/components/LayerPanel.tsx` rend déjà la hiérarchie
photo → effets (c'est la « Pile » livrée le 2026-08-04). Un triangle par racine
photo repliant ses enfants est **la seule façon connue** de faire tenir une
deuxième photo dans une colonne bornée : ADR-0001 impose une hauteur de panneau
bornée et une liste défilante dedans, mais replier vaut mieux que défiler quand
le regard cherche l'autre photo.

**Coût.** Le triangle est un contrôle **par ligne**, donc il faut le passer au
crible d'ADR-0001. Il y échappe par le même raisonnement que le verrou (entrée
du 2026-07-29) : ce n'est pas un réglage dupliqué agissant sur la sélection,
c'est un **état de la ligne elle-même**, et il n'existe que sur les racines
photo, pas sur chaque ligne. À écrire dans le rapport de tranche, pas à
supposer.

---

## 3. Révéler par étapes

> Distinction que le ticket pose et qu'il faut garder : nous masquons ce qui est
> **sans objet** (`EffectParam.appliesWhen`), eux masquent ce qui est **rare**.
> Aucun des mécanismes ci-dessous ne fait ce que fait `appliesWhen`.

### M9 — Le mode Solo : un seul groupe ouvert à la fois, automatiquement

**Alt-clic sur un en-tête de panneau** (ou clic droit → *Solo mode*) : ouvrir un
panneau **ferme celui qui était ouvert**. « *Solo mode applies independently to a
set of panels. The triangle in the panel header is **solid** when not in Solo
mode* » — l'état du mode est donc lisible sur la poignée elle-même
([Workspace basics](https://helpx.adobe.com/lightroom-classic/help/workspace-basics.html),
raccourci confirmé dans
[Keyboard shortcuts](https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html) :
« *Toggle solo mode — Alt-click a panel* »).

**C'est le mécanisme le plus directement transposable de tout ce document**, et
c'est aussi celui qui répond le plus exactement au problème qu'ADR-0001 a été
écrit pour résoudre : une colonne qui déborde. ADR-0001 borne la hauteur de
chaque carte ; le mode Solo borne le **nombre de cartes ouvertes à une**. Les
deux sont compatibles et ne se remplacent pas.

**Où ça s'appliquerait.** `src/components/dockedPanel/DockedPanelCard.tsx:43-61`
porte déjà le repli (bouton « Déplier / Replier le panneau », contenu non monté
si `collapsed`), et `src/App.tsx` porte les quatre états `presetsFolded`,
`layersFolded`, `texturesFolded` (déjà `true` par défaut), `propertiesFolded`.
Le mode Solo est **une règle sur ces quatre booléens**, pas un composant : ouvrir
l'un ferme les autres. Il vit dans `App.tsx` (composition root) ou dans un hook,
jamais dans `DockedPanelCard` — la carte ne connaît pas ses sœurs.

**Coût.** Très faible en code. Le vrai coût est un **arbitrage produit** : le
Solo interdit de voir Pile et Propriétés en même temps, ce qui est précisément
le flux livré le 2026-08-04. C'est pour ça qu'il existe M10.

### M10 — Les trois échappatoires du Solo, qui le rendent supportable

Sans elles le mode Solo est une prison. Lightroom en fournit trois, toutes au
clavier
([Keyboard shortcuts](https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html)) :

- **Maj-clic sur un panneau** = « *Open a new panel **without closing** soloed
  panel* » — l'exception ponctuelle, sans quitter le mode.
- **Ctrl-clic sur un panneau** = « *Open/close **all** panels* » — la sortie
  brutale.
- **Ctrl + 0-9** = « *Open/close right panels, Library and Develop modules,
  **top to bottom*** » — chaque panneau est **adressable par son rang**, sans
  viser à la souris.

**Où ça s'appliquerait.** Le rail latéral (`src/App.tsx:1686-1698`) porte déjà
trois icônes — Presets, Pile, Propriétés — mais **pas Textures**, qui n'a aucune
icône de rail alors qu'elle est une des quatre cartes. Un adressage numérique
(Ctrl+1..4) rendrait la quatrième atteignable et donnerait au Solo sa sortie.
Le registre de raccourcis existe : `src/ui/tools.ts:63-85` + le listener global
de `src/App.tsx:1429-1455`, qui **filtre déjà** les cibles `INPUT`/`TEXTAREA`/
`contentEditable` (`:1431-1435`) — le piège classique est donc déjà désamorcé.

**Coût.** Faible. Attention à une collision réelle : `Ctrl+I` est déjà pris par
l'isolation (`src/App.tsx:1443`).

### M11 — Réduire en icônes plutôt que replier

Photoshop offre un troisième état entre « ouvert » et « fermé » : la double
flèche en haut du dock **réduit tous les panneaux en icônes** ; cliquer une
icône rouvre **ce seul** panneau ; et « *to show only the icons, adjust the dock
width until the labels disappear* »
([Expand or collapse panel icons](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/collapse-expand-icons.html)).

**Où ça s'appliquerait.** C'est presque ce que fait notre rail
(`src/App.tsx:1686-1698`) : une bande d'icônes qui montre/cache le dock. La
différence est que **le rail n'est pas le dock réduit** — c'est un contrôle
séparé, et il lui manque une entrée (Textures). Le mécanisme d'Adobe fait du
rail et du dock **deux états du même objet**, ce qui explique pourquoi leur
correspondance est totale par construction.

**Coût.** Moyen : c'est une refonte du rapport rail/dock, pas un ajout. À noter
que l'idée « la largeur décide de l'affichage des libellés » est en tension avec
un dock **content-sized** — chez nous la largeur est un `useState(320)`
(`src/App.tsx:276`) et non une conséquence.

### M12 — L'état d'ouverture PAR DÉFAUT est une préférence déclarée, pas une constante

Dans Photoshop, l'expansion des effets d'un calque se règle dans *Layers panel
Options* → **Expand New Effects**
([Apply Smart Filters](https://helpx.adobe.com/photoshop/using/applying-smart-filters.html)).
Le défaut d'ouverture est une donnée que l'utilisateur possède.

**Où ça s'appliquerait.** Nos sept `Disclosure` ont un `defaultOpen` **codé en
dur** dans le JSX (« Effet » ouvert `ParamPanel.tsx:370`, « Masque » ouvert
`MaskPanel.tsx:138`, « Affiner le bord » **fermé** `MaskPanel.tsx:418`,
« Source »/« Placement »/« Actions » ouverts dans `PhotoPanel.tsx:86,113,178`),
et elles sont **non contrôlées** — l'état de repli est donc **perdu au démontage
de la carte**, donc à chaque changement de sélection. C'est le défaut le plus
irritant du lot et il est invisible dans un test : rien ne casse, on rouvre.

**Coût.** Faible : passer les `Disclosure` en contrôlées et lever l'état dans
`App.tsx` (la primitive accepte déjà `open`/`onOpenChange`,
`src/components/ui/collapsible.tsx:5-13`). La persistance disque est un
deuxième pas, séparable.

### M13 — Ce qui ne s'applique pas est FANÉ, pas retiré — et le retirer est une préférence

Le mécanisme le plus intéressant du document pour nous, parce qu'il contredit
frontalement notre choix. Dans Lightroom, un preset incompatible avec la photo
courante « *is shown as **faded and in italic style*** » dans le panneau
Presets — il reste **à sa place, visible, et illisible comme actionnable**. Et
le faire disparaître est une **préférence explicite** : *Preferences → Presets →
Visibility → Show Partially Compatible Develop Presets*
([Apply Presets](https://helpx.adobe.com/lightroom-classic/help/apply-presets.html)).

Nous avons choisi l'inverse : `EffectParam.appliesWhen` **retire** le contrôle,
et `EffectSection.appliesWhen` retire la section **en-tête comprise** —
`groupEffectParams` le documente comme un arbitrage assumé (« *ADR-0001 prime sur
la stabilité visuelle* », `src/components/ParamPanel.tsx:196-199`).

Le mécanisme d'Adobe dit qu'il existe une **troisième voie** entre montrer et
cacher, et que le choix entre les deux peut appartenir à l'utilisateur plutôt
qu'à l'auteur de l'effet. Il ne dit pas que nous avons tort — il dit que la
question a deux réponses et que nous n'en avons instruit qu'une.

**Où ça s'appliquerait.** `groupEffectParams` (`src/components/ParamPanel.tsx:149-153`,
la fonction `masque`) est le point unique où le choix se fait, pour les deux
porteurs. Un troisième régime (`disabled` au lieu de retiré) y tiendrait en
quelques lignes : `LabeledSlider` a déjà un `disabled` câblé et stylé
(utilisé pour le verrou de calque, `ParamPanel.tsx:324`).

**Coût.** Bas en code, **haut en surface** : garder 15 curseurs fanés sur 22
dans `glass` en Poli rend exactement le débordement de colonne qu'ADR-0001
interdit. Toute reprise de cette idée doit passer le point 4 de la checklist
(mesure sur 1920×1080), et l'issue probable est « fané pour les cas courts,
retiré pour les cas longs » — c'est-à-dire une décision, donc hors de ce
document.

---

## 4. Trouver

### M14 — Filtrer les presets par leur nom

« *You can **filter Presets and Preset groups based on name** in the Presets
panel* » ([Apply Presets](https://helpx.adobe.com/lightroom-classic/help/apply-presets.html)).

**Où ça s'appliquerait.** `src/components/PresetPanel.tsx` n'a aucun champ de
recherche (son seul `placeholder` est celui du renommage,
`PresetDialogs.tsx:170`). Le patron est **déjà écrit et éprouvé** dans notre
propre code : `EffectPicker.tsx:29-38` (champ + `sr-only` + état vide + reset à
la fermeture). Idem pour `TextureLibrary`, qui liste un dossier entier.

**Coût.** Faible, et **ADR-0001-compatible par construction** : un champ de
filtre est un contrôle **unique** — c'est exactement le remède que l'ADR
prescrit, pas la maladie. Il va dans le slot `controls` de `DockedPanelCard`
(hors du conteneur défilant), placement `top` ou `bottom` au choix.

### M15 — La recherche globale cherche des OUTILS et des COMMANDES, pas des réglages

Ctrl+F (Cmd+F) ouvre le panneau **Discover** : « *Search for tools, help, and
more* », qui donne accès « *to tools, in-app tutorials, quick actions, and help
articles all in one place* »
([Access Discover panel](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/access-discover-panel.html)).

**Le constat négatif est le plus utile** : ni Photoshop ni Lightroom n'offrent de
recherche **plein-texte des réglages**. On cherche un outil, une commande, un
preset, une photo — jamais « le curseur qui contient *rayon* ». À 23 effets et
plusieurs centaines de paramètres, c'est une donnée pour le grilling : les deux
outils de référence ont choisi de **hiérarchiser** plutôt que d'indexer.

**Où ça s'appliquerait.** Nulle part directement. C'est un argument, pas une
proposition. Si une recherche transverse devait exister chez nous, le corpus
naturel serait `EffectParam.label` + `EffectSection.label` sur tout le registre,
et le point d'entrée `EffectPicker` (qui ne cherche aujourd'hui que
`effect.name`, `catalog.ts:63`).

### M16 — L'aide-mémoire des raccourcis du contexte courant, appelé et congédié

**Ctrl + /** = « *Display current module shortcuts* », et **Click** = « *Hide
current module shortcuts* »
([Keyboard shortcuts](https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html)).
La liste est **filtrée par le module courant**, et se referme au premier clic
n'importe où.

**Où ça s'appliquerait.** Nous avons de quoi le générer sans le maintenir à la
main : `src/ui/tools.ts:63-85` déclare déjà `shortcutLabel` (V/B/E) à côté de
chaque outil. Le reste des raccourcis vit en dur dans les listeners
(`App.tsx:1429-1455`, `Canvas.tsx:146-178`) et dans des `title=` de boutons
(`Toolbar.tsx:126-145`, « Annuler (Ctrl+Z) »). Un tel écran ne vaut que si sa
source est **la même table** que les listeners — sinon il ment dès le premier
ajout, et c'est le genre de mensonge que rien ne teste.

**Coût.** Le coût réel n'est pas l'overlay, c'est la **centralisation** des
raccourcis dans une table lisible par les deux. C'est un refactor de `App.tsx`,
fichier déjà signalé comme dépassant le seuil où le compilateur React abandonne.

### M17 — Chercher le contrôle DEPUIS l'image

Deux mécanismes inverses, où c'est l'image qui mène au réglage :

- **Targeted Adjustment** : on sélectionne l'outil dans le panneau Courbe ou
  Mélangeur, puis on **glisse directement sur la photo** pour bouger le curseur
  qui gouverne la zone touchée ; le groupe de cible se choisit dans la barre
  d'outils
  ([Develop module basics](https://helpx.adobe.com/lightroom-classic/help/develop-module-tools.html)).
  Cinq raccourcis dédiés (Ctrl+Alt+Maj+T/H/S/L/G) et un pour le désarmer (…+N).
- **L'histogramme nomme le contrôle sous le pointeur** : en survolant
  l'histogramme, « *the area for each Tone control appears in light gray **along
  with the name of the control and current setting***», et un glissement à cet
  endroit règle le contrôle en question (⚠️ **article contribué**,
  [Tone Control Adjustment](https://helpx.adobe.com/lightroom-classic/help/tone-control-adjustment.html) —
  la moitié « Targeted Adjustment » est, elle, dans la doc Adobe).

**Où ça s'appliquerait.** Nous avons **déjà la moitié la plus difficile** :
`CanvasControl` (point / disque / axe), le gabarit `pose`, `RegionHandles`,
`PointHandles`, `AxisHandles`, et un en-tête « sur la toile » qui apparaît dans
le panneau au bon endroit (`ParamPanel.tsx:441-445`). Ce qui n'existe pas est le
**sens inverse** : rien ne va de la toile vers le panneau. Manipuler une poignée
ne surligne pas, ne déplie pas et ne fait pas défiler jusqu'au curseur
correspondant.

**Coût.** Faible et purement d'affichage : le lien existe déjà dans le modèle de
rendu — `ParamRenderItem` porte un `spatialId` (`ParamPanel.tsx:22`) et
`spatialByParam` fait la correspondance dans les deux sens
(`ParamPanel.tsx:109-123`). Il manque un état « contrôle spatial actif » remonté
depuis la toile. **Aucun réordonnancement de `params[]`** n'est impliqué.

---

## 5. Montrer l'état

### M18 — Un œil PAR GROUPE, qui dit si le groupe agit — et qui se maintient pour comparer

Le mécanisme le plus dense du corpus, cité intégralement parce que chaque
membre de phrase porte une fonction distincte :

> « *All panels have individual eye indicators to allow you to **check which
> panel has an active setting**. Furthermore, you can **hold down the eye icon
> to temporarily hide the settings** from the sub-panel for better visual
> indication. […] holding Alt or Option key will **reveal a panel switch in
> place of the eye indicator**. You may select the switch to turn the panel off
> or select the option to **Reset an edit** within the panel. **Strike-out eye
> indicator** will be shown in a disabled state when the corresponding panel
> switch is turned off.* »
> ([Develop module basics](https://helpx.adobe.com/lightroom-classic/help/develop-module-tools.html))

Quatre fonctions sur **une seule case** de l'en-tête de groupe :
1. **lire** — ce groupe a-t-il un réglage actif ;
2. **comparer** — maintenir masque temporairement, relâcher restaure ;
3. **éteindre** — Alt transforme l'indicateur en interrupteur ;
4. **remettre à zéro** — le même Alt donne accès au reset du groupe.

Et un cinquième état, passif : l'œil **barré** quand le groupe est éteint. À
rapprocher du *Panel On/Off icon* qui « *temporarily turn[s] off all the
settings in a panel* »
([Workspace basics](https://helpx.adobe.com/lightroom-classic/help/workspace-basics.html)).

**Où ça s'appliquerait.** `ParamSection` (`src/components/ParamPanel.tsx:236-243`)
rend `section-title` comme un `<div>` inerte. C'est là, et seulement là, que ces
quatre fonctions se logeraient. Les données nécessaires sont **déjà toutes
présentes au moment du rendu** : `EffectSection.params` donne la liste des
paramètres du groupe, et `resolvedParams` vs `param.default`
(`ParamPanel.tsx:309-310`) donne « ce groupe est-il au défaut » sans aucun
nouveau champ de modèle.

**Coût.** Découpable en quatre gestes de tailles très différentes :
- **lire** (le point « ce groupe n'est plus au défaut ») : quasi gratuit, pure
  comparaison locale, aucun état nouveau ;
- **remettre à zéro** : un appel `onParamChange(layer.id, {…defaults})` ; le
  chemin d'écriture existe, l'entrée d'historique se valide comme un choix
  discret (`onParamCommit()` immédiat, patron déjà écrit `ParamPanel.tsx:466`
  et `:493`) ;
- **éteindre un groupe** : **coûteux et douteux** — il faudrait un état
  persistant par section dans `LayerState`, donc dans les presets, alors que le
  shader lit toujours tous les paramètres. Extinction ≠ masquage : la note de
  `appliesWhen` (« masquer ne borne rien ») vaut ici aussi ;
- **maintenir pour comparer** : voir M27, c'est le même besoin.

⚠️ **Piège ADR-0001.** Cet indicateur se répète — une case par section. Il n'est
pas pour autant un contrôle répété au sens de l'ADR : il agit sur **son propre
groupe**, pas sur une sélection, et l'ADR range explicitement « Paramètres
d'effet » dans la colonne *non applicable* (« rien ne se répète ; c'est la
DESTINATION du principe »). À écrire dans le rapport de tranche, avec la mesure
de hauteur, pas à supposer.

### M19 — Le point « cet outil a servi », et le point rouge « il faut y revenir »

« *To keep track of the tools used, **a dot** would be visible under each tool
in the tool strip. **A red dot** would be shown […] if the feature needs an
update. For example, a red dot would be visible under Masking if an AI mask
needs to be refreshed.* »
([Develop module basics](https://helpx.adobe.com/lightroom-classic/help/develop-module-tools.html))

Deux signaux **de forme identique et de sens différent**, distingués par la
seule couleur : « tu es passé par là » et « ce que tu as fait là est périmé ».

**Où ça s'appliquerait.** Le premier est le « hors défaut » de M18, appliqué à
une ligne de la Pile plutôt qu'à une section. Le second n'a pas d'équivalent
chez nous aujourd'hui, **mais il en aurait un demain** : `EffectPass.enabled`
et `libraryTexture` créent des états où un calque peut être en attente (la
texture 1×1 de repli servie par `TextureLibraryStore` tant que la vraie n'est
pas chargée, `src/render/effects/types.ts:320-327`).

**Coût.** Faible pour le marqueur. ⚠️ Il tombe sur la **ligne de calque**, dont
ADR-0001 mesure la largeur au pixel (entrée du 2026-07-29 : le nom était tombé à
32 px). Un marqueur, comme le verrou, ne se justifie que « **uniquement quand il
est posé** » — un point présent est une information, un point absent doit ne
rien coûter.

### M20 — L'avertissement d'incompatibilité vit sur l'objet, pas dans une boîte

« *If you see a **warning icon** next to a Smart Filter in the Layers panel, the
filter doesn't support the image's color mode or depth.* »
([Apply Smart Filters](https://helpx.adobe.com/photoshop/using/applying-smart-filters.html))

Et sur le masque : « *A **red X** appears over the filter mask thumbnail when the
mask is disabled* » — l'état désactivé est peint **sur la vignette**, pas ailleurs.

**Où ça s'appliquerait.** Nous avons exactement ce cas et nous le traitons en
prose : `presetDocument.ts` ignore un calque dont l'effet a disparu du registre
et « *pousse un avertissement, jamais une exception* ». Cet avertissement
n'atterrit sur aucune ligne. De même, la vignette de masque de la Pile
(spec du 2026-08-04, « deux cibles sur une ligne d'effet ») ne porte pas d'état
« masque désactivé », alors que `MaskPanel.tsx:191-208` permet de le désactiver.

**Coût.** Faible, et même contrainte de largeur que M19.

### M21 — L'écrêtage : une touche pour le permanent, un modificateur pour le ponctuel

- **J** = « *Show clipping* »
  ([Keyboard shortcuts](https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html)) —
  une bascule persistante.
- **Alt/Option maintenu pendant le glissement** des curseurs Blancs ou Noirs
  affiche l'écrêtage **le temps du geste** (⚠️ article contribué,
  [Tone Control Adjustment](https://helpx.adobe.com/lightroom-classic/help/tone-control-adjustment.html)).

Le même diagnostic, deux durées : l'une qu'on arme, l'autre qui vit et meurt
avec le geste.

**Où ça s'appliquerait.** Nous n'avons aucun avertissement d'écrêtage, alors que
**la moitié du registre en produit** : `glow`, `halation`, `lensFlare` et
`lightLeak` **ajoutent** de la lumière — c'est leur définition même. Un effet
qui rend du blanc pur ne se distingue pas d'un effet bien réglé sans mesure.
Le point d'accroche existe : le rendu se lit déjà par `Renderer.exportFrame()`,
et `scripts/render-check.mjs` fait exactement ce genre de mesure hors ligne.

**Coût.** Élevé et hors sujet de ce ticket — c'est une passe de rendu
supplémentaire ou une lecture GPU par frame, pas une décision d'interface. À
noter comme adjacence, pas comme proposition.

### M22 — La valeur mixte s'écrit avec un tiret, pas avec un chiffre trompeur

« *A slider representing multiple non-identical values appears as
**indeterminate, with an en dash (–) in place of the value**. The handle
position corresponds to the first selected value.* » (Spectrum · Slider).

**Où ça s'appliquerait.** Nulle part **aujourd'hui** : nous n'avons pas de
sélection multiple. À garder pour le jour où la Pile en aura une — la règle est
que le curseur ne ment pas en affichant la valeur du premier.

---

## 6. Le clavier

### M23 — Double-clic sur le NOM d'un curseur = retour au défaut. Alt-clic sur le nom du GROUPE = tout le groupe

Les deux lignes exactes de la table officielle
([Keyboard shortcuts](https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html)) :

| Résultat | Windows |
|---|---|
| Reset a slider | **Double-click slider name** |
| Reset a group of sliders | **Alt-click group name** |
| Reset all settings | Ctrl + Shift + R |

Recoupé deux fois : « *Double-click individual slider controls to reset the
sliders to zero* »
([Develop module basics](https://helpx.adobe.com/lightroom-classic/help/develop-module-tools.html)) ;
et Spectrum en fait une **règle de composant**, pas une astuce Lightroom :
« *After a slider has been adjusted, it can be reset to the default value by
double-clicking the handle* » (Spectrum · Slider, ajouté en 5.4.0). ⚠️ Les deux
sources divergent sur la **cible** : Lightroom dit le **nom**, Spectrum dit la
**poignée**. Divergence réelle, à trancher — pas à moyenner.

**Où ça s'appliquerait.** C'est le manque le plus net de tout ce relevé :
`ParamPanel.tsx` (563 lignes) ne contient **pas une occurrence** de `reset`, et
ni `labeled-slider.tsx` ni `number-field.tsx` n'ont de `onDoubleClick`. Or
`EffectParam.default` est là, à portée, déjà lu à chaque rendu
(`ParamPanel.tsx:310`) — l'information nécessaire est **entièrement présente**,
elle n'est juste pas actionnable.

Le geste de groupe tombe sur `ParamSection` (`ParamPanel.tsx:236-243`) et lui
donne sa raison d'être : `EffectSection` est aujourd'hui **purement décoratif**,
un titre au-dessus d'un `<div>`.

**Coût.** Le plus faible rapport coût/valeur du document.
- Curseur seul : un `onDoubleClick` dans `labeled-slider.tsx` + un `defaultValue`
  passé par `ParamPanel`. Une entrée d'historique atomique (`onParamCommit()`
  immédiat, patron `ParamPanel.tsx:466`).
- Groupe : `section.params` donne déjà la liste ; un seul `onParamChange` avec
  le patch complet.
- **Aucun réordonnancement de `params[]`**, **aucun champ de modèle nouveau**,
  **aucun pixel de rendu** — donc `npm run test:render` doit rendre **zéro
  écart**, et c'est le gate discriminant.

⚠️ Deux pièges nommés : le double-clic sur une **poignée** entre en conflit avec
le glissement (Spectrum le fait quand même) ; et `ColorGroupControl` regroupe
trois paramètres sous une pastille (`ParamPanel.tsx:533-554`) — un « reset » y
signifie *trois* valeurs, pas une.

### M24 — Le clavier règle un curseur, et passe au suivant

| Résultat | Touches |
|---|---|
| Increase/decrease selected slider in **small** increments | Up / Down, ou + / − |
| Increase/decrease selected slider in **larger** increments | **Shift** + Up / Down |
| **Cycle through Basic panel settings** (forward/backward) | **. (point) / , (virgule)** |

([Keyboard shortcuts](https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html)).
Spectrum confirme le socle : « *Up or Right Arrow — increases the value* ».

Le troisième est le plus intéressant : `.` et `,` **traversent les curseurs d'un
panneau** sans souris et sans Tab. Un panneau de 37 paramètres (`curves`) est un
argument pour, pas contre.

**Où ça s'appliquerait.** Nous avons déjà le **pas large au Maj**, mais seulement
sur les **manipulateurs** (`TransformHandles.tsx:332`, `RegionHandles.tsx:185`,
`AxisHandles.tsx:58`, `PointHandles.tsx:85`, `CurveControl.tsx:143`,
`ColorPickerPanel.tsx:144`) — **pas sur `LabeledSlider`**, qui a la molette
(`labeled-slider.tsx:88-112`, 1 % de la plage par cran) mais dont les flèches
sont celles de la primitive Base UI, sans variante Maj. L'asymétrie est nette :
nos poignées savent faire, nos curseurs non.

**Coût.** Faible pour Maj+flèche. La traversée `.` / `,` est plus lourde : il
faut un ordre de parcours, or nos items de rendu sont déjà ordonnés et blocs par
blocs (`groupEffectParams` rend des `ParamRenderBlock[]`) — l'ordre existe, il
faut un focus qui le suive.

### M25 — Un modificateur pendant un geste change l'OUTIL, pas seulement la contrainte

Lightroom, tous confirmés dans la table officielle :

| Résultat | Geste |
|---|---|
| **Temporarily switch from brush A or B to Eraser** | **Alt-drag** |
| **Paint a horizontal or vertical line** | **Shift-drag** |
| Increase/decrease brush size | ] / [ |
| Increase/decrease brush feathering | Shift + ] / Shift + [ |
| Switch between local adjustment brush A and B | / |
| Crop from center of photo | Alt-drag |
| Show/hide local adjustment **mask overlay** | **O** |
| **Cycle** local adjustment mask overlay **colors** | **Shift + O** |
| Show/hide local adjustment pin | H |

La distinction qui compte : Maj **contraint** (une droite), Alt **substitue**
(la gomme). Ce ne sont pas deux variantes du même mécanisme.

**Où ça s'appliquerait.** Le pinceau est notre trou le plus franc. Les handlers
de peinture de `src/components/Canvas.tsx:438-492` ne lisent **aucun**
modificateur : ni trait droit au Maj, ni gomme temporaire à Alt. Le seul
modificateur de geste sur la toile est **Espace maintenu** (ou bouton du milieu)
pour le pan (`Canvas.tsx:183-185`). Or la gomme existe déjà comme outil à part
entière (touche `E`, `src/ui/tools.ts:63-85`) : « Alt = gomme le temps du
geste » est un **raccourci vers un état qui existe**, pas une fonction nouvelle.

Le couple **O / Maj+O** tombe sur `MaskPanel.tsx:140-157` (`overlayForceHidden`,
« Afficher / Masquer l'overlay »), qui n'a **aucun raccourci** et dont la
couleur d'overlay n'est pas réglable — un overlay rouge sur une photo rouge est
invisible, c'est précisément le problème que Maj+O résout.

**Coût.** Faible à moyen. Le vrai risque est connu et documenté : **CDP ne peut
pas simuler un vrai drag natif** (deux agents ont déjà conclu à tort « non
reproductible » à cause de ça). Toute vérification d'un modificateur pendant un
geste passe donc par un listener passif injecté + un geste humain réel, ou par un
test unitaire sur la fonction pure qui décide — c'est le patron déjà retenu pour
`isToolShortcutEvent` (`src/ui/tools.ts:145-154`).

### M26 — Alt pendant un curseur affiche une VUE DE DIAGNOSTIC, pas un aperçu

Deux occurrences documentées, de nature identique :

- Mélangeur de couleurs : « *Holding Alt or Option key while making adjustments
  with Point Color or Mixer sliders will **show only the active hue in color and
  greyscale of all other hues** for better visualisation* »
  ([Develop module basics](https://helpx.adobe.com/lightroom-classic/help/develop-module-tools.html)) —
  celle-ci est de la doc Adobe.
- Netteté : Alt-glisser sur *Masking* affiche le masque de netteté en noir et
  blanc (les zones noires sont protégées).

Le curseur, pendant qu'on le bouge, ne montre pas son résultat mais **son
domaine d'action**.

**Où ça s'appliquerait.** Nous avons au moins deux candidats évidents où le
domaine est invisible : le seuil de `outlines` (qu'est-ce qui est détecté comme
contour) et le masque de netteté implicite de nos effets à seuil. Le point
d'accroche technique existe : `EffectPass` sait déjà rendre une passe interne
conditionnelle (`EffectPass.enabled`), donc une « passe de diagnostic » n'est pas
étrangère au modèle.

**Coût. Élevé, et c'est le mécanisme le plus cher du document.** Il demande un
shader de visualisation par effet concerné, donc il touche le rendu — donc il
tombe sous la règle « **un verrou aveugle ne verrouille rien** » (la mire doit
pouvoir montrer ce que la vue de diagnostic prétend montrer). À ne pas confondre
avec M18 (maintenir pour masquer), qui ne coûte rien de comparable.

---

## 7. Comparer

### M27 — L'avant/après est une TOUCHE, et il a quatre dispositions

| Résultat | Touche |
|---|---|
| **View Before only** | **\ (antislash)** |
| View Before and After left/right | Y |
| View Before and After top/bottom | Alt + Y |
| View Before and After in a split screen | Shift + Y |

([Keyboard shortcuts](https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html),
recoupé par
[Develop module basics](https://helpx.adobe.com/lightroom-classic/help/develop-module-tools.html) :
« *Zooming and panning are **synchronized** in the two views* », et le « Avant »
est la photo **telle qu'importée, presets compris**).

Photoshop a le même geste à l'échelle de la pile : l'œil de la **ligne
« Smart Filters »** masque d'un coup **tous** les filtres du Smart Object, alors
que chaque filtre garde le sien
([Apply Smart Filters](https://helpx.adobe.com/photoshop/using/applying-smart-filters.html)).

**Où ça s'appliquerait — et c'est le manque le plus visible du produit.** Nous
n'avons **aucun** moyen de voir la photo sans ses effets. L'isolation
(`src/layers/isolation.ts:142-168`, Ctrl+I ou Alt+clic sur l'œil) est nommée
« geste de comparaison » dans son propre commentaire (`:146`) mais fait autre
chose : elle n'affiche **qu'un** calque.

Le chemin est court et il est **déjà là** :
`src/render/framePipelineExecutor.ts:313` ne rend que
`layers.filter(layer => layer.enabled)`. Un « avant » est donc un rendu où tous
les calques d'effet sont filtrés — **aucune passe nouvelle, aucun shader**. Il
faut un drapeau de session (pas un état de document : il ne doit pas partir dans
un preset ni créer une entrée d'historique) et une touche maintenue.

**Coût. Faible, et c'est le meilleur rapport du document avec M23.** Deux
vigilances : (a) chaque bascule déclenche un rendu pleine résolution — ADR-0001
note déjà que c'est le cas à chaque changement de sélection, donc l'ordre de
grandeur est connu ; (b) la touche maintenue doit survivre à une perte de focus,
piège déjà rencontré et déjà résolu chez nous pour l'Espace du pan
(`Canvas.tsx:167-169` remet l'état à faux sur `blur`) — le patron est écrit.

### M28 — Le survol prévisualise sans engager. Trois fois.

Trois surfaces, même principe, jamais un clic :

1. **Historique** : « *You can **hover over the steps to preview** the
   corresponding image in the Develop loupe view* »
   ([Develop module basics](https://helpx.adobe.com/lightroom-classic/help/develop-module-tools.html)) ;
   et « *Preview each state of the photo by **rolling the pointer over the
   list**… viewing the effects in the Navigator panel* »
   ([Develop module options](https://helpx.adobe.com/lightroom-classic/help/develop-module-options.html)).
2. **Instantanés** : « *Roll the pointer over the list of snapshots to preview
   each one in the Navigator.* » (même page).
3. **Presets** : « ***Hover over the preset, to preview** the effects of a preset
   on your image.* »
   ([Apply Presets](https://helpx.adobe.com/lightroom-classic/help/apply-presets.html)).

**Où ça s'appliquerait.** `src/components/PresetPanel.tsx` applique au **clic**,
sans aperçu — et ADR-0001 range explicitement la liste des presets en
*non applicable* au principe de densité « *aucune sélection — le clic applique
directement* ». Un aperçu au survol change ce constat : il introduit un état
intermédiaire entre « pas touché » et « appliqué », sans ajouter un seul
contrôle à la ligne.

**Coût. Le plus mal cerné du document, et il faut le dire.** Un aperçu au survol
d'un preset veut dire **rendre une pile complète** à chaque déplacement de
souris, à résolution native — car il n'y a **pas de distinction preview/export**
chez nous, c'est une décision utilisateur verrouillée. Sans une stratégie bornée
(debounce, et une réponse à « que fait-on si le rendu est plus lent que le
survol »), c'est une porte ouverte sur un gel d'interface. La spec du 2026-08-04
range déjà les miniatures GPU en non-objectif pour une raison voisine : « *pas
de miniatures GPU recalculées à chaque frame ; une stratégie bornée doit précéder
leur implémentation* ».

### M29 — L'historique est une LISTE d'états, nommables, avec des instantanés à côté

Deux modèles, convergents :

- **Lightroom** : chaque réglage devient un **état daté et nommé** ; on peut
  **renommer** un état (double-clic) ; un bouton **Clear All** vide la liste
  sans toucher à l'image ; les **instantanés** sont une liste séparée, nommée,
  alphabétique, qu'on remplit à la main
  ([Develop module options](https://helpx.adobe.com/lightroom-classic/help/develop-module-options.html)).
  Alt+clic sur un état antérieur « *will clear all changes above the selection* »
  ([Develop module basics](https://helpx.adobe.com/lightroom-classic/help/develop-module-tools.html)).
- **Photoshop** : 20 états par défaut, réglable **jusqu'à 1 000** ; les états
  **grisés** montrent « *edits that will be lost if you continue from a selected
  state* » ; *Allow Non-Linear History* ; et une option nommée
  **« Make Layer Visibility Changes Undoable »**, qui décide si basculer un œil
  compte comme un pas d'historique
  ([History panel settings](https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/history-panel-overview.html)).

Cette dernière option est la plus pertinente pour nous, et pour une raison
précise : elle prouve qu'Adobe considère **« quels gestes méritent une entrée
d'historique »** comme une question ouverte, pas comme une évidence.

**Où ça s'appliquerait.** `src/layers/history.ts` porte déjà `past[]`/`future[]`,
un budget de 512 Mo, et un `bytesUsed()` dont le commentaire dit lui-même
« *pour tests et **futur indicateur UI*** » (`:119`). Le module n'est importé que
par `src/application/documentSession.ts` — **aucun composant ne le touche**.
Exposer une liste demanderait d'abord que les entrées portent un **libellé**,
ce qu'elles n'ont pas.

**Coût.** Moyen à élevé, et il commence par le **modèle**, pas par l'interface :
nommer une entrée d'historique. La question « quels gestes méritent une entrée »
est déjà tranchée au cas par cas dans notre code, en commentaire (les gestes
atomiques valident tout de suite, `ParamPanel.tsx:460-467` et `:488-493`) — ces
décisions sont exactement la matière d'une liste lisible.

### M30 — On peut ÉCRIRE dans le « avant »

Trois commandes symétriques, avec raccourcis :

| Résultat | Touches |
|---|---|
| Copy After settings to Before | Ctrl + Alt + Shift + ← |
| Copy Before settings to After | Ctrl + Alt + Shift + → |
| Swap Before and After settings | Ctrl + Alt + Shift + ↑ |

Plus, depuis l'historique : clic droit sur un état → *Copy History Step Settings
To Before* — on choisit **quel** état sert de point de comparaison
([Develop module basics](https://helpx.adobe.com/lightroom-classic/help/develop-module-tools.html)).

**Où ça s'appliquerait.** C'est le **niveau au-dessus** de M27 : le « avant »
n'est pas figé à l'import, il est **choisi**. Utile ici pour une raison
spécifique — nos effets s'empilent, et la comparaison intéressante est rarement
« avec tout / sans rien » mais « avec ce calque / sans ce calque ».

**Coût.** Élevé : il faut un second jeu de calques de référence et un second
rendu. **À ne pas confondre avec M27, qui ne demande ni l'un ni l'autre.**

### M31 — L'intensité d'un preset appliqué reste réglable, et c'est un opt-in par preset

« *Adjust the intensity of the applied preset using the **Preset Amount
slider***. » Avec deux subtilités : à la création, une case **Support Amount
Slider** décide si le preset l'autorise ; si l'option est décochée ou
impossible, « *the Amount slider will be **greyed out** for that preset* ». Et
la règle de dérive : « *When you adjust sliders other than those specific to the
preset, **the preset selection stays the same***. »
([Apply Presets](https://helpx.adobe.com/lightroom-classic/help/apply-presets.html)).

**Où ça s'appliquerait.** Notre bannière de dérive (`src/App.tsx:1990-2000`)
répond à une question voisine — « ce n'est plus le preset » — mais n'offre
qu'une sortie binaire (mettre à jour / copier). Un curseur d'intensité offre une
**troisième voie**, et il a chez nous une traduction directe et bon marché :
chaque calque porte déjà `opacity` sur `LayerState`, donc « 60 % de ce preset »
est **exprimable sans nouveau modèle**.

⚠️ Ce n'est **pas** une équivalence : moduler l'opacité de N calques n'est pas
interpoler N jeux de paramètres vers leurs défauts, et les deux donnent des
images différentes. À nommer comme une option, pas comme une implémentation.

**Coût.** Faible si l'on choisit la voie opacité, moyen sinon. Le
« greyed out quand non supporté » est le même mécanisme que M13 (fané plutôt que
caché) — une cohérence à noter.

---

## 8. Synthèse — mécanisme, point d'accroche, coût

Coût estimé sur **le code**, pas sur la décision. Aucun ordre de priorité n'est
impliqué : cette colonne est un fait, pas un avis.

| # | Mécanisme | Fichier d'accroche | Coût |
|---|---|---|---|
| M23 | Double-clic = défaut ; Alt-clic sur le groupe = groupe | `ui/labeled-slider.tsx`, `ParamPanel.tsx:236-243` | **Faible** |
| M27 | Avant/après par touche maintenue | `render/framePipelineExecutor.ts:313`, `App.tsx:1429` | **Faible** |
| M9 | Mode solo des cartes | `App.tsx` (4 booléens `*Folded`) | **Faible** |
| M14 | Filtre par nom dans Presets / Textures | `PresetPanel.tsx`, patron dans `EffectPicker.tsx:29-38` | **Faible** |
| M18a | Point « ce groupe n'est plus au défaut » | `ParamPanel.tsx:236-243` + `:309-310` | **Faible** |
| M3 | Unité hors du champ de saisie | `ui/labeled-slider.tsx:159-173` (patron : `number-field.tsx:155-159`) | **Faible** |
| M4 | Remplissage depuis 0 sur plage bipolaire | `ui/labeled-slider.tsx` | **Faible** |
| M24 | Maj + flèche sur un curseur | `ui/labeled-slider.tsx` | **Faible** |
| M12 | Repli persistant des `Disclosure` | `ui/collapsible.tsx:5-13`, état levé dans `App.tsx` | **Faible** |
| M1 | Glose d'un souffle sous le nom d'effet | `effects/types.ts:266`, `EffectPicker.tsx` | **Faible** |
| M10 | Ctrl+1..4 pour adresser une carte | `App.tsx:1429-1455` (⚠️ Ctrl+I pris) | **Faible** |
| M25 | Alt = gomme temporaire ; Maj = trait droit ; O / Maj+O | `Canvas.tsx:438-492`, `MaskPanel.tsx:140-157` | **Faible-moyen** |
| M8 | Triangle repliant la chaîne d'une photo | `LayerPanel.tsx` (⚠️ ADR-0001 pt. 3 et 6) | **Moyen** |
| M17 | Poignée de toile → surligne son curseur | `ParamPanel.tsx:22` (`spatialId`), `:109-123` | **Moyen** |
| M19/M20 | Marqueurs d'état sur la ligne | `LayerPanel.tsx` (⚠️ largeur du nom, ADR-0001 pt. 6) | **Moyen** |
| M13 | Fané plutôt que retiré | `ParamPanel.tsx:149-153` (`masque`) | **Moyen** (surface) |
| M7 | Ordre/visibilité des cartes, persistés | `App.tsx:239`, patron `useTextureLibrary.ts:6-26` | **Moyen** |
| M16 | Aide-mémoire des raccourcis | exige de centraliser les raccourcis (`App.tsx`) | **Moyen** |
| M31 | Intensité d'un preset appliqué | `LayerState.opacity` | **Moyen** |
| M29 | Historique visible | `layers/history.ts` (exige de nommer les entrées) | **Moyen-élevé** |
| M28 | Aperçu au survol d'un preset | `PresetPanel.tsx` (⚠️ pas de preview/export séparé) | **Élevé / non borné** |
| M30 | « Avant » choisi, copie entre les deux états | second jeu de calques + second rendu | **Élevé** |
| M26 | Vue de diagnostic sous Alt | shader par effet (⚠️ règle de la mire) | **Élevé** |
| M21 | Avertissement d'écrêtage | passe ou lecture GPU | **Élevé** |

### Ce qu'aucun de ces mécanismes ne demande

Vérifié un par un, parce que le ticket refuse d'avance toute réponse qui les
violerait :

- **Aucun** ne réordonne `params[]` — M6, M17 et M23 touchent l'affichage ou
  l'action, jamais l'ordre persisté dans les presets.
- **Aucun** ne suppose un dock redimensionnable ni un splitter. M11 est le seul
  à évoquer une largeur, et c'est signalé comme une tension, pas une proposition.
- **Aucun** ne fait connaître `LayerStack` ou le renderer à un composant : M9,
  M10, M12, M27 lèvent tous leur état dans `App.tsx`.
- **Trois** ajoutent un élément qui se répète sur une liste et doivent passer la
  checklist ADR-0001 explicitement, par écrit, dans leur rapport de tranche :
  **M8** (triangle par racine photo), **M18** (indicateur par section),
  **M19/M20** (marqueurs sur la ligne de calque).

---

## 9. Ce que nous faisons et qu'ils ne font pas

À verser au grilling au même titre que les manques — une comparaison qui ne
listerait que les manques conclurait mécaniquement qu'il faut tout copier.

- **Un masque PAR effet.** Photoshop est explicite sur sa limite : « *When you
  mask Smart Filters, the masking applies to **all** Smart Filters — you **can't
  mask individual** Smart Filters* »
  ([Apply Smart Filters](https://helpx.adobe.com/photoshop/using/applying-smart-filters.html)).
  Nous avons un masque par calque d'effet, avec sources combinables. C'est plus
  fin que Photoshop, et c'est un acquis à ne pas dégrader en copiant leur
  ergonomie.
- **L'applicabilité est DÉCLARÉE et RELUE.** `appliesWhen` est validé au
  chargement par `validateEffect`, et 41 déclarations ont été **mesurées** le
  2026-08-05 (dont une fausse, `glass.flat`). Rien dans la documentation Adobe ne
  décrit un équivalent : leur masquage est câblé dans chaque panneau.
- **Un maximum de curseur dynamique.** `EffectParam.maxFrom` borne le curseur
  quand un autre paramètre le borne. Ni la doc Lightroom ni Spectrum ne
  mentionnent un `max` variable — Spectrum ne connaît que `min`/`max`/`step`
  fixes.
- **Ctrl+molette sur le dernier contrôle touché** (`src/ui/activeControl.ts:103-131`).
  Aucun équivalent documenté chez Adobe : leur « hot text » exige de survoler
  le contrôle visé.
- **Le vocabulaire de section est FERMÉ** (`liste`·`paire`·`grille`·`pose`·
  `figure`). Adobe fait de la mise en page libre par panneau. Notre contrainte
  est plus forte, délibérément.

Et une **absence à ne pas lire comme un manque** : ni Photoshop ni Lightroom ne
proposent de recherche plein-texte des réglages (M15). Deux outils de référence
ont préféré hiérarchiser. C'est une donnée pour décider, pas un retard.

---

## 10. Ce que ce relevé ne couvre pas

- **Aucune mesure sur pièce.** Rien ici n'a été mesuré dans la fenêtre réelle.
  Les coûts de la colonne « Coût » sont des estimations de code, et tout ce qui
  touche la hauteur d'une carte ou la largeur d'une ligne doit être **mesuré**
  (checklist ADR-0001, points 3-4-6) avant d'être décidé.
- **La barre de tâches contextuelle de Photoshop** (barre flottante qui propose
  l'étape suivante selon l'outil ou la sélection) est mentionnée dans la page
  « Workspace overview » mais sa page dédiée rend un 404 ; je ne l'ai pas
  instruite. Elle est en tension de principe avec un dock fixe et mériterait son
  propre passage.
- **Lightroom (cloud) et Lightroom mobile** n'ont pas été instruits — seulement
  Lightroom **Classic**. Leur panneau Édition est organisé différemment et
  pourrait porter des mécanismes absents d'ici.
- **La divergence M23** (Lightroom réinitialise au **nom**, Spectrum à la
  **poignée**) n'est pas tranchée : elle est signalée exprès.
- **Le comportement des animations et transitions n'est pas couvert**, par
  construction. Aucune source lue ne le décrit, et je n'ai rien inféré d'une
  image.

---

## Index des sources

Aide Photoshop — [Panels and menus](https://helpx.adobe.com/photoshop/using/panels-menus.html) ·
[Workspace overview](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/workspace-overview.html) ·
[Access the Discover panel](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/access-discover-panel.html) ·
[Expand or collapse panel icons](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/collapse-expand-icons.html) ·
[Use simple math in number fields](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/use-simple-math.html) ·
[Apply Smart Filters](https://helpx.adobe.com/photoshop/using/applying-smart-filters.html) ·
[Adjustment and fill layers overview](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/adjustment-and-fill-layers-overview.html) ·
[Adjustment layer options](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/adjustment-layers-options.html) ·
[Create adjustment and fill layers](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/work-with-adjustment-and-fill-layers.html) ·
[Edit adjustment and fill layers](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/change-adjustment-and-fill-layer-options.html) ·
[Use the Layers panel](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/get-started-layers/work-with-the-layers-panel.html) ·
[History panel settings](https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/history-panel-overview.html)

Aide Lightroom Classic — [Develop module basics](https://helpx.adobe.com/lightroom-classic/help/develop-module-tools.html) ·
[Workspace basics](https://helpx.adobe.com/lightroom-classic/help/workspace-basics.html) ·
[Develop module options](https://helpx.adobe.com/lightroom-classic/help/develop-module-options.html) ·
[Apply Presets](https://helpx.adobe.com/lightroom-classic/help/apply-presets.html) ·
[Keyboard shortcuts](https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html) ·
⚠️ article contribué (Todd R. Shaner), non écrit par Adobe :
[Tone Control Adjustment](https://helpx.adobe.com/lightroom-classic/help/tone-control-adjustment.html)

Adobe Spectrum — [Slider](https://spectrum.adobe.com/page/slider/) ·
[Contextual help](https://spectrum.adobe.com/page/contextual-help/)

Documents internes lus — `CLAUDE.md` ·
`.claude/decisions/ADR-0001-densite-ui-controles-repetes.md` ·
`docs/design-system/photoshop-web-reference-tokens.md` ·
`docs/superpowers/specs/2026-08-03-pile-proprietes-masque-design.md` ·
`src/render/effects/catalog.ts` · `src/render/effects/types.ts` ·
`src/components/ParamPanel.tsx`, plus le relevé de code cité tout au long.

---

## Annexe — mécanismes relevés, non retenus dans le corps

Notés pour ne pas être re-cherchés, écartés faute d'un point d'accroche chez
nous aujourd'hui.

- **Math dans les champs numériques.** Photoshop accepte `30+45`, `300/2`,
  `12*4`, `3 cm * 50%` dans tout champ numérique, et `+50` ajoute à la valeur
  courante
  ([Use simple math](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/use-simple-math.html)).
  Notre `parseControlValue` (`src/ui/formatValue.ts:14-25`) est un parseur
  simple ; le gain est réel sur les champs de dimension (`PhotoPanel`), faible
  sur les curseurs d'effet.
- **Scrubby slider / hot text.** Survoler le **titre** d'un curseur change le
  pointeur en main et permet de glisser ; Maj accélère ×10
  ([Panels and menus](https://helpx.adobe.com/photoshop/using/panels-menus.html)).
  Spectrum le généralise : glisser **sur le texte de la valeur**, ou molette en
  survol de ce texte (Spectrum · Slider). Chez nous : `requestPointerLock`
  n'apparaît nulle part, et nous avons déjà la molette **et** la saisie au
  clavier — donc la troisième voie est du confort, pas une capacité manquante.
- **Échelle de progression logarithmique** pour un contrôle fin des petites
  valeurs (Spectrum · Slider). Pertinent pour nos rayons en pixels, mais c'est
  une **transformation de la valeur** — donc un risque de rupture de preset si
  elle est mal isolée du modèle. À instruire à part.
- **Piste en dégradé** pour donner du sens à la plage (Spectrum · Slider). Nous
  l'avons déjà, mais uniquement dans `ColorRampControl` et `ColorPickerPanel`.
- **Tooltip vs help text vs contextual help.** Spectrum les sépare par une règle
  nette : « *Use **help text** for critical information that a user needs to
  know to complete a task. **Don't hide essential information in contextual
  help**.* » et le tooltip est réservé à « *a few words […] such as showing the
  label for an icon-only button* »
  ([Contextual help](https://spectrum.adobe.com/page/contextual-help/)).
  Nos `EffectParam.hint` sont rendus en `title=` — c'est-à-dire le registre le
  plus faible des trois — alors qu'ils disent **pourquoi** un paramètre est sans
  objet, ce qui est de l'information nécessaire à la tâche. Écart de registre
  réel, mais son remède (une ligne visible sous le curseur) coûte de la hauteur,
  donc il retombe sur ADR-0001.
- **Vue de référence** de Lightroom (une photo fixe à côté de la photo éditée,
  `Maj+R`) : sans objet ici, nous n'éditons pas des séries.
- **Auto Hide & Show / Auto Hide / Manual** pour les groupes de panneaux
  ([Workspace basics](https://helpx.adobe.com/lightroom-classic/help/workspace-basics.html)) :
  un dock qui s'ouvre au survol du bord. Écarté — c'est un comportement de
  mouvement, et nos règles interdisent d'en inférer quoi que ce soit sans le voir.
