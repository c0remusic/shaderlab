"""Le ZERO de la campagne DETAIL, controle des deux cotes.

LA QUESTION : notre pipeline change-t-il le grain de la photo AVANT qu'aucun
debruitage n'existe ? Si oui, toute amplitude de Detail calibree sur la campagne
Lightroom serait biaisee du meme facteur, et rien ne le dirait — le biais
vivrait dans le zero de l'instrument, pas dans les mesures. Elle se pose
maintenant precisement parce que la campagne n'a pas encore tourne.

CE QUI REND LA COMPARAISON EXACTE. Les exports de Lightroom et nos rendus font
tous 6240x4160 sur `DSCF5171.JPG` : un crop de 1400x1400 pris au centre tombe
donc sur LES MEMES PIXELS des deux cotes, a l'echelle native. Aucune reduction,
donc aucune des chausse-trappes de la decimation — et un grain se juge en 1:1 de
toute facon (CLAUDE.md, echelle du phenomene).

Les trois champs viennent de `champs_detail.py`, partage avec
`analyse-detail.py` : les deux cotes ne se comparent que s'ils se mesurent au
meme code.

Notre cote se rend par `temoin-shaderlab.mjs` (app sur CDP 9222 + Vite 1421).
"""
import os

from champs_detail import champs

LR = os.path.expanduser("~/Documents/shaderlab-lightroom-mesures")
SOURCE = r"C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG"
COTE = 1400

# (libelle, fichier). Le fichier source EN PREMIER : c'est la reference dont les
# deux chaines s'ecartent, et ni l'une ni l'autre n'est la verite de l'autre.
LIGNES = [
    ("fichier boitier", SOURCE),
    ("Lightroom temoin", os.path.join(LR, "ph-temoin.jpg")),
    ("shaderlab temoin", os.path.join(LR, "sl-temoin.png")),
    ("Lightroom Texture +100", os.path.join(LR, "ph-texture-p100.jpg")),
    ("shaderlab Texture +100", os.path.join(LR, "sl-texture-p100.png")),
    ("Lightroom Texture -60", os.path.join(LR, "ph-texture-m60.jpg")),
    ("shaderlab Texture -60", os.path.join(LR, "sl-texture-m60.png")),
]

lus = {}
print("crop de %dx%d au centre, echelle native" % (COTE, COTE))
print("")
print("%-24s %8s %9s %8s" % ("", "grain", "nettete", "acuite"))
manquants = []
for libelle, path in LIGNES:
    if not os.path.exists(path):
        manquants.append(libelle)
        continue
    g, s, a = champs(path, crop=COTE)
    lus[libelle] = (g, s, a)
    print("%-24s %8.3f %9.3f %8.3f" % (libelle, g, s, a))

if manquants:
    print("")
    print("MANQUENT : " + ", ".join(manquants))

base = lus.get("fichier boitier")
if base:
    print("")
    print("ECART AU FICHIER BOITIER — le zero de chaque chaine :")
    for libelle in ("Lightroom temoin", "shaderlab temoin"):
        if libelle in lus:
            print("  %-22s grain x%.3f   nettete x%.3f" % (
                libelle, lus[libelle][0] / base[0], lus[libelle][1] / base[1]))

for dose in ("+100", "-60"):
    lr_t, lr_d = lus.get("Lightroom temoin"), lus.get("Lightroom Texture " + dose)
    sl_t, sl_d = lus.get("shaderlab temoin"), lus.get("shaderlab Texture " + dose)
    if lr_t and lr_d and sl_t and sl_d:
        print("")
        print("TEXTURE %s — chaque cote rapporte a SON PROPRE temoin :" % dose)
        print("  Lightroom   grain x%.3f   nettete x%.3f" % (lr_d[0] / lr_t[0], lr_d[1] / lr_t[1]))
        print("  shaderlab   grain x%.3f   nettete x%.3f" % (sl_d[0] / sl_t[0], sl_d[1] / sl_t[1]))
