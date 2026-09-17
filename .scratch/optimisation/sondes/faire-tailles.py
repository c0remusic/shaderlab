"""Copies reduites de la meme photo, pour mesurer la LOI d'echelle du cout GPU.

Meme contenu, seule la taille change : toute difference de temps vient donc du
nombre de pixels, pas du sujet.
"""
from PIL import Image
import os

SRC = "C:/Users/LEETJ/Pictures/vram-test/photo-1.jpg"
DST = "C:/Users/LEETJ/Pictures/vram-test/echelle"
os.makedirs(DST, exist_ok=True)

im = Image.open(SRC)
w, h = im.size
print("source", w, h, round(w * h / 1e6, 2), "Mpx")

for div in (2, 4, 8):
    nw, nh = w // div, h // div
    out = os.path.join(DST, "echelle-%d.jpg" % div)
    im.resize((nw, nh), Image.LANCZOS).save(out, quality=95)
    print(out, nw, nh, round(nw * nh / 1e6, 3), "Mpx")
