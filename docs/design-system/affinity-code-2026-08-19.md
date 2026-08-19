# Le code d'Affinity, lu — ce que leur architecture apprend à la nôtre

Relevé le 2026-08-19 au soir, pour l'audit v2, sur la demande d'Antoine :
« regarde leur code pour savoir comment améliorer le nôtre ».

**Ce qui se lit, et à quel titre.** Trois couches :

1. **Le SDK JavaScript embarqué** (`App\Resources\JSLib\`, 105 fichiers, ~2,4 Mo)
   — lu EN ENTIER par trois agents (46 + 6 + 10 fichiers, plus tests et
   exemples). Il est **sous licence BSD 3-Clause** (Canva Pty Ltd, en-tête sur
   chaque fichier) : cette couche s'étudie sans aucune réserve. C'est une
   façade FFI sans logique métier — mais la FORME de la façade est la carte
   exacte du moteur.
2. **Les chaînes des binaires** — lecture seule, faite (catalogues + 22 773
   identifiants extraits de `Serif.Affinity.dll`).
3. **Les implémentations d'effets** — **ILLISIBLES, mesuré** : le scan des
   trois DLL moteur ne trouve qu'UN gabarit `__kernel void Kernel` et un seul
   `clCreateProgramWithSource` — les filtres sont du C++ compilé, le source
   OpenCL s'assemble à l'exécution, aucune bibliothèque d'algorithmes en
   clair. Leur code d'effets ne s'apprend QUE par la boîte noire mesurée —
   qui a déjà produit quatre prises (plancher du Bloom, courbure des lames,
   feather en S, morphologie octogonale). La décompilation reste exclue
   (dérivé + EULA — c'est le produit d'Antoine qu'elle exposerait).

Tout ce qui suit mappe une leçon de LEUR architecture sur NOTRE code, avec le
chemin. Les gains sont classés à la fin.

---

## 1. La leçon n° 1 — le preview transactionnel, et c'est NOTRE plaie exacte

**Chez eux** : une seule voie de mutation dans tout le moteur —
`doc.executeCommand(commande, preview)`. Le flag `preview` traverse ~250
méthodes. `preview=true` applique RÉELLEMENT la commande au document vivant
(le canvas se met à jour) mais n'écrit pas d'entrée d'historique ; chaque
preview remplace le précédent ; `clearPreviews()` abandonne ; le commit est
la MÊME commande rejouée sans le flag. Leurs trois exemples officiels
utilisent tous ce squelette : à chaque frappe d'un dialogue,
`executeCommand(cmd, true)` ; sur OK, `executeCommand(cmd, false)`.
**Il n'existe aucun code d'aperçu séparé — l'aperçu EST la commande.**

**Chez nous** : le chemin vivant est une SECONDE implémentation. Pendant un
drag, `App.tsx` construit le tableau à la main et appelle
`replaceLiveLayers`, hors des mutateurs de `LayerStack` — délibérément (34 ms
de `clone()` par `pointermove`), et c'est par là que le verrou a fui le
2026-08-18. `CLAUDE.md` porte la rustine en toutes lettres : « toute règle
métier posée sur `LayerStack` doit s'exprimer AUSSI sur cette porte, sinon
elle ne protège que ce que personne ne fait ».

**Le chemin chez nous** n'est pas d'adopter leur Command pattern intégral
(327 fabriques — un autre monde). C'est de réifier la SEULE distinction qui
nous manque : un mode « vivant » PORTÉ PAR LE MODÈLE au lieu d'un chemin
parallèle. Concrètement : `LayerStack` expose la mutation vivante elle-même
(même garde, même verrous, zéro clone — la contrainte de perf reste
satisfaite par une mutation en place étiquetée), et `replaceLiveLayers`
meurt. Une règle métier ne s'écrit plus qu'une fois. C'est un refactor de
frontière, pas une réécriture — et c'est la première chose que ce relevé
change à notre code.

Mécanisme jumeau chez eux, à noter pour plus tard : `mergeable` sur les
transformations — tout est committé mais les entrées consécutives FUSIONNENT
dans l'historique. Deux stratégies de drag (preview / coalescence), pas une.

## 2. La commande porte son libellé, ses effets, et l'historique est un ARBRE

Ce que leur modèle donne « gratuitement » parce que tout passe par une
commande-valeur :

- **Chaque entrée d'historique a un LIBELLÉ localisé** porté par le TYPE de
  commande (jamais une chaîne passée par l'appelant) — et une **VIGNETTE**
  rasterisée, et la commande elle-même.
- **L'historique est un arbre** : `hasAlternateFutures` par entrée,
  `createCycleAlternateFutures` pour naviguer — annuler puis faire autre
  chose ne détruit pas l'ancien futur.
- **Des instantanés NOMMÉS** (`DocumentSnapshot`), distincts de l'historique,
  persistés, avec restauration et « ouvrir l'instantané comme document ».
- **`cmd.newNodes`** : après exécution, la commande contient les nœuds
  qu'elle a créés — l'intention est aussi le reçu.
- **Undo est une commande** — d'où macros et enregistrement d'actions sans
  aucun code par fonctionnalité : c'est un tap sur le pipeline.

**Chez nous** : `History` est solide (budget 512 Mo, refcount des buffers)
et MUET — pas de libellés, pas de panneau possible en l'état. Le candidat
« panneau Historique » de l'audit commence par : un libellé par `push`.
La leçon d'ici l'affine : le libellé doit venir du GESTE (une table
geste→libellé à l'endroit où le geste commit), pas une chaîne libre par
appelant — sinon deux appelants du même geste divergent. L'arbre et les
vignettes : notés, pas chartés (coût réel, geste non nommé).

## 3. La sélection est une VALEUR, avec des sous-sélections typées

`Selection` = liste de (nœud + sous-sélections typées) — dix types de
sous-sélection (points de courbe, arêtes, arrêts de dégradé, plages de
texte, mailles de transparence…), immuables (`cloneAndAddItems`), et TOUTE
commande prend une sélection en premier argument, `null` = la sélection
courante. Un script peut cibler « les points 3 et 7 de la courbe A » sans
toucher la sélection de l'interface.

**Chez nous** : `selectedId` scalaire. Suffisant aujourd'hui — mais le jour
où un geste doit viser « deux arrêts du dégradé du masque » ou « ces trois
calques », le patron est celui-là : la sélection descend en ARGUMENT dans les
opérations, elle ne se lit pas dans un état global. À garder en tête au
premier besoin multi-sélection, pas avant.

## 4. Node/NodeDefinition, et les capacités en FACETTES

- **Créer sans muter** : on ne pose jamais un nœud puis on le configure — on
  remplit une `NodeDefinition` DÉTACHÉE (réutilisable entre exécutions,
  c'est ce qui rend leur preview bon marché), une commande la matérialise.
  Aucun état intermédiaire invalide n'existe dans le document.
- **Facettes** : un nœud n'hérite pas de 200 champs — il expose des
  interfaces optionnelles par capacité (`visibilityInterface`,
  `blendModeInterface`, `rasterInterface`, `exportableInterface`…), un
  fichier chacune, mémoïsées.
- **Une pile d'effets est un SOUS-ARBRE** (`NodeChildType.Main` /
  `Enclosure`) : les ajustements/filtres/masques sont des ENFANTS du calque
  — ordonnables, groupables, masquables individuellement.

**Chez nous** : `LayerState` est déjà de la donnée pure (bien), plate (bien
pour notre taille). La facette est la leçon à retenir pour la CROISSANCE :
le chantier « calque de retouche » (pixels peints) se modélise comme une
capacité de plus sur le calque, pas comme un nouveau type qui duplique tout.

## 5. La Spline est LEUR type universel de réponse — et notre `curveControls` est l'embryon du nôtre

Recensement exhaustif (trois agents) : la MÊME classe `Spline` (points 2D
dans [0,1]², flag linéaire, presets `SplineProfile : Linear · SCurve ·
SmoothIn · SmoothOut · Squared · SquareRoot`) sert dans SIX sous-systèmes —
courbes tonales (par canal), **plages de fusion** (par canal, source ET
dessous — le « Blend If » en courbe), profil de biseau des deux styles de
calque 3D, **courbe de réponse de CHAQUE dynamique de pinceau**, profil de
largeur des brosses vectorielles, wet edges. La reformulation exacte : chez
eux, toute RÉPONSE (tonale ou de contrôleur) est une courbe éditable ; la
configuration reste scalaire.

**Chez nous** : `EffectModule.curveControls` existe — pour `curves` seul.
La leçon : le jour où arrivent BlendRanges (ticket 06), la dureté du pinceau,
ou un falloff d'effet, **c'est le MÊME widget de courbe et la MÊME LUT 1D
GPU** — un composant, un uploader, N usages. Et leur vocabulaire
`SplineProfile` (six profils NOMMÉS partagés) est la version généralisée de
ce que notre feather vient de faire en dur : nommer des profils de réponse
au lieu de les recoder.

## 6. Détails de moteur qui comptent, relevés dans la façade

- **Le bruit est une propriété de la COULEUR et du DÉGRADÉ** (`Colour.noise`,
  `Gradient.noise`) — l'anti-banding est natif, pas un effet. Nous rendons
  des dégradés (`aplat`, masques gradient) en 8 bits : le banding est notre
  risque aussi, et la parade est un dither AU POINT D'ÉCHANTILLONNAGE du
  dégradé. À vérifier sur un dégradé `aplat` doux avant de dire qu'on l'a.
- **Leurs stops de dégradé portent `midpoint` ET `smoothness`** — deux
  paramètres de FORME par intervalle. Notre `aplat` interpole en lumière
  linéaire (bien) mais à forme fixe.
- **`Mf` — le masque FLOTTANT est un format de première classe** (M8/M16/Mf,
  distinct de l'alpha RGBA). Nos masques sont r8 ; le jour du 16 bits
  (ticket 11), les masques ont leur propre question de précision.
- **Trois opacités** (`globalOpacity`, `fillOpacity`, transparence SPATIALE —
  un `FillDescriptor` complet, dégradé/mesh éditable au canvas). La
  transparence spatiale recouvre ce que nos masques `gradient` font — leur
  version est un remplissage généralisé.
- **La visibilité est une FONCTION D'UN CONTEXTE** (`VisibilityTestOptions` :
  écran / export / domaine) — un seul graphe, N passes paramétrées. Notre
  paire `layers()`/`displayLayers()` et notre overlay refusé à l'export
  (`maskOverlayFor`) sont des instances du même principe — le nôtre est
  câblé par cas, le leur est un contrat. À généraliser si un troisième cas
  arrive.
- **Double DPI** (`UnitValueConverter(dpi, viewDpi)`) et unités dans les NOMS
  de paramètres (`pixels96`) — le contrat minimal du print. Notre export
  print (PRD) en aura besoin tel quel.
- **`NodeRenderingEngine`** : rasteriser un SOUS-ARBRE (effets compris) comme
  source raster paresseuse, sans export fichier. Notre `exportFrame()` est
  global-document ; un rendu par calque servirait les vignettes du panneau
  Historique et du panneau Calques le jour venu.
- **`enableIfDisabled`** sur les setters d'effets de calque : bouger un
  curseur d'un effet éteint le rallume — UN geste, pas deux. Micro-leçon UX
  directement applicable à notre pile.
- **Verrous : UN bit local + UN bit hérité, c'est tout** (`isEditable`,
  `isLocalEditable`, `isMasterEditable`) — la confirmation définitive de ce
  que l'audit d'hier soupçonnait sur le cadenas unique. Notre modèle à
  quatre verrous est plus riche que le leur ; la contradiction avec la
  référence est actée, à toi de trancher.

## 7. Leur UI scriptée confirme NOTRE pari déclaratif — par son échec inverse

Deux faits croisés :

1. Leurs dialogues de script sont DÉCLARATIFS mais FERMÉS (16 contrôles, pas
   d'éditeur de courbe alors que le modèle en est truffé, aucun binding —
   le motif officiel est d'accrocher les contrôles comme propriétés
   arbitraires sur l'objet Dialog).
2. **Ils ont eu une API d'activation conditionnelle déclarative
   (`setIsEnabledBy*`, huit méthodes) et l'ont DÉPRÉCIÉE EN LA VIDANT** — les
   méthodes existent, ne font rien, et un `console.warn` renvoie vers le
   handler impératif (`onControlValueChanged` + `setItemsVisibility`).
   Le déclaratif générique de dépendances n'a pas composé.

**Notre `DisplayCondition` (voie A — une condition ne vise qu'un paramètre à
`choices`, aucune échappatoire prédicat)** est exactement le compromis
qu'ils n'ont pas trouvé : déclaratif, donc validable par `validateEffect` et
mesurable par `--applicabilite` — mais BORNÉ, donc il compose. Leur
dépréciation est la meilleure validation externe de cette voie à ce jour.

Et leur trou central, dit par l'agent en une phrase : **un modèle de document
exemplaire, exposé sans AUCUNE métadonnée** — pas d'énumération des
paramètres, bornes par écrêtage SILENCIEUX (écrire `gamma = 23578` relit
`2.0` sans un mot), deux conventions de passage de structures non signalées,
une `Spline` sans `evaluate()`. Notre registre fait l'inverse : les modules
se décrivent, `validateEffect` relit tout au chargement, la garde
`parametresCables` prouve le câblage, les bornes sont des clamps TESTÉS.
**Sur ce plan précis, c'est eux qui auraient à copier.** La synthèse
stratégique du relevé : garder notre déclarativité, prendre leurs quatre
inventions de modèle (preview transactionnel, commande-valeur/libellés,
effets-en-arbre → facettes, courbes de réponse).

## 8. Bugs réels de leur SDK, relevés en passant

Utiles parce que le SDK est notre instrument de mesure : `I16()`/`IA16()`
appellent le constructeur 8 bits avec un alpha 65535 (`colours.js`) ;
`LineStyle.create()` lève si `vectorBrush` absent
(`VectorBrush.createDefault()` jette « not yet implemented ») ;
`DocumentHistoryItem.dispose()` oublie son handle ; un test appelle une
fabrique qui n'existe pas (`createSetCurrentSnapshotFromHistoryIndex`). Et
la leçon de pilotage payée deux fois par NOS mesures : **écrire
`node.parameters = p` échoue en silence sur plusieurs types — la voie fiable
est `DocumentCommand.createSetXxxParameters(selection, params)`** (c'est
elle qui a débloqué la mesure des ajustements, et elle explique l'échec du
`screenType` du Halftone).

---

## Récapitulatif — les prises CODE, classées

| # | Prise | Notre état | Coût |
| --- | --- | --- | --- |
| 1 | ⭐ Réifier le geste vivant (mort de `replaceLiveLayers`, verrous écrits une fois) | la fuite est documentée dans CLAUDE.md, la rustine est manuelle | M — refactor de frontière LayerStack/App |
| 2 | Libellés d'historique portés par le GESTE (préalable du panneau Historique) | `History` muet | S–M |
| 3 | Widget courbe + LUT 1D UNIQUES, vocabulaire de profils nommés | `curveControls` mono-usage, profils en dur | M — au premier second usage (BlendRanges ou dureté pinceau) |
| 4 | Anti-banding : dither au point d'échantillonnage des dégradés | à VÉRIFIER sur `aplat` doux — peut-être déjà invisible | XS (mesure) puis S |
| 5 | `enableIfDisabled` : régler un effet éteint le rallume | deux gestes aujourd'hui | XS |
| 6 | `midpoint`/`smoothness` par arrêt de dégradé (`aplat`) | forme fixe | S |
| 7 | Visibilité contextuelle en contrat (écran/export/domaine) | câblée par cas (2 cas) | à ne faire qu'au 3ᵉ cas |
| 8 | Rendu de sous-arbre (vignettes par calque/entrée) | `exportFrame` global | M — quand un panneau en a besoin |
| 9 | Snapshots nommés / historique en arbre / sélection réifiée / facettes | — | notés, au geste nommé |

**Où l'on ne change RIEN, validé par leur code** : la déclarativité du
registre (leur trou central), `DisplayCondition` voie A (leur déclaratif
générique est mort), les clamps testés contre leur écrêtage silencieux, le
WGSL unique contre leur double compilation, et le modèle un-effet-un-module.
