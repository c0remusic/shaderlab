"""Fabrique la MIRE BI-TONALE — une image SANS AUCUN detail, et rien d'autre.

Elle repond a une seule question, et c'est celle qui separe un terme GLOBAL d'un
terme a grand rayon : **Clarte fait-elle quelque chose sur une image sans
detail ?** Une courbe de ton globale agirait quoi qu'il arrive ; un operateur de
contraste local, aussi large soit son rayon, n'aurait rien a se mettre sous la
dent.

Deux aplats, 4096 px chacun, 96 en haut et 160 en bas — memes niveaux que la
zone PORTEE de la mire de portee, pour que les deux se comparent directement.
Le seul detail de l'image est sa frontiere.

⚠️ Elle porte « bitonale » dans son nom et pas seulement sa taille : une premiere
version de la mire de portee avait exactement ces dimensions (2048x8192), et la
campagne suivante a ECRASE ses releves, qui portaient le meme nom de mesure. Une
mire qui repond a une autre question prend un autre nom, pas seulement une autre
taille.

Usage : python faire-mire-bitonale.py
"""
import json
import os

import numpy as np
from PIL import Image

ICI = os.path.dirname(os.path.abspath(__file__))
HAUT, BAS = 96, 160
# 4000 et pas 4096 : une mire de portee fait deja 2048x8192, et deux geometries
# de meme taille se disputeraient l'appariement des exports. L'analyse refuse
# desormais l'ambiguite au lieu de la trancher, mais autant ne pas la creer.
DEMI = 4000
LARGEUR = 2048


def ecris():
    img = np.full((2 * DEMI, LARGEUR, 3), HAUT, dtype=np.uint8)
    img[DEMI:] = BAS
    nom = "shaderlab-mire-bitonale-%dx%d" % (LARGEUR, 2 * DEMI)
    jpg = os.path.join(ICI, nom + ".jpg")
    Image.fromarray(img).save(jpg, "JPEG", quality=100, subsampling=0)
    geo = {"largeur": LARGEUR, "hauteur": 2 * DEMI, "demi": DEMI,
           "x0": LARGEUR // 4, "x1": 3 * LARGEUR // 4,
           "zones": [{"nom": "bitonale", "y0": 0, "y1": 2 * DEMI,
                      "haut": HAUT, "bas": BAS,
                      "detail_haut": False, "detail_bas": False}]}
    with open(os.path.join(ICI, nom + ".json"), "w", encoding="utf-8") as o:
        json.dump(geo, o, indent=1)
    print("ecrit", jpg, (LARGEUR, 2 * DEMI))


if __name__ == "__main__":
    ecris()
