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
