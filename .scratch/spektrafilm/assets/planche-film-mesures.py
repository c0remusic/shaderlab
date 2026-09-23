"""Quatre mesures sur les crops 1:1 de la planche film, pour ne pas conclure a l'oeil.

1. NOIRS : moyenne des 5 % de pixels les plus sombres du crop agave (silhouette),
   et leur teinte (B - R) : un noir releve et bleute est la signature d'un tirage.
2. ECRETAGE : part des pixels dont un canal vaut 255 dans le crop bougie — le
   roll-off des hautes lumieres d'un film ne cloue pas au blanc.
3. GRAIN : ecart-type du residu haute frequence (image - flou gaussien sigma 3)
   sur une zone de ciel sans detail du crop agave, en niveaux, luma et chroma.
   ⚠️ L'ORIGINAL porte deja un grain de fichier : son chiffre est le plancher.
(Une 4e mesure, le lisere de halation, a ete jetee : voir en bas.)
Usage : python planche-film-mesures.py <dossier-des-rendus>
"""
import os, sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

R = sys.argv[1]
COLS = ["original", "notre-pile", "notre-pile-dosee", "portra400", "vision3-500t", "ektar100", "velvia100"]


def lit(nom, col):
    p = os.path.join(R, f"{nom}__{col}__crop.png")
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float64)


print("%-18s %8s %7s %9s %8s %8s" % ("", "noir", "B-R", "ecrete%", "grainY", "grainC"))
for col in COLS:
    ag, bo = lit("5160-agave", col), lit("5163-bougie", col)
    Y = ag.mean(axis=2)
    seuil = np.percentile(Y, 5)
    sombres = ag[Y <= seuil]
    noir, teinte = sombres.mean(), (sombres[:, 2] - sombres[:, 0]).mean()
    ecrete = 100 * (bo.max(axis=2) >= 254.5).mean()
    # zone de ciel plat : coin haut droit du crop agave (verifie sur la planche)
    z = ag[40:220, 760:960]
    hf = z - gaussian_filter(z, sigma=(3, 3, 0))
    gY = hf.mean(axis=2).std()
    gC = (hf - hf.mean(axis=2, keepdims=True)).std()
    print("%-18s %8.1f %7.1f %9.2f %8.2f %8.2f" % (col, noir, teinte, ecrete, gY, gC))

# ⚠️ Une QUATRIEME mesure, le lisere rouge de halation au bord feuille/ciel (pixels
# sombres ou R - G > 25 le long d'une ligne), a ete essayee et JETEE le
# 2026-09-23 : elle comptait le lavis orange du glow comme un lisere (187 pixels
# pour notre pile aux defauts contre 8 a 12 pour les stocks) — elle ne separe pas
# un halo large d'un lisere fin. Mesurer le lisere demande un profil en travers du
# bord, pas un comptage.
