"""Tranche la loi de portee de Clarte : pixels ABSOLUS ou fraction de l'image ?

Trois hauteurs a largeur constante (2048) : 4096, 8192, 16384, donc des plateaux
de 1024, 2048 et 4096 px — un RAPPORT DE 4 entre les extremes. Un rapport de 2
laissait les deux lois a 0,2 et 0,6 niveau l'une de l'autre, trop serre.

Le depart se fait sur deux echantillonnages du MEME profil :

  ABSOLU    — les trois hauteurs lues aux memes distances en pixels. Si la loi
              est absolue, les trois courbes se superposent.
  FRACTION  — les trois hauteurs lues aux memes fractions de leur plateau. Si la
              loi suit l'image, ce sont celles-la qui se superposent.

⚠️ Les deux regions se jugent SEPAREMENT, et le melange etait le piege. Le
contraste court de Clarte (≈ 8 px) est deja etabli comme absolu ; l'inclure dans
le test de fraction le condamnerait d'avance, puisqu'une meme fraction y designe
trois distances differentes en pleine pente. Le depart ne porte donc que sur le
CHAMP LOIN, au-dela de 64 px, la ou vit la composante large.

Usage : python comparer-portee-hauteur.py
"""
import json
import os

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
LR = os.path.join(ICI, "..", "research", "mesures-presence")

HAUTEURS = [4096, 8192, 16384]          # largeur 2048, plateaux 1024 / 2048 / 4096
MESURE = "por-2048-%d-clarte-p100"
TEMOIN = "por-2048-%d-temoin"

DIST_PRES = [0, 2, 4, 8, 16, 32]                       # le contraste court
DIST_LOIN = [64, 128, 192, 256, 384, 512, 768]         # < 1024, le plus petit plateau
FRAC_LOIN = [1 / 16, 1 / 8, 3 / 16, 1 / 4, 3 / 8, 1 / 2, 3 / 4]


def charge(h):
    d = json.load(open(os.path.join(LR, (MESURE % h) + ".json"), encoding="utf-8"))
    t = json.load(open(os.path.join(LR, (TEMOIN % h) + ".json"), encoding="utf-8"))
    return d, t


def ecart(h, zone, cote, positions, en_fraction):
    """Ecart a l'entree, a des distances donnees en pixels ou en fraction du plateau."""
    d, t = charge(h)
    p = np.array(d["zones"][zone]["profil"])
    q = np.array(t["zones"][zone]["profil"])
    m = len(p) // 2
    out = []
    for pos in positions:
        k = int(round(pos * m)) if en_fraction else int(pos)
        k = min(k, m - 1)
        i = m - 1 - k if cote == "haut" else m + k
        out.append(float(p[i] - q[i]))
    return out


def dispersion(tableau):
    """Ecart maximal entre hauteurs, point par point, puis le pire et la moyenne."""
    a = np.array(tableau)
    etendue = a.max(axis=0) - a.min(axis=0)
    return etendue.max(), etendue.mean()


def main():
    for zone in ("portee", "portail"):
        for cote in ("haut", "bas"):
            print("\n=== zone %s, cote %s ===" % (zone, cote))

            print("  CONTRASTE COURT — memes distances en pixels")
            print("    %-10s %s" % ("px", "".join("%8d" % k for k in DIST_PRES)))
            pres = []
            for h in HAUTEURS:
                v = ecart(h, zone, cote, DIST_PRES, False)
                pres.append(v)
                print("    h=%-8d %s" % (h, "".join("%8.2f" % x for x in v)))
            mx, mo = dispersion(pres)
            print("    dispersion entre hauteurs : max %.2f, moyenne %.2f" % (mx, mo))

            print("  CHAMP LOIN — hypothese ABSOLUE (memes pixels)")
            print("    %-10s %s" % ("px", "".join("%8d" % k for k in DIST_LOIN)))
            absolu = []
            for h in HAUTEURS:
                v = ecart(h, zone, cote, DIST_LOIN, False)
                absolu.append(v)
                print("    h=%-8d %s" % (h, "".join("%8.2f" % x for x in v)))
            mxa, moa = dispersion(absolu)
            print("    dispersion entre hauteurs : max %.2f, moyenne %.2f" % (mxa, moa))

            print("  CHAMP LOIN — hypothese FRACTION (memes fractions de plateau)")
            print("    %-10s %s" % ("fraction", "".join("%8.3f" % f for f in FRAC_LOIN)))
            frac = []
            for h in HAUTEURS:
                v = ecart(h, zone, cote, FRAC_LOIN, True)
                frac.append(v)
                print("    h=%-8d %s" % (h, "".join("%8.2f" % x for x in v)))
            mxf, mof = dispersion(frac)
            print("    dispersion entre hauteurs : max %.2f, moyenne %.2f" % (mxf, mof))

            verdict = ("ABSOLUE" if moa < mof else "FRACTION")
            print("  -> le champ loin colle %.1fx mieux a l'hypothese %s"
                  % (max(moa, mof) / max(min(moa, mof), 1e-6), verdict))


if __name__ == "__main__":
    main()
