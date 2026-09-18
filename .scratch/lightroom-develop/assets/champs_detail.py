"""Les trois champs du panneau Detail, definis UNE fois.

Ce module existe pour une raison et une seule : les deux cotes d'une
calibration doivent se mesurer au MEME instrument, sinon leurs chiffres ne se
comparent pas. `analyse-detail.py` lit les exports de Lightroom,
`comparer-temoin-shaderlab.py` lit nos rendus — les deux importent d'ici.

Les trois grandeurs, et chacune repond a une question posee au ticket 10 :

  GRAIN      ecart-type local dans le decile le plus PLAT de l'image. Ailleurs
             la structure domine et on ne mesurerait plus le bruit. C'est le
             MEME estimateur que `trouver-photo-propre.py`, deliberement.

  NETTETE    ecart-type local dans le decile le plus STRUCTURE. C'est ce que le
             debruitage COUTE — le compromis que tout debruiteur arbitre, et que
             le seul chiffre de grain ne montre pas.

  ACUITE     largeur de transition mediane sur les bords francs, en pixels. Un
             debruiteur qui garde le grain mais elargit les bords a triche.

⚠️ `cote` REDUIT PAR DECIMATION (NEAREST) et jamais par moyenne : moyenner
tuerait justement ce qu'on mesure. Corollaire a ne pas oublier — deux images de
TAILLES SOURCE differentes decimees vers le meme cote ne prelevent pas les memes
pixels, donc leurs grains ne sont plus comparables. Quand les deux cotes d'une
comparaison ne sortent pas de la meme taille, comparer des CROPS a l'echelle
native (`crop=`) plutot que des reductions.
"""
import numpy as np
from PIL import Image
from numpy.lib.stride_tricks import sliding_window_view


def charger(path, cote=1400, crop=None):
    """Ouvre en niveaux de gris. `crop` = cote d'un carre pris au CENTRE, a
    l'echelle NATIVE (aucune reduction) ; sinon decimation vers `cote`."""
    im = Image.open(path).convert("L")
    if crop:
        w, h = im.size
        c = min(crop, w, h)
        x, y = (w - c) // 2, (h - c) // 2
        return im.crop((x, y, x + c, y + c)), (w, h)
    taille = im.size
    im.thumbnail((cote, cote), Image.NEAREST)
    return im, taille


def champs(path, cote=1400, crop=None):
    """Rend (grain, nettete, acuite). Voir le docstring du module."""
    im, _ = charger(path, cote, crop)
    return champs_image(im)


def champs_image(im):
    a = np.asarray(im).astype(float)
    win = sliding_window_view(a, (3, 3))
    sd = np.sqrt(np.maximum(win.var(axis=(2, 3)), 0))
    gx = np.abs(np.diff(a, axis=1))[:-2, :-1][: sd.shape[0], : sd.shape[1]]
    gy = np.abs(np.diff(a, axis=0))[:-1, :-2][: sd.shape[0], : sd.shape[1]]
    g = gx + gy
    plat = sd[g <= np.percentile(g, 10)]
    struct = sd[g >= np.percentile(g, 90)]
    # ACUITE : sur les pixels portant un bord franc, le rapport amplitude locale
    # sur gradient — la largeur en pixels qu'il faut a la transition pour
    # parcourir son amplitude. Ne demande pas de localiser le bord.
    forts = g >= np.percentile(g, 99)
    amplitude = np.maximum(win.max(axis=(2, 3)) - win.min(axis=(2, 3)), 1e-6)
    acuite = float(np.median(amplitude[forts] / np.maximum(g[forts], 1e-6)))
    return float(np.median(plat)), float(np.median(struct)), acuite
