"""DESAMBIGUISE le temoin de research/14.

Ce temoin reduisait la photo d'un facteur 4 et la discrimination du portail
passait de 1,14 a 2,20. J'ai attribue ce saut au GRAIN. Mais reduire d'un facteur
4 change DEUX choses a la fois : le grain baisse ET toutes les structures
deviennent quatre fois plus petites en pixels, donc les noyaux a ecartement
ABSOLU du module ne voient plus la meme chose. Le temoin melangeait deux causes.

Ce script en fabrique un troisieme qui les separe : reduire au quart PUIS
remonter a la taille d'origine. Le grain reste divise (il a ete moyenne, et
l'agrandissement ne le recree pas), mais l'echelle des structures est rendue.

  - si la discrimination reste haute  -> c'est bien le GRAIN
  - si elle retombe vers 1,14         -> c'etait l'ECHELLE, et research/14 est
                                         a corriger
"""
from PIL import Image
import os

SRC = "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG"
SORTIE = "C:/Users/LEETJ/AppData/Local/Temp/claude/C--dev-shaderlab/5cd8e3ee-e6ce-40b9-9de5-528e15ea775a/scratchpad/opti"

im = Image.open(SRC)
w, h = im.size
petite = im.resize((w // 4, h // 4), Image.LANCZOS)
remonte = petite.resize((w, h), Image.BICUBIC)
chemin = os.path.join(SORTIE, "DSCF5171-degraine.jpg")
remonte.save(chemin, quality=97)
print("ecrit", chemin, remonte.size)

# Meme mesure de grain que trouver-photo-propre.py, pour verifier que le grain
# est bien reste bas apres la remontee.
import numpy as np
from numpy.lib.stride_tricks import sliding_window_view


def grain(path, cote=1400):
    g = Image.open(path).convert("L")
    g.thumbnail((cote, cote), Image.NEAREST)
    a = np.asarray(g).astype(float)
    win = sliding_window_view(a, (3, 3))
    sd = np.sqrt(np.maximum(win.var(axis=(2, 3)), 0))
    gx = np.abs(np.diff(a, axis=1))[:-2, :-1][: sd.shape[0], : sd.shape[1]]
    gy = np.abs(np.diff(a, axis=0))[:-1, :-2][: sd.shape[0], : sd.shape[1]]
    gg = gx + gy
    return float(np.median(sd[gg <= np.percentile(gg, 10)]))


print("grain original        %.3f" % grain(SRC))
print("grain au quart        %.3f" % grain(os.path.join(SORTIE, "DSCF5171-quart.jpg")))
print("grain degraine (plein) %.3f" % grain(chemin))
