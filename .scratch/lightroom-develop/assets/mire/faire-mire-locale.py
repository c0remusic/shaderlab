"""Fabrique la MIRE LOCALE — celle que la mire principale ne peut pas remplacer.

POURQUOI UNE SECONDE MIRE. La mire principale mesure tres bien les operateurs
GLOBAUX (une courbe de transfert, un virage, une rotation de teinte) parce que
sa rampe et ses patches donnent beaucoup d'ancres. Elle ne peut PAS mesurer un
operateur LOCAL — voile, clarte, accentuation — et deux contre-expertises l'ont
etabli le 2026-09-15, chiffres a l'appui :

  - ses patches sont CONTIGUS (marge de 20 px seulement) : le meme coefficient de
    voile refait colonne par colonne dans le patch gris 118 court de 0,675 a
    0,745, une dispersion 2,4 fois plus large que la correction qu'on voulait y
    lire. Un operateur qui regarde le voisinage voit les patches voisins ;
  - sa rampe monte par marches de 8 px : a cette echelle, tout operateur local
    voit une texture, pas un aplat ;
  - pour l'accentuation, 99 % de ses bords sont des bords de TEINTE a canal fort
    constant (marche de luminance x2,11, marche de canal fort x1,010). Le seul
    vrai echelon d'intensite non ecrete a son cote sombre a Ylin 0,134, au-dessus
    de la zone qu'on cherchait a modeler.

CE QUE CELLE-CI APPORTE, et rien d'autre :

  ZONE A — sept BANDES pleine largeur, 200 px de haut, parfaitement uniformes.
    Mesurer au centre d'une bande, c'est etre a 100 px de tout bord verticalement
    et infiniment loin horizontalement : un operateur local y voit un vrai aplat.
    C'est ce qui separe le terme GLOBAL du terme LOCAL d'un voile.

  ZONE B — trois ECHELONS D'INTENSITE gris, cote sombre sous Ylin 0,10, aucun
    canal ecrete, plateaux de 341 px de part et d'autre. C'est la mesure qui
    manquait pour dire si l'accentuation de Lightroom a un pied lineaire dans les
    noirs, ou si elle reste un facteur pur.

  ZONE C — trois echelons COLORES (primaire saturee contre neutre clair). Ils
    discriminent un halo teinte d'un halo neutre : un FACTEUR teinte le liseré de
    la couleur du pixel, un OFFSET le rend neutre.

Usage : python faire-mire-locale.py
Sortie : shaderlab-mire-locale.jpg, a poser a cote de la mire principale dans
C:/Users/LEETJ/Pictures/shaderlab-mire/.
"""
import os
from PIL import Image, ImageDraw

W = 2048
BANDE_H = 200
GRIS = [0, 32, 64, 118, 160, 200, 255]          # ancres neutres, zone A
ECHELONS = [(20, 60), (30, 90), (45, 130)]       # zone B : sombre | clair, 8 bits
COLORES = [((200, 20, 20), (225, 225, 225)),     # zone C : primaire | neutre clair
           ((20, 120, 200), (225, 225, 225)),
           ((230, 180, 20), (60, 60, 60))]
PAIRE_H = 300

H = len(GRIS) * BANDE_H + 2 * PAIRE_H
img = Image.new("RGB", (W, H), (0, 0, 0))
d = ImageDraw.Draw(img)

y = 0
for v in GRIS:
    d.rectangle([0, y, W, y + BANDE_H], fill=(v, v, v))
    y += BANDE_H

cell = W // 3
for i, (a, b) in enumerate(ECHELONS):
    x0 = i * cell
    d.rectangle([x0, y, x0 + cell // 2, y + PAIRE_H], fill=(a, a, a))
    d.rectangle([x0 + cell // 2, y, x0 + cell, y + PAIRE_H], fill=(b, b, b))
y += PAIRE_H

for i, (ca, cb) in enumerate(COLORES):
    x0 = i * cell
    d.rectangle([x0, y, x0 + cell // 2, y + PAIRE_H], fill=ca)
    d.rectangle([x0 + cell // 2, y, x0 + cell, y + PAIRE_H], fill=cb)

dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shaderlab-mire-locale.jpg")
img.save(dest, "JPEG", quality=100, subsampling=0)
print("ecrit", dest, img.size)

# ── GEOMETRIE, pour le script d'analyse ──────────────────────────────────────
print("\nzones (a recopier dans l'analyse) :")
for i, v in enumerate(GRIS):
    c = i * BANDE_H + BANDE_H // 2
    print(f"  bande gris {v:3d} : lignes {c-60} a {c+60}, toute la largeur")
yb = len(GRIS) * BANDE_H
print(f"  echelons gris   : lignes {yb+60} a {yb+240}, bord a x = {cell//2}, {cell+cell//2}, {2*cell+cell//2}")
print(f"  echelons colores: lignes {yb+PAIRE_H+60} a {yb+PAIRE_H+240}, memes x")
