"""Lit la campagne DETAIL de Lightroom et en tire les lois.

Les trois grandeurs — GRAIN, NETTETE, ACUITE — sont definies dans
`champs_detail.py`, et elles y ont ete DEPLACEES le 2026-09-18 pour que
`comparer-temoin-shaderlab.py` mesure NOS rendus avec exactement le meme code.
Deux cotes d'une calibration qui ne partagent pas leur instrument ne partagent
pas non plus leurs chiffres. (Extraction verifiee : `ph-temoin` rend 6,680
avant comme apres.)

⚠️ TOLERANT AUX MANQUES : la course exporte une mesure a la fois. Lance pendant
la campagne, ce script imprime ce qui existe et dit ce qui manque, au lieu
d'echouer sur le premier fichier absent.
"""
import glob
import os
import sys

from champs_detail import champs

DOSSIER = os.path.join(os.path.expanduser("~"), "Documents", "shaderlab-lightroom-mesures")
ORDRE = [
    "det-temoin",
    "det-lum25", "det-lum50", "det-lum75", "det-lum100",
    "det-lum50-det0", "det-lum50-det100", "det-lum50-con100", "det-lum100-det0",
    "det-tex100-nr0", "det-tex100-nr50", "det-tex100-nr100",
    "det-sh40-r1", "det-sh40-r3", "det-sh40-det100", "det-sh40-mask100",
]


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
