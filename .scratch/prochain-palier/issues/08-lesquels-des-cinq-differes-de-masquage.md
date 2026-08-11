# Lesquels des cinq différés de masquage entrent dans ce palier

Type: grilling
Status: open
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
