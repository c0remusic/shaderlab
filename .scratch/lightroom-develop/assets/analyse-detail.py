"""Lit la campagne DETAIL de Lightroom et en tire les lois.

Trois grandeurs, et chacune repond a une question posee au ticket 10 :

  GRAIN      ecart-type local dans le decile le plus PLAT de l'image. Ailleurs
             la structure domine et on ne mesurerait plus le bruit. C'est le
             MEME instrument que `trouver-photo-propre.py`, deliberement : les
             deux cotes doivent se comparer, sinon les chiffres ne le sont pas.

  NETTETE    ecart-type local dans le decile le plus STRUCTURE. C'est ce que le
             debruitage COUTE — le compromis que tout debruiteur arbitre, et que
             le seul chiffre de grain ne montre pas.

  ACUITE     largeur de transition mediane sur les bords francs, en pixels. Un
             debruiteur qui garde le grain mais elargit les bords a triche.

⚠️ TOLERANT AUX MANQUES : la course exporte une mesure a la fois. Lance pendant
la campagne, ce script imprime ce qui existe et dit ce qui manque, au lieu
d'echouer sur le premier fichier absent.
"""
import glob
import os
import sys

import numpy as np
from PIL import Image
from numpy.lib.stride_tricks import sliding_window_view

DOSSIER = os.path.join(os.path.expanduser("~"), "Documents", "shaderlab-lightroom-mesures")
ORDRE = [
    "det-temoin",
    "det-lum25", "det-lum50", "det-lum75", "det-lum100",
    "det-lum50-det0", "det-lum50-det100", "det-lum50-con100", "det-lum100-det0",
    "det-tex100-nr0", "det-tex100-nr50", "det-tex100-nr100",
    "det-sh40-r1", "det-sh40-r3", "det-sh40-det100", "det-sh40-mask100",
]


def champs(path, cote=1400):
    im = Image.open(path).convert("L")
    # NEAREST : reduire en moyennant tuerait justement ce qu'on mesure.
    im.thumbnail((cote, cote), Image.NEAREST)
    a = np.asarray(im).astype(float)
    win = sliding_window_view(a, (3, 3))
    sd = np.sqrt(np.maximum(win.var(axis=(2, 3)), 0))
    gx = np.abs(np.diff(a, axis=1))[:-2, :-1][: sd.shape[0], : sd.shape[1]]
    gy = np.abs(np.diff(a, axis=0))[:-1, :-2][: sd.shape[0], : sd.shape[1]]
    g = gx + gy
    plat = sd[g <= np.percentile(g, 10)]
    struct = sd[g >= np.percentile(g, 90)]
    # ACUITE : sur les colonnes portant un bord franc, la largeur en pixels ou
    # la transition passe de 10 % a 90 % de son amplitude. Mesuree par le
    # rapport gradient max / amplitude locale, qui ne demande pas de localiser
    # le bord.
    forts = g >= np.percentile(g, 99)
    amplitude = np.maximum(win.max(axis=(2, 3)) - win.min(axis=(2, 3)), 1e-6)
    acuite = float(np.median((amplitude[forts] / np.maximum(g[forts], 1e-6))))
    return float(np.median(plat)), float(np.median(struct)), acuite


def trouver(nom):
    for motif in ("%s.jpg", "%s.JPG", "%s*.jpg", "%s*.JPG"):
        f = sorted(glob.glob(os.path.join(DOSSIER, motif % nom)))
        if f:
            return f[0]
    return None


if not os.path.isdir(DOSSIER):
    sys.exit("Dossier d'exports absent : %s\nLa campagne a-t-elle tourne ?" % DOSSIER)

lus = {}
manquants = []
print("mesure                 grain    nettete   acuite    grain / temoin")
for nom in ORDRE:
    f = trouver(nom)
    if not f:
        manquants.append(nom)
        continue
    gr, st, ac = champs(f)
    lus[nom] = (gr, st, ac)
    ref = lus.get("det-temoin", (gr, st, ac))[0]
    rapport = gr / ref if ref > 0 else float("nan")
    print("%-22s %7.3f %10.3f %8.3f %14.3f" % (nom, gr, st, ac, rapport))

if manquants:
    print("")
    print("MANQUENT (%d) : %s" % (len(manquants), ", ".join(manquants)))
    print("La course exporte une mesure a la fois — relancer plus tard.")

if "det-temoin" in lus and "det-lum100" in lus:
    print("")
    print("LOI DE REDUCTION — part du grain qui reste, par dose :")
    ref = lus["det-temoin"][0]
    for nom in ("det-lum25", "det-lum50", "det-lum75", "det-lum100"):
        if nom in lus:
            print("  %-16s %.3f" % (nom, lus[nom][0] / ref))
    print("")
    print("CE QUE CA COUTE — part de la structure qui reste :")
    refs = lus["det-temoin"][1]
    for nom in ("det-lum25", "det-lum50", "det-lum75", "det-lum100"):
        if nom in lus:
            print("  %-16s %.3f" % (nom, lus[nom][1] / refs))

if "det-tex100-nr0" in lus and "det-tex100-nr100" in lus:
    print("")
    print("TEXTURE SUR GRAIN REDUIT — la raison de tout ce chantier (research/15) :")
    for nom in ("det-tex100-nr0", "det-tex100-nr50", "det-tex100-nr100"):
        if nom in lus:
            print("  %-16s grain %.3f   nettete %.3f" % (nom, lus[nom][0], lus[nom][1]))
