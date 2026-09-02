# 25 — lensBlur : « les autres paramètres ne font virtuellement rien »

**What to build:** Retour d'Antoine au grilling du 2026-08-27, sens VISUEL
confirmé (pas la cadence) : à l'usage, seul le rayon de `lensBlur` compte —
les autres curseurs paraissent inertes.

Se trie AU PIXEL avant toute correction (même méthode que `warp` D11 et
`sliceShift`) : balayer chaque paramètre de son min à son max à rayon 8, 24
et 60, compter les canaux d'écart de chacun. Trois issues possibles par
paramètre, et la mesure décide : course morte réelle (corriger le shader),
course écrasée par le rayon (remapper ou conditionner), paramètre vivant mais
subtil (rien à corriger, peut-être un défaut mal calibré).

Rappel outillage : `--applicabilite` ne mesure que les déclarations de la
table ; ici c'est un balayage ad hoc (scénarios temporaires render-check ou
mesure directe par l'app + signature). `lensBlur` porte 12 params dont
`bladeCurvature` (défaut 0) et le couple highlightThreshold/Boost.

**Blocked by:** None (can start immediately).

**Status:** ready-for-human — mesure faite, un défaut corrigé, trois arbitrages
rendus à Antoine (§ Ce qui est PROPOSÉ).
**Type:** research

- [x] Table mesurée : param × rayon → % de canaux d'écart sur mire à bokeh.
- [x] Tri : mort / écrasé / vivant-subtil, avec la correction proposée par cas.
- [x] Corrections appliquées (`fieldAngle` en Iris), `test:render` en conséquence
      (aucun écart : la correction est déclarative, elle ne touche aucun pixel).
- [ ] Re-jugé par Antoine à l'usage.

Note : le probe de cadence en production (ticket 14) reste PRÊT mais n'est
plus l'urgence — la préoccupation exprimée est l'ergonomie, pas la vitesse.

---

## Protocole (2026-09-02)

Instrument : `.scratch/retour-usage-execution/assets/mesure-25-lensblur.mjs`
(rejouable ; `--tour2` pour les mesures de périodicité). Iframe sur
`render-check-page.html` du Vite du worktree — module map vierge, donc les
modules servis sont ceux du DISQUE. Aucun IPC, aucune écriture dans l'app.

**Mire.** Points lumineux ISOLÉS de 1 à 3 px sur un fond à 10 %, quinze points
en cinq colonnes réparties sur toute la largeur (de quoi laisser mordre
`fieldCenterX`), trois teintes en lignes, plus une bande de dégradé en bas.
C'est le piège historique de cet effet : sous un damier, un lens blur rend
exactement ce que rendrait un gaussien, et la forme du diaphragme comme la
pondération des hautes lumières y mesureraient toutes zéro — pas parce qu'elles
sont mortes, parce que la mire est aveugle.

**Métrique.** Deux rendus identiques à un paramètre près, `exportFrame` des deux
côtés. `%` = canaux RGB dont l'écart dépasse 1 LSB (l'alpha est exclu, il est
constant et diluerait le compte d'un quart) ; `moy` = écart absolu moyen sur
tous les canaux RGB.

**Contrôle de déterminisme** : deux rendus du même état rendent `0,00 %,
max 0`. La spirale de collecte est tournée par un hash du pixel, donc
reproductible — sans ce contrôle, tout le tableau serait du bruit.

**Bornes égales par symétrie** : `bladeRotation` et `fieldAngle` vont de 0 à
360°, et 0 vs 360 est le MÊME angle. Ces deux-là se balaient 0 vs 37.

---

## Table mesurée — course entière, par rayon

Référence d'amplitude, indépendante du rayon courant :

| course du rayon | % canaux | moy | max |
|---|---|---|---|
| `radius` 0→120 (course entière) | **72,55 %** | **14,58** | 229 |
| `radius` 0→8 | 3,77 % | 1,51 | 197 |
| `radius` 8→24 | 11,56 % | 3,21 | 173 |
| `radius` 24→60 | 36,78 % | 7,11 | 171 |
| `radius` 60→120 | 73,40 % | 9,63 | 158 |

Les onze autres, course entière, dans le contexte du DÉFAUT puis dans un
contexte qui ACTIVE le paramètre (`%` canaux, `moy` entre parenthèses) :

| paramètre | course | contexte | rayon 8 | rayon 24 | rayon 60 |
|---|---|---|---|---|---|
| `blades` | 0→12 | défaut | 0,82 % (0,04) | 3,53 % (0,16) | 10,95 % (0,53) |
| `blades` | 0→3 | défaut | 3,44 % (0,50) | 10,85 % (1,94) | 34,71 % (4,77) |
| `bladeRotation` | 0→37 | **défaut (`blades`=0)** | **0,00 % (0)** | **0,00 % (0)** | **0,00 % (0)** |
| `bladeRotation` | 0→37 | `blades`=6 | 1,05 % (0,06) | 3,92 % (0,22) | 14,82 % (0,87) |
| `bladeCurvature` | 0→1 | **défaut (`blades`=0)** | **0,00 % (0)** | **0,00 % (0)** | **0,00 % (0)** |
| `bladeCurvature` | 0→1 | `blades`=6 | 2,15 % (0,16) | 7,59 % (0,56) | 22,00 % (1,53) |
| `highlightThreshold` | 0→1 | défaut | 3,16 % (0,73) | 10,48 % (2,53) | 34,53 % (5,89) |
| `highlightBoost` | 0→20 | défaut | 2,33 % (0,83) | 8,33 % (3,12) | 32,40 % (7,61) |
| `fieldShape` | 0→2 (Iris) | défaut | 1,62 % (0,29) | 5,12 % (0,96) | 15,96 % (2,03) |
| `fieldShape` | 0→3 (Radial) | défaut | 1,67 % (0,22) | 5,19 % (0,84) | 16,65 % (1,83) |
| `fieldCenterX` | 0→1 | **défaut (Uniforme)** | **0,00 %** | **0,00 %** | **0,00 %** |
| `fieldCenterX` | 0→1 | Iris | 1,09 % (0,33) | 3,46 % (0,98) | 10,58 % (2,39) |
| `fieldCenterY` | 0→1 | **défaut (Uniforme)** | **0,00 %** | **0,00 %** | **0,00 %** |
| `fieldCenterY` | 0→1 | Iris | 1,55 % (0,33) | 4,55 % (1,08) | 13,44 % (2,34) |
| `fieldAngle` | 0→37 | **défaut (Uniforme)** | **0,00 %** | **0,00 %** | **0,00 %** |
| `fieldAngle` | 0→37 | **Iris** | **0,00 %** | **0,00 %** | **0,00 %** |
| `fieldAngle` | 0→37 | Linéaire | 1,79 % (0,47) | 5,43 % (1,35) | 16,57 % (2,80) |
| `fieldRange` | 0,01→1,5 | **défaut (Uniforme)** | **0,00 %** | **0,00 %** | **0,00 %** |
| `fieldRange` | 0,01→1,5 | Iris | 3,77 % (1,51) | 11,87 % (4,24) | 37,60 % (8,96) |
| `fieldFeather` | 0→1 | **défaut (Uniforme)** | **0,00 %** | **0,00 %** | **0,00 %** |
| `fieldFeather` | 0→1 | Iris | 1,49 % (0,50) | 4,24 % (1,36) | 13,26 % (2,94) |
| `fieldFeather` | 0→1 | Radial | 1,56 % (0,24) | 4,41 % (0,87) | 14,07 % (1,99) |

### Segments de course (où l'action se trouve)

| segment | contexte | rayon 8 | rayon 24 | rayon 60 |
|---|---|---|---|---|
| `blades` 0→3 | défaut | 3,44 % | 10,85 % | 34,71 % |
| `blades` 3→6 | défaut | 3,04 % | 9,32 % | 29,90 % |
| `blades` 6→12 | défaut | 1,85 % | 6,52 % | 18,81 % |
| `blades` 10→12 | défaut | — | 1,78 % | 7,54 % |
| `highlightThreshold` 0→0,3 | défaut | 0,87 % (0,04) | 3,03 % (0,12) | 5,59 % (0,29) |
| `highlightThreshold` 0,3→0,6 | défaut | 2,73 % (0,24) | 9,29 % (0,85) | 30,21 % (2,05) |
| `highlightThreshold` 0,6→1 | défaut | 2,20 % (0,46) | 7,68 % (1,56) | 26,17 % (3,55) |
| `highlightBoost` 0→6 | défaut | 2,20 % (0,46) | 7,68 % (1,56) | 26,17 % (3,55) |
| `highlightBoost` 6→13 | défaut | 2,10 % (0,23) | 7,48 % (0,93) | 26,02 % (2,34) |
| `highlightBoost` 13→20 | défaut | 1,97 % (0,14) | 7,17 % (0,63) | 24,88 % (1,72) |
| `bladeCurvature` 0→0,5 | `blades`=6 | 1,49 % | 5,27 % | 15,58 % |
| `bladeCurvature` 0,5→1 | `blades`=6 | 1,46 % | 5,57 % | 16,32 % |
| `bladeCurvature` 0,9→1 | `blades`=6 | — | 1,12 % | 4,43 % |
| `fieldRange` 0,01→0,5 | Iris | — | 7,65 % (2,08) | 25,32 % (4,51) |
| `fieldRange` 0,5→1,0 | Iris | — | 5,59 % (2,20) | 16,69 % (5,03) |
| `fieldRange` 1,0→1,5 | Iris | — | **0,27 % (0,12)** | **0,56 % (0,23)** |

### Périodicité (second tour)

| couple | contexte | rayon 24 | rayon 60 |
|---|---|---|---|
| `bladeRotation` 0→30 (demi-période) | `blades`=6 | 4,12 % | 15,43 % |
| `bladeRotation` 0→60 (1 période) | `blades`=6 | **0,00 %** | **0,00 %** |
| `bladeRotation` 0→120 (2 périodes) | `blades`=6 | **0,00 %** | **0,00 %** |
| `bladeRotation` 0→360 (6 périodes) | `blades`=6 | **0,00 %** | **0,00 %** |
| `bladeRotation` 0→72 (1 période) | `blades`=5 | **0,00 %** | **0,00 %** |
| `bladeRotation` 0→120 (1 période) | `blades`=3 | **0,00 %** | **0,00 %** |
| `fieldAngle` 0→90 | Linéaire | 7,16 % | 21,55 % |
| `fieldAngle` 0→180 (1 période) | Linéaire | **0,00 %** | **0,00 %** |
| `fieldAngle` 0→360 (2 périodes) | Linéaire | **0,00 %** | **0,00 %** |
| `fieldAngle` 0→90 | **Iris** | **0,00 %** | **0,00 %** |
| `fieldAngle` 0→180 | **Iris** | **0,00 %** | **0,00 %** |

---

## Tri

### Le bac « écrasé par le rayon » est VIDE

Aucun paramètre n'agit à petit rayon pour s'éteindre à grand, ni l'inverse.
Les onze montent tous MONOTONEMENT de 8 à 24 à 60, d'un facteur 3 à 4 par
palier — c'est-à-dire au même rythme que le rayon lui-même. Le rayon n'écrase
personne ; il est simplement le seul dont la course entière déplace 72,55 % des
canaux quand la meilleure des autres en déplace 37,60 %.

L'hypothèse du ticket (« course écrasée par le rayon → remapper ou
conditionner ») ne trouve donc aucun cas.

### Mort réel, et cause structurelle — 1 cas

**`fieldAngle` en Iris : 0,00 % sur trois couples (0 vs 37, 0 vs 90, 0 vs 180)
× trois rayons, max 0 les neuf fois.** Ce n'est pas une faiblesse de mire, c'est
une identité : `lens_field` fait tourner l'écart au centre puis n'en prend que
la LONGUEUR — et une rotation conserve la norme. L'iris est un disque PARFAIT
dans l'espace corrigé de l'aspect, et tourner un disque ne fait rien.

Le commentaire du shader affirmait « net à l'intérieur d'une ELLIPSE, dont
l'allongement vient de l'aspect du cadre de réglage » : prémisse fausse.
`aspectScale` est appliqué à `d` AVANT la rotation — c'est justement ce que la
correction d'aspect sert à obtenir. L'infobulle (« Oriente … l'ellipse (Iris) »)
et l'`appliesWhen` (`equals: [1, 2]`) répétaient la même erreur.

**Et « ellipse » est faux aussi, MESURÉ et non déduit du code** (le code seul
m'a fait écrire deux fois de suite qu'elle était « elliptique en espace
écran »). Sonde : damier de 2 px, Iris à `fieldRange` 0,35, `fieldFeather` 0,05,
toile 512×340 — franchement non carrée — puis amplitude locale sur 8 px pour
trouver la frontière net/flou. Résultat : **demi-largeur nette 142 px,
demi-hauteur nette 142 px**. Un DISQUE parfait à l'écran (amplitude 215 au
centre, 2 dans le coin : la sonde a du signal). En pixels,
`|d| = distance / √(W·H)`, donc l'iris est rond quel que soit le format — c'est
tout ce que la correction d'aspect sert à faire. Trois infobulles portaient le
mot « ellipse » ; les trois sont corrigées.

⚠️ Ma première sonde a rendu « 1 px des deux côtés » : elle comparait deux
pixels VOISINS dans un damier de 2 px, qui sont égaux une fois sur deux. Un
détecteur cassé rend un chiffre, pas une erreur.

⚠️ **Pourquoi la campagne d'applicabilité ne pouvait pas l'attraper.** Elle
éprouve une déclaration là où le paramètre est dit INERTE. `lensBlur.fieldAngle`
n'y avait que Uniforme et Radial — les deux cas justes. Un `appliesWhen` trop
LARGE est l'angle mort de cet instrument : il ne regarde jamais le côté
« VIVANT » de la déclaration. Même motif que
`un-compte-n-est-pas-une-couverture`.

### Mort par le DÉFAUT, pas par le shader — 2 cas visibles, 5 masqués

À la configuration par défaut, le panneau montre **sept** curseurs
(`radius`, `blades`, `bladeRotation`, `bladeCurvature`, `highlightThreshold`,
`highlightBoost`, `fieldShape`) — les cinq du Champ sont masqués par
l'`appliesWhen` de leur section, ce qui est correct.

**Deux de ces sept sont exactement morts : `bladeRotation` et `bladeCurvature`,
0,00 % aux trois rayons.** Cause : `blades` vaut 0 par défaut, donc le
diaphragme est CIRCULAIRE, et un cercle n'a ni orientation ni courbure d'arête.
Les deux redeviennent parfaitement vivants dès `blades` ≥ 3 (jusqu'à 22,00 % à
rayon 60 pour la courbure).

C'est la moitié de la section **Diaphragme** — la première que l'utilisateur
voit — inerte à l'ouverture, et sans rien qui le signale à l'écran hors la
queue de deux infobulles. C'est l'explication mécanique la plus directe de « les
autres paramètres ne font virtuellement rien » : les deux curseurs juste sous
`Rayon`, ceux qu'on essaie en second, ne font littéralement rien tant qu'on n'a
pas d'abord relevé `Lames`.

Les cinq du Champ sont dans le même cas (`fieldShape` = Uniforme ⇒ 0,00 %) mais
ils sont MASQUÉS, donc ils ne trompent personne.

### Course déclarée plus longue que la course utile — 2 cas (motif D11)

**`bladeRotation`, 0..360 déclaré, 0..360/n utile.** À six lames : 0 vs 60,
0 vs 120 et 0 vs 360 rendent tous 0,00 %, quand la demi-période 0 vs 30 rend
4,12 % (r24) et 15,43 % (r60). Cinq sixièmes de la course rejouent le premier
sixième. Vérifié aussi à 5 lames (0 vs 72 = 0,00 %) et 3 lames (0 vs 120 =
0,00 %).

**`fieldAngle` en Linéaire, 0..360 déclaré, 0..180 utile.** 0 vs 180 et 0 vs 360
rendent 0,00 %, 0 vs 90 rend 21,55 % à rayon 60. La bande est symétrique : la
seconde moitié de la course rejoue la première.

⚠️ **`maxFrom` N'EST PAS le remède, contrairement à `sliceShift.edgeFeather`.**
`ParamPanel` écrête la valeur AFFICHÉE (`Math.min(brut, plafond)`), ce qui est
juste pour une course SATURANTE — au-delà, l'effet ne bouge plus — et faux pour
une course PÉRIODIQUE : 300° à six lames rend l'image de 0°, pas celle de 60°.
Un plafond à 60 montrerait le pouce à fond de course sur un rendu qui est celui
du début, et un preset stocké au-dessus serait mal relu. On échangerait un
mensonge contre un autre. Un correctif demande une **course périodique
déclarable** (le pouce reboucle, la valeur se replie) : mécanisme à arbitrer,
pas borne à poser.

### Vivant, non linéaire — rien à corriger

- **`blades` 0→12 lit 3,53 % quand `blades` 0→3 lit 10,85 %** : la course
  entière mesure MOINS que son premier quart. Ce n'est pas un défaut, c'est la
  physique — `blades`=0 est un cercle et `blades`=12 un 12-gone, dont le rayon
  ne dévie du cercle que de 3,4 % (`cos(π/12)`=0,966). Les deux BOUTS de la
  course sont donc presque la même image, et la forme est maximale au milieu-bas
  (le triangle). Le max déclaré est légitime. Conséquence d'usage réelle : qui
  compare les deux extrémités conclut que le curseur ne fait rien — il faut le
  traverser. `blades` 10→12 reste distinguable (7,54 % à rayon 60).
- **`highlightThreshold` : premier tiers quasi muet.** 0→0,3 rend 0,87/3,03/5,59 %
  avec un max de 4 à 5 LSB, contre 25 LSB pour 0,3→0,6. Cause : le seuil est
  DÉCODÉ vers le linéaire (`srgb_to_linear(0,3)` = 0,073), décodage voulu et
  documenté — c'est lui qui a réparé le bright-pass du glow. ⚠️ Ce chiffre est un
  PLANCHER : ma mire est un fond à 10 % plus des points saturés, donc presque
  rien n'y vit entre 0 et 0,073 linéaire, et sa bande de dégradé est invariante
  sous un flou symétrique. Sur une vraie photo pleine de tons moyens le bas de
  course mordrait davantage. **À ne pas traiter en course morte sur cette
  mesure-là.**
- **`highlightBoost` : décroissant mais jamais mort.** Chaque tiers rend ~60 % du
  précédent (moy 3,55 → 2,34 → 1,72 à rayon 60), et 15→20 déplace encore 22,22 %
  des canaux. Comportement attendu d'une pondération `1 + boost·x` normalisée par
  la somme des poids : elle tend vers une moyenne purement pondérée par les
  hautes lumières. Rien à corriger.
- **`bladeCurvature` : la course la mieux répartie de l'effet.** 0→0,5 = 15,58 %
  et 0,5→1 = 16,32 % à rayon 60, et 0,9→1 mord encore (4,43 %).
- **`fieldRange` : dernier tiers quasi mort — mais seulement CENTRÉ.** 1,0→1,5
  rend 0,27/0,56 % contre 25,32 % pour le premier tiers. Cause : sur une toile
  512×340 avec un centre au milieu, la distance corrigée au coin vaut ~0,9, donc
  dès `range` ≈ 1,0 tout est déjà net. **Ce n'est PAS D11** : avec le centre
  poussé dans un coin la distance double, et 1,5 redevient utile. Un `maxFrom`
  correct devrait lire `fieldCenterX/Y` ET l'aspect de la toile — or `maxFrom` ne
  reçoit que des paramètres, jamais l'état de la toile. Non exprimable, et non
  souhaitable. Laissé tel quel.
- **`fieldCenterX/Y`, `fieldFeather`, `fieldShape`** : vivants dans tout contexte
  qui a un champ, à des amplitudes comparables entre eux.

---

## Ce qui a été CORRIGÉ (mécanique, sans arbitrage)

`src/render/effects/lensBlur.ts` + `scripts/applicabilite-table.mjs` :

1. `fieldAngle.appliesWhen` : `equals: [1, 2]` → **`equals: [1]`**. Le curseur ne
   s'affiche plus en Iris, où il est prouvé inerte par construction ET par
   mesure. Correction DÉCLARATIVE : elle ne touche aucun pixel.
2. Infobulle de `fieldAngle` corrigée (elle promettait d'orienter une ellipse) et
   complétée de la période de 180° du mode Linéaire.
3. Infobulle de `bladeRotation` complétée de la période de 360°/n — le seul
   porteur possible aujourd'hui, `appliesWhen` exigeant une cible à `choices` et
   `blades` étant un curseur continu.
4. Commentaire de la branche IRIS du shader : la prémisse « ellipse allongée par
   l'aspect » est remplacée par la démonstration (rotation ⇒ norme conservée) et
   la mesure.
5. Infobulle de `fieldShape` : « zone nette elliptique » → « circulaire », et
   « les QUATRE réglages suivants » → la section Champ (il y en a CINQ, le compte
   était faux depuis le début).
6. Infobulle de `fieldRange` : « rayon de l'ellipse » → « rayon du disque net »,
   et « en fraction de la plus petite dimension de la toile » → **√(largeur ×
   hauteur)**, qui est ce que `aspectScale` normalise réellement. La formule
   annoncée n'était pas celle du shader.
7. `applicabilite-table.mjs` : configuration **Iris** ajoutée à
   `lensBlur.fieldAngle` dans le même geste, comme la règle CLAUDE.md l'impose —
   sans quoi la nouvelle déclaration serait non éprouvée en silence.

**Aucun index de `params[]` n'a bougé, aucune référence de pixels n'est
déplacée.**

Gates : `npx tsc --noEmit` OK · `npm run lint` OK · `npm run test` 2080/2080 ·
`npm run test-storybook` 335/335 · `npm run test:render` **aucune régression de
rendu** (0 des 124 références déplacée — le gate discriminant d'un travail de
panneau) · `render-check --applicabilite --declaration lensBlur.fieldAngle` :
**inerte** sur les trois configurations, dont Iris avec un effet actif sur 9,7 %
des canaux (donc verdict concluant, pas une configuration morte).

---

## Ce qui est PROPOSÉ (décision d'Antoine)

1. **`blades` : défaut 0 → 6.** C'est la correction la plus directe du retour
   d'usage : elle rend vivants d'un coup les deux curseurs morts de la section
   Diaphragme, et 6 est ce que le fichier appelle lui-même « l'hexagone des
   objectifs courants ». Changer un défaut ne déplace AUCUNE référence (les trois
   scénarios `effet-lens-blur*` posent `blades: 6` explicitement). Mais ça change
   l'allure de l'effet à l'ouverture — bokeh hexagonal au lieu de rond : c'est un
   choix esthétique, donc pas le mien.
2. **Course périodique déclarable**, pour `bladeRotation` (période 360/n) et
   `fieldAngle` en Linéaire (période 180). `maxFrom` ne convient pas (§ ci-dessus).
   Ce serait un troisième genre de borne à côté de `max` et `maxFrom`, à peser
   contre son coût : deux paramètres du registre en bénéficieraient.
3. **Iris vraiment elliptique** — un allongement réglable que `fieldAngle`
   orienterait, ce que l'infobulle promettait depuis toujours. C'est une
   fonctionnalité (un paramètre de plus, en fin de `params[]`, et des références
   déplacées), pas la correction du constat. Si elle est retenue,
   `fieldAngle.appliesWhen` revient à `[1, 2]` et la configuration Iris sort de
   la table d'applicabilité.
4. **`appliesWhen` sur un SEUIL** (ici `blades` ≥ 3), qui masquerait
   `bladeRotation` et `bladeCurvature` sur un diaphragme circulaire. Le fichier
   explique pourquoi il ne le fait pas (voie A : `appliesWhen` exige une cible à
   `choices`, et cette exigence EST la garantie qu'on relise ce qui commande
   quoi). Ouvrir la voie au seuil est une décision de mécanisme ; la proposition
   1 résout le même symptôme sans y toucher.

## Ce que la mesure NE dit pas

Elle mesure des canaux déplacés, pas de la beauté. Un curseur à 22 % d'écart
peut rester inintéressant à l'œil, et un à 4 % peut être exactement le réglage
qui compte. Le tri ci-dessus sépare le MÉCANIQUE (mort, redondant, mal borné) du
reste ; le jugement d'usage reste à Antoine, case 4.
