# La portée de Texture et de Clarté — et pourquoi la première campagne ne pouvait pas la lire

Mesuré le 2026-09-16, Lightroom Classic 14.5.1. Instruments :
`assets/mire/faire-mire-portee.py`, `faire-mire-bitonale.py`,
`assets/analyse-mire-portee.py`. Relevés : `mesures-presence/por-*.json`,
`bit-*.json`.

## La question posée, et ce qui a dû être réparé avant d'y répondre

Question : le rayon de ces deux opérateurs se règle-t-il en **pixels** ou en
**fraction de l'image** ? De la réponse dépend la façon dont on les écrit, et
elle ne se déduit d'aucune mesure faite sur une seule taille d'image.

La mire de présence a des marches **verticales** : chaque plateau vaut la moitié
de la LARGEUR. Deux défauts l'ont rendue muette sur Clarté, et le second n'a été
vu qu'en regardant un profil.

**Défaut 1 — le plateau.** Ses deux estimateurs de largeur de halo rendaient,
pour Clarté, environ 0,9 fois le demi-plateau à toutes les tailles : 229, 452 et
950 px pour des demi-plateaux de 256, 512 et 1024. Ce n'est pas une mesure, c'est
une saturation — et c'est elle, et non l'opérateur, qui produisait la belle suite
« 125 · 219 · 295 px, ça suit la largeur ».

**Défaut 2 — le contenu, et il rendait la mire inerte.** Une marche entre deux
APLATS ne fait presque rien bouger. Le binaire nommait déjà la raison :
`cr_stage_localized_detail_clarity_mask`, à côté de
`cr_stage_localized_detail_clarity_blur`. **Clarté est portée par un masque de
DÉTAIL** ; sans détail alentour, elle ne fait rien, quel que soit son rayon. Un
aplat ne peut donc pas servir de plateau pour mesurer sa portée : il l'éteint.

D'où trois mires neuves, toutes à marche **horizontale** (le plateau vaut alors
la moitié de la HAUTEUR, qu'on choisit) :

- **zone PORTÉE** — réseau fin autour de 96 en haut, autour de 160 en bas. Du
  détail des deux côtés, donc l'opérateur est actif partout et la marche porte
  sur la moyenne locale.
- **zone PORTAIL** — aplat 128 en haut, réseau fin autour de 128 en bas. **Même
  ton des deux côtés** : il n'y a pas de marche de ton, seulement une marche de
  DÉTAIL. Tout ce qui bouge dans la moitié plate vient donc du détail d'à côté.
- **mire BI-TONALE** — deux aplats, 96 et 160, et rien d'autre dans l'image. Le
  témoin qui manquait : aucun détail nulle part.

Le réseau est vertical et le profil se prend selon y, moyenné sur les colonnes :
le réseau disparaît de la moyenne, et le profil ne porte que la réponse à la
marche.

## Texture : locale, absolue, et elle ne touche pas un aplat

| mesure | résultat |
|---|---|
| largeur efficace du halo | **10,4 px** (intégrale) · **12,1 px** (dérivée) |
| sur 4 largeurs (1024 → 4096) et 2 hauteurs (7584, 16384) | identique |
| marche verticale contre marche horizontale | identique (−9,3 / +10,9 les deux fois) |
| moitié plate du PORTAIL, à toute distance du détail | **0,00** |
| image bi-tonale, à partir de 32 px du bord | **0,00** |

Rien à nuancer : le rayon de Texture est en **pixels absolus**, il vaut une
douzaine de pixels, et l'opérateur est nul partout où son entrée est plate.

## Clarté : deux composantes, et une seule est locale

**Sur une image SANS détail** (mire bi-tonale, Clarté +100) :

| distance au bord | 0 | 2 | 8 | 32 | 128 | 1024 | 3900 |
|---|---|---|---|---|---|---|---|
| côté 96 | −18,52 | −6,20 | −0,08 | 0,00 | −0,23 | −0,67 | 0,00 |
| côté 160 | +22,98 | +7,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |

Huit pixels, et plus rien. **Il n'y a pas de courbe de ton globale** : le champ
lointain vaut exactement l'entrée. C'est ce qui réfute le « terme global de
−19,59 » du fichier 05 — ce déplacement-là existait bien, mais il était produit
par le détail du reste de la mire, pas par une courbe.

**Sur une image AVEC du détail ailleurs** (zone PORTAIL, moitié plate à 128, le
détail commence à la frontière) :

| distance au bord | 0 | 32 | 128 | 512 | 1024 | 2048 |
|---|---|---|---|---|---|---|
| Clarté +100 | −9,90 | −10,09 | −10,04 | −10,19 | −10,45 | −11,00 |
| Texture +100 | +0,03 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |

Aucune décroissance sur 2048 px. Même ton, même aplat, même dose que la mire
bi-tonale ; la seule différence est qu'il y a du détail **ailleurs dans l'image**.
La portée de cette composante dépasse donc le plateau entier.

## Ce dont dépend cette portée — la réponse à la question posée

**La largeur ne joue pas.** Trois largeurs, hauteur et plateaux identiques :

| distance | 0 | 8 | 128 | 1024 | 3900 |
|---|---|---|---|---|---|
| 1024 × 16384 | −22,31 | −6,44 | −6,24 | −7,67 | −8,43 |
| 2048 × 16384 | −22,10 | −6,22 | −5,92 | −7,44 | −8,21 |
| 4096 × 16384 | −21,84 | −5,97 | −5,73 | −7,18 | −7,87 |

Moins de 0,6 niveau d'écart sur un facteur 4 de largeur, et la dérive est
monotone et minuscule. Ce qui enterre définitivement la lecture « ça suit la
largeur » : c'était le plateau de l'estimateur, jamais l'opérateur.

**La hauteur, elle, joue — sur la composante large seulement.** Même largeur
(2048), plateau 4096 contre 2048 :

| distance | 0 | 2 | 8 | 32 | 128 | 512 | 1024 |
|---|---|---|---|---|---|---|---|
| hauteur 16384 | −22,10 | −12,41 | −6,22 | −5,77 | −5,92 | −6,74 | −7,44 |
| hauteur 8192 | −22,13 | −12,40 | −6,14 | −5,72 | −6,12 | −7,32 | −7,93 |

De 0 à 32 px : **identique à 0,08 près**. Cette composante-là est en pixels
absolus, comme Texture.

Au-delà, les deux profils divergent, et la comparaison à distance ÉGALE est moins
bonne que la comparaison à **fraction de plateau égale** : à mi-plateau, 16384
rend −8,14 et 8192 rend −7,93 (écart 0,21) ; à distance absolue égale (512 px),
elles rendent −6,74 et −7,32 (écart 0,58). La loi proportionnelle colle trois à
cinq fois mieux que la loi absolue.

**Rapport de 4 : la loi est tranchée.** Hauteurs 4096, 8192 et 16384 à largeur
constante — plateaux de 1024, 2048 et 4096 px. Dispersion moyenne entre les trois
hauteurs, dans le champ loin (au-delà de 64 px, donc hors du contraste court) :

| zone / côté | hypothèse ABSOLUE | hypothèse FRACTION | |
|---|---|---|---|
| portée / haut | 0,91 | **0,15** | fraction ×6,1 |
| portée / bas | 2,22 | **0,20** | fraction ×10,9 |
| portail / haut | 0,95 | **0,41** | fraction ×2,3 |
| portail / bas | 0,33 | 0,17 | absolu ×1,9 |

Trois lectures sur quatre donnent la FRACTION, et les deux de la zone PORTÉE la
donnent largement — l'hypothèse absolue y produit jusqu'à **5,48 niveaux** de
désaccord entre hauteurs, quand la fraction en produit 0,37. Le cas le plus net,
portée / bas à mi-course : lues à 512 px pour toutes, les trois hauteurs rendent
−0,33 · −2,65 · −3,93 ; lues à la moitié de leur plateau, elles rendent
−0,33 · −0,06 · −0,08.

La quatrième lecture (portail / bas) préfère l'absolu, et elle ne pèse rien : ses
deux dispersions valent 0,33 et 0,17, c'est-à-dire que ce côté-là — la moitié
DÉTAILLÉE du portail — ne bouge presque pas selon la hauteur. Il ne discrimine
rien, dans aucun sens.

Et le **contraste court reste absolu** sur ce même rapport de 4 : dispersion de
**0,09 à 0,46 niveau** entre les trois hauteurs, aux distances 0 à 32 px.

## À quelle dimension, alors ? Pas au grand côté

« Proportionnel à l'image » ne dit pas à quoi. Dans toutes les mires ci-dessus la
hauteur est le GRAND côté, donc « suit la hauteur » et « suit le grand côté » y
rendent la même chose. Une mire de **16384 × 4096** les sépare : même plateau que
la 2048 × 4096 (1024 px), mais un grand côté quatre fois plus long.

| portée / haut, distance px | 0 | 8 | 128 | 512 | 1000 |
|---|---|---|---|---|---|
| 2048 × 4096 | −22,23 | −6,16 | −6,56 | −7,88 | −7,97 |
| 16384 × 4096 | −21,86 | −5,94 | −6,37 | −7,71 | −7,80 |

Le profil est le **même**, à 0,4 niveau près, aux mêmes distances absolues. Un
rayon qui suivrait le grand côté aurait été quatre fois plus large et la courbe
se serait aplatie ; elle ne bouge pas. **La portée selon y suit la HAUTEUR**, et
la largeur ne la touche pas — ce que confirmait déjà le test à trois largeurs.

Une portée qui vaut une fraction de CHAQUE dimension prise séparément n'est pas
un rayon isotrope : c'est la signature d'une **pyramide à nombre de niveaux
fixe**, qui réduit l'image dans les deux axes jusqu'à un gabarit constant.

⚠️ **Un effet mesuré et non expliqué** : élargir l'image huit fois à hauteur
constante ne change pas la FORME du profil mais en réduit l'AMPLITUDE d'environ
40 %, uniformément — le portail passe de −10,4 à −6,0 sur toute la longueur du
plateau, et la zone portée se décale de +2,1 sans changer d'allure. Un décalage
constant, pas une déformation. Noté, pas modélisé.

**Conclusion.** Clarté se compose d'un contraste **court et absolu** (≈ 8 px, le
seul qui survive sur une image sans détail) et d'une composante **large dont la
portée vaut une fraction de chaque dimension de l'image**, de l'ordre du quart de
la hauteur — et encore, elle dérive encore au bout du plateau à toutes les
hauteurs testées, donc ce quart est un plancher, pas une mesure de sa longueur.

## Ce que ça décide pour nous

- **Texture s'écrit en pixels.** Un rayon d'une douzaine de pixels, constant,
  quelle que soit la taille de l'image. Notre tente à un texel est dix fois trop
  courte, et c'est un nombre, pas une architecture, qu'il faut changer.
- **Clarté s'écrit en deux morceaux.** Notre pyramide, relative à l'image, a
  exactement la bonne FORME pour la composante large — une pyramide à nombre de
  niveaux fixe EST une portée proportionnelle à chaque dimension, et c'est ce que
  la mesure décrit. Ce qui manque est le nombre de niveaux : elle rend 13,5 px là
  où il en faut de l'ordre du quart de la hauteur. Et il manque entièrement le
  second morceau, le contraste court de 8 px en pixels absolus.
- **Et surtout : Clarté doit être éteinte par l'absence de détail.** C'est la
  propriété la plus visible de l'opérateur d'Adobe et celle qu'aucun de nos deux
  modules ne porte : chez nous, `clarity` agit sur tout écart au flou, y compris
  celui que produit une simple frontière entre deux aplats. C'est probablement ce
  qui fait qu'à forte dose notre Clarté cerne les bords au lieu de porter la
  matière.

## Ce qui a été corrigé le 2026-09-16, et ce qui reste

**Texture est corrigée**, et l'écart à Lightroom tombe d'un facteur six.

| Texture +100, gain par période | 3 | 16 | 64 | 256 | écart moyen sur 14 périodes |
|---|---|---|---|---|---|
| Lightroom | 1,75 | 1,51 | 1,37 | 1,12 | — |
| shaderlab avant | 1,99 | **1,04** | **1,07** | **1,00** | **0,326** |
| shaderlab après | 1,82 | 1,59 | 1,38 | 1,11 | **0,057** |

Et l'axe qui n'existait pas du tout chez nous, l'amplitude (période 16, de 2 à 64
niveaux) : Lightroom 1,79 → 1,15 ; nous, avant, **plat à 1,04** ; après,
1,69 → 1,15. Écart moyen 0,555 → 0,125.

Trois pièces, chacune imposée par une mesure :

1. **Deux bandes.** Le calcul exact de la réponse d'un noyau unique — tous
   écartements confondus — le fait mourir avant la période 32, quand Lightroom
   tient 1,37 à 64. La bande fine est un noyau de treize prélèvements à
   écartement absolu (2,1 px), la bande moyenne est la pyramide. Les poids sont
   ajustés sur les quatorze gains mesurés, pas choisis.
2. **Treize prélèvements et pas neuf.** Une tente étirée laisse des trous entre
   ses points et REPLIE : à l'écartement 6 px, le gain mesuré tombait à 1,00 à la
   période 3 — le curseur était aveugle là où il compte le plus.
3. **L'epsilon du filtre guidé, gratuit.** La pyramide transporte désormais
   `(luminance, sqrt(luminance))` au lieu d'une couleur. Son premier canal vaut
   exactement l'ancien `dot(rgb, luma)`, donc aucune calibration de ton ne bouge ;
   et `r − g²` EST la variance locale, puisque y au carré est la luminance. Zéro
   passe de plus, zéro lecture de plus.

**Clarté n'est pas corrigée, et ce n'est pas une constante qui manque.** Sa
portée vaut une fraction de chaque dimension de l'image — une pyramide bien plus
profonde que la nôtre. Or la bande moyenne de Texture a besoin de la profondeur
ACTUELLE, et la chaîne de passes est linéaire : elle ne peut pas transporter deux
profondeurs à la fois. Approfondir la pyramide casserait Texture. C'est une
limite de structure, et elle se lève d'une seule façon — donner au moteur de
passes un second flou, soit une seconde texture liée, soit un second module.

⚠️ **CE MÊME MANQUE A UN TROISIÈME CLIENT, et c'est le plus cher** : le portail
de Texture. Mesuré sur photo le 2026-09-16, il ne détecte pas les bords mais le
GRAIN — la variance locale vaut 0,015 partout, l'epsilon 0,0082, donc le portail
reste bloqué à 0,33 avec 15 % de course au bord. Le séparer demande la variance
du signal PASSE-BAS, pas la variance locale, c'est-à-dire un second créneau de
lissage. Deux corrections ont été écrites et revertées avant que ça se mesure :
[`08-le-portail-de-texture.md`](08-le-portail-de-texture.md), à lire AVANT d'y
retoucher.

⚠️ **Un portail de détail a été écrit puis RETIRÉ le même jour.** L'idée venait
d'une phrase de ce fichier — « Clarté doit être éteinte par l'absence de détail » —
et deux mesures l'ont réfutée comme mécanisme. D'abord Lightroom garde un gain
plat de 1,77 pour des amplitudes de 2 à 32 niveaux : son opérateur est LINÉAIRE
dans le détail, il n'a pas de seuil. Ensuite notre Clarté ne touchait déjà pas un
aplat — un contraste local y vaut zéro par construction. Le portail ne corrigeait
donc rien et introduisait une dépendance à l'amplitude que Lightroom n'a pas ;
posé, mesuré, retiré.

**Coût.** Sur la mire (15,5 Mpx), rendu de bout en bout, build de dev : témoin
136,7 ms · texture 145,8 · clarté 145,1 · les deux 150,0 · exposition seule
147,2. La dernière ligne est la preuve que le reste est du bruit — l'exposition
ne réveille aucune pyramide et sort pourtant plus haut que Texture qui en réveille
une. Le surcoût est donc sous le plancher de cet instrument (±2 à 3 ms). ⚠️ Et
cela ne prouve rien sur la cadence : elle se mesure en build de PRODUCTION, dont
le plancher vaut 2,6 fois celui du dev.

## Pièges d'instrument payés dans cette campagne

- **Un estimateur qui rend 0,9 × son plateau ne mesure rien.** Les deux
  estimateurs de largeur le faisaient, et ils avaient l'air de s'accorder sur une
  belle loi. Le seul contrôle qui l'a montré est d'avoir imprimé le PROFIL au
  lieu du scalaire.
- **Deux mires de même taille se disputent l'appariement.** La mire bi-tonale
  faisait d'abord 2048 × 8192, comme une mire de portée : sa campagne a écrasé
  les relevés de l'autre, qui portaient les mêmes noms de mesure. L'analyse
  REFUSE désormais une taille revendiquée par deux géométries, au lieu de prendre
  la première trouvée — une ambiguïté s'arrête, elle ne se tranche pas en
  silence. Et la bi-tonale fait maintenant 8000 px de haut, pour ne pas créer
  l'ambiguïté qu'on vient d'apprendre à refuser.
- **Une marche entre deux aplats ne mesure pas un opérateur gaté par le détail.**
  Le plateau doit porter ce qui réveille l'opérateur, sinon on mesure son
  sommeil.
