"""Ajuste Texture comme la SOMME DE DEUX BANDES, comme le binaire la decrit.

Le calcul exact de la reponse d'un noyau unique (reponse-noyau.py) montre qu'AUCUN
ecartement ne rend la courbe de Lightroom : tous meurent avant la periode 32,
quand elle tient encore 1,37 a la periode 64. Deux etages de reechantillonnage
sont nommes dans CameraRaw.dll (fResample1a/1b, fResample2a/2b, conv1, conv2) :
Texture y est un filtre guide a DEUX echelles.

Nous avons deja les deux :
  - la bande FINE, le noyau treize taps de la passe finale, dont la reponse se
    calcule exactement (prelevements bilineaires compris) ;
  - la bande MOYENNE, la pyramide, dont la reponse se MESURE — elle est deja
    exercee par Clarte, et nos propres releves la donnent periode par periode.

Trois inconnues : l'ecartement du noyau fin, et le poids de chaque bande.
"""
import json
import numpy as np

PERIODES = [3.0, 4.0, 6.01, 8.0, 11.98, 16.0, 24.09, 32.0, 47.63, 64.0, 97.52, 128.0, 186.18, 256.0]
LR = np.array([1.746, 1.696, 1.637, 1.586, 1.535, 1.513, 1.491, 1.497, 1.454, 1.374, 1.261, 1.203, 1.149, 1.120])
CLARITY_AMT = 0.9   # le gain dont nos releves de Clarte +100 sont issus

ASSETS = r"C:/dev/shaderlab/.scratch/lightroom-develop/assets"


def reponse_pyramide():
    """(1 - K) de la pyramide, MESUREE sur nos propres releves de Clarte +100."""
    j = json.load(open(ASSETS + "/presence-shaderlab.json", encoding="utf-8"))
    t = [b for b in j["pres-temoin"]["bandes"] if b["zone"] == "echelle"]
    c = [b for b in j["pres-clarte-p100"]["bandes"] if b["zone"] == "echelle"]
    return np.array([(ci["amp"] / ti["amp"] - 1.0) / CLARITY_AMT for ci, ti in zip(c, t)])


def taps_bilineaires(x):
    f = np.floor(x)
    a = x - f
    return [(f, 1.0 - a), (f + 1.0, a)]


def reponse_fine(d):
    poids = [(-d, 0.125), (-d / 2, 0.25), (0.0, 0.25), (d / 2, 0.25), (d, 0.125)]
    out = []
    for p in PERIODES:
        acc = 0j
        for x, w in poids:
            for xi, wi in taps_bilineaires(x):
                acc += w * wi * np.exp(-2j * np.pi * xi / p)
        out.append((1.0 - acc).real)
    return np.array(out)


def main():
    pyr = reponse_pyramide()
    cible = LR - 1.0
    best = None
    for d10 in range(10, 121):           # ecartement de 1,0 a 12,0 px
        d = d10 / 10.0
        fine = reponse_fine(d)
        # Poids par moindres carres, les deux bandes en meme temps.
        A = np.vstack([fine, pyr]).T
        (a1, a2), *_ = np.linalg.lstsq(A, cible, rcond=None)
        if a1 < 0 or a2 < 0:
            continue
        err = np.abs(A @ np.array([a1, a2]) - cible)
        if best is None or err.mean() < best[0]:
            best = (err.mean(), err.max(), d, a1, a2, A @ np.array([a1, a2]))
    err, pire, d, a1, a2, modele = best
    print("MEILLEUR : ecartement %.1f px, poids fin %.3f, poids pyramide %.3f" % (d, a1, a2))
    print("  ecart moyen %.4f, pire %.4f\n" % (err, pire))
    print("  periode   " + "".join("%8.1f" % p for p in PERIODES))
    print("  Lightroom " + "".join("%8.3f" % v for v in LR))
    print("  modele    " + "".join("%8.3f" % (1 + v) for v in modele))
    print("  ecart     " + "".join("%8.3f" % (1 + v - g) for v, g in zip(modele, LR)))
    print()
    print("  part fine " + "".join("%8.3f" % v for v in a1 * reponse_fine(d)))
    print("  part pyr. " + "".join("%8.3f" % v for v in a2 * pyr))


if __name__ == "__main__":
    main()
