"""Lit les profils des trois canaux de la pyramide sur la mire de portee.

Geometrie (shaderlab-mire-portee-2048x16384.json) :
  zone PORTEE  y     0.. 8192  reseau des deux cotes, marche de TON 96/160
  zone PORTAIL y  8192..16384  aplat 128 de 8192 a 12288, reseau de 12288 a 16384

UNE question : le canal b fait-il la marche de la zone PORTAIL, ou la ligne y
est-elle plate ? La zone PORTAIL a le MEME TON des deux cotes — tout ce qui y
bouge vient donc du DETAIL et de rien d'autre.

Les canaux sortent d'une cible 8 bits sRGB : on redecode avant de conclure.
"""
import json
import os
import sys

D = "C:/Users/LEETJ/AppData/Local/Temp/claude/C--dev-shaderlab/5cd8e3ee-e6ce-40b9-9de5-528e15ea775a/scratchpad/opti"
nom = sys.argv[1] if len(sys.argv) > 1 else "portail"


def s2l(c):
    x = max(c, 0.0)
    return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4


d = json.load(open(os.path.join(D, "canal-detail-%s.json" % nom)))


def moy(canal, champ, y0, y1):
    a = d[canal][champ][y0:y1]
    return sum(a) / len(a)


ZONES = [
    ("PORTEE reseau 96", 200, 3800),
    ("PORTEE reseau 160", 4400, 7900),
    ("PORTAIL aplat 128", 8400, 12100),
    ("PORTAIL reseau 128", 12500, 16100),
]

print("TEMOIN (sortie = color) — doit rendre l'image, sinon rien d'autre ne vaut")
for z, y0, y1 in ZONES:
    print("  %-20s %6.2f octets, amplitude %5.2f" % (z, moy("temoin", "profil", y0, y1), moy("temoin", "ampli", y0, y1)))

print("")
print("zone                    r (luma floutee)   g (y floute)    b (DETAIL)")
print("                         octet   ampli      octet  ampli     octet  valeur")
for z, y0, y1 in ZONES:
    b = moy("b", "profil", y0, y1)
    print("%-22s %7.2f %7.2f   %7.2f %6.2f   %7.2f %8.5f" % (
        z,
        moy("r", "profil", y0, y1), moy("r", "ampli", y0, y1),
        moy("g", "profil", y0, y1), moy("g", "ampli", y0, y1),
        b, s2l(b / 255.0)))

a = moy("b", "profil", 8400, 12100)
c = moy("b", "profil", 12500, 16100)
print("")
print("MARCHE DE DETAIL (portail, meme ton des deux cotes) :")
print("  aplat %.2f -> reseau %.2f octets   (%.5f -> %.5f)" % (a, c, s2l(a / 255.0), s2l(c / 255.0)))
if abs(c - a) < 1.0:
    print("  ⚠️  PLATE : le canal ne separe pas le detail du non-detail.")
else:
    print("  marche de %.2f octets — le canal SEPARE le detail." % (c - a))

print("")
print("Profil du canal b autour de la frontiere y=12288, pas de 128 lignes :")
for y in range(12288 - 768, 12288 + 896, 128):
    print("  y=%-6d %6.2f octets" % (y, moy("b", "profil", y, y + 128)))
