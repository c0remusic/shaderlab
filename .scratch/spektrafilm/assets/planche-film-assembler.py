"""Assemble la planche film : une planche par photo.

Haut : les sept images ENTIERES reduites (couleur, halation — un effet de masse se
juge reduit). Bas : les crops 1:1 a pleine resolution, en deux rangees de quatre
(grain, micro-diffusion — un effet par pixel se juge a 1:1).

Colonnes : original, notre pile aux defauts, notre pile dosee (reglage de session,
pas un preset), puis quatre stocks spektrafilm rendus tels quels.
Usage : python planche-film-assembler.py <dossier-des-rendus> <dossier-de-sortie>
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

R, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
COLONNES = [
    ("original", "original"),
    ("notre-pile", "shaderlab — glow + halation + grain, DÉFAUTS"),
    ("notre-pile-dosee", "shaderlab — même pile DOSÉE (réglage de session)"),
    ("portra400", "spektrafilm — Portra 400 → Portra Endura"),
    ("vision3-500t", "spektrafilm — Vision3 500T → 2383"),
    ("ektar100", "spektrafilm — Ektar 100 → Endura Premier"),
    ("velvia100", "spektrafilm — Velvia 100 (inversible, scan)"),
]
PHOTOS = ["5163-bougie", "5160-agave", "5171-lys"]
try:
    F = ImageFont.truetype("arial.ttf", 26)
    FT = ImageFont.truetype("arialbd.ttf", 34)
except OSError:
    F = FT = ImageFont.load_default()
FOND, TEXTE, MARGE, BANDE = (24, 24, 24), (225, 225, 225), 12, 40


def charge(nom, col, mode):
    p = os.path.join(R, f"{nom}__{col}__{mode}.png")
    if not os.path.exists(p) and col == "original":
        p = os.path.join(R, f"{nom}__temoin-app__{mode}.png")
    return Image.open(p).convert("RGB") if os.path.exists(p) else None


for nom in PHOTOS:
    crops = [charge(nom, c, "crop") for c, _ in COLONNES]
    entiers = [charge(nom, c, "entier") for c, _ in COLONNES]
    C = max(im.width for im in crops if im)            # crop 1:1, ~998 px
    largeur = 4 * C + 5 * MARGE
    tuile = (largeur - (len(COLONNES) + 1) * MARGE) // len(COLONNES)
    ent = []
    for im in entiers:
        if im is None:
            ent.append(None); continue
        k = tuile / im.width
        ent.append(im.resize((tuile, round(im.height * k)), Image.LANCZOS))
    hEnt = max(im.height for im in ent if im)
    hauteur = 60 + BANDE + hEnt + MARGE + 2 * (BANDE + C + MARGE) + 50
    P = Image.new("RGB", (largeur, hauteur), FOND)
    d = ImageDraw.Draw(P)
    d.text((MARGE, 12), f"DSCF{nom.split('-')[0]} — images entières réduites, puis crops 1:1 à pleine résolution", font=FT, fill=TEXTE)
    y = 60
    for k, (im, (_, lab)) in enumerate(zip(ent, COLONNES)):
        x = MARGE + k * (tuile + MARGE)
        d.text((x, y + 6), lab.split(" — ")[-1] if len(lab) > 30 else lab, font=ImageFont.truetype("arial.ttf", 17) if F != ImageFont.load_default() else F, fill=TEXTE)
        if im:
            P.paste(im, (x, y + BANDE))
    y += BANDE + hEnt + MARGE
    rangs = [[0, 1, 2, None], [3, 4, 5, 6]]
    for rang in rangs:
        for j, k in enumerate(rang):
            x = MARGE + j * (C + MARGE)
            if k is None:
                d.text((x + 10, y + BANDE + C // 2 - 60), "Crops 1:1 (998 px à pleine résolution).\nLe grain et la micro-diffusion\nse jugent ici, pas en réduit.\n\nLa pile DOSÉE est un réglage\nà l'œil de la session, pas un preset.", font=F, fill=(160, 160, 160))
                continue
            d.text((x, y + 6), COLONNES[k][1], font=F, fill=TEXTE)
            if crops[k]:
                P.paste(crops[k], (x, y + BANDE))
        y += BANDE + C + MARGE
    d.text((MARGE, y + 8), "spektrafilm (andreavolpato/spektrafilm, GPL-3.0, profils CC BY-SA 4.0) rendu tel quel, exposition automatique coupée ; shaderlab par son pipeline réel (harnais render-check-page).", font=ImageFont.truetype("arial.ttf", 18) if F != ImageFont.load_default() else F, fill=(150, 150, 150))
    sortie = os.path.join(OUT, f"planche-film-{nom}.jpg")
    P.save(sortie, quality=95)
    print(sortie, P.size)
