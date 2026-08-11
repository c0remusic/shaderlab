# Quelles fonctions de Photoshop et Lightroom compléteraient les nôtres

Recherche du ticket
[10-quelles-fonctions-completeraient-les-notres](../issues/10-quelles-fonctions-completeraient-les-notres.md).
Mesuré sur disque le 2026-08-11, `master` à `012fc10`, worktree unique.

**Ce document n'arbitre rien.** Il mesure, il cite, il classe. Chaque entrée dit
ce que la fonction fait, **ce que notre pile ne sait pas produire sans elle**,
ce qu'elle coûte vu notre architecture, et son verdict de doublon. Une entrée
dont le verdict est « rien, c'est juste plus commode » est un résultat, pas un
échec — la section 2 en porte huit.

---

## 0. Les six mesures qui décident presque tout le reste

Elles sont en tête parce que la moitié des verdicts en découle mécaniquement.
Aucune n'est reprise d'un document : toutes sont lues dans le code.

**(1) Un calque d'effet lit DÉJÀ le composite en dessous, et se fusionne avec
lui.** Le binding 0 (`srcTexture`) est l'entrée ping-pong, c'est-à-dire le
composite des calques inférieurs ; la sortie de `fs_main` est ensuite recomposée
par `mix(color, blend(color, effected), opacity * masque)`
(`src/render/shaderCompose.ts:214-236`, `:181-211`). **Conséquence : la recette
« dupliquer le calque, appliquer un filtre, changer le mode de fusion, masquer »
— qui revient une dizaine de fois dans le cahier de postproduction — est UN
calque chez nous, pas deux.** Le bloom du contre-jour brûlé
(`docs/superpowers/specs/2026-08-03-references-postproduction.md:82-87`) est
littéralement un calque `glow` en mode Écran avec un masque de luminosité. C'est
le point le plus sous-estimé de l'inventaire.

**(2) Onze modes de fusion, et leur interface est déjà vectorielle.**
`blendRegistry` porte exactement `normal, multiply, screen, add, darken,
lighten, overlay, hard-light, soft-light, color-burn, color-dodge`
(`src/render/blend/registry.ts:7-10`). La signature d'un mode est
`fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32>`
(`src/render/blend/modes.ts:6`) — donc un mode **non séparable**, qui a besoin
des trois canaux ensemble, s'écrit sans toucher à l'interface. Les quatre modes
TSL (Teinte, Saturation, Couleur, Luminosité) ont été **différés YAGNI** le
2026-07-19, pas refusés (`docs/INDEX.json:410`).

**(3) `blendMode` est une CHAÎNE, `params` est un tableau d'index.** Le mode
d'un calque est un id texte (`src/layers/types.ts:58`), résolu par recherche
(`blend/registry.ts:19-23`). **Ajouter un mode de fusion ne déplace donc aucun
index persisté dans un preset** — contrairement à l'ajout d'un choix au milieu
d'une liste `choices`, qui est interdit par la règle du dépôt. C'est une
asymétrie de coût qui n'est écrite nulle part et qui vaut d'être connue.

**(4) Un effet ne peut lire que deux images : son entrée, et une texture de
bibliothèque.** Le groupe 0 est exhaustif — bindings 0 à 7, énumérés à
`shaderCompose.ts:214-236` et `effectPassRunner.ts:310-320`. Le binding 6
(couverture) n'est jamais passé à `fs_main` : il ne sert que de poids de
compositing (`shaderCompose.ts:167-168`), donc **un effet écrêté ne peut même
pas lire le RVB de la photo sous lui**. Le binding 7 (`libraryTexture`,
ADR-0018) est le seul accès à une image tierce, il est déclaré GÉNÉRIQUE
(`src/render/effects/types.ts:306-328`), et il est **refusé en présence de
passes internes** (`src/render/effects/validate.ts:297-301`).

**(5) Les sources de masque paramétriques sont ancrées sur la photo ORIGINALE,
délibérément.** `fs_generate` reçoit « la couleur de la photo ORIGINALE (pas le
calque en cours d'édition — la génération est ancrée sur l'image source,
indépendante de l'empilement d'effets) » (`src/mask/sources/types.ts:8-16`).
Un masque de luminosité posé au sommet d'une pile ne voit donc pas ce que la
pile a fait aux tons.

**(6) Un preset ne capture ni les masques ni les calques photo.** Il capture
`effectId, params, enabled, opacity, blendMode` par calque, sur toute la pile
(`src/presets/presetTypes.ts:5-11`) ; à l'application chaque calque reçoit un
masque VIDE (`src/presets/presetDocument.ts:114`) et les calques photo sont
sautés (`:41-44`). Un preset est donc une **recette**, jamais un état de
travail.

---

## 1. Les fonctions retenues, classées par rapport valeur/coût

### 1.1 — Les quatre modes de fusion non séparables (Couleur, Luminosité, Teinte, Saturation)

**Ce qu'elles font.** Un mode non séparable ne s'applique pas canal par canal :
il décompose les deux couleurs en luminance et en chromaticité et n'en recombine
qu'une partie. La spécification qui les définit formellement est *CSS
Compositing and Blending Level 1* (W3C, Candidate Recommendation Draft du
21 mars 2024, <https://www.w3.org/TR/compositing-1/>), qui nomme exactement ces
quatre modes « non-separable » et donne, verbatim :

> **Color** : « Creates a color with the hue and saturation of the source color
> and the luminosity of the backdrop color. »
> **Luminosity** : « Creates a color with the luminosity of the source color and
> the hue and saturation of the backdrop color. »

`Teinte` et `Saturation` sont les deux variantes qui n'empruntent qu'une
composante. La spécification fournit aussi les cinq fonctions auxiliaires dont
la formule a besoin — `Lum`, `Sat`, `ClipColor`, `SetLum`, `SetSat` — ce qui
rend l'écriture mécanique plutôt qu'inventive.

**Ce que notre pile ne sait pas produire sans elles.** Aucune combinaison des
onze modes actuels ne les approche, et ce n'est pas une question de degré : les
onze sont tous des fonctions appliquées **canal par canal** (voir leurs corps,
`blend/modes.ts:6-79`), donc aucune ne peut faire dépendre le rouge de sortie du
vert d'entrée. Un opérateur qui préserve la luminance en changeant la
chromaticité est hors de cette classe par construction. Concrètement, trois
choses restent inaccessibles aujourd'hui :

- **Le split-tone**, c'est-à-dire teinter les ombres et les hautes lumières
  d'une image qui garde ses couleurs. `duotone` produit bien trois encres par
  zone tonale (`effects/duotone.ts:13-23`) mais **jette le RVB d'origine** — sa
  sortie est un `mix` entre les trois encres, indexé par la seule luminance
  (`duotone.ts:105-107`), et il n'a aucun paramètre de dosage interne.
  `gradientMap.preserveShading` réinjecte la LUMINOSITÉ d'origine
  (`gradientMap.ts:131`), jamais la chromaticité. Un calque `duotone` en mode
  `Couleur` serait, lui, exactement un split-tone.
- **Le calque de couleur unie en mode `Color`**, que le cahier demande deux fois
  et qui est le seul mode qu'il cite et que nous n'ayons pas (voir le décompte
  ci-dessous).
- **La courbe qui ne déplace pas la saturation.** Une courbe en S forte sature
  les couleurs comme effet de bord ; en mode `Luminosité` elle ne touche que le
  ton. C'est le geste standard, et notre `curves` n'a aucun moyen de s'y
  soustraire.

**Décompte des modes cités par le cahier de postproduction** (666 lignes dictées
par Antoine), mesuré à l'occurrence : `Screen` ×9, `Multiply` ×5, `Soft Light`
×3, `Overlay` ×2, `Lighten` ×2, **`Color` ×2**, `Normal` ×1, `Addition` ×1.
**Nous portons les sept premiers et pas le huitième** (lignes 96 et 292 du
cahier). Le manque est étroit, mais il est mesuré et non supposé.

**Coût.** Le plus bas de tout ce document. Un mode est un module autonome — « en
ajouter un = un fichier » (`CLAUDE.md` § Stack, patron `blend/registry.ts`) — et
l'interface `vec3 -> vec3` accepte le non-séparable tel quel. Il faut écrire les
fonctions `SetLum` / `SetSat` / `ClipColor` de la formule de référence (une
vingtaine de lignes de WGSL, partageables entre les quatre modes) et trancher la
même tension que les cinq modes définis-gamma existants : ils décodent en sRGB,
appliquent la formule, ré-encodent (`modes.ts:29-39`), et les helpers
`srgb2lin`/`lin2srgb` sont déjà injectés. **Aucun changement de modèle, aucune
migration de preset** (mesure 3), aucune UI nouvelle (le sélecteur liste le
registre).

**Verdict de doublon : aucun.** Prouvable par la forme de l'opérateur, pas par
essai : une fonction non séparable n'est pas dans l'image des fonctions
séparables. La seule chose qui en approche est `preserveShading` de
`gradientMap`, et elle est interne à un effet, pas disponible à la pile.

**Sources.** `blend/modes.ts`, `blend/registry.ts`, `docs/INDEX.json:410`
(différé YAGNI daté), cahier de postproduction lignes 96, 292, 484.

---

### 1.2 — Netteté / contraste local (accentuation, clarté, texture)

**Ce que ça fait.** Trois opérateurs de la même famille, séparés par la
**bande de fréquence spatiale** sur laquelle ils agissent — et c'est l'équipe
Camera Raw d'Adobe qui le dit dans ces termes, en présentant le curseur Texture
(<https://blog.adobe.com/en/publish/2019/05/14/from-the-acr-team-introducing-the-texture-control>) :

> « Texture is best for making subtle adjustments to those **mid-frequency**
> features. »
> « Clarity is best for making stronger adjustments to a **broader frequency
> range, including some lower frequencies**. »
> « Clarity can bring out changes in larger areas of tonality, and will change
> the luminance and saturation more than Texture. »

L'accentuation (unsharp mask) occupe la bande haute, le même billet résumant la
réaction courante à Texture : « it's somewhere between positive Clarity and
Sharpening ». Tous s'écrivent sur le même squelette,
`sortie = entrée + k · (entrée − flou(entrée))`, ce qui change d'un opérateur à
l'autre étant le rayon du flou et la façon dont `k` est modulé.

**Ce que notre pile ne sait pas produire sans eux.** Rien, à aucun réglage, et
c'est **doublement bloqué** :

- il n'existe aucun effet d'accentuation, de clarté, de texture, de passe-haut
  ou de contraste local au registre — vérifié sur les 23 modules de
  `src/render/effects/` ; les deux seules occurrences du mot « Clarté » sont des
  libellés de LUMINOSITÉ (`glass.ts:239`, `outlines.ts:383`) ;
- et la construction classique « copie floutée + mode de fusion » est
  inexécutable ici, faute d'un mode de fusion **signé**. Les onze modes ne
  comptent ni `Différence`, ni `Soustraction`, ni `Lumière linéaire`, ni
  `Lumière vive` (`blend/registry.ts:7-10`) — or `|flou − image|` perd
  précisément le signe qui distingue un halo clair d'un halo sombre. Un effet ne
  pouvant pas davantage lire un autre calque (mesure 4), les deux chemins sont
  fermés.

C'est le manque le plus RÉPÉTÉ du cahier de postproduction, et de loin : netteté
dure du flash (l.49), contraste local de la lumière latérale (l.63), contraste
et clarté du spéculaire (l.110), uniformisation de la netteté (l.172), netteté
locale de la mise au point imparfaite (l.193), netteté numérique du bruit
assumé (l.239), texture et clarté du contraste dur (l.302), netteté des gouttes
(l.415), netteté faible du look film délavé (l.619). **Neuf mentions, aucun
effet.**

**Coût.** Un fichier d'effet, avec ses passes internes — le noyau de flou
pyramidal partagé existe déjà (`effects/blurChain.ts`, utilisé par glow et
halation) et `EffectPass` sait enchaîner des passes. Pas de changement de
modèle. Le coût réel n'est pas le code, c'est **la barre de qualité** : un
unsharp mask naïf produit un liseré clair le long des bords francs, et c'est
exactement le « filtre Photoshop 2005 » que le dépôt proscrit. La bande de
fréquence citée ci-dessus est donc le paramètre de conception principal, pas une
finition. ⚠️ Adobe **ne dit rien** des halos dans le billet cité — le lien entre
rayon, bande et liseré est un raisonnement d'ici, pas une affirmation sourcée,
et il se tranchera à l'œil comme la pondération des hautes lumières de
`lensBlur` s'est tranchée sur `mireBokeh`.

**Point d'attention, pas un obstacle.** ADR-0010 tient le gaussien hors du
registre parce qu'il « lave l'image », et son garde vit dans
`test/render/effects/registry.test.ts` : il interdit les ids `gaussianBlur`,
`boxBlur`, `averageBlur`, et fige la liste des effets dont l'id contient
« blur » à `lensBlur` + `motionBlur`. Un effet d'accentuation ne déclenche
aucune de ces assertions — mais il **utilise** un flou en interne, et cette
tension mérite d'être nommée devant l'ADR plutôt que découverte ensuite. Ce
n'est pas une décision que ce document prend.

**Verdict de doublon : aucun.** Ni les deux flous (qui retirent du détail), ni
`outlines` (qui DESSINE un trait à partir du gradient au lieu de rehausser le
contraste existant), ni `curves` (qui est un opérateur ponctuel, sans voisinage)
ne produisent une augmentation de contraste local.

**Sources.** Registre et catalogue mesurés ; cahier de postproduction, neuf
lignes citées ci-dessus ; `blend/registry.ts` ; ADR-0010 et son garde.

---

### 1.3 — Carte de déplacement pilotée par une image

**Ce que ça fait.** Un effet qui lit une IMAGE et s'en sert pour décider de
combien déplacer chaque pixel de ce qui est en dessous : `sortie(uv) =
entrée(uv + k · f(carte(uv)))`. C'est ce qui fait qu'une typographie posée sur
une photo épouse les plis d'un vêtement au lieu de flotter dessus.

**Ce que notre pile ne sait pas produire sans elle.** Aucun des trois effets qui
déplacent des pixels ne peut être piloté par une image :

- `warp` déplace par un bruit fractal ou huit déformations centrées analytiques
  (`effects/warp.ts:46-81`) — la forme du champ est calculée, jamais lue ;
- `glass` déplace par un relief procédural (quatorze matières), et c'est
  précisément ce relief qui distingue ses matières ;
- `texture` lit bien une image par le binding 7, mais il **sort le scan brut**
  et laisse le mode de fusion faire le mélange (`effects/texture.ts:255-261`) —
  il n'a jamais accès au résultat d'un déplacement.

Le cahier demande la fonction trois fois : « typographie transformée avec `Warp`
ou `Displacement Map` » (l.384), « une displacement map créée à partir de la
photo aide le texte à suivre les volumes » (l.391), « déplacement avec
displacement map » (l.568) — plus, en creux, la déformation de l'image derrière
les gouttes de condensation (l.414).

**Coût.** Bas, et c'est ADR-0018 qui l'a rendu bas : `libraryTexture` est
générique, le paramètre porte le RANG dans le catalogue trié, le binding 7 porte
les pixels. Un déplacement n'a **pas besoin de passes internes**, il satisfait
donc la restriction de `validateEffect` (mesure 4). Le mécanisme de dossier
d'images est livré depuis le 2026-08-05, avec sa discipline de licence : seul du
CC0 part dans l'installateur (ambientCG, Poly Haven, vérifiés à la source), et
tout le reste passe par un dossier désigné par l'utilisateur
(`docs/superpowers/specs/2026-08-05-textures-scans-design.md:164-171`).

⚠️ **Une nuance d'approvisionnement, mesurée.** Les 44 matières CC0 livrées ne
contiennent que la carte **Color** : les zips ambientCG portent bien une carte
`Displacement`, mais elle n'a pas été extraite (`...textures-scans-design.md:189-192`).
Deux sorties, aucune n'étant un obstacle : se servir de la luminance de la carte
Color (ce que fait la fonction de référence, qui lit un canal d'un fichier
ordinaire), ou retirer les cartes Displacement par la même technique de requêtes
Range, sous la même licence.

**Verdict de doublon : aucun.** La mesure porte sur la SOURCE du champ de
déplacement, pas sur son effet : procédural chez `warp` et `glass`, lu chez
celui-ci. Deux images différentes donnent deux déformations différentes, ce
qu'aucun réglage de `warp` ne peut atteindre.

**Sources.** `effects/texture.ts`, `effects/warp.ts`, ADR-0018,
`validate.ts:297-301`, cahier de postproduction l.384, 391, 414, 568.

---

### 1.4 — La courbe libre (et donc la solarisation)

**Ce que ça fait.** Autoriser une courbe tonale non monotone : un segment qui
DESCEND quand l'entrée monte. C'est la définition de la solarisation, que le
cahier décrit en §6 comme « courbe inversée partiellement » (l.581).

**Ce que notre pile ne sait pas produire sans elle — et l'endroit exact du
blocage.** `curves` porte quatre canaux, jusqu'à cinq points chacun, en spline
de Hermite monotone. Le SHADER évaluerait un ordre de Y quelconque
(`effects/curves.ts:114-156`) ; c'est **l'UI qui interdit** : `constrainCurvePoint`
borne le Y d'un point entre celui de ses voisins (`src/ui/curveControl.ts:25-26`),
et c'est le seul chemin d'édition (glisser, clavier, insertion — `CurveControl.tsx:93,121,152`).
Le seul moyen d'exprimer un segment décroissant aujourd'hui est d'éditer un
preset à la main : `presetDocument.apply` écrête aux bornes min/max mais ne
vérifie aucun ordre (`presetDocument.ts:102-106`).

**Coût.** Quasi nul en code (une condition), non nul en décision : la
monotonie n'est pas un accident, c'est une contrainte posée, et un panneau de
courbe qui laisse croiser deux points demande un rendu et une preuve. À noter
aussi que le déblocage porte sur les quatre canaux, donc ouvre les fausses
couleurs par canal en même temps que la solarisation.

**Verdict de doublon : partiel, et il faut le dire précisément.** Les fausses
couleurs du même paragraphe du cahier (l.586-592 : gradient map, bichromie,
noirs remplacés par du bleu) sont **déjà couvertes** par `gradientMap` et
`duotone`. Ce qui ne l'est pas est l'inversion partielle elle-même — un ton qui
s'assombrit quand l'exposition monte. Aucun autre effet ne la produit.

**Sources.** `effects/curves.ts`, `src/ui/curveControl.ts`, cahier de
postproduction l.578-584.

---

### 1.5 — Le masque mesuré sur ce qui est EN DESSOUS

**Ce que ça fait.** Photoshop appelle ça `Fusionner si` (Blend If) : un calque
peut être masqué en fonction de la luminosité de **ce qui est sous lui** —
c'est-à-dire du composite déjà traité — et non de l'image de départ.

**Ce que notre pile ne sait pas produire sans lui.** Nos trois sources
paramétriques sont ancrées sur la photo originale, et c'est écrit comme une
intention (mesure 5). L'écart n'est pas théorique : dans la pile « photo →
`curves` qui bouche les ombres → `glow` masqué sur les hautes lumières », notre
masque de luminosité voit les hautes lumières de la photo D'ORIGINE, pas celles
que la courbe vient de fabriquer. Toute recette du cahier qui enchaîne un
étalonnage PUIS un masquage tonal tombe dans cet écart — et c'est la forme même
de son workflow type, qui met le color grading avant les retouches locales
(l.31-33).

**Coût.** Moyen-bas, et la plomberie est déjà là : le résolveur de masque reçoit
déjà `colorView` — « pour tout calque qui n'est pas le tout premier de la pile,
ce guide EST le composite des calques en dessous » — et il porte déjà un
`guideEpoch` pour invalider son cache quand ce composite change
(`src/render/maskTextureResolver.ts:254-268`). Ce qui manque est un choix, par
source ou par masque, entre les deux images, plus sa sérialisation et son
contrôle. Attention : `MaskSource.params` a un ordre sérialisé qui est un
contrat WGSL par type — un drapeau s'ajoute à la FIN, jamais au milieu.

**Verdict de doublon : non, et la mesure répond deux choses.** Le mécanisme
existe (masque continu par plage tonale, avec tolérance et union des deux
extrêmes) ; c'est son ENTRÉE qui diffère. À l'inverse, la seconde moitié de
`Fusionner si` — le masquage par les pixels du calque LUI-MÊME, c'est-à-dire par
la sortie de l'effet avant compositing — n'a aucun équivalent et **aucun usage
identifié dans le cahier**. Le proposer serait de la parité, pas un besoin.

**Sources.** `src/mask/sources/types.ts:8-16`, `maskTextureResolver.ts:254-268`,
cahier de postproduction l.29-34.

---

### 1.6 — Le masque radial

**Ce que ça fait.** Une source de masque continue qui rayonne depuis un point,
avec un rayon et un adoucissement — le « masque radial clair près de la source »
du contre-jour brûlé (l.76), le « vignettage inversé autour du sujet » du flash
frontal (l.50), et le vignettage tout court.

**Ce que notre pile ne sait pas produire sans lui.** La source `gradient` est
**linéaire uniquement** : elle projette `uv` sur l'axe défini par deux points
(`src/mask/sources/gradient.ts:44-55`), et son en-tête la nomme « Dégradé
linéaire ». Le PRD de masquage annonçait pourtant « dégradé linéaire/radial »
(`...masking-prd.md:77`) — **la moitié radiale n'a pas été livrée**, et
personne ne l'a noté depuis. Aujourd'hui un vignettage se peint au pinceau, donc
ne se règle plus après coup.

**Coût.** Très bas : un module de plus au registre des sources, sur le patron
des trois existants (`src/mask/sources/registry.ts`), ou deux paramètres ajoutés
en fin du contrat de `gradient`.

**Verdict de doublon : non pour le rendu, mais attention au périmètre.** Un
dégradé radial n'est pas la « sélection géométrique rect/ellipse » différée par
le PRD — l'un est une rampe continue sans bord, l'autre une région à bord
franc — mais les deux se recouvrent assez pour que le choix appartienne au
ticket [08](../issues/08-lesquels-des-cinq-differes-de-masquage.md), qui les
instruit ensemble. Cette entrée est **signalée, pas revendiquée**.

**Sources.** `src/mask/sources/gradient.ts`, `...masking-prd.md:77`, cahier de
postproduction l.50, 76.

---

### 1.7 — Saturation, vibrance, et la sélection par teinte

**Ce que ça fait.** Trois choses distinctes qu'il faut séparer pour que le
verdict soit honnête : régler la saturation globalement, la régler de façon NON
linéaire (la vibrance d'Adobe, qui épargne les couleurs déjà saturées et les
carnations), et régler teinte/saturation/luminosité d'une BANDE de teintes (le
panneau TSL de Lightroom).

**Ce que notre pile sait déjà faire, mesuré.** La catégorie « Couleur » ne
compte que quatre effets — `duotone`, `channelMixer`, `curves`, `gradientMap`
(`effects/catalog.ts:28-31`) — et aucun ne porte de curseur de saturation :
tous les paramètres nommés « Saturation » du registre sont des composantes d'une
ENCRE choisie par l'utilisateur (`colorGroup`), jamais la chroma de l'image. Le
fichier `effects/hsl.ts` est un helper unidirectionnel HSL→RVB au service de ces
encres, pas un effet.

Mais `channelMixer` est une matrice 3×3 complète, avec coefficients négatifs,
préservation de luminosité et un `monochrome` continu
(`effects/channelMixer.ts:234-262`). Or une mise à l'échelle de saturation
globale EST une matrice 3×3, et une rotation de teinte globale aussi. **Une
désaturation, une sursaturation et un virage de teinte globaux sont donc déjà
atteignables** — par une surface de contrôle qui ne le dit pas. Et la sélection
par teinte se construit avec `colorRange`, qui cumule jusqu'à six prélèvements
avec tolérance et dureté (`src/mask/sources/colorRange.ts:7,22`) : un masque
`colorRange` inversé plus un calque `channelMixer` monochrome donne exactement
la recette « image désaturée, rouge de marque conservé » du cahier (l.294-295).

**Ce qui reste hors de portée.** La **vibrance**, parce qu'elle n'est pas
linéaire : elle module l'effet en fonction de la saturation déjà présente du
pixel, ce qu'aucune matrice ne peut faire. Et le TSL par bande demande un calque
et un masque par bande, là où le panneau de référence en tient huit.

**Coût.** Bas (un effet). Mais lire d'abord la section 2 : une partie du besoin
est déjà servie autrement.

**Verdict de doublon : PARTIEL, et c'est le cas le plus intéressant du
document.** La saturation globale est un doublon mesurable de `channelMixer` —
même opérateur, autre habillage — donc « plus commode » et rien d'autre. La
vibrance ne l'est pas. Une proposition qui les vend ensemble se ferait payer un
doublon au prix d'une nouveauté.

**Sources.** `effects/catalog.ts`, `effects/channelMixer.ts`, `effects/hsl.ts`,
`src/mask/sources/colorRange.ts`, cahier de postproduction l.286-295.

---

### 1.8 — Les groupes de calques

**Ce que ça fait.** Un conteneur qui aplatit ses enfants, puis applique SON
opacité, SON mode de fusion et SON masque au résultat aplati.

**Ce que notre pile ne sait pas produire sans eux.** Deux choses, dont une
mathématique :

- **Fusionner un ENSEMBLE de calques comme un tout.** `A puis B, chacun à 50 %`
  n'est pas `(A puis B) à 50 %` — les modes de fusion ne sont pas associatifs de
  cette façon. Aucun réglage de la pile plate ne rattrape l'écart.
- **Un masque partagé qui reste vivant.** On peut copier un masque d'un calque à
  l'autre, mais « la copie est indépendante et figée » par décision explicite du
  PRD (`...masking-prd.md:68-70`) : masquer identiquement six calques demande six
  copies, et retoucher le bord demande six retouches.

`LayerState` est plat aujourd'hui — pas de `children`, pas de conteneur
(`src/layers/types.ts:50-98`), et l'exécuteur itère un tableau linéaire
(`framePipelineExecutor.ts:390`). L'écrêtage n'y supplée pas : il chaîne des
calques consécutifs vers une base PHOTO et ne module que le poids de
compositing (`src/layers/clipping.ts:37-46`), il n'aplatit rien.

**Coût. Le plus élevé du document, et il est chiffrable.** Le compositing
imbriqué demande une cible de rendu pleine taille de plus par niveau
d'imbrication — soit environ 96 Mo par niveau à 24 Mpx, à ajouter au risque VRAM
R1 déjà ouvert et non mesuré (`ARCHITECTURE.md:615`). Il demande aussi de passer
`LayerState` d'un tableau à un arbre, c'est-à-dire de toucher les cinq couches
qui le consomment. Le design de 2026-07-18 l'avait vu ainsi : « pièce la plus
lourde de la vague », placée en tranche 5, jamais exécutée, avec le mode
`Pass Through` écarté YAGNI (`docs/INDEX.json:127`).

**Verdict de doublon : aucun**, et c'est justement pour ça qu'il coûte cher.

**Sources.** `src/layers/types.ts`, `src/layers/clipping.ts`,
`...masking-prd.md:56-58, 68-70`, `docs/INDEX.json:127`, `ARCHITECTURE.md:615`.

---

### 1.9 — La déformation peinte (Liquify, smudge)

**Ce que ça fait.** Un pinceau qui pousse les pixels au lieu de peindre une
valeur — le champ de déplacement est dessiné à la main, pas calculé.

**Ce que notre pile ne sait pas produire sans elle.** Notre pinceau peint un
masque **scalaire 8 bits, un octet par pixel** (`src/mask/maskPainter.ts:81-84`)
qui DOSE un effet ; il ne peut pas porter un vecteur. `warp` déforme, mais par
un champ procédural sans contrôle local. Le cahier la demande en §6
(« `Liquify` », « smudge directionnel », l.566-571) et en §2 (« étirement
directionnel de morceaux de cheveux, vêtements ou arrière-plan », l.127).

**Coût. Élevé, et pour une raison de modèle plutôt que de shader.** Il faut un
raster à deux canaux, hors du state React comme tous les gros buffers
(invariant anti-OOM du dépôt), son entrée dans l'historique, un outil, et un
paramètre qui n'est pas un flottant — donc pas dans `params`. C'est le même mur
que la typographie (`params` est un `Record<string, number>`, uniform
`array<f32, 48>`), et il est instruit par le ticket
[03](../issues/03-une-forme-a-t-elle-besoin-de-contentsource.md) sous un autre
angle.

**Verdict de doublon : aucun.** Mais le rapport valeur/coût est le plus mauvais
des entrées non rejetées, et la fonction est citée deux fois par le cahier
contre neuf pour la netteté.

**Sources.** `src/mask/maskPainter.ts`, `effects/warp.ts`, cahier l.127, 566-571.

---

### 1.10 — La dégradation numérique (blocs de compression, banding, rééchantillonnage dur)

**Ce que ça fait.** Le « bruit numérique assumé » du cahier (l.234-244) :
compression visible, banding, micro-artefacts, réduction de résolution puis
réagrandissement avec interpolation dure — le rendu webcam, DV, image internet
archivée.

**Ce que notre pile sait déjà faire, mesuré.** La moitié de la recette est
livrée : `grain` porte un mode **Capteur** décrit comme « bruit blanc par pixel,
maximal dans les ombres » et un paramètre **Chrominance** dont le maximum donne
« trois couches indépendantes, taches colorées » (`effects/grain.ts:70,84`).
Le bruit coloré dans les ombres n'est donc pas à écrire.

**Ce qui reste.** Les blocs de quantification 8×8, le banding franc, et le
rééchantillonnage dur. Aucun effet ne les produit — `dither` quantifie mais avec
un motif d'impression qui est le sujet, pas un artefact.

**Coût.** Bas (un effet, sans passe interne).

**Verdict de doublon : partiel et déclaré.** Ne pas réécrire le bruit ; écrire
l'artefact. Et la valeur est la moins étayée du document : une seule mention du
cahier, aucune photo d'Antoine à l'appui — ce qui, vu la leçon `lensFlare`,
suffit à ne pas la classer plus haut.

**Sources.** `effects/grain.ts:70-85`, cahier de postproduction l.234-244.

---

### 1.11 — Le tri par pixels (pixel sorting)

**Ce que ça fait.** Trier les pixels d'une bande selon leur luminosité, entre
deux seuils : une coulée ORDONNÉE, qui n'a pas la texture d'un étirement.

**Ce que notre pile ne sait pas produire sans lui.** `pixelStretch` étire le
pixel de bord, `sliceShift` décale des bandes, `warp` déforme : aucun ne
réordonne. Le résultat visuel diffère de façon évidente (une rampe continue
triée contre une traînée constante).

**Coût. Élevé et structurel** : un tri n'est pas une fonction ponctuelle de
`uv`. Sur GPU il demande soit un tri bitonique multi-passes, soit une passe par
ligne — dans une architecture où chaque passe est une passe de rendu plein cadre
et où la résolution est native, sans downscale d'aperçu (décision projet).

**Verdict de doublon : aucun**, mais la valeur est faible : une mention en
passant du cahier (l.571), dans une liste.

**Sources.** `effects/pixelStretch.ts`, `effects/sliceShift.ts`, cahier l.571.

---

### 1.12 — Les variantes de session (l'équivalent utile des copies virtuelles)

**Ce que ça fait.** Lightroom garde plusieurs traitements d'une même photo
(copies virtuelles, instantanés) et synchronise des réglages d'une photo à
l'autre. La question du ticket est de savoir si ça a un sens pour un éditeur qui
travaille une image à la fois.

**Ce que notre pile fait déjà, et ce qu'elle ne fait pas.** La
**synchronisation de réglages** est exactement ce qu'un preset fait : capture de
la pile, application ailleurs, export/import JSON, détection de dérive. Le
**catalogue** n'a pas d'objet ici — un éditeur sans bibliothèque, et la pellicule
de session est déjà un concept différé nommé (`CONTEXT.md:293-294`). Restent les
variantes, et là il y a un écart mesuré : **un preset ne restitue pas les
masques** (masque vide à l'application, `presetDocument.ts:114`) **ni les calques
photo** (sautés, `:41-44`). Comparer deux traitements d'une même image en gardant
les masques peints est donc impossible aujourd'hui, y compris en passant par un
preset.

**Coût.** Bas si la variante est un instantané interne à la session (la pile
complète est déjà clonable — `LayerStack.clone`, partage par référence des
rasters immuables, `src/layers/types.ts:59-62`) ; élevé si elle doit survivre à
la fermeture, puisqu'il faudrait persister des rasters de masque.

**Verdict de doublon : quasi total sur la synchronisation, réel sur les
variantes.** À écrire honnêtement : ce n'est pas une capacité de rendu, c'est du
confort de comparaison, et la carte a déjà un axe « lisibilité » où il
pourrait retomber ([09](../issues/09-ce-que-photoshop-et-lightroom-rendent-lisible.md)).

**Sources.** `src/presets/presetDocument.ts`, `presetTypes.ts`, `CONTEXT.md:293-294`.

---

## 2. Ce que la mesure renvoie comme doublon ou pure commodité

Résultat valide, et la moitié du travail de ce ticket. Chacune de ces fonctions
est réclamée par le cahier ; **aucune ne demande une ligne de code**.

| Recette du cahier | Ce qui l'exécute déjà | Mesure |
| --- | --- | --- |
| **Bloom** (l.262-269 : sélection des hautes lumières, flou, mode Écran, opacité) | un calque `glow`, mode Écran, masque de luminosité | mesure 1 : la duplication de Photoshop est notre calque |
| **Dodge and burn** (cité 4 fois) | un calque `curves` masqué au pinceau, deux fois (un clair, un sombre) | le pinceau dose déjà un effet, c'est la définition du D&B non destructif |
| **Bleach bypass** (différé nommé depuis 2026-07-20) | `channelMixer` en `monochrome` posé en `Incrustation` ou `Lumière crue`, plus un calque `curves` | les deux modes existent (`modes.ts:31,42`), et un **preset capture exactement ça** : effectId + params + opacité + mode (mesure 6) |
| **Halation, aberration chromatique, grain, motion blur, gradient map, bichromie, light leaks** | `halation`, `lensDistortion`, `grain`, `motionBlur`, `gradientMap`, `duotone`, `lightLeak` | point 2 du tri du cahier, déjà écrit ; recompté ici sans changement |
| **Profondeur de champ courte** (l.178-187) | `lensBlur` + masque ; la carte de profondeur est le différé du ticket 08 | le noyau de bokeh est livré, la géométrie de champ aussi (4 modes) |
| **Vitesse lente avec flash** (l.137-149 : copies décalées, flou directionnel, Écran) | plusieurs calques `motionBlur` masqués, en Écran | seule la duplication du SUJET manque, et c'est le détourage — ticket 08 |
| **Saturation globale, virage de teinte global** | `channelMixer` (matrice 3×3, luminosité préservée) | voir 1.7 : même opérateur, autre habillage |
| **Aplat coloré** (l.453, l.559) | `gradientMap` à trois arrêts identiques, modelé à 0 | contournement réel mais peu lisible ; la vraie réponse est le ticket 03 |

Un mot sur le **« étage color grade »**, la piste nommée par le ticket
(`CONTEXT.md:278-280`, `PRD-print-export.md:25`) : la mesure le dissout en trois
morceaux de natures différentes. La **courbe de contraste** est livrée
(`curves`, 2026-08-04). Le **bleach bypass** est une pile de deux calques, donc
un preset. Le **split-tone** n'est ni l'un ni l'autre : il demande un mode de
fusion non séparable (1.1). Aucun des trois n'appelle un « étage » — l'entrée
peut se fermer, se transformer en preset livré, et rendre son dernier tiers à
l'entrée 1.1.

---

## 3. Ce qui doit être DIT et non simulé

Le point 4 du tri du cahier, rappelé par le ticket. Ces trois-là sont nommés par
Antoine lui-même comme non créables en postproduction, et une fonction qui
prétendrait les produire rendrait le « filtre Photoshop 2005 » proscrit :

- **Téléobjectif compressé** (l.164-175) — « il est difficile de créer une vraie
  compression optique après coup », « à prévoir principalement au shooting ».
  Une compression de perspective demande de déplacer le point de vue, donc de la
  géométrie 3D que le pixel ne porte pas.
- **Lumière latérale dure** (l.58-70) — « idéalement obtenue au shooting ». Ce
  qui suit dans le cahier n'est pas une simulation mais un renforcement (courbe
  en S, assombrissement sélectif), et notre pile le fait déjà.
- **Reflets spéculaires très marqués** (l.105-117) — « ils doivent être
  photographiés » ; le cahier note lui-même que les redessiner « devient
  rapidement artificiel ».

À ajouter à la liste sur le même critère, parce que ce sont des fonctions
Photoshop qu'un inventaire ferait remonter mécaniquement :

- **Remplissage d'après le contenu / génératif** — invente des pixels qui n'ont
  pas été photographiés. Hors de la nature de l'outil (aucun de nos 23 effets ne
  fabrique de contenu à partir de rien, sauf `lightLeak` qui l'assume comme un
  accident de boîtier), et dépendant d'un modèle ou d'un service.
- **Le relighting** (déplacer la source lumineuse d'une scène) — même raison que
  la lumière latérale, en pire.

Ce document **ne décide pas** de la forme que prend ce « dire » — documentation,
ADR de refus, ou rien. La carte note elle-même que c'est le plus flou des trois
points ouverts du cahier.

---

## 4. Ce qui appartient à un autre ticket de cette carte

Signalé pour que ces sujets ne soient pas comptés deux fois, ni oubliés :

| Sujet rencontré | Où il est instruit |
| --- | --- |
| Recadrage, miroir horizontal/vertical | ROADMAP bloc 2 et ticket [05](../issues/05-ce-qui-reste-du-design-de-parite-du-calque-photo.md) — mesuré ici : `LayerTransform` n'a ni `crop` ni échelle négative (`ui/transform.ts:119-127`), `enterCrop` n'a aucun appelant de production (`ui/tools.ts:23-27`) |
| Formes, aplats, ombres graphiques | ticket [03](../issues/03-une-forme-a-t-elle-besoin-de-contentsource.md) |
| Typographie, projection de texte | ticket [04](../issues/04-la-typographie-entre-t-elle-dans-ce-palier.md) |
| Détourage, lasso, rect/ellipse, profondeur, segmentation | ticket [08](../issues/08-lesquels-des-cinq-differes-de-masquage.md) — dont le masque radial de 1.6 |
| Recherche de réglage, avant/après, histogramme, nommage | ticket [09](../issues/09-ce-que-photoshop-et-lightroom-rendent-lisible.md) |
| `curves` en linéaire ou en perçu | ticket [06](../issues/06-curves-en-lineaire-ou-en-percu.md) — confirmé ici : `curves.ts` n'importe aucune transformation sRGB et applique sa courbe à la luminance linéaire (`curves.ts:194,198`), contrairement à `duotone` (`duotone.ts:90-96`) |
| Export 16 bits, TIFF | hors portée de la carte ; mesuré ici : export **JPEG 8 bits uniquement**, `convertToBlob({type:"image/jpeg"})` (`src/export/exportImage.ts:107`), pile composite entière, aucun export par calque (`src/layers/isolation.ts:22`) |

---

## 5. Deux écarts trouvés en chemin, hors sujet du ticket

Notés parce qu'ils sont mesurés et qu'ils se perdraient autrement. Ce document
ne les traite pas.

1. **`MAX_PHOTO_LAYERS` vaut 5 dans le code** (`src/layers/photoLayer.ts:66`),
   contre **4** annoncé par `CONTEXT.md:259` et `ARCHITECTURE.md:565`.
2. **La moitié radiale du dégradé de masque n'a jamais été livrée**, alors que
   le PRD la donnait en vague 1 (`...masking-prd.md:77`) et qu'aucun document ne
   la signale comme manquante. Voir 1.6.

---

## 6. Ce que je n'ai pas mesuré, et qu'il ne faut pas croire mesuré

- **Aucune preuve visuelle.** Rien ici n'a été rendu ni regardé. Les verdicts de
  doublon portent sur ce qu'un opérateur PEUT produire, jamais sur ce qui est
  beau — la distinction est celle du bloc 1 du ROADMAP.
- **Aucun doublon n'a été prouvé À L'OCTET.** La règle du dépôt exige une mesure
  avant un RETRAIT ; ce document ne retire rien, il classe. Les verdicts 1.7
  (saturation) et 2 (bleach bypass) sont ceux qui gagneraient le plus à une
  mesure réelle avant d'être opposés à quiconque : porter le scénario, comparer
  les MD5, c'est le protocole d'ADR-0016.
- **Les photos d'Antoine n'ont pas été demandées.** Tout ce document s'appuie sur
  son cahier dicté, ce qui est déjà mieux que des références publiques — mais la
  leçon `lensFlare` reste : une référence dit ce qu'une fonction PEUT être, ses
  photos disent ce qu'elle DOIT être. Vrai en particulier pour 1.2 (quel halo est
  acceptable) et 1.10.
- **Ce n'est pas un inventaire exhaustif de Photoshop ni de Lightroom.** Le
  parcours est parti du cahier dicté par Antoine et du registre réel, puis n'est
  sorti du dépôt que pour deux points de formule. Un balayage systématique du
  menu Filtre ou des panneaux de Lightroom donnerait d'autres candidats — il
  donnerait aussi beaucoup de bruit, et la leçon `lensFlare` dit lequel des deux
  chemins paie.
- **Aucune dépendance externe n'est proposée.** Toutes les entrées sont du WGSL
  à écrire ici. La seule ressource tierce citée est le jeu CC0 déjà livré
  (ambientCG / Poly Haven, licences vérifiées à la source par le chantier
  textures) ; aucune bibliothèque n'est recommandée, donc aucun cas
  `webgpu-image-filter` ne se pose.

---

## Sources

**Code, mesuré sur disque le 2026-08-11** (`master` @ `012fc10`) :
`src/render/effects/registry.ts`, `catalog.ts`, `curves.ts`, `channelMixer.ts`,
`duotone.ts`, `gradientMap.ts`, `grain.ts`, `warp.ts`, `texture.ts`,
`types.ts`, `validate.ts` · `src/render/blend/registry.ts`, `modes.ts` ·
`src/render/shaderCompose.ts`, `effectPassRunner.ts`, `framePipelineExecutor.ts`,
`maskTextureResolver.ts` · `src/mask/sources/{types,gradient,luminosity,colorRange,registry}.ts`,
`src/mask/{types,maskPainter}.ts` · `src/layers/{types,layerStack,clipping,photoLayer}.ts` ·
`src/ui/{curveControl,transform,tools,canvasMode}.ts` · `src/presets/{presetDocument,presetTypes}.ts` ·
`src/export/exportImage.ts` · `test/render/effects/registry.test.ts`.

**Sources externes de première main** (deux seulement, et c'est délibéré — le
cahier dicté par Antoine est plus proche du besoin qu'une documentation
générale ; les définitions extérieures n'ont été cherchées que là où la
FORMULE ou la BANDE de l'opérateur devait être exacte) :

- *CSS Compositing and Blending Level 1*, W3C, Candidate Recommendation Draft du
  21 mars 2024 — <https://www.w3.org/TR/compositing-1/> : classification des
  quatre modes non séparables, leurs définitions verbatim et les cinq fonctions
  auxiliaires `Lum` / `Sat` / `ClipColor` / `SetLum` / `SetSat`. Spécification
  ouverte, aucune dépendance à embarquer.
- *From the ACR Team: Introducing the Texture Control*, équipe Camera Raw
  d'Adobe, 14 mai 2019 — <https://blog.adobe.com/en/publish/2019/05/14/from-the-acr-team-introducing-the-texture-control> :
  bandes de fréquence de Texture, Clarity et Sharpening, dans leurs mots.

Aucune bibliothèque tierce n'est citée ni recommandée, donc aucune licence de
code n'est engagée par ce document.

**Documents du dépôt** :
`docs/superpowers/specs/2026-08-03-references-postproduction.md` (cahier dicté
par Antoine, 666 lignes — source principale de cette recherche) ·
`2026-08-01-references-effets.md` (cahier Figma) ·
`2026-07-18-shaderlab-layers-masking-prd.md` ·
`2026-08-05-textures-scans-design.md` · `2026-08-05-elements-et-composition-cadrage.md` ·
`docs/ROADMAP.md` · `docs/INDEX.json` · `CONTEXT.md` · `ARCHITECTURE.md` ·
`CLAUDE.md` · `PRD-print-export.md` · `.claude/decisions/INDEX.md`
(ADR-0008, ADR-0010, ADR-0011, ADR-0016, ADR-0018).
