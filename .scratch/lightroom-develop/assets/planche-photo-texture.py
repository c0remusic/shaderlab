"""Planche Texture sur photo reelle : Lightroom contre nous, en 1:1.

Une ligne par detourage, quatre colonnes de doses, Lightroom au-dessus et nous
en dessous. Aucune reduction — Texture est un operateur PAR PIXEL.
"""
import os
import sys

from PIL import Image, ImageDraw

SP = r"C:/Users/LEETJ/AppData/Local/Temp/claude/C--dev-shaderlab/5cd8e3ee-e6ce-40b9-9de5-528e15ea775a/scratchpad"
LR = os.path.expanduser("~/Documents/shaderlab-lightroom-mesures")
CROPS = {"petale": (2600, 2500), "feuillage": (1200, 1200), "ciel": (4200, 600)}
DOSES = ["ph-temoin", "ph-texture-p40", "ph-texture-p100", "ph-texture-m60"]
TITRES = ["temoin", "Texture +40", "Texture +100", "Texture -60"]
T = 320

quel = sys.argv[1] if len(sys.argv) > 1 else "petale"
x, y = CROPS[quel]

pad = 8
W = len(DOSES) * (T + pad) + pad
H = 2 * (T + 22) + pad + 20
planche = Image.new("RGB", (W, H), (22, 22, 24))
d = ImageDraw.Draw(planche)
d.text((pad, 4), f"DSCF5171, detourage {quel} en {x},{y} — 1:1, aucune reduction", fill=(200, 200, 205))

for i, (dose, titre) in enumerate(zip(DOSES, TITRES)):
    cx = pad + i * (T + pad)
    lr = Image.open(os.path.join(LR, dose + ".jpg")).convert("RGB").crop((x, y, x + T, y + T))
    planche.paste(lr, (cx, 20))
    d.text((cx, 20 + T + 3), "Lightroom  " + titre, fill=(190, 190, 195))
    nous = Image.open(os.path.join(SP, f"nous-{dose}-{quel}.png")).convert("RGB")
    planche.paste(nous, (cx, 20 + T + 22))
    d.text((cx, 20 + 2 * T + 25), "shaderlab  " + titre, fill=(190, 190, 195))

out = os.path.join(SP, f"planche-texture-{quel}.png")
planche.save(out)
print("ecrit", out, planche.size)
