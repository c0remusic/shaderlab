"""Met face a face Lightroom et shaderlab sur la mire de presence.

Lightroom : `research/mesures-presence/*.json`, ecrits par `analyse-mire-presence.py`
            depuis les exports du plugin.
shaderlab : `presence-shaderlab.json`, ecrit par `mesure-presence-shaderlab.mjs`
            depuis le pipeline REEL (iframe du harnais, modules du disque).

Les deux fichiers portent la MEME structure de bandes, parce que les deux lisent
la meme geometrie. Aucune table de correspondance ici : les noms de mesures sont
identiques des deux cotes, c'est la campagne qui les a nommes pareil.

Usage : python comparer-presence.py [nom ...]
"""
import glob
import json
import os
import sys

import importlib.util

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))

# Le halo n'est calcule qu'a UN endroit, et les deux cotes stockent le PROFIL
# brut : c'est la seule facon que « portee 24 px » veuille dire la meme chose
# chez Lightroom et chez nous. Le nom de fichier porte des tirets, d'ou l'import
# par chemin plutot que par nom de module.
NOMS = sys.argv[1:]
_spec = importlib.util.spec_from_file_location("_amp", os.path.join(ICI, "analyse-mire-presence.py"))
_amp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_amp)
halo = _amp.halo
LR = os.path.join(ICI, "..", "research", "mesures-presence")
NOUS = os.path.join(ICI, "presence-shaderlab.json")


def charge():
    lr = {}
    for f in glob.glob(os.path.join(LR, "*.json")):
        d = json.load(open(f, encoding="utf-8"))
        lr[d["nom"]] = d
    nous = json.load(open(NOUS, encoding="utf-8"))
    return lr, nous


def mesure_halo(b):
    r = np.array(b["profil"], dtype=np.float64)
    return halo(r, len(r))


def par_zone(d, zone):
    return [b for b in d["bandes"] if b["zone"] == zone]


def gains(d, t, zone):
    out = []
    for b, bt in zip(par_zone(d, zone), par_zone(t, zone)):
        out.append(b["amp"] / bt["amp"] if bt["amp"] > 1e-6 else float("nan"))
    return out


def main():
    lr, nous = charge()
    tlr, tn = lr.get("pres-temoin"), nous.get("pres-temoin")
    if tlr is None or tn is None:
        raise SystemExit("il manque un temoin d'un des deux cotes")
    noms = NOMS or [n for n in sorted(nous) if n != "pres-temoin"]
    for nom in noms:
        if nom not in lr or nom not in nous:
            print("== %s : absent d'un des deux cotes" % nom)
            continue
        a, b = lr[nom], nous[nom]
        print("\n== " + nom)
        print("  ECHELLE (gain par periode)")
        print("    %-10s %s" % ("periode", "".join("%8.1f" % x["periode"] for x in par_zone(a, "echelle"))))
        print("    %-10s %s" % ("Lightroom", "".join("%8.3f" % g for g in gains(a, tlr, "echelle"))))
        print("    %-10s %s" % ("shaderlab", "".join("%8.3f" % g for g in gains(b, tn, "echelle"))))
        print("  AMPLITUDE (gain, P=16 puis P=64)")
        amp = par_zone(a, "amplitude")
        print("    %-10s %s" % ("amp in", "".join("%8d" % x["amplitude"] for x in amp)))
        print("    %-10s %s" % ("Lightroom", "".join("%8.3f" % g for g in gains(a, tlr, "amplitude"))))
        print("    %-10s %s" % ("shaderlab", "".join("%8.3f" % g for g in gains(b, tn, "amplitude"))))
        print("  APLATS (deplacement de la moyenne — terme GLOBAL)")
        for x, xt, y, yt in zip(par_zone(a, "plat"), par_zone(tlr, "plat"),
                                par_zone(b, "plat"), par_zone(tn, "plat")):
            print("    base %3d : Lightroom %+7.2f   shaderlab %+7.2f"
                  % (x["base"], x["moyenne"] - xt["moyenne"], y["moyenne"] - yt["moyenne"]))
        print("  ECHELONS (halo, portee a 10 %, et champ lointain)")
        for x, xt, y, yt in zip(par_zone(a, "echelon"), par_zone(tlr, "echelon"),
                                par_zone(b, "echelon"), par_zone(tn, "echelon")):
            hx, hxt = mesure_halo(x), mesure_halo(xt)
            hy, hyt = mesure_halo(y), mesure_halo(yt)
            for tag, h, ht in (("Lightroom", hx, hxt), ("shaderlab", hy, hyt)):
                print("    %3d|%3d  %s halo %+6.2f/%+6.2f portee %4d/%4d px  global %+6.2f/%+6.2f"
                      % (x["base"], x["droite"], tag, h["halo_gauche"], h["halo_droite"],
                         h["portee_gauche"], h["portee_droite"],
                         h["loin_gauche"] - ht["loin_gauche"], h["loin_droite"] - ht["loin_droite"]))


if __name__ == "__main__":
    main()
