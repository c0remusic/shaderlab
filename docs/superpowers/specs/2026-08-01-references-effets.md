# Cahier de références des effets — 2026-08-01

À quoi chaque effet **devrait** ressembler, d'après des sources externes, comparé
à ce que le code fait **aujourd'hui** (`master@5a06faa`, 12 effets au registre).

Ce document ne remplace pas l'[audit du 2026-07-31](2026-07-31-audit-effets.md),
il lui succède. L'audit regardait le code contre lui-même (contrats, mesures,
dégénérescences). Celui-ci regarde le rendu contre le monde : la barre de qualité
de `CLAUDE.md` dit « pas de filtre Photoshop 2005 » sans dire à quoi comparer —
voici les comparaisons.

## État de l'audit précédent : déchargé

Vérifié sur disque avant d'écrire la suite, parce que `docs/INDEX.json` et le
ledger ont déjà menti :

| finding HAUTE de l'audit | statut au 2026-08-01 | preuve |
|---|---|---|
| effet sur calque photo → image noire | **fermé par décision**, pas par shader | ADR-0008 ; garde `layer.imageSource !== undefined` à `layerStack.ts:232` |
| `hash2` du warp sature en f32 | **corrigé** | `359d95e` — hachage entier de la maille, `warp.ts:44` |
| grain culmine dans les ombres | **corrigé** | `f7b5399` — décalage posé sur le ton perceptuel, `grain.ts:44` |
| coquille d'upsample du glow | **corrigé** | `0643c53` — tap central 4/16, `glow.ts:60` |
| deux correctifs proposés dangereux | finding de méthode, pas de code | — |

Deux lignes du tableau « barre de qualité » de l'audit sont donc **périmées** :
la chaîne du glow ne s'arrête plus à 1/8 (elle descend à 1/64) et son noyau de
remontée a bien un tap central. Ne pas les recopier.

---

## 1. Glow — la référence le coupe en deux

**Ce que disent les sources.** *Bloom* et *halation* ne sont pas le même
phénomène, et les confondre est précisément la signature d'un filtre bon marché.

- **Bloom / diffusion** : lueur douce et diffuse, halo « nacré » autour des
  hautes lumières, contraste global adouci. C'est le domaine des filtres
  physiques Pro-Mist / Black Pro-Mist / Glimmerglass.
- **Halation** : halo **rouge-orangé** propre au film argentique. La lumière
  traverse l'émulsion, se réfléchit sur les surfaces internes, revient filtrée de
  ses composantes bleues et vertes, et ré-expose surtout la couche **rouge**,
  la plus profonde. Conséquence tenue par la physique : au bord de la zone
  surexposée le halo tire **orange** (l'énergie pénètre encore la couche verte),
  et il vire au **rouge pur** en s'éloignant.
- **Orton vs diffusion** : l'effet Orton agit sur *toute* l'image, clairs comme
  sombres ; un filtre de diffusion ne relève que les zones brillantes. Deux looks
  distincts, pas deux dosages du même.

**Ce que fait le code.** `glow.ts` est un bloom de moteur de jeu propre :
bright-pass à seuil + genou, chaîne dual-filter 1/2→1/64→1/2, composite additif
en linéaire. Puis un `tintStrength` applique un **gain par canal uniforme** sur
tout le bloom, teinte par défaut hue 35 (orange) à 15 %.

**L'écart, et il est structurel.** Ce gain uniforme est une *imitation* de
halation qui ne peut pas en produire la signature :

1. **Pas de dégradé orange→rouge.** Un gain constant colore tout le halo de la
   même teinte. La transition orange-au-bord / rouge-au-loin est ce qui fait lire
   un halo comme de la halation plutôt que comme un voile coloré.
2. **Pas de dépendance au fond.** La halation ne se voit que sur fond sombre —
   Dehancer expose un contrôle dédié (*Background Gain*) pour ça. Le code n'a
   aucun équivalent : le halo teinté se pose aussi bien sur un ciel blanc.
3. **Un seul rayon.** Dehancer sépare *Local Diffusion* (taille géométrique des
   halos) et *Global Diffusion* (voile secondaire sur les demi-tons). Le code n'a
   que `spread`.
4. **Pas de garde-fou anti-fireflies.** La référence Jimenez (COD Advanced
   Warfare, SIGGRAPH 2014) impose une **moyenne de Karis** sur le premier
   downsample : sans elle, un sous-pixel très brillant se propage en artefact.
   Le bright-pass de `glow.ts` n'en a pas.

**Surface de contrôle de référence** (Dehancer, pour un futur effet halation) :
Source Limiter (seuil), Background Gain, Local Diffusion, Smoothness, Global
Diffusion, Amplify, Hue (0 = rouge pur → 100 = orange), Blue Comp.

**Conclusion.** Le vrai upgrade qualité du glow n'est pas un réglage de plus :
c'est de **retirer la teinte** pour en faire un bloom/diffusion assumé, et de
poser la halation comme effet séparé avec sa propre physique. Voir §7.

### LIVRÉ le 2026-08-01

**Glow redevient un bloom.** Les quatre paramètres de teinte
(`tintHue/Saturation/Lightness/Strength`) sont retirés, le composite est additif
et neutre. Rupture assumée sur les presets : un preset portant ces clés les garde
en mémoire mais elles ne sont plus jamais lues — `effectPassRunner` itère
`effect.params`, `presetDocument` conserve les clés inconnues sans les résoudre.
Aucun crash, et surtout aucun **contrôle inerte**, qui aurait été l'échec
silencieux que ce dépôt proscrit.

**Moyenne de Karis** posée sur le PREMIER downsample, et lui seul. La pondération
`1/(1+luma)` n'est pas conservatrice en énergie — à tous les niveaux elle
assombrirait tout le halo. Un seul suffit : passé la première réduction, un
firefly est déjà moyenné avec ses voisins. La somme est divisée par la somme des
poids **appliqués**, jamais par la constante 8 du noyau non pondéré (sinon
l'énergie fuit proportionnellement à la luminosité locale). Verrouillé par un
test qui compte les niveaux pondérés — il doit y en avoir exactement un.

**Halation devient un effet** (`halation.ts`), avec les trois propriétés que la
référence exige et qu'un gain de teinte ne pouvait pas tenir :

1. **La couleur du halo remplace celle de la source** — la couche rouge est
   ré-exposée, elle ne sait pas ce qui l'a exposée. Le bright-pass jette
   délibérément la couleur et ne garde qu'une énergie en niveaux de gris.
2. **Dégradé orange au cœur, rouge au loin** — dérivé de la MAGNITUDE du halo
   (`1 - exp(-m·transition)`) plutôt que d'une distance géométrique. Même fait
   physique lu autrement : la teinte suit l'énergie du retour lumineux, et
   l'énergie est exactement ce que la pyramide a calculé. Une distance en pixels
   aurait demandé un second champ, et aurait en plus été fausse — deux sources
   voisines s'additionnent.
3. **Effacement sur fond clair** (Background Gain de Dehancer), mesuré sur le ton
   PERCEPTUEL du fond. Sans lui, l'effet rosit les ciels blancs.

**Limite assumée** : pas de *Global Diffusion* ni de *Smoothness*. `passes` est
une chaîne strictement séquentielle dont seule la dernière sortie est exposée au
composite (`prevPass`) ; deux rayons simultanés demanderaient un changement de
moteur. Empiler deux calques halation aux portées différentes y supplée.

**Noyaux extraits** dans `effects/blurChain.ts` (downsample, downsample+Karis,
upsample paramétré). Même raison que `hash.ts` et `hsl.ts` : deux copies auraient
dérivé, et l'écart se serait lu comme un défaut d'optique alors qu'il n'aurait
été qu'un défaut de copier-coller. L'index du paramètre de portée est passé en
argument à `upsampleWgsl(n)` — un index recopié en dur lirait le mauvais curseur
au premier réordonnancement, panne SILENCIEUSE puisque le shader compile quel que
soit `n`. Verrouillé par test dans les deux effets.

---

## 2. Grain — deux écarts mesurables

**Ce que disent les sources.**

- Le grain d'un film couleur est **par couche**. « Les tons chair, le feuillage
  et le ciel excitent les trois couches dans des proportions différentes, et
  chaque combinaison produit une structure et une force de grain différentes.
  C'est pourquoi une plaque de grain fixe — même dépendante de l'exposition —
  paraît juste sur un mur gris et fausse sur un visage. »
- Le grain existe dans les ombres **et** dans les hautes lumières, mais jamais
  sur du noir pur ni du blanc pur (Dehancer).
- Le grain simulé sonne faux parce qu'il lui manque les corrélations de **phase
  et de densité** — un spectre de puissance correct ne suffit pas (Bournemouth).
- Le grain doit être **indépendant de la résolution**, défini dans le plan-film
  et non en pixels de sortie — c'est tout l'objet du modèle booléen d'IPOL, qui
  permet de zoomer jusqu'à voir les grains individuels.

**Ce que fait le code.** `grain.ts` calcule **un** scalaire de bruit et l'ajoute
identiquement aux trois canaux :

```wgsl
let perturbe = srgb_to_linear(tone + noise * intensity * response);
return vec4<f32>(color.rgb + vec3<f32>(perturbe - srgb_to_linear(tone)), color.a);
```

**Les écarts.**

1. **Grain monochrome.** `vec3<f32>(delta)` — le même delta sur R, G et B. C'est
   le tell le plus direct d'un grain numérique, et celui que la source FilmMatch
   décrit mot pour mot. Correctif : trois bruits décorrélés, pondérés par la
   contribution de chaque couche.
2. **Grain dépendant de la résolution.** `size` est en pixels de l'image source :
   `(uv * dims) / size`. La même valeur ne donne donc pas le même grain sur une
   photo 6 MP et sur une 24 MP — alors que le réglage prétend décrire une taille
   de grain physique.
3. **Structure trop régulière.** `valueNoise` est isotrope et lissé ; le grain
   réel est un empilement de cristaux de tailles variées. Écart réel mais le plus
   coûteux à combler, et le moins visible des trois.

⚠️ **Licence.** Le code de référence d'IPOL (Newson et al.) est en **GPL v3+**,
l'article en CC-BY-NC-SA. Inspiration et lecture seulement — aucune reprise
verbatim, conformément à la règle de `CLAUDE.md` sur les licences.

### LIVRÉ le 2026-08-01 — et le cadrage a changé en route

Ce document proposait d'abord de « décorréler les canaux ». Antoine a recadré :
c'est du bruit **analogique** qu'on veut, avec la possibilité de **basculer**
vers l'autre. Ce n'est pas le même produit — décorréler est un dosage, basculer
suppose deux phénomènes distincts. La référence en fournit quatre différences
nettes, et le grain porte désormais les quatre :

| | analogique (argentique) | numérique (capteur) |
|---|---|---|
| structure spatiale | `valueNoise` — corrélée, cristaux qui débordent du pixel | `hash` — bruit blanc, chaque photosite indépendant |
| maille | **indépendante de la définition** (le grain est dans le film) | **liée au pixel** (la grille est dans le capteur) |
| réponse tonale | maximale au demi-ton, nulle sur noir et blanc purs | maximale dans les **ombres**, jamais nulle (bruit de lecture) |
| chrominance | faible par défaut | marquée (taches rougeâtres/verdâtres) |

Trois axes orthogonaux en sortent, et c'est le vrai gain de conception : le
**mode** choisit la texture, la **chrominance** la couleur, l'**intensité** la
force. Deux normalisations d'amplitude tiennent cette orthogonalité, chacune
dérivée puis verrouillée par test :

- entre les deux modes — `valueNoise` a un écart-type relatif de 0,743 (calculé
  sur les poids `smoothstep`), sans quoi basculer renforcerait le grain de 35 % ;
- sur la course de chrominance — `Var = 1/3 + (2/3)t²`, sans quoi le curseur de
  couleur ferait aussi +73 % de force.

**Pourquoi un choix et pas un curseur.** Les deux réponses tonales sont
opposées. Interpoler entre elles donnerait une courbe qui ne modélise ni un film
ni un capteur — une moyenne de deux physiques n'est la physique de rien. C'est
mesuré dans le test, pas affirmé. À distinguer de `channelMixer.monochrome`,
délibérément continu parce que c'est le même calcul à deux dosages.

Ce besoin a fait naître **`EffectParam.choices`** (`effects/types.ts`), premier
paramètre à états nommés du projet : la valeur reste un nombre — l'uniform est un
`array<f32>` — mais l'interface ne montre jamais ce nombre. Rendu en `Select`
en ligne dans `ParamPanel`, validé par `validateEffect` (bornes accordées au
nombre de choix, exclusif avec `colorGroup`).

**Note d'histoire.** Le défaut corrigé en `f7b5399` faisait culminer le grain
dans les ombres. Il produisait donc, par accident, le comportement d'un capteur.
Ce qui était un bug est devenu un mode.

---

## 3. Chromatic bleed — aligné, sauf sur un phénomène

**Ce que disent les sources.** Deux aberrations distinctes :

- **Latérale (transverse)** : la magnification diffère selon la longueur d'onde.
  Croît du centre vers les coins, **absente au centre**, franges sur les zones de
  fort contraste, non corrigeable par la fermeture du diaphragme.
- **Longitudinale (LoCA, « bokeh fringing »)** : les longueurs d'onde ne
  convergent pas dans le même plan. Visible **partout, y compris au centre**, sur
  les transitions net/flou, et **réductible en fermant le diaphragme**.
- Le *purple fringing* est encore autre chose : un artefact de microlentilles de
  capteur numérique.

**Ce que fait le code.** `chromaticBleed.ts` modélise l'aberration **latérale**
correctement : direction radiale, magnitude normalisée par la distance au coin,
R et B décalés en sens opposés, G non décalé, calcul dans l'espace corrigé de
l'aspect. C'est juste, et c'est le meilleur alignement code/référence du registre.

**Le seul écart.** `centerPresence` prétend « part du décalage des coins déjà
présente au centre ». C'est un raccourci vers la LoCA — mais avec le mauvais
mécanisme : la LoCA n'est pas un décalage radial uniforme, c'est une frange
sur les transitions de netteté, dépendante du contraste local et non de la
position. Le paramètre produit un look plausible par un moyen faux ; s'il faut un
jour une vraie LoCA, ce sera un autre calcul (frange dépendante du gradient
local), pas un réglage de celui-ci.

---

## 4. Warp — pas d'écart de référence

Le FBM sur bruit à gradient (Inigo Quilez) est la construction canonique pour un
déplacement organique ; la référence produit (Photoshop Liquify) replie aussi le
champ aux réglages extrêmes. Rien dans les sources ne contredit le code.
La seule question ouverte reste esthétique, et elle est déjà posée par l'audit :
le repli aux extrêmes est-il une fin de course assumée ? Cela se tranche à l'œil.

---

## 5. Posterize — référence graphique, pas photographique

La référence est la **sérigraphie** : aplats d'encre, pas de dégradé. Une presse
ne reproduit qu'une cinquantaine de niveaux par encre, ce qui *impose* la
quantification au lieu de la simuler.

Le tramage Bayer du code est le bon geste. La question ouverte de l'audit — les
paliers doivent-ils se répartir sur l'axe linéaire ou perceptuel ? — n'est pas
tranchée par les sources : une presse quantifie sur la **densité d'encre**, ce
qui penche perceptuel, mais l'audit a **mesuré** que basculer éclaircit l'image
de 27 points sRGB à levels=2. Reste une décision de look, à prendre à l'œil,
pas une correction.

---

## 6. Duotone — la référence dit que ce n'en est pas un

**Ce que disent les sources.** Un duotone d'imprimerie, c'est **deux encres**,
chacune avec **sa propre courbe de tonalité** qui mappe chaque niveau de gris
vers un pourcentage d'encre. Le noir tient les ombres et les bas demi-tons ;
la seconde encre tient les hauts demi-tons et les hautes lumières. Le but
d'origine n'était pas de coloriser : c'était **d'étendre la plage tonale**,
chaque encre n'apportant qu'une cinquantaine de niveaux.

**Ce que fait le code.** `duotone.ts` interpole **trois** couleurs HSL
(ombres / ton moyen / hautes lumières) par deux `smoothstep` posés sur la
luminance perceptuelle, et **remplace** la couleur du pixel.

**Deux conséquences.**

1. Ce n'est pas un duotone : ni deux encres, ni courbes séparées, ni combinaison
   soustractive. C'est une rampe à trois arrêts — soit, littéralement, un
   *gradient map*.
2. **`duotone` et `gradientMap` font la même chose.** Vérifié ligne à ligne :
   les deux prennent trois arrêts HSL, positionnent sur `linear_to_srgb(luma)`,
   interpolent par `smoothstep` et écrivent le résultat. `gradientMap` est un
   **sur-ensemble** — il ajoute point noir, point blanc, position de l'arrêt
   moyen et préservation du modelé ; il ne lui manque que le `contrast` de
   duotone. Deux entrées du registre pour un seul effet.

**RÉSOLU le 2026-08-01 — et pas dans le sens que ce document proposait
d'abord.** La première rédaction concluait « retirer l'un des deux ». Antoine a
objecté que notre `gradientMap` ne fait pas ce que fait celui de Figma, et la
référence lui donne raison. Le gradient map de Figma expose :

| contrôle Figma | chez nous |
|---|---|
| éditeur de dégradé, arrêts libres (gauche = plus sombre, droite = plus clair) | **3 arrêts HSL figés** |
| espace de mélange : sRGB, **OKLab**, **OKLCH**, Linéaire | linéaire seulement |
| décalage (offset) de la rampe | absent |
| **répétition** — répète la rampe en bandes de couleur | absent |
| **type de répétition** : Mirror (bandes symétriques) ou Repeat (cycle néon à arêtes dures) | absent |
| **scatter** — casse le banding par une texture grain/risographie | absent |

La redondance avec `duotone` n'est donc pas une fatalité de conception : elle est
le symptôme de tout ce qui manque à `gradientMap`. Un gradient map avec
répétition, miroir et espace de mélange OKLab ne ressemble plus du tout à une
rampe à trois arrêts.

**Décision : on ne supprime rien.** On remonte `gradientMap` au niveau de sa
référence — la redondance se dissout d'elle-même. `duotone` reste libre de
devenir, plus tard, le vrai modèle deux encres à courbes décrit plus haut.

### LIVRÉ le 2026-08-01 (`6da8041`) — quatre lignes sur six

La description publiée par Figma nomme exactement trois contrôles : *« custom
gradients — control pattern repetition, offset, and color space »*.

| contrôle Figma | chez nous |
|---|---|
| *pattern repetition* | ✅ `Répétition` (1→12) + `Type de répétition` (Miroir / Répétition) |
| *offset* | ✅ `Décalage` (−1→1) |
| *color space* | ✅ `Espace de mélange` : sRGB, Linéaire, **OKLab, OKLCH** |
| scatter (visible sur leur aperçu) | ✅ `Dispersion` |
| *custom gradients* — arrêts libres | ❌ **reste** |
| espace de mélange sur les autres effets | ✅ module partagé `blendSpace` |

Le seul trou est l'éditeur d'arrêts libres, et il n'est pas de nature shader :
`array<f32, N>` est de taille fixe et `ParamPanel` ne sait rendre qu'un curseur,
un groupe de couleur ou une liste de choix. C'est un **nouveau genre de
contrôle**, donc un chantier d'interface.

Deux mesures faites en chemin, qui contredisent l'intuition et sont verrouillées
par `test/render/effects/blendSpace.test.ts` :
- **OKLab ne répare PAS le creux de saturation** entre deux complémentaires — il
  est même légèrement sous le linéaire (.058 contre .114 sur bleu→orange). Une
  DROITE dans le plan a/b passe près de l'origine quand les bouts sont opposés.
  C'est correct, et un test le verrouille contre une « correction » future.
- **Seul OKLCH tient le chroma** (×6,6 sur magenta→vert) : la teinte tourne au
  lieu de traverser l'axe achromatique. Ce qu'OKLab apporte est ailleurs — sa
  clarté de milieu est la moyenne perceptuelle exacte des bouts, là où le
  linéaire la surélève et le sRGB l'enfonce.

Réserve de look, à trancher : l'aperçu Figma porte un grain FRANC, qui fait le
rendu. Notre `Dispersion` est bornée à ±1/8 de rampe pour qu'un pixel ne
traverse pas un arrêt. Si c'est ce look qui est visé, c'est ce plafond qu'il
faut monter.

La leçon de méthode vaut d'être notée : « ces deux effets font la même chose »
était une conclusion tirée du CODE seul. Confrontée à la référence externe, elle
s'inverse — ce n'est pas un doublon, c'est un effet inachevé.

---

## 6quater. L'inventaire Figma de ce cahier était INCOMPLET — relevé le 2026-08-01

Corrigé après lecture directe de `figma.com/community/shaders`. ⚠️ **Correction
de la correction, le 2026-08-01 au soir** : la première rédaction de ce
paragraphe disait « le catalogue tient dix-neuf entrées ». C'est FAUX, et
l'erreur est instructive.

La page s'intitule « Shader **Effects & Fills** » et porte **deux onglets** :
`Effets` et `Remplissages`. Les dix-neuf ci-dessous sont la grille de l'onglet
**Effets**, qui est celui par défaut — l'onglet **Remplissages n'a jamais été
ouvert**, et son contenu reste inconnu.

La preuve était déjà dans le relevé du carrousel fait le même jour, sans qu'on
en tire la conséquence : il ÉTIQUETTE chaque vedette, et deux d'entre elles sont
des **Remplissages** (`Pattern grid`, `Moire`) qui ne figurent pas dans les
dix-neuf. La grille était donc bien filtrée. Une donnée qui contredisait
l'affirmation se trouvait dans le même relevé qui a servi à l'écrire.

Note de portée, à trancher avant d'aller y voir : un *remplissage* GÉNÈRE un
motif, là où nos effets TRANSFORMENT une photo. Ce n'est pas le même contrat
d'entrée (`fs_main(uv, color)` reçoit le composite en dessous), donc pas
forcément le même chantier — mais `Moire` (« line distortion, RGB separation,
optical interference ») décrit quelque chose qu'un calque d'effet saurait faire.

Les dix-neuf **effets** :

> Colored edges · Slice shift · Channel mixer · Outlines · Halftone · Hatching ·
> Bokeh blur · Bloom · Pixel stretch · Filter presets · Pattern refraction ·
> Gradient map · Lens distortion · Color adjust · Dither · Warp · Pixelate ·
> Chromatic metal · Gooey merge

**Sept n'apparaissent nulle part ailleurs dans ce cahier** : Colored edges,
Hatching, Filter presets, Pattern refraction, Color adjust, Chromatic metal,
Pixelate. Le §7 « effets candidats » a donc été écrit sur un inventaire partiel,
et sa dernière ligne (« Bokeh blur / Lens distortion / Dither restent au backlog
Figma ») sous-estime ce qui reste.

Deux descriptions obtenues de la page elle-même, à verser au dossier :
- **Pattern refraction** — « Simulate refracting light to create distortions
  like waves, zigzags, and lenticular patterns. » Proche de `warp` par le
  moyen, très loin par l'intention : ce sont des distorsions PÉRIODIQUES et
  optiques (lenticulaire), pas un bruit fractal.
- **Moire** (un remplissage, pas un effet) — « customizable line distortion,
  RGB separation, and optical interference effects. »

⚠️ **Limite de méthode, à ne pas oublier au prochain passage** : la page ne
publie la description que des QUATRE vedettes de son carrousel. La surface de
contrôle des quinze autres n'est lisible qu'en ouvrant chaque shader dans Figma,
donc avec un compte. **Et l'onglet `Remplissages` n'a pas été ouvert du tout** —
tout inventaire tiré de ce paragraphe ne couvre que les Effets. Les écarts du §6bis ci-dessous viennent d'une lecture
antérieure et n'ont PAS été revérifiés contre les fiches ; `warp` en particulier
est jugé « sans écart de référence » au §4 sans que le shader Figma du même nom
ait jamais été regardé (auteur : Miggi from Figgi). C'est un trou franc.

Demandés par Antoine le 2026-08-01 : **Hatching** (`5bb4ee2`) et
**Colored edges** (`65d34fb`) — LIVRÉS, conçus d'après leurs références de
domaine (gravure ; détection de contours) faute d'avoir pu lire leurs fiches.
L'écart avec la surface de contrôle de Figma est donc INCONNU pour ces deux-là,
et c'est écrit dans les deux fichiers.

### La famille des flous — CLOSE le 2026-08-01

Demandée par Antoine le même jour. Trois effets, et le découpage vient du §6ter :
le clivage n'est pas entre les cinq outils de la Blur Gallery mais entre le
NOYAU et ce qu'on en fait.

| outil Photoshop | chez nous |
|---|---|
| Lens Blur (noyau bokeh) | `lensBlur` (`942568b`) |
| Iris Blur, Tilt-Shift | `lensBlur` → géométries `Iris` et `Linéaire` |
| Field Blur | couvert autrement — le masque au pinceau par calque |
| Path Blur, Spin Blur, Radial (zoom) | `motionBlur` (`e2210ef`), trois trajectoires |
| Surface Blur / Smart Blur | `surfaceBlur` (`3f53b0d`) |
| **Gaussian, Box, Average** | **REFUSÉS**, et pas oubliés |

Le refus du gaussien mérite d'être écrit ici plutôt que découvert plus tard par
souci de parité : ce paragraphe même dit qu'il ne sert qu'à réduire le détail et
qu'il LAVE une photo. Le poser au registre serait livrer sciemment le rendu que
la barre de qualité du projet interdit. Un flou doux s'obtient déjà par
`lensBlur` à intensité de bokeh nulle. Un test du registre vérifie qu'aucun
`gaussianBlur` ni `boxBlur` n'y entre.

## 6bis. Les cinq autres effets Figma — écarts relevés au passage

Même source (catalogue « Built by Figma »), même méthode. À traiter après les
chantiers de §7, mais consigné pour ne pas le redécouvrir :

- **Outlines** — Figma expose un **mode d'entrée** : Luma / Luma inversé / Alpha.
  Le nôtre n'en a pas ; il déduit toujours de la luminance.
- **Gooey merge** — Figma expose mode d'entrée (Alpha ou Luminance), couleur de
  **premier plan** et de **fond**, inversion, et un *Source Mix*. Le nôtre a une
  tout autre surface (tension, fonte, liseré) : plus riche par endroits, mais
  sans le choix d'entrée ni les couleurs.
- **Channel mixer** — Figma expose un **espace de mélange** sRGB (vif) ou
  linéaire (doux) pour les zones de recouvrement. Le nôtre mélange en linéaire
  sans le dire ni offrir l'autre.
- **Pixel stretch** — pilotage par cercle sur la toile, paramètre `Offset` signé.
  Le nôtre a angle + position + portée, sans manipulateur direct.
- **Slice shift** — angle, écartement, aléa : aligné.

### DEMANDE D'ANTOINE, 2026-08-01 au soir — fondu des bords de tranche

> « Je voudrais pouvoir flouter les bords pour un effet dégradé dans slice
> shift. »

Aujourd'hui, la limite entre une tranche décalée et sa voisine est une COUPURE
FRANCHE. C'est la signature de l'effet — un décrochage, une déchirure — et
l'adoucir doit donc être un **paramètre à défaut 0**, comme tout ce qui a été
ajouté ce jour-là sur des effets déjà livrés. Sept paramètres aujourd'hui :
`angle`, `sliceSize`, `displace`, `density`, `irregular`, `chromaSplit`, `seed`.
Aucun ne touche au bord.

**Le piège à ne pas rater en l'implémentant.** Flouter la SORTIE ne donnera pas
ça : ça étalerait toute la tranche, alors que seul son BORD doit fondre. Ce
qu'il faut, c'est faire varier continûment le DÉCALAGE de part et d'autre de la
frontière — mélanger les deux coordonnées d'échantillonnage (celle de la tranche
et celle de sa voisine) sur une bande étroite, plutôt que mélanger leurs
couleurs. C'est la même distinction que celle qui fait qu'un `pixelStretch`
COMPRIME sa coordonnée au lieu de recopier des pixels : on déplace la lecture,
on ne floute pas le résultat.

Corollaire : le fondu doit se mesurer en pixels et non en fraction de tranche,
sinon une tranche fine se retrouverait entièrement fondue quand une épaisse ne
le serait qu'au bord.

#### LIVRÉ le 2026-08-02 — et LA NOTE CI-DESSUS AVAIT TORT

Huitième paramètre `edgeFeather`, défaut 0, en pixels, borné à l'épaisseur d'une
tranche. Mais **le mécanisme prescrit deux paragraphes plus haut a été essayé,
livré, puis retiré le jour même** — et il faut lire la suite en le sachant.

> **Verdict d'Antoine sur pièce, 2026-08-02 :** « l'effet est sympa mais c'est
> pas ce que je voulais, ça ressemble plus à du warping ». Puis : « pour que les
> bords deviennent moins nets », « sans être flous », « juste que la limite soit
> moins franche ».

Faire varier le DÉCALAGE continûment — ce que le paragraphe ci-dessus prescrit —
ne supprime pas la limite : ça **cisaille** le contenu de la bande, jusqu'à ~71°
de pente aux réglages testés. La revue adverse l'avait chiffré le matin même et
avait écrit noir sur blanc que la requalification de « flouter » en piège était
*un jugement visuel sans checkpoint humain*. Le finding était classé Important.
Il aurait dû bloquer : sur un effet visuel, « propriété visuelle non vérifiée »
n'est pas une remarque, c'est une porte fermée.

Les deux refus d'Antoine (ni cisaillement, ni flou) ne laissent qu'une lecture,
et c'est **exactement ce que la note appelait le piège** : un FONDU ENCHAÎNÉ.
Chaque tranche est échantillonnée à son propre décalage — donc reste nette — et
c'est le passage de l'une à l'autre qui devient progressif. Prix assumé : dans
la bande, on voit les deux tranches à la fois ; étroite, ça se lit comme un bord
adouci, large, comme une surimpression.

`sliceAmount()` reste extraite en fonction pure de l'index de tranche, et
`trancheEchantillonnee()` s'y ajoute pour que la tranche voisine passe par le
même chemin exactement — le fondu CHOISIT entre deux lectures franches au lieu
d'en inventer une troisième.

**Le verrou a été posé AVANT le geste**, et c'est ce qui rend la suite lisible :
`sliceShift` n'avait aucune référence de pixels, donc « le défaut à 0 ne change
rien » serait resté une affirmation. La référence a été écrite sur le code
d'avant, sur une RAMPE et non sur la mire commune — la propriété à montrer est
la marche de valeur à la frontière, et un damier saute déjà d'un texel à l'autre.

Les trois mesures, sur le couple de références (même graine, mêmes tranches, seul
le fondu diffère — c'est un A/B, pas deux images qui se ressemblent) :

| | coupure franche | fondu 16 px |
|---|---|---|
| largeur de transition, colonne x=128 | **1 ligne** aux 4 frontières | **13 à 15 lignes**, mêmes y |
| monotonie sur la bande de fondu | — | **oui** aux 4 |
| cœur des tranches (hors bande) | — | **18432/18432 canaux identiques, écart max 0** |

#### La revue adverse a cassé la preuve du piège — et elle avait raison

**Version d'abord publiée ici, et fausse :** « le cœur des tranches identique
prouve qu'on a mélangé des coordonnées et non des couleurs, puisqu'un flou de la
sortie aurait bougé ces pixels-là aussi ». Deux trous, tous deux relevés en revue
le 2026-08-02 :

1. Un cœur intact n'exclut qu'un flou **global**. Le piège nommé dans la demande
   est une opération **locale au bord** — et n'importe quelle opération locale au
   bord laisse le cœur intact par construction. On réfutait une implémentation
   que personne n'écrirait.
2. Plus grave : **sur une rampe affine, mélanger des coordonnées et mélanger des
   couleurs sont algébriquement la même chose**, `mix` commutant avec un
   échantillonneur affine. `mireRampe` est exactement affine ; seule la courbure
   du transfert sRGB les sépare, pour **0,03 niveau d'écart moyen** sur tout
   l'intérieur. La mire choisie était structurellement aveugle à la propriété
   annoncée. C'est le piège `lensBlur`, reproduit une journée plus tard.

**Deuxième tentative, ratée elle aussi** — et elle vaut d'être écrite parce que
l'intuition y mène tout droit : compter un **contraste** sur des rayures fines.
Un décalage fractionnaire passe par une interpolation bilinéaire, qui atténue
déjà les hautes fréquences (période 3 px à une fraction de 0,5 : transfert
exactement 0,5). Dans la bande de fondu le décalage balaie, donc la fraction
balaie, donc l'atténuation moyenne chute. Mesure : **-25 %**, contre **-29 %**
attendus d'un mélange de couleurs. Indiscernable. Un mélange de coordonnées perd
du contraste lui aussi.

**Ce qui tranche est structurel, pas quantitatif.** Un mélange de coordonnées
ressort *toujours* une valeur de la source ; un mélange de couleurs *fabrique*
une valeur intermédiaire partout où les deux copies diffèrent. Sur une mire de
barres **binaires** (16 px, deux niveaux, uniformes en y et sur toute la largeur,
`mireBarres`), la part de pixels intermédiaires se compte — au canal vert, le
seul que `chromaSplit` ne décale pas :

| | mesuré |
|---|---|
| bande de fondu | **3,67 %** |
| hors bande | 2,93 % |
| image fabriquée d'un mélange de couleurs | **17,56 %** |

Le seuil du test était posé à **8 %**, moyenne géométrique des deux réponses,
donc la même marge de 2,2× de chaque côté. La mauvaise implémentation a été
fabriquée depuis la référence elle-même et passée dans la métrique : **le verrou
a été vu rouge avant d'être committé vert.**

**Puis le même instrument a servi à vérifier le revirement**, quelques heures
plus tard, quand le verdict d'Antoine a fait du « mélange de couleurs » la bonne
réponse. Même mire, même métrique, seuil retourné :

| | mesuré |
|---|---|
| mélange de coordonnées (retiré) | 3,67 % |
| **fondu enchaîné (livré)** | **26,25 %** |
| hors bande, inchangé | 2,93 % |

Le seuil du test est maintenant leur moyenne géométrique, 10 %, franchie dans
l'autre sens. Ce test aurait donc rougi sur l'implémentation précédente.

Leçon de forme qui vaut au-delà de cet effet : **un test dont l'énoncé cite le
MÉCANISME est à jeter au premier changement de mécanisme ; un test dont l'énoncé
cite une MESURE survit et sert d'arbitre.** Le bloc de tests du profil de poids
(`test/render/effects/sliceShift.test.ts`) n'a pas bougé d'une ligne entre les
deux implémentations, pour la même raison.

Et les trois mesures du couple de rampes, qui vivaient en prose, sont devenues
des assertions dans `test/scripts/renderRefs.test.mjs` — sans quoi un `--update`
de bonne foi les aurait effacées en silence, ce que ce fichier existe pour
empêcher.

**Un choix que la demande ne tranchait pas : `smoothstep` plutôt qu'une rampe
linéaire.** Une rampe a une dérivée qui casse aux deux bords du fondu et y pose
deux plis fins — on aurait remplacé une coupure par deux marques. Smoothstep est
de pente nulle en 1, donc raccordé tangent au décalage constant de chaque
tranche. Le profil mesuré le confirme : deltas `1 1 2 2 2 3 3 3 2 3 3 2 2 1 1` à
la frontière y=128, lents aux extrémités et rapides au centre, là où une rampe
aurait donné 2 partout avec un angle à chaque bout.

Et le clamp à `sliceSize` n'est pas cosmétique : la bande de fondu est large de
`f/2` de chaque côté, donc au-delà les deux frontières d'une même tranche se
recouvriraient et il faudrait mélanger trois tranches à la fois.

#### Trois points restés OUVERTS, tous relevés par la même revue

Aucun n'est un effet de bord du fondu ; tous demandent un arbitrage d'Antoine.

1. ~~**Ce qui est livré est un CISAILLEMENT, pas un flou.**~~ **CLOS le
   2026-08-02 par le checkpoint d'Antoine**, et dans le sens que ce point
   redoutait : le cisaillement a été rejeté, remplacé par un fondu enchaîné.
   Le point était classé Important ; il aurait dû bloquer la livraison. Sur un
   effet visuel, « propriété visuelle non vérifiée » ferme la porte.
2. **`irregular` est non monotone et se sabote à son maximum.** `P(fusion) =
   irrégularité × (1 - irrégularité)` : le pic est à 0,5 et la valeur retombe à
   **zéro à 1,0**, où toutes les bandes adoptent et où aucune ne partage plus
   d'identité — donc le peigne que ce contrôle devait détruire revient intact.
   Corollaire du même mécanisme : l'adoption n'étant pas transitive, les
   épaisseurs sont **1x et 2x uniquement**, jamais 3x comme l'affirmait le
   fichier depuis son écriture. Défaut ANTÉRIEUR au fondu ; le corriger déplace
   des pixels sur un effet déjà livré. Les deux propriétés sont désormais
   testées (`test/render/effects/sliceShift.test.ts`) — le test **constate** le
   défaut, il ne le valide pas.
3. **Course morte du curseur de fondu.** Maximum déclaré 200 px, effectif
   `sliceSize` (48 par défaut) : les trois quarts de la course ne font rien, sans
   retour dans le panneau. Le vrai correctif serait un maximum **dynamique**, que
   le système de paramètres ne sait pas exprimer ; et le rendre relatif à la
   tranche est exclu par la demande elle-même. Signalé dans le code plutôt que
   masqué.

Un motif se dégage : **le choix d'espace de mélange et le mode d'entrée sont des
contrôles récurrents chez Figma**, et absents partout chez nous. À traiter comme
une famille plutôt qu'effet par effet.

### LIVRÉ le 2026-08-01 — et DEUX de ces « écarts » n'en étaient pas

La famille est traitée comme famille, ainsi que ce paragraphe le demandait :
`effects/blendSpace.ts` et `effects/inputMode.ts` (`6da8041`).

| écart relevé | issue |
|---|---|
| Outlines — mode d'entrée | ✅ **deux** choix, pas trois (voir ci-dessous) |
| Gooey merge — mode d'entrée | ✅ trois modes |
| Gooey merge — couleur de premier plan | ✅ `93747d8` |
| Channel mixer — espace de mélange | ✅ `transferSpace`, défaut inchangé |
| Pixel stretch — `Offset` signé | ✅ `93747d8`, sous le nom `Asymétrie` |
| Gooey merge — couleur de FOND | ❌ **refusée**, voir plus bas |
| Gooey merge — *Source Mix* | ❌ **refusé**, voir plus bas |
| Gooey merge — inversion | ❌ **sans objet**, déjà atteignable |
| Pixel stretch — pilotage par cercle | ⬜ chantier d'interface, pas de shader |
| Slice shift — « aligné » | ⚠️ **jamais revérifié** contre la fiche |

**Le troisième mode d'entrée d'`outlines` est écarté SUR PREUVE.** Cet effet
mesure un gradient, et |∇(1−x)| = |∇x| : inverser la luminance laisse la
magnitude rigoureusement inchangée, donc le trait tracé serait identique au
pixel près. « Luma inversé » y serait un contrôle inerte — l'échec silencieux
que ce dépôt proscrit, et la même raison qui a fait retirer les quatre
paramètres de teinte du glow plutôt que de les laisser sans effet. D'où un
vocabulaire restreint (`INPUT_SOURCE_CHOICES`) qui n'est pas un sous-ensemble
arbitraire : c'est la même question posée à un opérateur pour lequel la
troisième réponse n'existe pas.

**La couleur de FOND de gooey merge est refusée.** Teinter les gouttes suppose
de savoir où elles sont, et `coverage` est le seul endroit du dépôt qui le
sache : irremplaçable. Le fond, lui, c'est tout le reste de la photo — le
teinter est un cast GLOBAL, que `duotone`, `gradientMap` et `channelMixer` font
déjà mieux et avec plus de réglages. L'ajouter aurait été la redondance exacte
que l'audit du 2026-07-31 avait relevée entre duotone et gradientMap, sans même
la circonstance atténuante d'un effet inachevé.

**Le *Source Mix* est refusé par une décision de projet antérieure** : « Pas de
curseur mélange avec l'original — le calque porte déjà son `opacity`, son
`blendMode` et son masque » (`gradientMap.ts`, et le même paragraphe dans
`pixelStretch.ts`).

**L'inversion est sans objet** : atteignable depuis `6da8041` par
`Mode d'entrée → Luminance inversée`. L'ajouter ferait deux chemins pour un
seul geste.

Les trois refus sont couverts par des tests (`ecartsFigma.test.ts`), pour que
l'absence se lise comme un choix et non comme un oubli qu'un futur passage
« parité Figma » comblerait de bonne foi.

⚠️ **`slice shift` reste le seul de la liste qui n'ait pas été vérifié.** Le
« aligné » ci-dessus vient d'une lecture antérieure, jamais recoupée avec la
fiche — qui n'est pas lisible sans compte Figma (voir §6quater).

## 6quinquies. LES FICHES ONT ÉTÉ LUES — 2026-08-01 au soir

Ce document a répété quatre fois que la surface de contrôle des shaders Figma
n'était pas lisible sans compte. **C'était faux, et la source manquante était
citée en bas de ce fichier depuis sa première rédaction** : l'article d'aide
« Built by the Figma team: shaders and plugins » documente les réglages de
presque tous, en HTML pur, sans authentification.

Trois heures ont été passées à piloter l'éditeur Figma dans le navigateur
d'Antoine — sélection de calque, popover de réglages, zoom — pour une
information qui tenait dans une page d'aide déjà référencée. **Leçon** : avant
de piloter une interface, épuiser la documentation que l'on cite déjà.

Ce qui suit renverse plusieurs conclusions de ce cahier.

### `warp` — le §4 est FAUX, et c'est l'écart le plus grand du registre

Le §4 conclut « pas d'écart de référence ». Il jugeait notre warp contre des
références FBM génériques, pas contre le shader Figma du même nom.

| | Figma | nous |
|---|---|---|
| nature | **huit types ANALYTIQUES** au choix | **un** champ de bruit fractal |
| types | Sine wave, Twist, Bulge, Pinch, Ripple, Flag, Squeeze, Swirl | — |
| centre | poignée `Center`, le point d'où la distorsion irradie | absent (le bruit n'a pas de centre) |
| réglages | Frequency, Amplitude | Échelle, Amplitude, Détails, Rugosité, Anisotropie, Torsion, Graine |

**L'intersection est vide.** Aucun de leurs huit types n'est atteignable par un
bruit fractal : une torsion, une bulle, un pincement, une ondulation
concentrique sont des formules FERMÉES centrées sur un point, pas du bruit. Et
notre houle organique n'est atteignable par aucun de leurs huit.

Ce ne sont pas deux versions du même effet, ce sont deux effets qui partagent un
nom. Leur note « Reset Frequency and Amplitude when you switch Type, since each
formula responds differently » confirme qu'il s'agit bien de huit formules
distinctes et non d'un continuum.

### `outlines` — MÊME NOM, AUTRE EFFET

> « This draws a series of evenly spaced outlines that echo your shape outward,
> like ripples. »

Le leur **n'est pas un détecteur de contours** : il empile des contours
concentriques qui s'éloignent de la forme, avec espacement, épaisseur et dégradé
de couleurs. Le nôtre mesure un gradient de Scharr et trace la ligne de crête.

**Conséquence directe sur une décision de ce cahier.** Le §6bis écarte leur
troisième mode d'entrée (`Inverse luma`) « sur preuve » : |∇(1−x)| = |∇x|. La
preuve reste JUSTE — pour NOTRE opérateur. Elle ne dit rien du leur, qui cherche
une forme par seuil et pour qui l'inversion change tout (leur propre texte :
« Inverse luma uses darkness, for dark art or text on white »). La formulation
« la référence expose un contrôle inerte » était donc abusive : c'est chez nous
qu'il serait inerte, parce que nous ne faisons pas la même chose qu'eux.

### `coloredEdges` — conçu à l'aveugle, et tombé juste

> « Gradient: Colors of edge lines. **Wraps radially around the center, so edges
> at different angles pick up different colors.** Up to eight stops. »

C'est exactement le principe retenu sans avoir lu cette phrase : la teinte vient
de l'ORIENTATION du bord. Deux écarts réels subsistent :
- ils exposent un **dégradé à huit arrêts**, nous une roue HSL (teinte, rotation,
  étendue) — moins libre, mais sans éditeur d'arrêts à construire ;
- ils ont `Opacity` + `Background` (une **couleur** de fond derrière les
  contours), nous un `Délavé` qui ne va que vers le blanc.

Leur `Threshold` / `Thickness` / `Intensity` correspondent à nos Seuil /
Épaisseur / (saturation+luminosité).

### `hatching` — divergent, et l'un ne fait pas l'autre

⚠️ **Ce tableau a été écrit AVANT `0574caf` (2026-08-01, 20 h 39) et sa première
ligne est périmée depuis.** Elle a survécu à sa péremption assez longtemps pour
être recopiée telle quelle dans le triage du lendemain — voir le point 7. Corrigée
le 2026-08-02.

| | Figma | nous |
|---|---|---|
| motif | **Waves, Zigzag, Circles** | droites parallèles, **plus Ondulations / Zigzag / Cercles depuis `0574caf`** |
| tonalité | `Density` = épaisseur des lignes dans les zones CLAIRES | charge par couche, avec relais |
| croisement | absent | jusqu'à quatre couches croisées |
| position | poignée `Transform` sur la toile (origine, rotation, espacement) | angle, espacement |

Le leur est **décoratif** (ondulations, zigzags, cercles) ; le nôtre est une
**taille-douce** (gravure, croisement pour atteindre le noir). Aucun des deux ne
sait faire l'autre. À noter : leur `Density` agit sur les zones claires, le
nôtre sur les sombres — logique inverse.

### `channelMixer` — encore un nom partagé pour deux outils

> « Channel mixer takes the red, green, and blue colors in an image and
> **recolors each channel with your own selected color**. »

Le leur assigne **une couleur par canal** : c'est un outil de fausse couleur et
de duotone. Le nôtre est une **matrice 3×3 numérique**, le modèle du filtre
optique. Leur `color space` sRGB/Linéaire correspond en revanche exactement au
`transferSpace` livré ce matin — cette partie-là était juste.

### `gooeyMerge` — leur contrôle PRINCIPAL nous manque

> « **Threshold**: Sets where the edge of each shape sits. **Negative values grow
> the shapes so nearby ones touch and merge. This is the main control.** »

Notre `Seuil de fusion` est borné à [0, 1] et ne peut pas GROSSIR les formes.
C'est, de leur propre aveu, le réglage central de l'effet. Les autres écarts
sont confirmés : `Spread`, `Edge Softness`, `Foreground/Background Color`,
`Invert`, `Source Mix` — et nos refus documentés du fond et du Source Mix
restent valides comme choix de projet, mais le `Threshold` négatif, lui, est un
manque et non un refus.

### `gradientMap` — la correspondance ligne à ligne est CONFIRMÉE

Leur fiche nomme : `Gradient` (arrêts), `Mix space` (sRGB / OKLab / OKLCH /
Linear), `Offset`, `Repeat frequency`, `Repeat type` (Mirror / Repeat),
`Scatter`. Livré : tout sauf les arrêts libres. Leur conseil « use OKLab, OKLCH
or Linear **if transitions look muddy** » recoupe la mesure faite ici — sauf que
notre mesure va plus loin et dit lequel : OKLCH.

### `sliceShift` — « aligné » se confirme, à un manipulateur près

Leur fiche : cercle sur la toile pour la direction, `Shift`, `Random`. Nous :
Direction, Épaisseur, Décalage, Densité, Irrégularité, Écart des canaux, Graine.
Nous en avons plus ; il manque le pilotage direct sur la toile.

### Effets Figma sans équivalent chez nous, avec leur surface réelle

- **Halftone** — Pattern (Dot/Blended), Dot Size, Dot Scale, **Color Mode
  (CMYK aux angles d'écran d'imprimerie / RGB / BW Light / BW Dark)**, Rotation,
  Center, Softness, Clip to Alpha. La rosette CMYK est le cœur.
- **Lens distortion** — fisheye (`Distortion`) + aberration avec **trois modes**
  (Lateral / Longitudinal / **Anamorphic**, « horizontal cinema-lens split »).
  Notre `chromaticBleed` couvre l'aberration latérale seule, sans la déformation
  géométrique.
- **Pattern refraction** — Pattern (Lenticular / Zigzag / Waves / Circular /
  Curved square / Flat square), Strength signé, Smoothness, Frost, Dispersion,
  **Edge wrap** (Zero / Clamp / Repeat / Mirror).
- **Dither** — Style (Bayer / Blue Noise / Threshold), Size, Levels, Mono.
- **Pixelate**, **Chromatic metal**, **Color adjust**, **Filter presets**,
  **Bloom**, **Bokeh blur**.

### `pixelStretch` — notre lecture de l'`Offset` était une interprétation

> « drag **Offset** to set **how far and which way** the pixels pull. Negative
> and positive values go opposite directions. »

Leur `Offset` est une distance SIGNÉE (portée + sens). Le nôtre a été livré
comme une **asymétrie** de répartition de la portée entre les deux côtés. Les
deux donnent « ça ne part que d'un côté » aux extrêmes, mais ce n'est pas la
même grandeur. À revoir si la parité compte.

## 6ter. La famille des flous — référence Photoshop

Ajoutée au chantier par Antoine le 2026-08-01. Aucun flou n'existe au registre
aujourd'hui, et c'est l'absence la plus voyante face à la référence.

**Ce que dit la référence.** La Blur Gallery de Photoshop tient cinq outils, et
le vrai clivage n'est pas entre eux mais avec le flou gaussien :

- **Gaussien** : moyenne uniforme. Sert à réduire le détail, pas à imiter un
  objectif. Sur une photo, il « lave » l'image.
- **Lens Blur** : simule le rendu d'un objectif. Deux propriétés que le gaussien
  n'a pas, et qui expliquent tout l'écart de qualité :
  1. **Il favorise les zones claires sur les sombres** — les hautes lumières
     ponctuelles s'étalent en disques nets au lieu de se diluer. C'est ça, le
     bokeh.
  2. **La forme du diaphragme est réglable** (circulaire, lame, triangulaire…) et
     se lit dans la forme des taches de bokeh.
  Corollaire mesurable cité par la référence : quand un point lumineux rétrécit,
  sa tache de bokeh **ne rétrécit pas** — elle devient plus transparente et ses
  bords plus nets.

Les cinq outils de la galerie sont ensuite des **géométries de champ** posées
au-dessus de ce noyau : Field (dégradé libre par épingles), Iris (zone nette
elliptique), Tilt-Shift (bande nette entre deux lignes), Path (flou le long d'un
chemin — c'est un flou de mouvement), Spin (flou radial circulaire).

**Conséquence de découpage.** Ce n'est pas un effet, c'est **deux** :
- un **noyau de flou d'objectif** (seuil de hautes lumières, forme et nombre de
  lames du diaphragme, rayon) — c'est là qu'est toute la qualité ;
- une **géométrie de champ** qui module le rayon (uniforme / linéaire /
  elliptique / radial). Chez nous, le masque au pinceau fait déjà une partie de
  ce travail, ce qui rend Field et Iris moins urgents qu'ils ne le sont dans
  Photoshop.

Path Blur et Spin Blur relèvent du **motion blur** déjà nommé en différé dans
`CONTEXT.md` — même famille, à cadrer avec lui.

### LIVRÉ le 2026-08-01 (`942568b`) — le noyau, pas les cinq géométries

`lensBlur` est au registre. Les deux propriétés que ce paragraphe désigne comme
« toute la qualité » sont là : pondération des hautes lumières (le disque garde
son bord au lieu de se dissoudre) et forme de diaphragme réglable (polygone
inscrit, 3 à 12 lames, orientation). Quatre géométries de champ : Uniforme,
Linéaire (tilt-shift), Iris, Radial. Field n'est pas repris — le masque au
pinceau par calque fait déjà ce travail.

**Ce que le chantier a appris, et qui vaut au-delà de cet effet.** Le premier
scénario de rendu posait l'effet sur la mire commune du harnais. Il était
STRUCTURELLEMENT incapable de voir la propriété principale : une tache de bokeh
ne se lit que sur un petit point brillant contre du sombre, et sous un damier
couleur un lens blur rend exactement ce que rendrait un gaussien. Dix-sept tests
unitaires étaient verts sur un effet qui rendait des nuées granuleuses au double
du rayon réglé.

Un second scénario a été écrit pour ça — `effet-lens-blur-bokeh`, seize points
isolés sur du noir, quatre tailles × quatre teintes. Il a trouvé les deux
défauts à sa première exécution. La règle à retenir : **un verrou de pixels ne
vaut que si sa mire peut montrer ce que l'effet prétend faire.**

## 7. Effets candidats, par force de référence

| effet | pourquoi il est justifié | source |
|---|---|---|
| **Halation** | Le seul effet que la référence réclame explicitement, et qui manque. Physique connue, surface de contrôle documentée (Dehancer). Complète le glow au lieu de le doubler. | film / Dehancer |
| **Anamorphic streak** | Traînée horizontale bleue issue du barillet cylindrique, teinte donnée par le traitement anti-reflet. Ni bloom ni flare à fantômes : un *smear* directionnel, que les moteurs ne savent pas faire nativement. | optique anamorphique |
| **Lens blur** (noyau bokeh) | Aucun flou au registre, et le gaussien ne vaut rien sur une photo. Toute la qualité tient dans deux propriétés précises : pondération des hautes lumières et forme de diaphragme. Voir §6ter. | Photoshop Blur Gallery |
| **Halftone** | Complète posterize sur la même référence d'impression (trame AM/FM, angles d'écran, rosette). Au backlog Figma. | sérigraphie / Figma |
| **Motion blur** | Déjà nommé comme différé dans `CONTEXT.md`. Flou directionnel ou radial. | `CONTEXT.md` |
| **Étage color grade** | Déjà nommé comme différé : courbe de contraste + bleach bypass + split-tone. | `CONTEXT.md` |
| **Bokeh blur / Lens distortion / Dither** | Restent au backlog Figma de référence, non priorisés. | Figma Config 2026 |

---

### ÉTAT DU §7 au 2026-08-01 au soir

| effet candidat | issue |
|---|---|
| **Halation** | ✅ `5185b36` |
| **Anamorphic streak** | ✅ `6b3d2f9` — traînée bleue, teinte du traitement et non de la source |
| **Lens blur** (noyau bokeh) | ✅ `942568b`, et la famille des flous close par `motionBlur` + `surfaceBlur` |
| **Halftone** | ✅ `fdc2c31` — rosette CMJN aux angles d'écran de l'offset |
| **Motion blur** | ✅ `e2210ef` |
| **Étage color grade** | ⬜ toujours différé — c'est le plus utile en pratique et le plus gros (la fiche `Color adjust` de Figma liste treize contrôles) |
| **Bokeh blur / Lens distortion / Dither** | ⬜ backlog Figma, surface de contrôle désormais consignée au §6quinquies |

Cinq des sept candidats sont livrés. Ce qui reste n'est plus bloqué par la
référence — leurs surfaces sont lues et écrites — mais par un arbitrage de
priorité.

**Effets Figma sans équivalent, dans l'ordre où leur fiche les rend faisables** :
Lens distortion (fisheye + trois modes d'aberration, dont Anamorphic),
Pattern refraction (six formes de lentille), Dither (Bayer / Blue Noise /
Threshold), Pixelate, Chromatic metal, Color adjust, Filter presets.

**Ce qui reste bloqué, et c'est désormais une seule chose** : rien. Les fiches
`warp` et `sliceShift`, dernières inconnues, ont été lues le 2026-08-01 au soir
(§6quinquies). Le seul angle mort restant est le **rendu réel** de ces vingt
effets sous un œil humain — aucun checkpoint visuel n'a été fait.

## Sources

Halation et bloom :
[Dehancer — Halation and its simulation](https://blog.dehancer.com/articles/halation/) ·
[VSCO — Halation vs Bloom vs Lens Flare](https://www.vsco.co/learn/halation-vs-bloom-vs-lens-flare) ·
[Wikipedia — Anti-halation backing](https://en.wikipedia.org/wiki/Anti-halation_backing) ·
[analog.cafe — Halation in Film Photography](https://www.analog.cafe/r/halation-in-film-photography-i3q4)

Diffusion et Orton :
[phillipreeve.net — Diffusion Filters](https://phillipreeve.net/blog/diffusion-filters-are-they-useful/) ·
[Alik Griffin — Black Pro-Mist vs Glimmerglass vs Cinebloom](https://alikgriffin.com/black-pro-mist-vs-glimmerglass-vs-cinebloom/) ·
[DPReview — What are mist filters](https://www.dpreview.com/articles/9999362588/what-are-mist-filters-and-what-do-they-do-to-your-photographs/)

Bloom (implémentation) :
[Jimenez — Next Generation Post Processing in COD: Advanced Warfare](https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare/) ·
[LearnOpenGL — Physically Based Bloom](https://learnopengl.com/Guest-Articles/2022/Phys.-Based-Bloom)

Grain :
[IPOL — Realistic Film Grain Rendering (Newson et al.)](https://www.ipol.im/pub/art/2017/192/) — ⚠️ code GPL v3+ ·
[Bournemouth — Simulating Film Grain using the Noise-Power Spectrum](https://eprints.bournemouth.ac.uk/10547/1/grain.pdf) ·
[FilmMatch — Texture Suite](https://www.film-match.com/texture-suite-ofxs) ·
[Dehancer — Film Grain](https://www.dehancer.com/learn/article/grain) ·
[Noam Kroll — Why Most Film Grain Looks Fake](https://noamkroll.com/why-most-film-grain-looks-fake-and-how-to-achieve-better-results-in-post-production/)

Aberration chromatique :
[Photography Life — What is Chromatic Aberration](https://photographylife.com/what-is-chromatic-aberration) ·
[Image Engineering — Longitudinal and lateral chromatic aberration](https://www.image-engineering.de/library/technotes/750-longitudinal-and-lateral-chromatic-aberration)

Duotone :
[Adobe — Use duotones in Photoshop](https://helpx.adobe.com/photoshop/using/duotones.html) ·
[CreativePro — Extending Tonal Range with Duotones](https://creativepro.com/extending-tonal-range-photoshop-with-duotones/) ·
[printindustry.com — Duotones, Tritones, Quadtones](https://www.printindustry.com/Newsletters/Newsletter-246.aspx)

Flous :
[Adobe — Use the Blur Gallery in Photoshop](https://helpx.adobe.com/photoshop/using/blur-gallery.html) ·
[Boris FX — Gaussian Blur vs Lens Blur](https://borisfx.com/blog/gaussian-blur-vs-lens-blur-which-should-i-use/) ·
[KelbyOne — Fake Bokeh with Lens Blur](https://insider.kelbyone.com/how-to-fake-bokeh-with-lens-blur-in-photoshop-by-scott-valentine/) ·
[Bob Atkins — Bokeh and Background Blur](https://www.bobatkins.com/photography/technical/bokeh.html)

Figma (référence des effets du backlog) :
[Built by the Figma team — shaders and plugins](https://help.figma.com/hc/en-us/articles/41409034424215-Built-by-the-Figma-team-shaders-and-plugins)

Anamorphique :
[Bart Wronski — Anamorphic lens flares and visual effects](https://bartwronski.com/2015/03/09/anamorphic-lens-flares-and-visual-effects/) ·
[Lindsey Optics — What is a Streak Filter](https://www.lindseyoptics.com/blog/what-is-a-streak-filter-how-to-get-anamorphic-lens-flare/) ·
[StraySpark — The Anamorphic Look in UE5](https://www.strayspark.studio/blog/anamorphic-film-look-ue5)

---

# 8. REVUE D'USAGE D'ANTOINE — 2026-08-02

**Le premier passage en main sur les vingt effets**, après la fenêtre de test du
fondu de `sliceShift`. C'est le checkpoint visuel qui manquait depuis la clôture
du §7 (« le seul angle mort restant est le RENDU RÉEL de ces vingt effets sous un
œil humain »). Onze retours, transcrits d'abord, puis confrontés au code et au
cahier — plusieurs étaient déjà écrits ici sans jamais avoir été traités.

> « Pixel stretch est sympa mais difficile à positionner correctement. Goey merge
> est sympa aussi mais très aliasé effet metal avec des artefacts, c'est le but ?
> Tous les effets de flou sont un peu inutiles à part le motion blur me semblent
> inutiles, et ses parametres ne sont pas assez extremes et on a pas assez de
> controle dessus contrairement à photoshop. Posterize à très peu de controles.
> Colored edges est horrible, inutilisable. Outlines pareil, ils ne font pas le
> meme effet que sur l'exemple de figma. Pas trop compris la différence entre
> l'effet duotone et Gradient map. Le channel mixer de figma fait aussi des
> effets plus interesants hatching a d'autres patterns. Sympa l'anamorphic mais
> c'est pas la lens distorsion de figma, on peut le garder en option dans lens
> distorsion par contre. Slice shift pourrait aussi avoir des lignes verticales
> ET horizontales. »

## Ce que la mesure confirme, avant tout arbitrage

| retour | vérification sur le code |
|---|---|
| Posterize a peu de contrôles | **UN seul paramètre** : `levels`, de 2 à 16. Rien d'autre. |
| Motion blur pas assez extrême | `amount` plafonne à **120 px**. Photoshop va à 2000. |
| Channel mixer de Figma plus intéressant | le nôtre est une matrice 3×3 (11 paramètres) ; le §6quinquies note que le leur **recolore chaque canal avec une couleur choisie** — autre construction, déjà relevée, jamais traitée. |
| Outlines ≠ l'exemple Figma | déjà écrit au §6quinquies : « MÊME NOM, AUTRE EFFET », le leur empile des contours **concentriques**. |
| Anamorphic ≠ lens distortion | le backlog du §7 liste « Lens distortion (fisheye + trois modes d'aberration, **dont Anamorphic**) ». La proposition d'Antoine colle à la fiche. |
| Duotone vs Gradient map | 11 paramètres contre 17, et une distinction explicitement documentée en tête de `gradientMap.ts`. |

## Les deux questions, répondues

**« Gooey merge très aliasé, effet métal avec des artefacts, c'est le but ? »**
**Non.** L'iso-surface est antialiasée analytiquement — `band = max((1 - tension)
* 0.25, fwidth(field) * 0.75)` puis `smoothstep` — donc le crénelage n'est pas
une intention. MAIS sur la capture, `Gooey merge` reçoit la sortie de
`Halftone` : il applique un seuil de métaballe sur une **trame de points**. Le
« métal à artefacts » vient très probablement de cet empilement et non de
l'effet seul. À trancher par un essai d'une minute — gooey seul sur la photo —
avant d'ouvrir un chantier. Ne pas corriger avant d'avoir isolé.

**« Pas trop compris la différence entre duotone et gradient map. »**
La différence EXISTE et est documentée en tête de `gradientMap.ts` : `duotone`
ÉCRASE la matière (son curseur contraste durcit jusqu'aux aplats sérigraphiés),
`gradientMap` GARDE la photo (arrêts positionnables — point noir, point blanc,
position du ton moyen — plus « Conserver le modelé » qui réinjecte la luminosité
d'origine). **C'est donc le PRODUIT qui échoue à la montrer, pas le code qui
serait redondant.** Les défauts et les noms ne portent pas la distinction.

Cette question a déjà tourné deux fois, et le noter évite un troisième tour :
l'audit du 2026-07-31 avait conclu « duotone et gradientMap sont la même
construction » ; Antoine l'avait **renversé** sur la fiche Figma (la redondance
est le symptôme d'un `gradientMap` inachevé, pas un doublon à supprimer) ; il dit
aujourd'hui ne pas les distinguer à l'usage. Les trois affirmations sont
compatibles : les outils sont distincts SUR LE PAPIER et indistincts À L'ÉCRAN.
Le travail n'est donc ni de fusionner ni de re-justifier, mais de rendre l'écart
LISIBLE — défauts, noms, et peut-être un mot dans l'interface.

## Le registre n'était verrouillé qu'aux trois quarts — relevé le 2026-08-03

Un audit de couverture des verrous de pixels, effet par effet contre
`scripts/render-check.mjs`, a trouvé **quatre effets sur vingt-trois sans verrou
propre** :

- `halation` et `gradientMap` : **aucun scénario**, pas une ligne. Neuf passes de
  pyramide et un composite recolorisant d'un côté, une rampe à trois arrêts en
  OKLCH de l'autre, et rien qui rougisse si ça bouge.
- `chromaticBleed` et `duotone` : **passagers** d'un scénario bâti pour autre
  chose — le premier dans `photo-double-exposure`, le second dans
  `masque-edge-aware`. Ils y font tourner du code, mais si leur rendu dérivait,
  la référence changerait sans qu'on sache laquelle des deux propriétés a bougé.
  Passager n'est pas verrouillé.

Sept scénarios posés, dont **deux mires neuves** — parce que dans les deux cas
aucune mire existante ne pouvait montrer la propriété :

- `mireLampes` (quatre sources de teintes très différentes, posées deux fois :
  sur du presque noir et sur un fond clair) pour `halation`. Ce que la famille
  des halos a de commun est le bright-pass ; ce qui les sépare est ce qu'ils font
  de l'énergie. La halation JETTE la couleur de la source — le fichier le déclare
  au bright-pass, et rien ne le vérifiait. Quatre halos rouges identiques autour
  de quatre sources de couleurs différentes, c'est cette ligne-là qui devient
  opposable. Un second scénario, effacement à 0, sert de témoin au terme de fond
  clair, qui est **inerte sur du noir** et n'était donc exercé nulle part : écart
  **20,4 % des canaux** entre les deux. ⚠️ Cet écart est MESURÉ plus que montré —
  la moitié claire du témoin vire au rose-chaud, et c'est tout.
- `mireDamierNeutre` (damier fin, r = g = b partout) pour `chromaticBleed`. La
  mire commune porte déjà de la chromaticité partout — rouge croissant en x, vert
  en y — donc une frange colorée ne s'y distingue pas de son fond. Sur une source
  sans couleur, tout pixel coloré de la sortie est FABRIQUÉ par la dispersion.
  C'est le raisonnement des barres binaires de `sliceShift`, porté à deux
  dimensions parce qu'une aberration radiale déplace en x ET en y. Deuxième
  scénario pour l'orientation tangentielle (`angle` 45°), qui est une seconde
  géométrie et non un réglage de plus : **23,1 %** d'écart avec le radial.

**Et la question duotone / gradientMap a enfin une mesure.** Les deux sont posés
sur la MÊME rampe neutre, et l'écart entre les deux références vaut **74,2 % des
canaux**. Les images disent pourquoi sans qu'on ait à trancher : `duotone` rend
trois aplats à bascules dures, `gradientMap` une rampe continue. Un troisième
scénario replie la rampe quatre fois en miroir (**74,1 %** d'écart avec la rampe
simple) — trois teintes fixes ne se répètent pas, donc c'est la capacité que
`duotone` ne peut pas avoir. Le troisième tour de la question de fusion part
maintenant d'un chiffre au lieu d'un avis.

## Triage

**A. DÉFAUTS — un effet livré qui ne tient pas sa promesse.**
1. ~~`coloredEdges` — « horrible, inutilisable ».~~ **CAUSE TROUVÉE ET CORRIGÉE
   le 2026-08-02 ; le verdict d'usage, lui, reste à rendre.** La roue de teintes
   était construite en **HSL**, qui n'est pas perceptuel. Mesuré sur la référence
   de rendu, sur les seuls pixels pleinement encrés : pour un unique curseur
   `Luminosité`, la clarté RÉELLEMENT PERÇUE balayait **0,290** selon la seule
   orientation du bord (bleu à 0,534, vert-jaune à 0,883). L'effet promettait
   « la teinte vient de l'orientation » et livrait « la teinte ET la clarté ET le
   chroma viennent de l'orientation » — deux des trois voulus par personne, et
   qu'aucun réglage des douze paramètres ne pouvait corriger puisque la variation
   était dans la conversion. Couleur reconstruite en **OKLCH** (même conclusion
   que la mesure de `gradientMap` sur les rampes de teinte) : étendue **0,018**,
   seize fois moins. Chroma borné à 0,30 — au-delà, l'écrêtage hors gamut
   rendrait la roue irrégulière par un autre chemin.
   ⚠️ **Ce qui est prouvé est la RÉGULARITÉ, pas l'agrément.** La mire est un
   damier, donc chacune de ses cases porte un bord : ces images ne ressemblent
   pas à ce que l'effet fait d'une photo. Une seconde référence
   (`effet-colored-edges-defauts`) montre le calque POSÉ, puisque c'est sur lui
   que portait le verdict — mais il reste à juger sur une vraie photo.
2. ~~`outlines` — même rejet, mais la cause est connue et écrite : ce n'est pas le
   même effet que celui de Figma.~~ **DEUX CHOSES, ET LES DEUX FAITES le
   2026-08-03**, dans cet ordre parce qu'elles n'ont rien à voir :
   - **Un vrai défaut de `outlines`**, trouvé en le posant seul sur une mire à
     aplats bruités : `band = softness * 0.5` valait 0,175 au défaut quand un
     contour franc ne produit qu'un `mag` de 0,16 — la rampe du `smoothstep`
     était plus large que tout le signal utile. Un contour franc sortait à
     **52 %** d'encre et jamais plein, un contour deux fois moins contrasté à
     **4,9 %**, soit un rapport de 10,6 pour un rapport de contraste de 2,3.
     Rendue relative au seuil : **100,0 %** et **99,9 %**, l'aplat bruité restant
     à 0,0 %. `coloredEdges` portait la même ligne — d'où le rejet conjoint.
   - **L'effet manquant, écrit** : `echoOutlines`. La fiche dit « evenly spaced
     outlines that echo your shape outward, like ripples » — ce n'est pas un
     détecteur. Il mesure une DISTANCE à une forme, ce qu'aucun gradient ne sait
     dire. Distance estimée au premier ordre sur un champ seuillé puis flouté
     (pyramide partagée), **linéarisée en espace logit** parce qu'un échelon
     flouté est un sigmoïde et non une droite. Mesuré sur la mire commune, pour
     un espacement demandé de 18 px : estimation affine **13,4 px / 32 % de
     dispersion** → logit **18,6 px / 34 %** → zone de confiance resserrée
     **18,5 px / 8 %**.
   `outlines` garde sa place et son id : il est bon à ce qu'il fait, il ne fait
   simplement pas ça. ⚠️ **Reste une question de NOM** : la fiche appelle
   `Outlines` l'effet à échos, et nous appelons `Outlines` le détecteur. Le nom
   d'affichage se change sans casser aucun preset (l'id seul est persisté) —
   arbitrage d'Antoine.
3. `gooeyMerge` — crénelage **ISOLÉ le 2026-08-02, et réel** (`00b8e00`). Il ne
   vient PAS de l'empilement sous halftone. Part de transitions fortes qui se
   font en un seul pixel — donc sans aucun pixel de couverture partielle :
   **50,0 %** sur la mire nue, **74,3 %** avec l'effet, contre 3,0 % pour
   halftone et 30,6 % pour outlines sur la même mire. L'effet AJOUTE des arêtes
   franches alors que son fichier annonce une iso-surface « toujours antialiasée
   analytiquement ». Verrou posé (`effet-gooey-merge`), puis **CORRIGÉ le
   2026-08-02** (`b43a74a`) — et le relevé ci-dessus était juste sur le
   diagnostic, faux sur sa nature. Ce n'était pas un bord crénelé mais le liseré
   spéculaire réduit à un fil d'UN pixel (`coverage * (1 - coverage)` culmine sur
   un seul pixel dès que la bascule est étroite), plus un plancher `fwidth` qui
   valait exactement ZÉRO parce que `fwidth` lit le champ tel qu'il est STOCKÉ —
   8 bits, demi-résolution — donc deux texels voisins identiques sur une plage
   lissée. Filaments comptés aux quatre seuils : **103/95/85/60 avant, 0/0/0/0
   après**. Le couple 74,3 % / 50,0 % ne s'est jamais reproduit, sous aucune des
   cinq définitions de « transition franche » essayées.

**B. SURFACE DE CONTRÔLE TROP PAUVRE — l'effet est juste, la main manque.**
4. ~~`posterize` — un seul paramètre.~~ **LIVRÉ le 2026-08-02** (`bde32ba`) :
   cinq paramètres, tous neutres à leur défaut. Le tramage se COUPE (c'est le
   rendu sérigraphie du §5, que l'effet ne savait pas faire), plage d'entrée
   point noir / point blanc, et l'axe de répartition — **la question que le §5
   laissait explicitement ouverte**, rendue à l'œil au lieu d'être figée dans le
   code. Mesure du tramage sur la longueur des plages constantes : 20,51 px sans
   trame (celle de la mire nue) contre 2,40 px avec.
5. ~~`motionBlur` — plafond à 120 px.~~ **LIVRÉ le 2026-08-02** (`a1438a9`) :
   2000 px comme Photoshop, par une collecte en DEUX ÉTAGES — monter le maximum
   seul aurait laissé un échantillon tous les cinq pixels, donc le chapelet de
   fantômes que ce fichier dit vouloir éviter. Et la plage étendue a découvert un
   défaut que le plafond cachait : la rotation appliquait son déplacement le long
   de la TANGENTE, une approximation au premier ordre dont le rayon croît en
   `√(1+θ²)`. Écart-type angulaire à 360°, où l'intégration d'un tour complet
   doit donner des anneaux constants : **16 à 20 % avant, 0,3 % après**.
6. ~~`channelMixer` — recoloration par canal (fiche Figma) absente.~~ **LIVRÉ le
   2026-08-02** : trois encres (une par canal) plus un curseur `Recoloration`,
   neutre à son défaut. **Et le §6quinquies avait tort sur un point** — il donnait
   « deux outils sous un même nom ». C'est la MÊME algèbre : assigner une couleur
   au canal rouge, c'est poser cette couleur en COLONNE 0 de notre matrice, dont
   les neuf curseurs sont les LIGNES. Leur outil était donc déjà atteignable
   ici, en réglant trois curseurs répartis dans trois groupes — ce qui manquait
   n'était pas une capacité mais une prise. Les encres se composent avec la
   matrice au lieu de la remplacer : on peut séparer les canaux au filtre optique
   PUIS les colorer, ce que la fiche de référence ne permet pas.
   L'effet n'avait ni test unitaire ni verrou de pixels ; les deux ont été posés,
   celui des DÉFAUTS avant le changement — c'est lui qui prouve que les dix
   paramètres ajoutés laissent le rendu identique au bit.
7. ~~`hatching` — les motifs de Figma (Waves / Zigzag / Circles) restent absents ;
   nos `waveAmplitude`/`waveFrequency` ne couvrent qu'une partie de « Waves ».~~
   **CETTE LIGNE ÉTAIT FAUSSE LE JOUR OÙ ELLE A ÉTÉ ÉCRITE.** Les trois formes
   sont livrées depuis `0574caf`, le **2026-08-01 à 20 h 39** — la revue les
   listait encore absentes le **2026-08-02 à 12 h 16**, seize heures plus tard.
   Le triage recopiait le tableau du §6quinquies, rédigé avant la livraison et
   jamais relu contre le code.
   Reste ce qui, lui, manquait vraiment et n'était écrit nulle part : **aucune
   des trois n'était verrouillée**. Le scénario `effet-hatching` tourne au défaut
   (`Droites`), donc il ne traverse aucune des trois autres branches de
   `hatch_coord`. Trois références posées le 2026-08-02 ; mesurées, les formes
   sont bien distinctes — ondulations s'écarte de droites sur 60,4 % des canaux,
   et **zigzag s'écarte d'ondulations sur 61,4 %**, ce qui est la mesure qui
   comptait : elle exclut que les deux ondes retombent sur la même branche.

**C. ERGONOMIE — l'effet est bon, on ne sait pas le viser.**
8. ~~`pixelStretch` — « difficile à positionner correctement ».~~ **LIVRÉ le
   2026-08-03** (`ff5a3c1`) : la zone se pose SUR LA TOILE, plus seulement aux
   curseurs. Le relevé d'origine, gardé parce qu'il nomme le manque :
   La région existe
   (`regionX`/`regionY`/`regionRadius`/`regionFeather`) mais se règle par
   curseurs. Le §6bis le disait déjà : « Le nôtre a angle + position + portée,
   **sans manipulateur direct** », là où Figma pose un cercle sur la toile.
   C'est le même manque que celui qui a fait ajouter la région le 2026-08-01 —
   traité à moitié.

**D. DÉCISIONS PRODUIT — à trancher par Antoine, pas par le code.**
9. **La famille des flous.** « Tous les effets de flou sont un peu inutiles à
   part le motion blur ». La famille avait été déclarée CLOSE le 2026-08-01, sur
   un découpage de référence (surface de l'ouverture / trajectoire / bilatéral)
   qui tenait techniquement. Le verdict d'usage la rouvre : `lensBlur` (10
   paramètres) et `surfaceBlur` (3) sont candidats au retrait ou à une refonte.
   ⚠️ Retirer un effet du registre casse les presets qui le citent.
10. **`anamorphicStreak` devient une option de `lensDistortion`.** Proposition
    d'Antoine, conforme à la fiche Figma. Implique d'écrire `lensDistortion`
    (fisheye + trois modes d'aberration) et d'y loger la traînée. Le §7 le
    listait déjà en tête du backlog « dans l'ordre où leur fiche les rend
    faisables ».
11. **`sliceShift` en deux axes.** « pourrait aussi avoir des lignes verticales
    ET horizontales ». Aujourd'hui un seul `angle` : les tranches et leur
    glissement tournent ensemble. Deux familles de tranches simultanées est un
    autre effet, pas un paramètre de plus — à cadrer avant d'écrire.

## Ce que cette revue apprend sur la MÉTHODE

Six des onze retours étaient **déjà écrits dans ce cahier** avant d'être
ressentis à l'usage — outlines (autre effet), channel mixer (recoloration
absente), hatching (motifs manquants), anamorphic/lens distortion, pixel stretch
(pas de manipulateur), et la question duotone/gradientMap qui en est à son
troisième tour. Ils ont été consignés comme des ÉCARTS DE RÉFÉRENCE, c'est-à-dire
comme de la documentation, et jamais convertis en travail.

L'écart de référence est un constat ; il ne devient un défaut que quand
quelqu'un s'en sert. Le cahier a correctement identifié ce qui manquait, et
n'avait aucun mécanisme pour le faire remonter. C'est le même trou que celui du
§7 : « le seul angle mort restant est le rendu réel sous un œil humain » — écrit,
puis laissé ouvert une journée pendant que six effets de plus étaient livrés.
