"""Assemble la planche du 187x : trois scenes, deux colonnes, detourages 1:1.

Les deux colonnes sortent a la MEME taille finale — celle a laquelle l'oeil les
voit. La question n'est pas « laquelle est plus definie » mais « les
distingue-t-on ».
"""
from PIL import Image, ImageDraw, ImageFont
import os

D = "C:/Users/LEETJ/AppData/Local/Temp/claude/C--dev-shaderlab/5cd8e3ee-e6ce-40b9-9de5-528e15ea775a/scratchpad/opti"
SORTIE = os.path.join(D, "planche-187x.png")

SCENES = [
    ("global", "GLOBAL — exposition, contraste, vibrance, saturation", "ecart moyen 1,22 / 3,0 % des pixels au-dela de 2 niveaux"),
    ("local", "LOCAL — les memes, plus Clarte 55 et Texture 40 (rayon en PIXELS)", "ecart moyen 5,98 / 67,2 %"),
    ("grain", "PAR PIXEL — effet Grain, reglages par defaut", "ecart moyen 4,49 / 59,8 %"),
]
COLONNES = [("A-natif", "A — rendu 26 Mpx puis reduit", "aujourd'hui : 16,9 ms, 1150 Mo"),
            ("B-affichage", "B — rendu direct a 456 px", "le levier : 0,09 ms, 160 Mo")]

CROP = 300
MARGE = 16
TITRE_H = 30
ENTETE_H = 50
HAUT = 58


def police(taille, gras=False):
    for nom in ("segoeuib.ttf" if gras else "segoeui.ttf", "arialbd.ttf" if gras else "arial.ttf"):
        try:
            return ImageFont.truetype(nom, taille)
        except OSError:
            continue
    return ImageFont.load_default()


f_titre = police(19, True)
f_scene = police(15, True)
f_note = police(13)
f_col = police(13, True)

largeur = MARGE * 3 + CROP * 2
hauteur = HAUT + ENTETE_H + len(SCENES) * (TITRE_H + 18 + CROP + MARGE) + MARGE

img = Image.new("RGB", (largeur, hauteur), (24, 24, 26))
d = ImageDraw.Draw(img)

d.text((MARGE, 14), "Rendre a la resolution d'affichage : ce que l'oeil y perd", font=f_titre, fill=(240, 240, 240))
d.text((MARGE, 36), "Meme photo boitier, meme taille finale (456 x 304, la taille reelle a l'ecran). Detourages 1:1 dans la vue.",
       font=f_note, fill=(150, 150, 155))

y = HAUT
for i, (cle, libelle, cout) in enumerate(COLONNES):
    x = MARGE + i * (CROP + MARGE)
    d.text((x, y + 6), libelle, font=f_col, fill=(210, 210, 220))
    d.text((x, y + 24), cout, font=f_note, fill=(146, 146, 152))
y += ENTETE_H

for cle, titre, note in SCENES:
    d.text((MARGE, y), titre, font=f_scene, fill=(235, 235, 240))
    d.text((MARGE, y + 19), note, font=f_note, fill=(150, 150, 155))
    y += TITRE_H + 18
    for i, col in enumerate(c[0] for c in COLONNES):
        p = os.path.join(D, "res-%s-%s-crop.png" % (cle, col))
        img.paste(Image.open(p).convert("RGB"), (MARGE + i * (CROP + MARGE), y))
    y += CROP + MARGE

img.save(SORTIE)
print(SORTIE, img.size)
