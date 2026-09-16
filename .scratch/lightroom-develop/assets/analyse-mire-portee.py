"""Lit les exports des MIRES DE PORTEE et mesure, par zone, la reponse a la marche.

Le profil se prend selon y, moyenne sur la moitie centrale des colonnes : le
reseau vertical disparait de cette moyenne, donc le profil ne porte que la
reponse a la marche horizontale.

Deux zones, deux lectures :

  PORTEE  — du detail des deux cotes, une marche de ton. La decroissance du halo
            donne le rayon du masque de Clarte, sur un plateau de 4096 px.
  PORTAIL — meme ton des deux cotes, une marche de DETAIL seulement. Tout ce qui
            bouge dans la moitie plate vient du portail de detail, et la distance
            a laquelle ca s'eteint EST sa portee. Loin de la frontiere, cette
            moitie vaut son niveau d'entree : c'est le seul endroit de toutes nos
            mires ou un terme GLOBAL se lit sans contamination possible.

Usage : python analyse-mire-portee.py [dossier_des_jpeg]
Sortie : research/mesures-presence/<nom>.json + tableau sur la sortie standard.
"""
import glob
import importlib.util
import json
import os
import sys

import numpy as np
from PIL import Image

ICI = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Documents/shaderlab-lightroom-mesures")
OUT = os.path.join(ICI, "..", "research", "mesures-presence")
# La mire bi-tonale partage ce format de geometrie (une liste de zones, un profil
# vertical) : elle est lue par le meme code, pas par un second analyseur.
GEOS = (sorted(glob.glob(os.path.join(ICI, "mire", "shaderlab-mire-portee-*.json")))
        + sorted(glob.glob(os.path.join(ICI, "mire", "shaderlab-mire-bitonale-*.json"))))

_spec = importlib.util.spec_from_file_location("_amp", os.path.join(ICI, "analyse-mire-presence.py"))
_amp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_amp)
halo, LUMA = _amp.halo, _amp.LUMA

# Distances au bord auxquelles le profil est imprime. Reparties en octaves : une
# reponse locale meurt dans les premieres, une reponse a grand rayon tient
# jusqu'aux dernieres, et l'oeil lit la difference sans modele.
JALONS = [0, 2, 8, 32, 128, 512, 1024, 2048, 3900]


def geometrie(taille):
    """Apparie un export a SA geometrie par la taille exacte, et REFUSE si deux
    geometries la revendiquent.

    Paye le 2026-09-16 : une mire de portee et une mire bi-tonale faisaient toutes
    deux 2048x8192, et la campagne de la seconde a ECRASE les releves de la
    premiere, qui portaient le meme nom de mesure. Prendre la premiere trouvee
    aurait rendu des chiffres plausibles pour la mauvaise mire. Une ambiguite
    s arrete, elle ne se tranche pas en silence."""
    trouves = []
    for chemin in GEOS:
        with open(chemin, encoding="utf-8") as f:
            g = json.load(f)
        if (g["largeur"], g["hauteur"]) == taille:
            trouves.append((os.path.basename(chemin), g))
    if len(trouves) > 1:
        raise SystemExit("deux geometries pour %dx%d : %s — renommer l une des mires"
                         % (taille[0], taille[1], ", ".join(n for n, _ in trouves)))
    return trouves[0][1] if trouves else None


def main():
    mesures = {}
    for f in sorted(glob.glob(os.path.join(SRC, "*.jpg"))):
        nom = os.path.splitext(os.path.basename(f))[0]
        img = Image.open(f)
        geo = geometrie(img.size)
        if geo is None:
            continue
        a = np.asarray(img.convert("RGB"), dtype=np.float64) @ LUMA
        profil = a[:, geo["x0"]:geo["x1"]].mean(axis=1)
        d = {"nom": nom, "taille": "%dx%d" % img.size, "zones": {}}
        for z in geo["zones"]:
            seg = profil[z["y0"]:z["y1"]]
            d["zones"][z["nom"]] = dict(halo(seg, len(seg)),
                                        profil=[round(float(v), 3) for v in seg])
        with open(os.path.join(OUT, nom + ".json"), "w", encoding="utf-8") as o:
            json.dump(d, o, ensure_ascii=False, indent=1)
        mesures.setdefault(d["taille"], []).append(d)

    if not mesures:
        raise SystemExit("aucun export a la geometrie d'une mire de portee dans " + SRC)

    for taille, liste in sorted(mesures.items()):
        temoin = next((d for d in liste if d["nom"].endswith("temoin")), None)
        if temoin is None:
            print("== %s : pas de temoin, rien a rapporter" % taille)
            continue
        for zone in sorted({z for d in liste for z in d["zones"]}):
            print("\n== %s — zone %s" % (taille, zone))
            print("   %-28s %s" % ("distance au bord (px)",
                                   "".join("%9d" % k for k in JALONS)))
            for d in liste:
                p = np.array(d["zones"][zone]["profil"])
                t = np.array(temoin["zones"][zone]["profil"])
                m = len(p) // 2
                for cote, sens in (("haut", -1), ("bas", +1)):
                    cases = []
                    for k in JALONS:
                        # Un jalon au-dela du demi-plateau tombe dans la ZONE
                        # VOISINE : il rendait des chiffres aberrants mais
                        # plausibles (+12,22 la ou tout le reste vaut -8) sur les
                        # mires a plateau court. Il se marque hors de portee, il
                        # ne se lit pas.
                        if k >= m:
                            cases.append("%9s" % "—")
                            continue
                        i = m - 1 - k if sens < 0 else m + k
                        cases.append("%9.2f" % (p[i] - t[i]))
                    print("   %-28s %s" % ((d["nom"] + " / " + cote)[-28:], "".join(cases)))


if __name__ == "__main__":
    main()
