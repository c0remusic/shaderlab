"""Ecart entre la colonne A (rendu natif puis reduit) et la colonne B (rendu a
la resolution d'affichage), a la MEME taille finale.

Un chiffre seul ne decide pas une question d'apparence — la planche le fait.
Mais il dit sur QUELLE scene regarder.
"""
from PIL import Image, ImageChops
import numpy as np
import os

D = "C:/Users/LEETJ/AppData/Local/Temp/claude/C--dev-shaderlab/5cd8e3ee-e6ce-40b9-9de5-528e15ea775a/scratchpad/opti"

print("scene        vue: moy / max / %>2   |   crop 1:1 : moy / max")
for scene in ("global", "local", "grain"):
    ligne = scene.ljust(12)
    for genre in ("vue", "crop"):
        a = np.asarray(Image.open(os.path.join(D, "res-%s-A-natif-%s.png" % (scene, genre))).convert("RGB")).astype(int)
        b = np.asarray(Image.open(os.path.join(D, "res-%s-B-affichage-%s.png" % (scene, genre))).convert("RGB")).astype(int)
        d = np.abs(a - b)
        if genre == "vue":
            part = 100.0 * (d > 2).mean()
            ligne += "%6.2f / %4d / %5.1f%%   |" % (d.mean(), d.max(), part)
        else:
            ligne += "  %6.2f / %4d" % (d.mean(), d.max())
    print(ligne)
