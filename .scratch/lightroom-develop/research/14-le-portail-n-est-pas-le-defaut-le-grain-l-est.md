# Le portail de Texture n'est pas le défaut — le grain l'est

Status: ready-for-agent
Type: research

Mesuré le 2026-09-18. Instruments : `assets/sonde-portail.mjs` (paramétrable
photo + facteur d'écartement), `assets/trouver-photo-propre.py`.

[`13`](13-le-portail-vu-au-lieu-d-etre-suppose.md) laisse trois choses à faire
avant d'écrire, et Antoine a choisi la seconde : **une photo à grain faible dirait
si le défaut est le portail ou la photo.** Réponse : la photo.

## Le témoin contrôlé, et pourquoi il vaut mieux qu'une autre photo

La bibliothèque est presque entièrement nocturne — quatorze fichiers sur quinze
ont une luminance médiane sous 20, donc leur « décile le plus plat » tombe dans
du noir écrasé où le grain se lit à 0,000. Prendre une autre photo aurait
confondu *moins de grain* et *autre scène*.

D'où le témoin : **la MÊME photo réduite d'un facteur 4**. Un bloc 4×4 moyenne
quatre fois moins de bruit, la structure survit. Tout ce qui change entre les
deux est le grain.

| | grain mesuré (niveaux) |
|---|---|
| `DSCF5171.JPG` (celle de toute la campagne) | **6,663** |
| `DSCF5171` au quart | **1,286** |

## Le relevé

Discrimination bord / plat, même sonde, même classement par le gradient, les
écartements mis à l'échelle de l'image :

| champ | pleine résolution | **au quart** |
|---|---|---|
| **actuel** — flou de la variance | **1,14** | **2,20** |
| structure, écart 2 px | 1,50 | 2,00 |
| structure, écart 4 px | 1,50 | 2,00 |
| structure, écart 8 px | 1,29 | 2,25 |
| structure, écart 16 px | 1,28 | 2,42 |

Et la grandeur qui décide, la **course réelle du portail** `ε/(v²+ε)` à l'ε
courant (0,0082) :

| | plat → bord | course |
|---|---|---|
| pleine résolution | 0,948 → 0,934 | **1,5 %** |
| au quart | 0,821 → 0,486 | **41 %** |

## Ce que ça établit

**Le portail actuel fonctionne — quand son hypothèse de calibration est
respectée.** Son ε a été ajusté sur une mire SANS grain (`08`) ; sur un signal
sans grain, il retrouve exactement le comportement qu'on lui demandait : presque
ouvert sur la matière plate, à moitié fermé au bord. Sa forme n'est pas en cause,
et il ne manque aucun champ.

**Ce qui le tue, c'est que le grain remplit la variance.** À grain nominal, sa
course tombe de 41 % à 1,5 % — vingt-sept fois moins. C'est le chiffre qui
manquait à `08`, qui établissait la cause sans pouvoir la contraster.

⚠️ **Et la piste du `13` perd son intérêt du même coup.** La « variance du flou »
mesurée en registres donnait 1,50 à pleine résolution, mieux que les 1,14 de
l'actuel — mais l'actuel donne **2,20** dès que le grain baisse, donc mieux que
tout ce que ce champ neuf atteint. Construire un second champ reviendrait à
compenser un bruit d'entrée par une mesure plus fine ; réduire le bruit d'entrée
fait mieux, et coûte moins.

## Ce que ça oriente

La correction n'est pas un portail neuf : c'est de **calculer la variance sur un
signal déjà lissé**, ce que le binaire nomme exactement — le guide du filtre de
Texture y est une *« small content image »*, une image réduite où le grain a
disparu et où seule la structure survit (`08`). Le témoin ci-dessus EST cette
image, fabriquée hors du moteur.

⚠️ **L'obstacle est la PRÉCISION, pas la structure**, et il faut le savoir avant
de commencer. Les cibles de passe sont en 8 bits : une variance se calcule
aujourd'hui par `E[y²] − E[y]²` à partir de deux canaux quantifiés, dont le pas
vaut ~0,004 en lumière. Les variances visées au quart valent 0,0018 sur le plat
et 0,0087 au bord — la première est SOUS le pas. Toute formulation qui fait
transiter `E[s²]` par une cible 8 bits perd la mesure ; celle qui tient calcule
la variance **en registres**, dans la passe, comme la sonde du `13` le fait déjà.

Trois voies, non tranchées :

1. **Amorcer la pyramide sur un signal lissé** — `rb_pn` lirait une petite
   moyenne au lieu du texel. ⚠️ Son canal `r` est la luminance floutée que
   lisent Hautes lumières, Ombres, Blancs, Noirs et le Voile : le toucher
   déplacerait cinq calibrations. À ne faire qu'avec un canal de plus, pas à la
   place.
2. **Une passe de variance dédiée**, à une échelle réduite, écrivant
   `sqrt(var)` (et non `var`) pour tenir dans 8 bits — l'écart-type au bord vaut
   0,093, confortable, là où la variance vaut 0,0087.
3. **Ne rien faire et documenter**, si la mesure Lightroom (voie 1 du `13`)
   montre que leur portail n'est pas plus ouvert que le nôtre sur la même photo.

## Réserve d'instrument, à ne pas passer sous silence

Un troisième point a été pris — `DSCF5162`, la plus grenue (13,6) et la plus
claire — et il rend un rapport de **0,49**, c'est-à-dire INVERSÉ. Il n'est pas
retenu comme mesure : sur une photo très grenue, le classement « plat » par le
gradient sélectionne les pixels où le grain est localement calme, ce qui biaise
l'échantillon dans le sens du résultat. Le témoin au quart n'a pas ce défaut —
même scène, même classement, un seul facteur changé. **Un point qui va dans le
sens de la thèse n'est pas pour autant une preuve** ; celui-là est écarté.
