# Le coût du verre, mesuré et jamais instruit

Type: task
Status: open

> ✅ **La mesure de PRODUCTION est prise (2026-08-14), et elle déplace la
> question.** Ce n'est ni le mortier, ni l'arête, ni le moulage, ni la
> géométrie des cellules : c'est le **déplacement** que le pavé produit, qui
> disperse les lectures de texture. Une lecture dispersée coûte ~25 fois une
> lecture cohérente sur cette photo. Voir le bloc « Mesuré en production »
> plus bas ; les pistes d'origine sont conservées, avec ce que la mesure en
> dit maintenant.

## Question

`glass` est de loin l'effet le plus cher du registre, et personne ne l'avait
mesuré. Combien coûte-t-il réellement, et que peut-on lui retirer sans lui
retirer ce qui le rend crédible ?

## Ce qui l'ouvre

Antoine, le 2026-08-13, devant l'app : « tout est super laggy c'est normal ? »
— en regardant un Pavé quadrillé. Non, ce n'est pas normal.

## Mesuré

Build de développement, photo de 26 Mpx, Pavé quadrillé, vrai glissement souris
à 125 Hz sur le premier curseur du panneau :

| Diffusion | Cadence |
| --- | --- |
| 16 prélèvements (poussés puis annulés le jour même) | **10,0 images/s** |
| 9 prélèvements | **15,9 images/s** |

Les 16 taps coûtaient donc **37 %** — annulés aussitôt, la spirale isotrope
étant conservée à 9 taps (c'est elle qui corrige le grain du Dépoli, et elle ne
coûte rien de plus que l'ancien étalement sur un axe).

**Mais 15,9 images/s est déjà le problème, et il est antérieur.** Ordre de
grandeur par pixel, sur un pavé : ~9 lectures pour la diffusion, 3 pour la
dispersion, **5 pour l'ambiance du mortier** — près de 450 millions de lectures
de texture par image à 26 Mpx.

⚠️ **Mesuré en DÉVELOPPEMENT, où le plancher est 2,6× celui de la production**
(15,4 ms contre 6,2 ms de travail synchrone par événement). La règle payée le
même jour sur le ticket 07 s'applique : une mesure en dev prouve qu'un coût
existe, jamais qu'il est négligeable — et ici elle ne sert qu'à établir
l'existence. **Le chiffre en production reste à prendre**, et c'est la première
chose à faire.

## Mesuré en production — 2026-08-14

**Protocole.** Build de production (`npm run tauri build -- --no-bundle`, donc
`target/release`), photo de **26 Mpx** (6240×4160, canvas à la résolution
native), un calque d'effet Glass sur le calque photo, **vrai glissement de
souris** par CDP `Input` (un `mousePressed`, 300 `mouseMoved` espacés de 4 ms,
un `mouseReleased`), sur le curseur **Épaisseur** et sur sa course centrale
(25 % → 75 %) — le même réglage et la même course dans TOUTES les lignes, pour
que seule la configuration diffère. Trois passes après un échauffement, médiane
rapportée. Instrument : **`scripts/perf-probe.mjs`**, écrit pour ce ticket et
versionné (les deux mesures de perf précédentes ont dû réécrire le leur).

**Ce qu'on compte** : les images RÉELLEMENT présentées, par instrumentation de
`GPUCanvasContext.getCurrentTexture` dans la page. Témoin de discrimination
posé dans la même session : le même calque en effet **Grain** rend
**149 images/s**, donc l'instrument sait rendre un grand nombre.

### Le résultat, et il ne désigne pas ce qu'on croyait

| Configuration (tout le reste par défaut) | Cadence | Fil principal |
| --- | --- | --- |
| témoin — effet **Grain** | **149 img/s** | 60 % |
| Verre, **Cannelé simple** (feuille) | **67,6 img/s** | 50 % |
| Verre, **Pavé · Quadrillé** | **10,1 à 11,7 img/s** | 7 à 11 % |

**Facteur 6 entre une feuille et un pavé**, et l'occupation du fil principal
s'EFFONDRE quand on passe au pavé : le goulot est le GPU, pas le JavaScript.
Le chiffre de 15,9 images/s relevé en développement n'était donc pas un
artefact de plancher — la production ne rattrape rien.

### Ablations : ce qui ne coûte RIEN

Chaque réglage mis à zéro, cumulativement, sur le Pavé quadrillé :

| Ablation | Cadence |
| --- | --- |
| référence (défauts) | 11,7 |
| `Largeur du mortier` = 0 | 11,3 |
| + `Profondeur de l'arête` = 0 | 11,7 |
| + `Moulage interne` = 0 | 11,6 |
| + `Dispersion` = 0 | 15,4 |

Les trois ornements du pavé — mortier, arête, moulage — ne coûtent **rien de
mesurable**. Le bloc d'ambiance du mortier est d'ailleurs gardé dans le shader
(`if (masqueMortier > 0.001)`), donc ses cinq lectures ne sont payées que sur
les pixels de joint : la piste « cinq `verre_lire` par pixel du joint » de ce
ticket surestimait sa part.

### Ce qui coûte : le DÉPLACEMENT, pas la géométrie

`Creux` règle l'amplitude du relief, donc du déplacement de réfraction. Sur le
Pavé quadrillé, toutes choses égales par ailleurs :

| Creux | 0 | 0,1 | 0,25 | 0,5 (défaut) | 0,75 | 1 |
| --- | --- | --- | --- | --- | --- | --- |
| Cadence | **66,9** | 47,0 | 23,3 | 14,4 | 9,9 | 10,1 |

**À déplacement nul, un pavé coûte exactement ce que coûte une feuille** (66,9
contre 67,6). Toute sa géométrie — les trois évaluations de `verre_hauteurPave`
pour la différence finie, la mosaïque, les hachages de variété par cellule — est
donc **gratuite** à l'échelle de la mesure. Ce qui coûte, c'est là où les
lectures vont.

### La confirmation, par une expérience jetable

Boucle de `verre_traverser` ramenée de **9 prélèvements à 1**, build de
production refait, mesure, puis retour à 9 et **mesure de contrôle** (10,1 —
la même qu'avant, donc l'expérience n'a rien laissé derrière) :

| Configuration | 9 taps | 1 tap |
| --- | --- | --- |
| Pavé quadrillé, défauts (9 + 3 lectures) | 10,1 | **23,8** |
| Pavé quadrillé, dispersion 0 (9 + 0 puis 1 + 0) | 11,4 | **54,4** |
| Cannelé simple (feuille) | 67,6 | 64,8 |

Deux choses s'y lisent, et la seconde est la plus utile :

1. **Sur une feuille, les neuf prélèvements sont GRATUITS** (67,6 contre 64,8 :
   l'écart est dans le bruit). Le nombre de lectures n'est pas le sujet — leur
   ADRESSE l'est.
2. **Sur un pavé, le temps est proportionnel au nombre de lectures.** 12, 4 et
   1 lectures donnent 99, 42 et 18 ms par image : la droite passe par
   **~7,4 ms par lecture** plus ~11 ms de plancher. Sur la feuille, les mêmes
   12 lectures tiennent dans 14,8 ms au total — soit **~25 fois moins par
   lecture**.

**Le mécanisme est donc la cohérence de cache.** Un pavé déplace fort et de
façon divergente d'un pixel au suivant ; en prime, l'étalement des taps vaut
`diffusion * 0.25 + length(d) * 0.10`, donc un grand déplacement ÉLARGIT encore
la spirale. Les neuf lectures partent alors chacune de son côté, et chaque
lecture manque le cache.

### Ce que ça change pour les pistes

- **Mipmap pour la diffusion** (piste 2 de ce ticket) : c'est la bonne piste, et
  pour une raison plus forte que « moins de travail » — un niveau grossier rend
  les lectures LOCALES en plus d'être moins nombreuses. C'est le seul levier qui
  attaque les 7,4 ms par lecture au lieu de les compter.
- **Mipmap pour l'ambiance du mortier** (piste 1) : sans objet, la mesure
  montre que ce bloc ne coûte rien.
- **« Le coût est-il payé quand il ne sert pas ? »** (piste 3) : oui pour la
  diffusion — la boucle des neuf taps n'a **aucune garde**, elle tourne même à
  `Diffusion` = 0 (vérifié dans le code ET par la mesure : 13,8 contre 14,8, rien).
  Non pour la dispersion, qui a la sienne (`if (disp > 0.001)`).
- **« Les cinq pavés sont le pire cas »** (piste 4) : vrai, mais pas par ce
  qu'ils ajoutent — par ce qu'ils déplacent.

⚠️ **La cible de cadence reste à décider, et c'est un arbitrage.** 10 images/s
sur 26 Mpx est inutilisable au pointeur ; 60 demanderait de diviser le coût par
six. Rien ici ne dit s'il faut viser le confort à pleine résolution, ou accepter
que les matières à fort déplacement soient lentes sur une photo de 26 Mpx.

## Session du 2026-08-15 — un instrument, un coût par matière, et une attribution FAUSSE corrigée

### Ce qui existe maintenant et n'existait pas

**Le temps GPU se mesure PAR PASSE** (`src/render/gpuTiming.ts`, `0e56a79`).
Jusque-là le dépôt avait deux instruments et aucun ne voyait le GPU :
`frameDiagnostics` rend `jsEncodeMs` — du temps d'ENCODAGE JS, qui peut afficher
2 ms pendant que le GPU en passe 60 — et `perf-probe.mjs` rend une cadence
murale pour la pile entière. Ni l'un ni l'autre ne sait dire QUELLE passe coûte.

Capture à la demande, une frame à la fois : éteint, aucun `timestampWrites`
n'est attaché et rien n'est alloué. Armé depuis le pont de debug
(`__shaderlabDebug.capturerTimingGpu`). ⚠️ Il **n'ordonne pas de rendu** — on
arme, PUIS on provoque un vrai geste, sinon on mesure une frame fabriquée par la
sonde.

⚠️ **L'instrument déduit sa propre granularité** (PGCD des valeurs brutes) :
Chromium quantifie les timestamps GPU, et le pas mesuré ici est **65 536 ns**, et
non les 100 µs annoncés partout. Une passe sous ce pas rend 0, jamais un chiffre
inventé. Le PGCD n'a de sens qu'à partir de plusieurs passes — sur une seule il
rend la valeur elle-même.

### Coût GPU par matière — 14 matières, photo 24 Mpx, build de dev

Toutes choses égales par ailleurs, seule la matière change. Minimum sur 3
captures (une durée GPU est bruitée vers le haut, jamais vers le bas).

| Matière | ms | Matière | ms |
| --- | --- | --- | --- |
| Dépoli | 15,5 | Pavé · Lisse | 25,1 |
| Cannelé simple | 15,7 | Pavé · Ondulé | 26,5 |
| Cannelé croisé | 16,3 | Martelé | 31,2 |
| Gaufré | 16,7 | Aluminium brossé | 51,3 |
| Poli | 18,4 | Écorce | 64,0 |
| Cathédrale | 21,9 | Pavé · Nuage | 74,8 |
| | | Pavé · Alvéolaire | 95,0 |
| | | **Pavé · Quadrillé** | **108,3** |

**Facteur 7 entre la moins chère et la plus chère.** Cohérent avec le facteur 6
feuille/pavé mesuré en production plus haut.

⚠️ **Croisement utile pour le bloc « aspect du verre » du ROADMAP** : trois des
quatre matières les plus chères — Quadrillé, Alvéolaire, Nuage — sont
**exactement celles qu'Antoine a refusées à l'œil**. Les deux chantiers visent le
même code dans la même fenêtre. À l'inverse le **Dépoli est la MOINS chère de
toutes** : son problème est esthétique, pas de coût.

### ⚠️ L'attribution que cette session a tirée de ces chiffres était FAUSSE

J'ai conclu du facteur 7 que le poste dominant était la **fonction de matière**
(l'en-tête de `glass.ts` dit qu'elle est évaluée trois fois par pixel en
différences finies pour la normale), et j'allais recommander de la réécrire en
dérivées analytiques.

**L'ablation `Creux` du bloc de production ci-dessus dit le contraire** : à
déplacement nul, un pavé coûte exactement ce que coûte une feuille (66,9 contre
67,6). Toute la géométrie — les trois évaluations comprises — est donc gratuite à
l'échelle de la mesure. Le facteur 7 par matière ne mesure pas la complexité du
calcul, il mesure **combien chaque matière DÉPLACE**, donc à quel point ses
lectures divergent.

**La leçon de méthode** : un classement par coût ne donne pas la CAUSE du coût.
Il fallait une ablation, pas un tri. Le tri est arrivé le premier et il était
convaincant.

### Ce que ça condamne, et ce que ça confirme

⛔ **Dérivées analytiques : essayé, mesuré, REJETÉ.** `valueNoiseD` écrite
(dérivée exacte de notre `valueNoise` — l'interpolant `3f²−2f³` a pour dérivée
`6f(1−f)`), puis `verre_microRelief` réécrit : **9 appels de bruit ramenés à 3**,
36 hachages à 12. Résultat :

- **coût** : les 18 références de `glass` déplacées, jusqu'à `max 255, moyenne 7` ;
- **gain** : Dépoli 15,53 → 14,22 ms, soit 8 %, dans la bande de bruit.

Reverté. On ne réduit pas un coût de **cache** en retirant des multiplications —
et c'est la mesure de production ci-dessus qui explique pourquoi, pas le bruit de
la mienne. **Ne pas redémarrer cette piste**, ni sur `verre_microRelief` ni sur
`verre_hauteurPave`.

⚠️ Ce que l'essai a quand même établi et qui reste vrai : **la différence finie
de `verre_microRelief` n'est pas une dérivée**, c'est un passe-bas. Son pas de
0,0016 en espace `c` vaut ~0,3 CELLULE de bruit à l'échelle 190. L'apparence
actuelle du micro-relief a été réglée AVEC ce lissage. Si le chantier §1 rouvre
ces matières, c'est un paramètre de rendu déguisé en détail d'implémentation.

✅ **Mipmap pour la diffusion (piste 2) : la machinerie EXISTE maintenant.**
`src/render/mipmapGenerator.ts` a été écrit cette session — WebGPU n'a aucune
génération de mipmaps intégrée, il fallait la chaîne de blits. Elle sert
aujourd'hui les textures de bibliothèque, mais elle est générique. C'est la seule
piste qui attaque les 7,4 ms par lecture au lieu de les compter, et l'obstacle
d'implémentation est levé.

⚠️ Réserve à ne pas oublier en la reprenant : les cibles de ping-pong sont créées
à **un seul niveau** (`effectPassRunner`, `imageFrameResources`). Les mipmapper
coûte une chaîne de blits PAR FRAME, pas une fois au chargement — le calcul
gain/coût est donc à refaire, il n'est pas le même que pour un scan.

## Session du 2026-08-17 — le levier est en place, et il a été éprouvé ailleurs d'abord

✅ **`mipmapGenerator.ts` est sur `master`** (fusion de `mipmaps-bibliotheque`,
`068b574`). Son verdict a été rendu par la mesure que son propre commit
réclamait, et cette mesure dit quelque chose d'utile POUR CE TICKET : sur la
passe `texture`, scan 8192² et photo 26 Mpx,

| Minification | sans mips | avec mips |
| --- | --- | --- |
| ~2:1 | 3,01 ms | 2,42 ms |
| ~8:1 | 6,03 ms | 2,29 ms |
| ~20:1 | 5,05 ms | 2,23 ms |

**Le coût devient PLAT au lieu de croître avec la minification.** C'est exactement
la propriété qu'on vient chercher ici : ce ticket a établi qu'une lecture
dispersée coûte ~25 fois une lecture cohérente, et une pyramide est le seul
mécanisme mesuré qui ramène le coût à une constante. Le mécanisme est donc
prouvé sur un cas réel du dépôt AVANT d'être appliqué là où il coûtera 18
références de pixels.

⚠️ **Ce que cette mesure ne transporte PAS.** Là-bas la pyramide est construite
UNE FOIS au chargement du scan ; ici la source de `verre_lire` est une cible de
ping-pong (`effectPassRunner.ts:209`) recréée et réécrite à chaque frame. Le coût
de construction est donc payé PAR IMAGE et il n'est pas mesuré. La première chose
à faire n'est pas d'écrire le shader, c'est de **mesurer ce que coûte la chaîne
de blits sur une cible 6240×4160**, parce que c'est elle qui décide si la piste
tient : si générer la pyramide coûte plus que les 7,4 ms par lecture qu'elle
économise, la piste meurt là.

⚠️ **Et une prémisse fausse a été trouvée en chemin, qui vaut pour ici aussi.** La
branche justifiait ses mipmaps par « les scans sont échantillonnés à l'échelle de
l'ÉCRAN, un rapport de l'ordre de 1:8 ». Faux : `presentPass.ts:44` dit que le
canvas porte la résolution NATIVE de l'image et n'est réduit que par CSS. Tout
raisonnement de LOD dans ce dépôt doit partir de la résolution de la CIBLE DE
RENDU, jamais de la taille apparente à l'écran — s'en tromper fait surestimer un
gain d'un facteur 4 à 6.

⚠️ **Un défaut voisin, repéré et non traité** : `texture.ts:235` échantillonne
derrière un `fract` en gardant le LOD automatique — le même motif qui a forcé
`inkTexture` au niveau 0. Au réglage par défaut la couture tombe sur le bord du
cadre, donc sans conséquence ; dès que `Décalage X/Y` la ramène dans le cadre,
elle devient une ligne d'un pixel prise au mip le plus grossier. Non mesuré.

### Outillage d'itération disponible

`C:\dev\shadplay` (MIT, Bevy, nightly) est construit et vérifié, avec un harnais
maison : `assets/shaders/shaderlab-pave.wgsl` — champ de hauteur et pente des
cinq matières Pavé, nos fonctions copiées de `glass.ts` et `hash.ts`, `params[]`
remplacés par des constantes en tête de fichier, deux modes d'affichage
(hauteur en gris, pente signée en couleur). Validé par `naga` et chargé par
shadplay. Rechargement à chaud à l'enregistrement, au lieu du cycle complet de
shaderlab.

⚠️ Il est **hors du dépôt** : il ne survivra pas à un nettoyage de `C:\dev`.

## Pistes, non instruites

- **L'ambiance du mortier** : cinq `verre_lire` par pixel pour une moyenne
  très basse fréquence, recalculée à chaque pixel du joint. Un niveau de mipmap
  grossier donnerait la même valeur en une lecture.
- **La diffusion** : neuf lectures pleine résolution pour un flou. Un mipmap
  choisi selon le rayon de diffusion ferait le même travail en deux ou trois.
- **Le coût est-il payé quand il ne sert pas ?** La diffusion tourne-t-elle à
  rayon nul, la dispersion à dispersion nulle ? La dispersion a déjà sa garde
  (« à dispersion nulle ce bloc ne s'exécute pas »), les autres restent à
  vérifier.
- **Les cinq pavés ajoutent le mortier et l'arête** à tout ce que fait déjà une
  matière de feuille : ce sont eux le pire cas, pas le verre en général.

## ✅ Arbitrage d'Antoine, 2026-08-15 : on fait le mipmap de diffusion

Question posée : « le seul levier mesuré est de rendre les lectures locales
(mipmap de diffusion), ce qui CHANGE le rendu. On y va ? » — **réponse : oui**.
Les deux autres options ont été écartées explicitement : ne rien changer et
accepter ~10 images/s, ou baisser la résolution pendant le geste (qui
contredirait frontalement « pas de distinction preview/export, résolution native
toujours »).

Ce que ça engage, et qui est connu AVANT d'écrire la première ligne :

- le rendu change, donc les **18 références de pixels du verre** sont à
  régénérer et à **relire à l'œil** avant commit ;
- le résultat se juge devant une photo, pas devant un chiffre — trois des quatre
  matières les plus chères sont exactement celles qu'Antoine a refusées à l'œil ;
- `src/render/mipmapGenerator.ts` existe depuis le 2026-08-15 : la brique est là,
  elle a été écrite pour les scans de la bibliothèque de textures.

⚠️ **La CIBLE, elle, n'est pas tranchée.** 10 images/s est inutilisable au
pointeur ; 60 demanderait de diviser le coût par six. Rien dans les mesures ne
dit lequel des deux vise juste, et c'est un arbitrage d'usage, pas de
performance.

## Ce qui rendrait ce ticket raté

Optimiser sans mesurer d'abord en production — on ne saurait pas ce qu'on a
gagné, exactement comme la première mesure du feather qui concluait « +15 % »
sur un plancher qui noyait le signal.

Et retirer de la crédibilité pour gagner des millisecondes : l'absorption qui
verdit avec l'inclinaison, la dispersion sur les seuls flancs, le liseré
d'arête sont ce qui sépare ce verre d'une lentille en plastique. Le coût qu'on
retire doit être du travail INUTILE, pas du travail visible.

## Hors sujet ici

L'aspect des pavés (« très artificiel, 3D des années 90 » — la régularité
parfaite d'une cellule à l'autre) et celui du mortier sont un travail de RENDU,
pas de performance. Ils se traitent séparément.
