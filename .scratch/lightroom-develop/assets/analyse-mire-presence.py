"""Lit les exports Lightroom de la MIRE DE PRESENCE et en tire, par bande :

  - la MOYENNE de sortie (terme global : un operateur purement local ne la bouge
    pas, et les aplats temoins ne portent que ca) ;
  - l'AMPLITUDE du fondamental, par demodulation complexe au nombre de cycles que
    la geometrie declare. Le GAIN est le rapport a la meme bande du temoin, donc
    toute perte due au JPEG ou au rendu de Lightroom au repos s'annule ;
  - la deuxieme HARMONIQUE, rapportee au fondamental : l'asymetrie du halo. Un
    operateur qui pousse plus le cote clair que le cote sombre la fait sortir,
    un operateur symetrique la laisse au plancher de bruit.

La geometrie n'est pas recopiee ici : elle est lue dans le JSON que
`mire/faire-mire-presence.py` ecrit a cote de l'image. Un seul point de verite —
c'est la regle qui a manque aux references de pixels, qui en ont deux.

Usage : python analyse-mire-presence.py [dossier_des_jpeg]
Sortie : research/mesures-presence/<nom>.json + research/06-presence-tables-brutes.md
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image

ICI = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Documents/shaderlab-lightroom-mesures")
OUT = os.path.join(ICI, "..", "research", "mesures-presence")
GEOS = sorted(glob.glob(os.path.join(ICI, "mire", "shaderlab-mire-presence*.json")))

# Luminance de Rec.709, celle que Lightroom utilise pour son Y en log-YCC. Les
# bandes sont neutres, donc les trois canaux disent la meme chose ; on garde la
# combinaison pour que la mesure tienne encore si une bande devient coloree.
LUMA = np.array([0.2126, 0.7152, 0.0722])


def geometrie(taille):
    """Retrouve la geometrie par la TAILLE EXACTE de l'image, largeur ET hauteur.

    Le dossier d'exports est partage avec les deux autres mires, et l'une d'elles
    a la meme largeur : apparier sur la largeur seule ferait lire des bandes la
    ou il n'y en a pas. Un export dont la taille ne correspond a aucune geometrie
    est ignore, pas devine."""
    for chemin in GEOS:
        with open(chemin, encoding="utf-8") as f:
            g = json.load(f)
        if (g["largeur"], g["hauteur"]) == taille:
            return g
    return None


def halo(r, W):
    """Lit le halo d'une marche : son amplitude de chaque cote, et la distance au
    bord ou il est retombe a 10 % de son sommet.

    Le champ LOINTAIN se prend au quart extreme de chaque plateau — assez loin du
    bord pour qu'aucun rayon plausible n'y arrive, assez loin des tranches de
    l'image pour que le traitement de bord de Lightroom n'y entre pas. L'ecart du
    champ lointain a l'entree est le terme GLOBAL ; ce qui le depasse pres du bord
    est le terme LOCAL, et sa PORTEE est le rayon cherche."""
    m = W // 2
    loin_g = float(r[W // 16:W // 4].mean())
    loin_d = float(r[3 * W // 4:15 * W // 16].mean())
    res = {"loin_gauche": round(loin_g, 3), "loin_droite": round(loin_d, 3)}
    for cote, seg, loin in (("gauche", r[:m][::-1], loin_g), ("droite", r[m:], loin_d)):
        # seg[0] est colle au bord, seg[k] est a k+0.5 px du bord.
        ecart = seg - loin
        k = int(np.argmax(np.abs(ecart)))
        sommet = float(ecart[k])
        portee = 0
        if abs(sommet) > 0.05:
            sous = np.where(np.abs(ecart) <= 0.1 * abs(sommet))[0]
            sous = sous[sous >= k]
            portee = int(sous[0]) if len(sous) else m
        # La PORTEE (seuil a 10 %) est fragile sur un halo large et mou : elle lit
        # un croisement de seuil, donc un point. La LARGEUR EFFECTIVE integre tout
        # le halo et le rapporte a son sommet — pour une decroissance en exp(-x/L)
        # elle vaut exactement L, et elle ne depend d'aucun seuil.
        res["halo_" + cote] = round(sommet, 3)
        res["portee_" + cote] = portee
        res["largeur_" + cote] = round(float(np.abs(ecart).sum() / abs(sommet)), 1) if abs(sommet) > 0.05 else 0.0
        # TROISIEME estimateur, et le seul qui ne depende pas du champ lointain.
        # Les deux precedents soustraient une reference prise au quart extreme du
        # plateau : sa distance au bord GRANDIT avec la largeur de la mire, donc
        # ils fabriquent a eux seuls une croissance du halo avec la largeur.
        # La DERIVEE est aveugle a toute erreur de reference — une constante
        # additive y disparait — et pour une decroissance en exp(-x/L) le
        # barycentre de |d/dx| vaut exactement L. On saute les 2 premiers pixels,
        # qui portent la marche elle-meme et non son halo.
        d = np.abs(np.diff(seg))[2:]
        k = np.arange(len(d)) + 2.5
        res["largeur_der_" + cote] = round(float((d * k).sum() / d.sum()), 1) if d.sum() > 1e-6 else 0.0
    return res


def controle_interne(d, t):
    """Le meme stimulus (base 128, amplitude 16, periodes 16 et 64) est present en
    zone AMPLITUDE, entoure de bandes de meme base, et en zone TON, entoure de
    bandes d'autres bases. Un operateur assez local pour que cette mire le lise
    rend le meme chiffre aux deux endroits. S'il ne le rend pas, ce n'est pas du
    bruit : c'est que son rayon depasse le pas des bandes, et alors les zones
    AMPLITUDE et TON ne disent rien de lui — seule la zone ECHELON le peut."""
    out = ["**Controle interne** — meme stimulus dans deux voisinages :", "",
           "| periode | gain (zone amplitude) | gain (zone ton) | dMoy (amplitude) | dMoy (ton) | verdict |",
           "|---|---|---|---|---|---|"]
    verdicts = []
    for per in (16.0, 64.0):
        def trouve(src, zone):
            for b, bt in zip(src["bandes"], t["bandes"]):
                if (b["zone"] == zone and b["cycles"] > 0 and abs(b["periode"] - per) < 0.5
                        and b["base"] == 128 and b["amplitude"] == 16):
                    return b, bt
            return None, None
        ba, ta = trouve(d, "amplitude")
        bt_, tt = trouve(d, "ton")
        if ba is None or bt_ is None:
            continue
        ga, gt = ba["amp"] / ta["amp"], bt_["amp"] / tt["amp"]
        da, dt = ba["moyenne"] - ta["moyenne"], bt_["moyenne"] - tt["moyenne"]
        # 0,03 en gain et 0,5 niveau en moyenne : dix fois le bruit mesure sur le
        # temoin, assez serre pour que le desaccord de Clarte (18 niveaux) sorte.
        ok = abs(ga - gt) < 0.03 and abs(da - dt) < 0.5
        verdicts.append(ok)
        out.append("| %.0f | %.3f | %.3f | %+.2f | %+.2f | %s |"
                   % (per, ga, gt, da, dt, "lisible" if ok else "**RAYON HORS PORTEE**"))
    out += ["", "> " + ("Les deux voisinages s'accordent : le rayon est sous le pas des bandes, "
                        "les zones ECHELLE / AMPLITUDE / TON valent pour cet operateur."
                        if all(verdicts) and verdicts else
                        "Les deux voisinages divergent : le rayon depasse le pas des bandes (96 px). "
                        "Ne rien conclure des zones ECHELLE / AMPLITUDE / TON — lire la zone ECHELON."), ""]
    return out


def demodule(img, geo):
    a = np.asarray(img.convert("RGB"), dtype=np.float64) @ LUMA
    W = geo["largeur"]
    x = np.arange(W) + 0.5
    res = []
    for b in geo["bandes"]:
        r = a[b["y0"]:b["y1"]].mean(axis=0)
        d = {"zone": b["zone"], "cycles": b["cycles"], "periode": b["periode"],
             "base": b["base"], "amplitude": b["amplitude"],
             "moyenne": round(float(r.mean()), 4)}
        if b["cycles"] > 0:
            ph = 2.0 * np.pi * b["cycles"] * x / W
            f1 = 2.0 * np.mean(r * np.exp(-1j * ph))
            f2 = 2.0 * np.mean(r * np.exp(-2j * ph))
            d["amp"] = round(float(abs(f1)), 5)
            d["phase"] = round(float(np.angle(f1)), 5)
            d["h2"] = round(float(abs(f2)), 5)
        elif b["cycles"] < 0:
            d["droite"] = b["droite"]
            d["profil"] = [round(float(v), 3) for v in r]
            d.update(halo(r, W))
        else:
            # Un aplat n'a pas de frequence a demoduler : ce qui s'y mesure est
            # l'ECART-TYPE, qui dit si l'operateur y a fabrique une structure.
            d["ecart_type"] = round(float(r.std()), 5)
        res.append(d)
    return res


def main():
    fichiers = sorted(glob.glob(os.path.join(SRC, "*.jpg")))
    if not fichiers:
        raise SystemExit("aucun JPEG dans " + SRC)
    os.makedirs(OUT, exist_ok=True)
    tout = {}
    for f in fichiers:
        nom = os.path.splitext(os.path.basename(f))[0]
        img = Image.open(f)
        geo = geometrie(img.size)
        if geo is None:
            continue
        d = {"nom": nom, "largeur": img.size[0], "taille": "%dx%d" % img.size, "bandes": demodule(img, geo)}
        with open(os.path.join(OUT, nom + ".json"), "w", encoding="utf-8") as o:
            json.dump(d, o, ensure_ascii=False, indent=1)
        tout[nom] = d
    if not tout:
        raise SystemExit("aucun export a la geometrie de la mire de presence dans " + SRC)

    temoins = {d["taille"]: d for n, d in tout.items() if n.endswith("temoin")}
    if not temoins:
        raise SystemExit("pas de temoin : le gain n'a aucun denominateur")

    lignes = ["# Texture et Clarte de Lightroom Classic 14.5.1, mesurees sur la mire de presence",
              "",
              "Gain = amplitude de la mesure / amplitude du temoin, a la meme bande.",
              "`h2/f1` = deuxieme harmonique rapportee au fondamental (asymetrie du halo).",
              "`dMoy` = deplacement de la moyenne de la bande (terme global).",
              "Geometrie : `assets/mire/shaderlab-mire-presence.json`. Donnees : `research/mesures-presence/`.",
              ""]
    for nom in sorted(tout):
        d = tout[nom]
        t = temoins.get(d["taille"])
        if t is None or nom == t["nom"]:
            continue
        lignes += ["## " + nom + " (" + d["taille"] + ")", "",
                   "| zone | periode | base | amp in | gain | h2/f1 | dMoy |",
                   "|---|---|---|---|---|---|---|"]
        for b, bt in zip(d["bandes"], t["bandes"]):
            dmoy = b["moyenne"] - bt["moyenne"]
            if b["cycles"] > 0:
                gain = b["amp"] / bt["amp"] if bt["amp"] > 1e-6 else float("nan")
                h2 = b["h2"] / b["amp"] if b["amp"] > 1e-6 else float("nan")
                lignes.append("| %s | %.2f | %d | %d | %.3f | %.3f | %+.2f |"
                              % (b["zone"], b["periode"], b["base"], b["amplitude"], gain, h2, dmoy))
            elif b["cycles"] < 0:
                lignes.append("| echelon %d\\|%d | — | — | — | halo %+.2f / %+.2f | portee %d / %d px | global %+.2f / %+.2f |"
                              % (b["base"], b["droite"], b["halo_gauche"], b["halo_droite"],
                                 b["portee_gauche"], b["portee_droite"],
                                 b["loin_gauche"] - bt["loin_gauche"], b["loin_droite"] - bt["loin_droite"]))
            else:
                lignes.append("| plat | — | %d | — | — | ecart-type %.3f | %+.2f |"
                              % (b["base"], b["ecart_type"], dmoy))
        lignes.append("")
        lignes += controle_interne(d, t)
    md = os.path.join(ICI, "..", "research", "06-presence-tables-brutes.md")
    with open(md, "w", encoding="utf-8") as o:
        o.write("\n".join(lignes) + "\n")
    print("ecrit", md, "et", len(tout), "json")


if __name__ == "__main__":
    main()
