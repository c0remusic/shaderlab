"""Lit la sonde de diagnostic en travers du bord, sur les memes lignes que la
mesure de halo.

⚠️ La cible de rendu est en sRGB PAR LE FORMAT : ce que le shader ecrit est
encode a l'ecriture. Un 0,5 ecrit ressort a 188 dans la PNG, pas a 128 — lire la
PNG telle quelle ferait mentir les trois champs du meme facteur. On decode donc
par l'EOTF avant toute lecture.

Canaux : R = portail, V = 0,5 + 2,5 * (y - yMoyen), B = variance * 50.
"""
import numpy as np
from PIL import Image

SP = r"C:/Users/LEETJ/AppData/Local/Temp/claude/C--dev-shaderlab/5cd8e3ee-e6ce-40b9-9de5-528e15ea775a/scratchpad"
T = 320
JAL = list(range(-12, 13, 3))


def eotf(v):
    v = v / 255.0
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


sonde = eotf(np.asarray(Image.open(f"{SP}/nous-ph-texture-p100-petale.png").convert("RGB"), dtype=np.float64))
# Le temoin de la sonde est inutilisable (le module est SAUTE a dose nulle, donc
# l image sort telle quelle) : on repere le bord sur le champ de variance, qui
# culmine exactement dessus.
variance = sonde[:, :, 2] / 50.0

lignes = []
for y in range(40, 280):
    i = int(np.argmax(variance[y]))
    if 40 < i < T - 40:
        lignes.append((y, i))
print("bord repere sur %d lignes, colonne mediane %d"
      % (len(lignes), int(np.median([i for _, i in lignes]))))

noms = ["portail", "detail moyen (y - yMoyen)", "variance"]
for c, nom in enumerate(noms):
    vals = []
    for k in JAL:
        acc = [sonde[y, min(max(i + k, 0), T - 1), c] for y, i in lignes]
        v = float(np.mean(acc))
        if c == 1:
            v = (v - 0.5) / 2.5
        if c == 2:
            v = v / 50.0
        vals.append(v)
    largeur = "%8.4f" if c else "%8.3f"
    print("  %-26s" % nom + "".join(largeur % v for v in vals))
print("  %-26s" % "distance au bord" + "".join("%8d" % k for k in JAL))
