"""Reponse en frequence EXACTE du noyau fin de Texture, sans GPU.

Les bandes de la mire ne varient que selon x, donc seule la projection du noyau
sur x compte. Projection des treize poids 2D :

    -d : 0,125   -d/2 : 0,25   0 : 0,25   +d/2 : 0,25   +d : 0,125

Chaque prelevement est BILINEAIRE : a un decalage non entier il ne lit pas un
texel mais un melange de deux, ce qui est un filtre en soi et qu'il faut compter
— c'est precisement ce melange qui decide du repliement.

Le gain de Texture a faible amplitude vaut 1 + amt*(1 - K(1/P)), ou K est la
transmittance du noyau. On compare aux gains de Lightroom aux memes periodes.
"""
import numpy as np

# Lightroom, Texture +100, zone ECHELLE de la mire de presence.
PERIODES = [3.0, 4.0, 6.01, 8.0, 11.98, 16.0, 24.09, 32.0, 47.63, 64.0, 97.52, 128.0, 186.18, 256.0]
LR = [1.746, 1.696, 1.637, 1.586, 1.535, 1.513, 1.491, 1.497, 1.454, 1.374, 1.261, 1.203, 1.149, 1.120]


def taps_bilineaires(x):
    """Un prelevement au decalage x (en pixels) lu en bilineaire = deux texels."""
    f = np.floor(x)
    a = x - f
    return [(f, 1.0 - a), (f + 1.0, a)]


def transmittance(d, periode):
    poids = [(-d, 0.125), (-d / 2, 0.25), (0.0, 0.25), (d / 2, 0.25), (d, 0.125)]
    acc = 0j
    for x, w in poids:
        for xi, wi in taps_bilineaires(x):
            acc += w * wi * np.exp(-2j * np.pi * xi / periode)
    return acc


def gains(d, amt):
    return [1.0 + amt * (1.0 - transmittance(d, p)).real for p in PERIODES]


print("Lightroom  " + "".join("%7.2f" % g for g in LR))
print("periode    " + "".join("%7.1f" % p for p in PERIODES))
print()
for d in (2, 3, 4, 5, 6, 8):
    # amt choisi pour coller a Lightroom a la periode 16, la bande de reference.
    k16 = (1.0 - transmittance(d, 16.0)).real
    amt = (1.513 - 1.0) / k16 if k16 > 1e-6 else float("nan")
    g = gains(d, amt)
    err = np.abs(np.array(g) - np.array(LR))
    print("d=%-4g amt=%5.2f " % (d, amt) + "".join("%7.2f" % v for v in g)
          + "   ecart moyen %.3f  pire %.3f" % (err.mean(), err.max()))
