# Lesquels des cinq différés de masquage entrent dans ce palier

Type: grilling
Status: resolved
Parent: ../map.md

## Question

`docs/superpowers/specs/2026-07-18-shaderlab-layers-masking-prd.md` a différé
**cinq** capacités de sélection, chacune avec un déclencheur nommé. Aucune n'a
été rouverte depuis. Elles ne sont ni au ROADMAP, ni dans les mémoires projet —
elles n'existent plus que dans ce PRD.

1. **Depth mask** — masque par profondeur. Déclencheur : « spike dédié après
   masques de base ». Les trois masques de base (`gradient`, `luminosity`,
   `colorRange`) sont livrés, câblés et verrouillés par référence de pixels
   depuis le 2026-08-05 : **le déclencheur a été atteint.** ⚠️ Le PRD est
   explicite sur le moyen : un modèle de vision monoculaire LOCAL type
   MiDaS / Depth-Anything, **PAS un LLM**.
2. **Segmentation sémantique** sujet / ciel / arrière-plan — même famille, même
   nature de dépendance (un modèle embarqué).
3. **Pen / path Bézier**.
4. **Sélection géométrique** rect / ellipse.
5. **Lasso** libre, polygonal, magnétique.

**Lesquelles entrent dans ce palier, et lesquelles sortent en portée ?**

## Ce qu'il faut interroger

- **Le déclencheur atteint ne vaut pas décision.** Le depth mask est *éligible*,
  pas *décidé* : embarquer un modèle de vision change la nature du produit
  (taille du binaire, licence des poids, temps d'inférence, dépendance ONNX ou
  équivalent côté Rust). C'est une décision de produit avant d'être technique.
- **Les 3, 4 et 5 se recoupent avec un chantier de cette carte.** « Sélection
  géométrique rect/ellipse » et « pen/path » ressemblent beaucoup à ce que
  [Une forme a-t-elle besoin de `contentSource`](03-une-forme-a-t-elle-besoin-de-contentsource.md)
  interroge — une forme qui MASQUE au lieu de PEINDRE. Si les formes arrivent,
  ces deux différés changent de coût du tout au tout. La question de portée se
  pose donc maintenant, pas après.
- **Le cahier de postproduction pousse dans le même sens.** Son point 5 dit que
  « plusieurs recettes demandent une GÉOMÉTRIE posée sur l'image, pas des
  curseurs », et note que le patron existe déjà (`CanvasControl`, gabarit de
  section `pose`, la source posée de `lensFlare`).
- **Une capacité déjà couverte ne se réécrit pas.** Règle du dépôt, payée deux
  fois : le doublon se MESURE avant de s'écrire, et la mesure répond souvent
  deux choses. Avant de retenir l'un de ces cinq, vérifier ce que les trois
  sources de masque existantes font déjà.

## Contrainte dure

Le PRD a aussi **ÉCARTÉ** (pas différé) la décontamination de couleur de
bordure, parce qu'elle modifie l'image et sort du modèle « le masque DOSE un
effet ». Ce modèle est la frontière : toute capacité retenue ici doit produire
un masque, jamais toucher les pixels.

## Addendum du 2026-08-11 — une SIXIÈME, qui n'a jamais été différée

Trouvée en résolvant
[Quelles fonctions compléteraient les nôtres](10-quelles-fonctions-completeraient-les-notres.md),
puis vérifiée indépendamment :

**Le dégradé RADIAL du masque n'a jamais été livré.** Le PRD le donnait en
vague 1, pas en différé —
`docs/superpowers/specs/2026-07-18-shaderlab-layers-masking-prd.md:76` :
« **Dégradé** linéaire/radial : angle, points de départ/fin, feather,
inversion. » Sur disque, `src/mask/sources/gradient.ts` s'annonce « Dégradé
linéaire » et ne porte aucun radial.

⚠️ **Elle n'est pas de la même nature que les cinq ci-dessus**, et c'est ce qui
la rend intéressante. Les cinq ont été différées **exprès**, avec un
déclencheur écrit. Celle-ci a été promise puis **livrée à moitié**, et aucun
document ne le signalait — ni le ROADMAP, ni `INDEX.json`, ni le ledger. Elle
a passé 24 jours invisible.

Le PRD ajoute par ailleurs (ligne 124) que le dégradé radial était le motif
donné pour DIFFÉRER la sélection géométrique rect/ellipse — « dégradé radial
déjà prévu ». Le motif ne tient donc plus : le point 4 de la liste ci-dessus se
juge en sachant que sa justification de report n'a jamais existé en code.

## Une sortie de portée est une réponse valide

Pour chacune des cinq, la réponse peut être « hors de portée de ce palier ».
Auquel cas elle va dans la section **Out of scope** de la carte avec sa raison
— jamais dans *Decisions so far*, qui n'enregistre que la route parcourue.

---

## Answer — RÉSOLU le 2026-08-18

**Quatre des six étaient déjà tombées avant qu'on ouvre ce ticket.** Il n'en
restait qu'une question, et elle part en recherche.

### 3, 4 et 5 sont hors portée depuis le 2026-08-17, et personne ne l'avait vu

Pen/path Bézier, sélection géométrique rect/ellipse et lasso : c'est **mot pour
mot** ce que la carte a mis hors portée en sortant l'outil de sélection, la
veille, en résolvant le [ticket 03](03-une-forme-a-t-elle-besoin-de-contentsource.md).
L'entrée *Out of scope* dit : « Antoine ne s'arrête pas à la primitive
géométrique — il veut **détourer à la main, tracer une silhouette, combiner des
régions** ».

| Différé du PRD | Formulation de la sortie de portée |
| --- | --- |
| 5. Lasso libre / polygonal / magnétique | « détourer à la main » |
| 3. Pen / path Bézier | « tracer une silhouette » |
| 4. Sélection géométrique rect / ellipse | « la primitive géométrique », nommée |

Ce n'est pas une exclusion de valeur mais de TAILLE : un outil de sélection est
un palier à lui seul, avec sa propre carte. Les trois y vont **ensemble**, et
c'est cohérent — ils ne diffèrent que par le geste, pas par ce qu'ils
produisent.

⚠️ **Ce ticket a donc été écrit sur une question que la carte allait résoudre
ailleurs**, et sans le lien rien ne l'aurait signalé : une décision prise dans
un ticket peut clore le contenu d'un autre sans citer son numéro. Le repérage ne
peut pas venir d'une recherche par identifiant — il vient de relire ce que la
décision DIT.

### L'addendum (dégradé radial) est LIVRÉ

Le ticket le donnait « promis en vague 1, livré à moitié, invisible depuis 24
jours ». Il ne l'est plus : `22c8049 feat(masque): le degrade radial, promis en
vague 1 et livre a moitie`, **2026-08-14**. Sur disque, `gradient.ts` s'annonce
« Dégradé LINÉAIRE OU RADIAL » et porte `[6]=mode (0 linéaire, 1 radial)`.
Verrouillé par **deux** références de pixels — `masque-degrade-radial` et son
témoin — donc pas seulement écrit : prouvé.

Conséquence pour le point 4, qui n'a plus d'objet mais mérite d'être notée : sa
justification de report (« dégradé radial déjà prévu ») a cessé d'être fausse
entre l'écriture de ce ticket et sa résolution.

### 1 et 2 : la seule vraie question, et elle part en recherche

Depth mask et segmentation sémantique demandent la même chose — un modèle de
vision monoculaire LOCAL embarqué. Le déclencheur du depth mask **est atteint**
(les trois masques de base sont livrés, câblés et verrouillés depuis le
2026-08-05), mais le ticket avait raison de dire qu'un déclencheur atteint ne
vaut pas décision.

**Arbitrage d'Antoine : ni entrée ni sortie de portée — une recherche d'abord.**
Personne n'a les chiffres qui rendent la décision produit possible : taille et
surtout **licence des POIDS** (l'app est distribuée), runtime d'inférence côté
Rust et ce qu'il ajoute au binaire, résolution réelle d'évaluation et coût du
ré-échantillonnage sur les contours, et la piste propre à ce dépôt — une
inférence dans le `GPUDevice` WebGPU qu'il tient déjà.

Sorti en [ticket 29](29-ce-que-coute-un-modele-de-vision-embarque.md),
`Type: research`, lancé le jour même.

Mesure d'ancrage prise ici pour cadrer l'écart : les dépendances Rust actuelles
sont **six crates légères** (`serde`, `serde_json`, `tauri`, `rfd`,
`percent-encoding`, `image`), sans rien de ML.

### Contrainte que la recherche doit respecter, et qui vient d'ici

Le PRD pose que **le masque DOSE un effet et ne touche jamais les pixels** —
c'est au nom de cette frontière qu'il a ÉCARTÉ (et non différé) la
décontamination de couleur de bordure. Toute capacité retenue doit produire une
carte scalaire 0..1, jamais une image retouchée.

Second point dur, mesuré ici : `MaskSourceModule`
(`src/mask/sources/types.ts`) est une union **FERMÉE** à trois entrées, dont le
WGSL reçoit `params: array<f32, 8>` et rend un flottant. Une source qui
dépendrait d'une TEXTURE calculée hors shader n'entre pas dans ce contrat tel
qu'il est écrit.
