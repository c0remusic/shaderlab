"""Compare NOTRE profil de portee a celui de Lightroom, zone par zone.

Les deux cotes lisent la MEME mire et la MEME geometrie ; Lightroom par les
exports du plugin (`analyse-mire-portee.py`), nous par le pipeline reel
(`mesure-portee-shaderlab.mjs`).

Usage : python comparer-portee.py
"""
import json
import os

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
LR = os.path.join(ICI, "..", "research", "mesures-presence")
GEO = json.load(open(os.path.join(ICI, "mire", "shaderlab-mire-portee-2048x16384.json"), encoding="utf-8"))
NOUS = json.load(open(os.path.join(ICI, "portee-shaderlab.json"), encoding="utf-8"))
JAL = [0, 2, 8, 32, 128, 512, 1024, 2048, 3900]


def lr(nom, zone):
    d = json.load(open(os.path.join(LR, nom + ".json"), encoding="utf-8"))
    return np.array(d["zones"][zone]["profil"])


def nous(nom, zone):
    p = np.array(NOUS[nom])
    z = next(x for x in GEO["zones"] if x["nom"] == zone)
    return p[z["y0"]:z["y1"]]


print("Ecart au temoin en travers de la marche, mire 2048 x 16384")
for zone in ("portee", "portail"):
    print()
    print("== zone %s" % zone)
    print("   %-26s %s" % ("distance au bord (px)", "".join("%9d" % k for k in JAL)))
    for tag, dose, temoin in (
        ("Lightroom", "por-2048-16384-clarte-p100", "por-2048-16384-temoin"),
        ("shaderlab", "por-clarte-p100", "por-temoin"),
    ):
        f = lr if tag == "Lightroom" else nous
        p, t = f(dose, zone), f(temoin, zone)
        m = len(p) // 2
        for cote, sens in (("haut", -1), ("bas", +1)):
            cases = []
            for k in JAL:
                if k >= m:
                    cases.append("%9s" % "—")
                    continue
                i = m - 1 - k if sens < 0 else m + k
                cases.append("%9.2f" % (p[i] - t[i]))
            print("   %-26s %s" % (tag + " / " + cote, "".join(cases)))
