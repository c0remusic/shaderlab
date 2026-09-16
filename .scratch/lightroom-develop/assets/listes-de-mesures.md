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

`shaderlab-mesures-go.txt` :

```
C:\Users\LEETJ\Pictures\shaderlab-mire\shaderlab-mire-lightroom.jpg
```

`shaderlab-mesures-extra.txt` :

```
temoin4	
st-h000	SplitToningShadowHue=0;SplitToningShadowSaturation=60
st-h060	SplitToningShadowHue=60;SplitToningShadowSaturation=60
st-h090	SplitToningShadowHue=90;SplitToningShadowSaturation=60
st-h150	SplitToningShadowHue=150;SplitToningShadowSaturation=60
st-h180	SplitToningShadowHue=180;SplitToningShadowSaturation=60
st-h270	SplitToningShadowHue=270;SplitToningShadowSaturation=60
st-h300	SplitToningShadowHue=300;SplitToningShadowSaturation=60
st-h330	SplitToningShadowHue=330;SplitToningShadowSaturation=60
st-ombres-sat20	SplitToningShadowHue=220;SplitToningShadowSaturation=20
st-ombres-sat100	SplitToningShadowHue=220;SplitToningShadowSaturation=100
cg-fusion-25	SplitToningShadowHue=220;SplitToningShadowSaturation=60;SplitToningHighlightHue=40;SplitToningHighlightSaturation=60;ColorGradeBlending=25
cg-fusion-75	SplitToningShadowHue=220;SplitToningShadowSaturation=60;SplitToningHighlightHue=40;SplitToningHighlightSaturation=60;ColorGradeBlending=75
st-balance-m50	SplitToningShadowHue=220;SplitToningShadowSaturation=60;SplitToningHighlightHue=40;SplitToningHighlightSaturation=60;SplitToningBalance=-50
st-balance-p50	SplitToningShadowHue=220;SplitToningShadowSaturation=60;SplitToningHighlightHue=40;SplitToningHighlightSaturation=60;SplitToningBalance=50
temperature-m50	IncrementalTemperature=-50
```

Les deux saturations donnent la loi d'amplitude, les doses intermédiaires de
fusion et de balance comblent les trous qui rendaient leurs lois indéterminées, et
`temperature-m50` est la dose qui manquait au milieu du retournement de la branche
froide de la balance des blancs — sans elle, ses paliers restent bloqués.

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
