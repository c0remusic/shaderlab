# PRD full-scope — Système de calques & masquage de shaderlab

> Produit par le skill `interview` (le QUOI, usage). Nourrit
> `superpowers:brainstorming` (le COMMENT). Mode FEATURE.
> **Consolide et remplace** `2026-07-16-shaderlab-interview-prd.md` (interview du
> 2026-07-16, marqué superseded) : il en absorbe le contenu (opacité + blend
> modes, pinceau/dégradé/luminosité) et ajoute le delta masquage/sélection
> (modèle de composition combinable, range mask couleur, refine edge, triage des
> différés). Interviews réelles avec Antoine, 2026-07-16 puis 2026-07-18.
>
> Feature sœur cadrée séparément : pan/zoom du canvas
> (`2026-07-18-shaderlab-canvas-pan-zoom-prd.md`) — navigation, indépendante du
> compositing.

## Contexte

shaderlab = outil desktop Windows d'effets shader GPU temps réel sur photos JPEG,
empilables en calques, faisant aussi office d'éditeur externe Lightroom. Le
système de calques actuel est fonctionnel mais pauvre : un calque est
**tout-ou-rien** (ni opacité ni mode de fusion dans le modèle `LayerState`), les
rendus sont ressentis **trop « légers »** (impossible d'aller vers l'extrême), et
le masquage se limite au **pinceau seul** (pas de sélection par couleur/tons, pas
d'affinage de bord). L'organisation UI ne se décide pas à l'aveugle.

Ce PRD cadre l'évolution complète du système de calques : dosage et fusion des
calques, masquage multi-source combinable, affinage des masques, présentation.

Origine du delta masquage : discussion des pratiques pro (Lightroom / Capture One
/ Photoshop) et critique d'un concurrent (dasca.studio) dont le modèle « effect
chain » ne permet pas de blend indépendant par calque — shaderlab prend la
direction calques + blend par calque + masque combinable. Aucun code extrait.

## Objectif

Faire du système de calques un vrai outil d'édition créative : doser et fusionner
les calques comme dans un logiciel pro, construire un masque fin depuis plusieurs
sources combinables, et pousser les rendus jusqu'à l'extrême — sans jamais
dégrader la fidélité de l'empilement ni la fluidité du geste.

## Comportements (quand X → Y)

> **« Vague 1 »** = le périmètre livré par cette feature (ce PRD). Les sources
> marquées « vague 1 » sont dans le scope ; la section **Différé** liste ce qui est
> repoussé à une vague ultérieure, chacun avec son trigger de réouverture nommé.

### Calques

- Quand j'ajuste l'opacité d'un calque → son effet s'atténue proportionnellement,
  en temps réel.
- Quand je change le mode de fusion d'un calque → il se mélange au calque
  au-dessous selon une **formule standard type Photoshop (~12+ modes)**, identique
  au logiciel de référence.
- Quand je réordonne / duplique / nomme / groupe des calques → la pile reste
  lisible et chaque action est annulable.
- Quand je groupe des calques → **le groupe est un conteneur à part entière** :
  il a **sa propre opacité, son propre mode de fusion et son propre masque**, qui
  s'appliquent au **résultat aplati de ses enfants** (modèle Photoshop, compositing
  imbriqué). Plier/déplier un groupe ne change pas le rendu.

### Masques — modèle de composition

- **Un calque a UN masque unique**, construit depuis **plusieurs sources
  combinables** (pinceau, dégradé, luminosité, range couleur…). Modèle Lightroom :
  un seul résultat à voir par calque.
- Quand j'ajoute une source à un masque → je choisis son **mode de combinaison** :
  **Ajouter** (union), **Soustraire**, ou **Intersecter** avec ce qui est déjà là.
- Quand je gère un masque → le voir (overlay), l'inverser, le désactiver, le
  copier vers un autre calque. **La copie est indépendante et figée** : le masque
  est dupliqué tel quel à l'instant de la copie, puis chacun vit sa vie (modifier
  l'un ne touche pas l'autre — pas de lien synchronisé).
- Quand je réordonne un calque → son masque le suit (une seule action annulable).

### Masques — sources (vague 1)

- **Pinceau qualité Photoshop** : diamètre, dureté, flow réglables, fluide à 60fps.
- **Dégradé** linéaire/radial : angle, points de départ/fin, feather, inversion.
- **Luminosité / plage tonale** : masquer selon les tons de la photo (ombres / tons
  moyens / hautes lumières), avec courbe de tolérance.
- **Range mask couleur** : je pointe une couleur de référence dans la photo, un
  curseur de **tolérance / dureté** génère un **masque continu** (pas binaire) qui
  suit cette couleur. Je peux **cumuler plusieurs prélèvements dans la MÊME source
  couleur** (comme Lightroom : plusieurs échantillons fusionnés, une seule
  tolérance/dureté globale gouverne l'ensemble) — utile pour une plage de tons
  proches (ex. un ciel dégradé). Distinct du masque luminosité.

### Masques — affinage (vague 1)

- **Refine edge (forme du masque seulement)** : appliquer à **n'importe quel
  masque**, quelle que soit sa source — **feather** (adoucir le bord),
  **contracter / dilater** le bord, **lisser**. Opère sur le masque lui-même,
  indépendamment de l'image. C'est un **ajustement live sur le masque combiné
  final** (pas cuit dans une source) : si j'ajoute une source ensuite, le refine
  edge se ré-applique au nouveau résultat combiné.

### Présentation UI

- Quand je travaille → calques, paramètres d'effet et masque sont accessibles
  ensemble. **L'organisation et le ressenti exacts se décident sur maquette
  visuelle rendue, pas verbalement** (constat d'interview : « montre-moi »).

## Différé (hors scope de cette vague, avec trigger de réouverture nommé)

Chacun est écarté **de cette vague seulement**, pas abandonné — trigger nommé pour
rouvrir la décision :

- **Depth mask** (masquer selon la distance au sujet). Nécessite une source de
  profondeur qu'un JPEG n'a pas → un **modèle de vision monoculaire local**
  (type MiDaS / Depth-Anything : image→depth map, ~50 Mo–1,5 Go, runtime ONNX/
  WebGPU, inférence à l'ouverture — **pas un LLM**). Chantier ML packaging à part.
  **Trigger** : une fois les masques de base (pinceau/dégradé/luminosité/couleur)
  livrés et validés, ouvrir un **spike depth dédié** (tester une variante légère
  hors app sur de vraies photos) avant toute intégration.
- **Pen/path Bézier** (détourage vectoriel point par point). Plus gros coût
  d'implémentation, recoupe partiellement lasso + refine edge. **Trigger** : si,
  à l'usage réel, lasso + refine edge ne suffisent pas pour un détourage précis.
- **Sélection géométrique (rectangle / ellipse)**. Recoupe partiellement le
  dégradé radial déjà prévu. **Trigger** : si un besoin de masque géométrique net
  (bord dur) apparaît, non couvert par dégradé + pinceau.
- **Lasso (libre / polygonal, puis magnétique)**. **Trigger** : si isoler une
  région arbitraire au tracé devient un besoin récurrent que le pinceau ne couvre
  pas confortablement. La variante **magnétique** (accroche aux contours) est un
  cran au-dessus, à traiter après le lasso simple.
- **Refine edge — accroche aux contours de l'image** (edge-aware : le bord du
  masque s'aligne sur les contours de contraste de la photo). **Trigger** : si le
  refine edge « forme seule » livré ne suffit pas pour des bords complexes.
- **Refine edge — décontamination couleur de bordure** : **écarté** (pas différé) —
  modifie les pixels de l'image, ce qui n'a pas de sens quand un masque ne fait que
  **doser un effet** dans le modèle shaderlab.

## Hors-scope explicite (autres)

- **Refonte des effets eux-mêmes** : les plages de paramètres « extrêmes »
  ressenties trop légères = chantier EFFETS adjacent, pas le système de calques
  (noté pour un PRD séparé).
- Round-trip Lightroom (déjà cadré ailleurs).
- Workspace multi-photo / pellicule (déjà cadré).
- Pan/zoom du canvas (feature sœur, PRD séparé du 2026-07-18).
- **Choix final de la direction visuelle du chrome** (dials VARIANCE / MOTION /
  DENSITY) → à décider sur options rendues en prototype, hors de ce PRD.

## Contraintes d'inacceptable

### Inacceptable (projet) — réutilisable par les futures features

- **Latence** : un paramètre peut mettre jusqu'à ~100 ms, mais **peindre un
  masque DOIT suivre à 60fps**. En-dessous = échec. (Deux budgets perf distincts
  selon le geste.)
- **Empilement** (les trois sont des planchers) : aucune dérive couleur/lumière
  due à l'empilement lui-même (bords sombres, halos, banding) ; opacité, masque
  et désactivation **exacts** ; **résultat identique à un logiciel de référence**
  pour un même ordre de calques. → compositing en **espace linéaire strict**,
  toutes textures couleur en `rgba8unorm-srgb`, pas de gamma manuel en WGSL.
- **Qualité** : pas de rendu « filtre Photoshop 2005 » (déjà acté, CLAUDE.md).
- **Validation** : la correction visuelle se juge **à l'œil, par checkpoint
  humain** ; jamais affirmée sans avoir été vue (constat récurrent d'interview).

### Inacceptable (feature calques & masquage)

- Perdre **silencieusement** un masque construit ou un réglage de calque =
  inacceptable (c'est du vrai travail utilisateur).
- Un masque **range couleur** doit rester **continu** (dégradé de valeurs), jamais
  réduit à un binaire dur — sinon le rendu redevient « cheap ».
- La combinaison de sources (add/subtract/intersect) doit être **exacte et
  prévisible** : le masque affiché en overlay = exactement ce qui dose l'effet.

## Terminé = démontrable

Checkpoint visuel humain (Antoine valide dans la vraie fenêtre WebView2, jamais
affirmé sans avoir été vu) :

### Calques (repris du 2026-07-16)

1. Démontrer opacité + les ~12 modes de fusion sur une **pile réelle**, comparés
   **visuellement** à un logiciel de référence (mêmes résultats).
2. Démontrer réordonner / dupliquer / grouper + undo, le masque suivant le calque.
   Pour un **groupe**, démontrer que son opacité / blend / masque s'appliquent bien
   au résultat aplati de ses enfants (comparé visuellement à un logiciel de
   référence).

### Masquage (delta 2026-07-18)

3. **Masque combiné multi-sources** : construire un masque sur un vrai calque en
   cumulant plusieurs sources (ex. dégradé + range couleur + retouche pinceau) avec
   add/subtract/intersect, et voir le résultat correct dans l'overlay.
4. **Range couleur continu** : pointer une couleur + régler tolérance/dureté →
   masque continu qui suit la couleur dans la photo, fluide.
5. **Refine edge sur n'importe quel masque** : appliquer feather + contracter/
   dilater + lisser sur un masque (peu importe sa source) et voir le bord se
   transformer correctement.
6. **Pinceau Photoshop-grade + dégradé + luminosité** démontrés, tous fluides
   (repris du 2026-07-16).
7. **Différés documentés** : depth mask, pen/path, géométrique, lasso,
   accroche-contours — chacun reste listé en section « Différé » avec son trigger
   de réouverture nommé (pas juste oubliés).

## Annexe — Choix techniques déduits (validés avec Antoine)

Déduits de l'usage, validés en fin d'interview (2026-07-16 puis 2026-07-18) :

### Calques (2026-07-16)

- **Modes de fusion** : implémentés en shader de compositing WebGPU/WGSL (déjà en
  place), en espace linéaire (cohérent avec `rgba8unorm-srgb`).
  ⚠️ **Tension réelle à trancher au brainstorming** : certains modes Photoshop
  (overlay, soft light…) sont définis en espace **gamma** dans Photoshop —
  respecter à la fois « match référence » ET « linéaire strict » demande un choix
  explicite (formule linéaire assumée, ou conversion ciblée par mode).
- **Opacité + `blendMode`** : à ajouter au modèle `LayerState` (aujourd'hui
  absents) et à l'historique (une entrée par ajustement, borné).
- **Groupe = conteneur avec compositing imbriqué** (opacité/blend/masque propres
  sur le résultat aplati des enfants). ⚠️ **Pièce la plus lourde de la vague** :
  introduit un vrai niveau de compositing imbriqué (aplatir un sous-arbre de
  calques avant d'appliquer opacité/blend/masque du groupe) — le brainstorming
  devra décider s'il constitue une **tranche d'implémentation séparée** (le reste
  de la vague — blend par calque, masques combinables — ne dépend pas des groupes
  et peut se livrer/valider avant).
- **Pinceau Photoshop-grade** : enrichir `MaskPainter` (flow, courbe de dureté) en
  gardant le 60fps comme plancher dur.
- **Organisation UI** : partir de l'inspecteur droit actuel (3 sections), itérer
  sur **maquette rendue** — aucune décision verbale.

### Masquage — modèle de composition (2026-07-18)

- **Un masque par calque = un seul buffer/texture de masque** (modèle actuel), les
  sources y écrivent successivement → réutilise le pipeline masque existant, rien
  de neuf côté stockage.
- **Combinaison add/subtract/intersect = opérations sur le buffer masque**
  (union/max, soustraction, intersection/min) appliquées par source ajoutée →
  réalise le modèle Lightroom validé.

### Masquage — sources & affinage (2026-07-18)

- **Range mask couleur = passe shader** mesurant la distance colorimétrique de
  chaque pixel à la/aux couleur(s) de référence, courbe tolérance/dureté → masque
  continu. Calcul **en espace linéaire** (couleur de référence échantillonnée dans
  les données linéaires) → respecte « linéaire strict ».
- **Refine edge (forme seule) = passes shader sur le masque** : feather (flou),
  contracter/dilater (morphologie érosion/dilatation), lisser — indépendant de
  l'image, donc transversal à tous les masques.
- **Toutes les nouvelles sources produisent le même format de masque que le
  pinceau** (même `Uint8Array`/texture) → overlay, inverser, désactiver, copier,
  suivre-le-calque réutilisés tels quels.

### Pattern d'extension (2026-07-18)

- **Registry étendu** : comme les effets (modules autonomes dans
  `src/render/effects/registry.ts`), les **sources de masque** et les **modes de
  blend** deviennent chacun un module/snippet enregistré → en ajouter un = un
  nouveau fichier, zéro modif moteur/UI. Répond à la question ouverte du PRD
  2026-07-16 (« ce pattern s'applique-t-il aussi aux blend et aux sélections ? » →
  oui). À confirmer/concevoir précisément au brainstorming.

---

**Prochaine étape** : PRD prêt → lancer `superpowers:brainstorming` pour concevoir
le COMMENT — en tranchant notamment (1) la tension modes-de-fusion / espace
linéaire, (2) le pattern registry pour blend + sources de masque, (3) le
comportement de combinaison exact (ordre des opérations, stockage de la liste de
sources vs masque aplati), (4) l'organisation UI sur maquette rendue.
