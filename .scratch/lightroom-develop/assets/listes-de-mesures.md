# Les listes de mesures prêtes à lancer

Le pont de mesure marche sans clic depuis que `LrForceInitPlugin = true` est posé
dans `Info.lua` (commit `ae6774c`) : Lightroom exécute le script au démarrage au
lieu d'attendre qu'on touche le module externe. Une campagne, c'est donc deux
fichiers à poser dans `Documents/` puis **un redémarrage de Lightroom** (une
quinzaine de secondes, dialogue de fin).

- `shaderlab-mesures-go.txt` — une ligne, le chemin de la mire à mesurer ;
- `shaderlab-mesures-extra.txt` — une mesure par ligne : `nom`, une TABULATION,
  puis `Cle=Valeur` séparés par des points-virgules. Les deux fichiers sont
  consommés (supprimés) par la course.

⚠️ Les clés qui comptent ne sont pas toujours celles du panneau. Les teintes
Ombres / Hautes lumières du Color Grading vivent sous `SplitToning*` ;
`ColorGradeShadowHue` et ses voisines sont IGNORÉES par Lightroom Classic.

---

## Campagne A — les teintes du Color Grading (mire principale)

**Pourquoi.** C'est le premier poste d'erreur du module, et il n'est pas
corrigible sans mesure : nos directions de teinte sont fausses de +15,7° sur
l'orange, −12,9° sur le vert et +26,8° sur le bleu, et la déformation n'est pas un
décalage constant. Sept hypothèses d'espace ont été testées et rejetées. Avec
trois teintes mesurées seulement (40, 120, 220) on ne peut ni expliquer la loi ni
l'interpoler honnêtement. Huit teintes de plus la rendent identifiable.

✅ **RÉVISÉE le 2026-09-23 — même durée de course, DEUX FOIS plus de signal.**
[`research/21`](../research/21-la-balance-n-est-pas-en-cause-c-est-la-teinte.md)
a mesuré les trois teintes connues et a montré au passage que la forme de mesure
décide de la moitié du résultat : `st-ombres-bleu` (roue des ombres seule) ne rend
que **107 niveaux** où un angle se lit, quand `st-balance-m100` — même teinte,
`SplitToningBalance=-100` — en rend **197**. La raison est mécanique : le poids des
ombres s'éteint en haut de rampe, la chroma y passe sous le seuil de lecture et
l'angle devient du bruit de quantification.

Chiffré sur le twin (`assets/campagne-a-couverture.mjs`), qui tombe à 5 niveaux
près des deux formes déjà mesurées chez Lightroom :

| forme | niveaux lisibles (médiane sur 10 teintes) |
|---|---|
| roue des ombres seule — la campagne telle qu'écrite | **102** |
| ombres + `SplitToningBalance=-100` | **218** |
| roue GLOBALE (`ColorGradeGlobalHue`) | 245 |
| médians seuls | 152 |

Trois décisions en découlent :

1. **Chaque ligne de teinte porte `SplitToningBalance=-100`.** Tout bascule du côté
   des ombres, donc la teinte couvre la rampe entière. Coût : une clé de plus par
   ligne, zéro mesure de plus. ⚠️ Et contrairement à `st-balance-m100`, la roue des
   hautes lumières reste à saturation 0 : **aucune contamination** — c'est elle qui
   faisait diverger de 4,5° les deux mesures du bleu.
2. **Les trois teintes déjà connues sont re-mesurées sous cette forme.** 40 vit
   aujourd'hui sur les HAUTES lumières et 140 sur les MÉDIANS : les comparer aux
   huit neuves reviendrait à mêler trois roues. Onze teintes, une seule roue, une
   seule forme — trois mesures de plus, et la série devient homogène.
3. ⚠️ **Le postulat « un seul modèle de mélange, donc une seule loi de teinte pour
   les quatre roues » n'a jamais été éprouvé**, et toute la série repose dessus.
   Deux lignes sur la roue GLOBALE aux mêmes teintes le testent : même écart, le
   postulat tient ; écart différent, la loi est par roue et la série ne vaut que
   pour les ombres. ✅ La clé `ColorGradeGlobalHue` est **honorée** — vérifié sur
   `grading2-global-bleu`, 207 niveaux de chroma ajoutée
   (`assets/globale-cle-marche.mjs`) — contrairement à `ColorGradeShadowHue` et
   `ColorGradeHighlightHue`, que Lightroom ignore.

`shaderlab-mesures-go.txt` :

```
C:\Users\LEETJ\Pictures\shaderlab-mire\shaderlab-mire-lightroom.jpg
```

`shaderlab-mesures-extra.txt` :

```
temoin4	
st-h000	SplitToningShadowHue=0;SplitToningShadowSaturation=60;SplitToningBalance=-100
st-h040	SplitToningShadowHue=40;SplitToningShadowSaturation=60;SplitToningBalance=-100
st-h060	SplitToningShadowHue=60;SplitToningShadowSaturation=60;SplitToningBalance=-100
st-h090	SplitToningShadowHue=90;SplitToningShadowSaturation=60;SplitToningBalance=-100
st-h140	SplitToningShadowHue=140;SplitToningShadowSaturation=60;SplitToningBalance=-100
st-h150	SplitToningShadowHue=150;SplitToningShadowSaturation=60;SplitToningBalance=-100
st-h180	SplitToningShadowHue=180;SplitToningShadowSaturation=60;SplitToningBalance=-100
st-h220	SplitToningShadowHue=220;SplitToningShadowSaturation=60;SplitToningBalance=-100
st-h270	SplitToningShadowHue=270;SplitToningShadowSaturation=60;SplitToningBalance=-100
st-h300	SplitToningShadowHue=300;SplitToningShadowSaturation=60;SplitToningBalance=-100
st-h330	SplitToningShadowHue=330;SplitToningShadowSaturation=60;SplitToningBalance=-100
cg-glob-h040	ColorGradeGlobalHue=40;ColorGradeGlobalSat=60
cg-glob-h220	ColorGradeGlobalHue=220;ColorGradeGlobalSat=60
st-ombres-sat20	SplitToningShadowHue=220;SplitToningShadowSaturation=20;SplitToningBalance=-100
st-ombres-sat100	SplitToningShadowHue=220;SplitToningShadowSaturation=100;SplitToningBalance=-100
cg-fusion-25	SplitToningShadowHue=220;SplitToningShadowSaturation=60;SplitToningHighlightHue=40;SplitToningHighlightSaturation=60;ColorGradeBlending=25
cg-fusion-75	SplitToningShadowHue=220;SplitToningShadowSaturation=60;SplitToningHighlightHue=40;SplitToningHighlightSaturation=60;ColorGradeBlending=75
st-balance-m50	SplitToningShadowHue=220;SplitToningShadowSaturation=60;SplitToningHighlightHue=40;SplitToningHighlightSaturation=60;SplitToningBalance=-50
st-balance-p50	SplitToningShadowHue=220;SplitToningShadowSaturation=60;SplitToningHighlightHue=40;SplitToningHighlightSaturation=60;SplitToningBalance=50
temperature-m50	IncrementalTemperature=-50
```

**Onze teintes** (`st-h*`), toutes sur la roue des ombres à Balance −100 : huit
neuves plus les trois déjà connues, re-mesurées sous cette forme pour que la série
soit homogène. **Deux contrôles de roue** (`cg-glob-h040`, `cg-glob-h220`)
éprouvent le postulat « une seule loi pour les quatre roues », sur lequel toute la
série repose. Les deux saturations donnent la loi d'amplitude, les doses
intermédiaires de fusion et de balance comblent les trous qui rendaient leurs lois
indéterminées, et `temperature-m50` est la dose qui manquait au milieu du
retournement de la branche froide de la balance des blancs — sans elle, ses
paliers restent bloqués.

**Se lit par `assets/balance-isole-les-teintes.mjs`**, qui prend le nom de scène et
la teinte posée, et rend l'angle mesuré, l'angle calculé, leur écart et
l'écart-type sur les niveaux lus. ⚠️ **Lire l'écart-type avant l'écart** : sur les
scènes déjà au disque il vaut 0,83° à 4,19°, et une teinte dont il monterait
beaucoup signalerait que l'angle y dérive avec le niveau — ce qui ne se corrige
pas par une rotation.

✅ **LANCÉE ET DÉPOUILLÉE le 2026-09-23.** Course de 05:43:41 à 05:43:59, 21
exports. Les onze teintes rendent **202 à 219 niveaux lisibles** chacune — la
révision ci-dessous a bien doublé le signal, le twin prédisait 218. Résultats :
[`research/22`](../research/22-la-campagne-a-et-la-direction-de-teinte.md).
En deux lignes : **la direction de teinte vient de ProPhoto** (5,00° contre 13,42°
en service sur l'angle, 3,77 contre 8,87 niveaux sur les rampes), et **l'ancienne
question était mal posée** — la direction n'est pas définie pour six teintes sur
onze, l'anomalie du bleu à +21,3° était un artefact de lecture près d'un point de
branchement d'OKLab, et elle tombe à +2,0° à mi-saturation.

🔴 **ARMÉE le 2026-09-23, sur décision d'Antoine.** Les deux sentinelles ont été
posées dans `Documents/` — **21 lignes, 64 clés, 11 teintes, 2 contrôles de roue**. ⚠️ **Elle a DÉSARMÉ la campagne E**
(Détail), qui occupait `go.txt` avec `DSCF5171.JPG` sans jamais avoir été lancée :
une seule photo par course. E se réarme depuis son propre bloc plus bas, rien
n'est perdu.

Deux précautions prises à l'armement, et elles valent d'être refaites tel quel :

- **le bloc n'est pas retapé**, il est extrait de ce fichier par ancres — donc ce
  qui est armé est exactement ce qui est versionné, et les TABULATIONS survivent ;
- **LF pur, jamais CRLF.** Le parseur lit les valeurs en `([%w]+)=([^;]+)`, donc la
  dernière paire de chaque ligne capture jusqu'à la fin de ligne : un `\r` y
  entrerait et `tonumber("-100\r")` rendrait `nil`. La campagne perdrait en
  silence une clé par ligne — et ce serait `SplitToningBalance=-100`, celle que
  toute cette révision ajoute. ⚠️ Le `go.txt` de la campagne E était en CRLF ; il
  survit parce qu'un `gsub("%s+$", "")` le nettoie, ce qui n'existe pas côté
  `extra.txt`.

Le parseur Lua est **simulé avant de poser** (`assets/armer-campagne-a.py`, gardé
au scratchpad de session) : une ligne qui ne matcherait pas
`^([%w%-%_]+)\t(.*)$` est ignorée EN SILENCE par le plugin, et une course coûte un
redémarrage plus une quinzaine de minutes.

A et F sont toutes deux sur la mire et pourraient fusionner en une seule course ;
**A est la plus rentable des deux** — elle vise le premier poste d'erreur du
module, et research/21 en chiffre le gain à au moins −17,5 % de moyenne et
−26,3 % de pire cas.

---

## Campagne B — les opérateurs locaux (mire locale)

**Pourquoi.** Voile, clarté et accentuation ne se mesurent pas sur la mire
principale : ses patches sont contigus, sa rampe monte par marches de 8 px, et ses
bords sont des bords de teinte à canal fort constant. Détail et chiffres dans
l'en-tête de `mire/faire-mire-locale.py`. La mire locale porte des bandes pleine
largeur (un opérateur local y voit un vrai aplat) et des échelons d'intensité dont
le côté sombre est sous Ylin 0,10 sans aucun canal écrêté.

`shaderlab-mesures-go.txt` :

```
C:\Users\LEETJ\Pictures\shaderlab-mire\shaderlab-mire-locale.jpg
```

`shaderlab-mesures-extra.txt` :

```
loc-temoin	
loc-voile-m100	Dehaze=-100
loc-voile-m50	Dehaze=-50
loc-voile-p50	Dehaze=50
loc-voile-p100	Dehaze=100
loc-clarte-p100	Clarity2012=100
loc-clarte-m100	Clarity2012=-100
loc-texture-p100	Texture=100
loc-nettete-025	Sharpness=25;SharpenRadius=1.0;SharpenDetail=25;SharpenEdgeMasking=0
loc-nettete-060	Sharpness=60;SharpenRadius=1.0;SharpenDetail=25;SharpenEdgeMasking=0
loc-nettete-100	Sharpness=100;SharpenRadius=1.0;SharpenDetail=25;SharpenEdgeMasking=0
loc-nettete-150	Sharpness=150;SharpenRadius=1.0;SharpenDetail=25;SharpenEdgeMasking=0
loc-nettete-150-r2	Sharpness=150;SharpenRadius=2.0;SharpenDetail=25;SharpenEdgeMasking=0
loc-nettete-150-masq50	Sharpness=150;SharpenRadius=1.0;SharpenDetail=25;SharpenEdgeMasking=50
```

La série d'accentuation à rayon constant et force croissante (25, 60, 100, 150)
répond à la question que les quatre premières mesures ont laissée ouverte : le
genou d'asymétrie SUIT-il la force, ce qui trahirait un modèle mal spécifié, ou
reste-t-il fixe, ce qui en ferait une vraie propriété de l'opérateur ?

⚠️ La mire locale n'a ni rampe ni balayage : `analyse-mesures.py` ne sait pas la
lire. Ses exports s'analysent directement depuis les JPEG (PIL), avec la géométrie
que `faire-mire-locale.py` imprime en fin de course.

---

## Campagne C — Texture et Clarté (mire de présence) — LANCÉE le 2026-09-16

**Pourquoi.** Ces deux curseurs ne se mesurent sur aucune des deux autres mires :
une rampe lisse les rend inertes, un échelon excite toutes les échelles à la fois.
La mire de présence porte un axe par question — échelle, amplitude, ton — plus des
aplats témoins et des marches. Résultats : `research/05-texture-et-clarte-mesurees.md`.

⚠️ **Une taille de mire par démarrage** : le plugin lit une seule ligne de
sentinelle. Cette campagne en a donc TROIS, et c'est délibéré — la troisième
(1024) existe parce que les deux premières ne séparaient pas un rayon
proportionnel à la racine de l'aire d'un rayon proportionnel à la largeur.

⚠️ **La mire porte sa taille dans son nom** (`…-2048x7584.jpg`). Lightroom garde
une photo dans son catalogue PAR CHEMIN : réécrire le même nom avec une géométrie
différente lui fait ressortir la précédente, et la campagne mesure alors une mire
qui n'existe plus. Une géométrie neuve = un nom neuf.

`shaderlab-mesures-go.txt`, l'une des trois :

```
C:\Users\LEETJ\Pictures\shaderlab-mire\shaderlab-mire-presence-2048x7584.jpg
C:\Users\LEETJ\Pictures\shaderlab-mire\shaderlab-mire-presence-2x-4096x7584.jpg
C:\Users\LEETJ\Pictures\shaderlab-mire\shaderlab-mire-presence-demi-1024x7584.jpg
```

`shaderlab-mesures-extra.txt` pour la mire 2048 (les deux autres n'ont besoin que
du témoin, de `texture-p100` et de `clarte-p100`, préfixés `pres2x-` / `presdemi-`) :

```
pres-temoin	
pres-texture-p100	Texture=100
pres-texture-p50	Texture=50
pres-texture-m50	Texture=-50
pres-texture-m100	Texture=-100
pres-clarte-p100	Clarity2012=100
pres-clarte-p50	Clarity2012=50
pres-clarte-m50	Clarity2012=-50
pres-clarte-m100	Clarity2012=-100
pres-voile-p100	Dehaze=100
```

L'analyse (`analyse-mire-presence.py`) apparie l'export à sa géométrie par la
TAILLE EXACTE, largeur et hauteur : le dossier d'exports est partagé avec les deux
autres mires et l'une d'elles a la même largeur. Un export dont la taille ne
correspond à aucune géométrie est ignoré, jamais deviné.

---

## Campagne D — Texture sur une VRAIE PHOTO — LANCÉE le 2026-09-16

**Pourquoi.** La mire donnait un écart moyen de 0,057 à Lightroom sur quatorze
échelles, et Antoine a dit « toujours pas satisfait par texture ». Une référence
de pixels prouve qu'un opérateur porte sa propriété, jamais qu'il est beau — et
un réseau à une seule fréquence ne distingue pas une étagère d'un ANNEAU.
Résultats : `research/08-le-portail-de-texture.md`.

⚠️ **PHOTO D'ORIGINE BOÎTIER UNIQUEMENT.** Un export déjà développé dans
Lightroom ferait juger nos opérateurs par-dessus un développement étranger —
vérifier `Software` dans l'EXIF avant d'ajouter une photo.

`shaderlab-mesures-go.txt` :

```
C:\Users\LEETJ\Pictures\2018\2018-01-25\DSCF5171.JPG
```

`shaderlab-mesures-extra.txt` :

```
ph-temoin	
ph-texture-p40	Texture=40
ph-texture-p100	Texture=100
ph-texture-m60	Texture=-60
```

Notre côté se rend par `assets/photo-texture-rendu.mjs` (détourages 1:1), se
chiffre par `assets/mesure-photo-texture.py` et se regarde par
`assets/planche-photo-texture.py`.

⚠️ **Le profil de bord se SÉPARE PAR POLARITÉ.** La frontière traverse le
détourage dans les deux sens ; moyenner les deux ensemble annule tout halo SIGNÉ
et ne laisse que sa part symétrique. Un liseré d'accentuation est signé — la
première lecture, faite sans cette séparation, montrait un soulèvement des DEUX
côtés chez Lightroom, ce qui n'existe pas.

---

## Campagne E — le panneau DÉTAIL (photo boîtier)

⚠️ **DÉSARMÉE le 2026-09-23 au profit de la campagne A**, sur décision d'Antoine.
Elle avait été armée plusieurs jours sans être lancée, et `go.txt` ne tient qu'une
photo. **Rien n'est perdu** : les deux sentinelles se réécrivent depuis le bloc
ci-dessous, à la même mécanique que celle décrite au bloc A — extraction par
ancres, LF pur, parseur simulé avant de poser.

**Pourquoi.** [`research/15`](../research/15-l-anneau-de-texture-est-un-debruitage-manquant.md)
établit que l'anneau de Texture n'est pas un défaut de portail mais un
débruitage absent : sur un signal dégrainé, la course du portail passe de 1,5 % à
52 %. Le [ticket 10](../issues/10-module-detail.md) charte le module ; cette
campagne lui donne ses AMPLITUDES. Les dix réglages ont été vérifiés dans le
binaire avant d'être demandés, chacun cherché seul et borné.

**S'arme par `assets/campagne-detail.py`**, qui écrit les deux sentinelles.
⚠️ Ne pas les écrire à la main : `mesures.lua` remet à zéro une longue liste
(`M.ZERO`) mais elle ne contient PAS les modulateurs du panneau —
`LuminanceNoiseReductionDetail`, `…Contrast`, `ColorNoiseReduction*`,
`SharpenRadius`, `SharpenDetail`, `SharpenEdgeMasking`. Sans les poser
explicitement, ils gardent ce que le catalogue a pour cette photo, et la
campagne mesurerait l'historique d'une image au lieu d'une loi. Le script les
écrit sur chaque ligne.

Seize mesures sur `DSCF5171.JPG`, dont le grain est déjà chiffré à **6,663**
par `assets/trouver-photo-propre.py` — les deux côtés se comparent au même
instrument.

| bloc | mesures | ce qu'il donne |
|---|---|---|
| loi de réduction | `det-lum25/50/75/100` | combien de grain part, par dose |
| modulateurs | `det-lum50-det0/det100/con100` | ce que Détail et Contraste retiennent |
| coût en netteté | `det-lum100-det0` | le compromis que tout débruiteur arbitre |
| **l'interaction** | `det-tex100-nr0/nr50/nr100` | Texture sur un grain déjà réduit — la raison du chantier |
| netteté | `det-sh40-r1/r3/det100/mask100` | les quatre réglages, un axe à la fois |

**Se lit par `assets/analyse-detail.py`** — grain (décile le plus plat), netteté
(décile le plus structuré) et acuité (largeur de transition sur les bords
francs). Tolérant aux manques : lancé pendant la course, il imprime ce qui existe
et nomme ce qui manque.

✅ **L'instrument est CONTRÔLÉ sur les exports déjà au disque**, avant toute
conclusion : il rend un grain de **6,680** sur `ph-temoin` là où la mesure
indépendante de `trouver-photo-propre.py` donne **6,663**, et il reproduit
l'amplification de grain de Texture que [`research/08`](../research/08-le-portail-de-texture.md)
avait mesurée — ×1,64 à +100 et ×0,55 à −60, contre ×1,76 et ×0,53 chez elle.
Deux chemins de code indépendants, les mêmes nombres.

---

## Campagne F — le signe NÉGATIF des trois autres roues (mire principale)

**Pourquoi, et pourquoi CES trois mesures.** [`research/18`](../research/18-la-forme-est-une-pente-en-lumiere-lineaire-plus-un-point-noir.md)
a identifié la forme du virage sur la roue des OMBRES : une pente en lumière
linéaire, plus un point noir séparé qui ne sert qu'à la montée. Le poids de plage
réel s'y est extrait — une sigmoïde, là où le nôtre est une puissance — et le
modèle domine celui en service sur les deux domaines de la rampe.

Ce qui bloque la livraison n'est pas une décision : **le poids ne s'extrait que du
signe NÉGATIF**. C'est là que le lift est nul, donc que la pente se lit seule, et
c'est ce qui rend l'extraction possible sans supposer d'amplitude. Or les roues
médians, hautes lumières et globale n'ont que leur `+50`. Poser le modèle sur les
quatre en n'ayant mesuré le poids que des ombres substituerait une forme mesurée
sur une roue à une forme modélisée sur quatre.

Les deux mesures d'appoint (`±100` des ombres) bornent l'extrapolation sur la
dose, que research/18 a dû poser par raisonnement — un gain se compose, un lift
s'additionne — sans pouvoir la vérifier.

⚠️ **Ne PAS armer tant que la campagne E n'a pas rendu ses exports** :
`shaderlab-mesures-go.txt` ne tient qu'UNE photo, et E porte `DSCF5171.JPG`.
Celle-ci est sur la MIRE. C'est une seconde course, pas un ajout.

`shaderlab-mesures-go.txt` :

```
C:\Users\LEETJ\Pictures\shaderlab-mire\shaderlab-mire-lightroom.jpg
```

`shaderlab-mesures-extra.txt` :

```
temoin5	
cg-moyens-lum-m50	ColorGradeMidtoneLum=-50
cg-hl-lum-m50	ColorGradeHighlightLum=-50
cg-global-lum-m50	ColorGradeGlobalLum=-50
cg-ombres-lum-p100	ColorGradeShadowLum=100
cg-ombres-lum-m100	ColorGradeShadowLum=-100
```

| mesure | ce qu'elle donne |
|---|---|
| `cg-moyens-lum-m50` | le profil de poids des MÉDIANS, par la pente |
| `cg-hl-lum-m50` | celui des HAUTES LUMIÈRES — la roue dont le poids est connu NON MONOTONE, et dont les deux mesures d'amplitude divergent (0,1798 contre 0,0148) |
| `cg-global-lum-m50` | celui de la GLOBALE, qui n'est pas plat mais cloché sur les tons moyens |
| `cg-ombres-lum-±100` | la borne de l'extrapolation sur la dose, aujourd'hui posée par raisonnement |

**Se lit par** `assets/extraire-poids-lightroom.mjs` (le profil de poids, avec ses
deux gardes : monotonie du profil, et discrimination contre l'hypothèse offset)
puis `assets/courbe-bas-de-rampe.mjs` (l'ajustement sur le bas et son coût sur le
haut). Les deux sont écrits pour la roue des ombres ; ils prendront la roue en
paramètre à cette occasion.

⚠️ **Le témoin se relit avant toute conclusion.** Sur la rampe des ombres il
s'écarte au plus de 0,032 niveau, mais la campagne D a mesuré une dérive d'export
de ×1,004 ailleurs : une forme lue au bas de rampe sans ce contrôle pourrait être
la dérive.
