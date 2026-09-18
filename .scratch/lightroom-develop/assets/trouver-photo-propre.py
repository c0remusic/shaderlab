"""Trouve la photo la MOINS GRENUE de la bibliotheque, et fabrique un temoin.

POURQUOI. Tout le dossier du portail de Texture est mesure sur des fichiers qui
portent ~12 niveaux de grain luma, et c'est ce grain qui remplit la variance
locale. Si le portail fonctionne sur une photo propre, le defaut n'est pas le
portail : c'est son hypothese de calibration (une mire sans grain) qui n'est
jamais respectee en usage.

DEUX SUJETS, pour ne pas confondre « photo differente » et « moins de grain » :
  1. la photo d'ORIGINE BOITIER la moins grenue de la bibliotheque ;
  2. la MEME photo que la campagne (DSCF5171), reduite d'un facteur 4 — meme
     scene, meme structure, grain divise par quatre parce qu'un bloc 4x4 moyenne
     quatre fois moins de bruit. C'est le temoin controle : tout ce qui change
     entre elle et l'originale est le grain.

Mesure du grain : ecart-type local sur une tente 3x3, pris dans le decile le
plus PLAT de l'image (gradient le plus faible). Ailleurs, la structure domine et
on ne mesurerait plus le bruit.
"""
from PIL import Image
import numpy as np
import glob
import os

DOSSIER = "C:/Users/LEETJ/Pictures/2018/2018-01-25"
SORTIE = "C:/Users/LEETJ/AppData/Local/Temp/claude/C--dev-shaderlab/5cd8e3ee-e6ce-40b9-9de5-528e15ea775a/scratchpad/opti"
REFERENCE = os.path.join(DOSSIER, "DSCF5171.JPG")


def grain(path, cote=1400):
    im = Image.open(path).convert("L")
    im.thumbnail((cote, cote), Image.NEAREST)  # NEAREST : ne PAS moyenner le grain
    a = np.asarray(im).astype(float)
    # Ecart-type local sur 3x3, par la formule E[x²] - E[x]².
    k = np.ones((3, 3)) / 9.0
    from numpy.lib.stride_tricks import sliding_window_view
    w = sliding_window_view(a, (3, 3))
    m = w.mean(axis=(2, 3))
    sd = np.sqrt(np.maximum(w.var(axis=(2, 3)), 0))
    # Le decile le plus plat, juge par le gradient.
    gx = np.abs(np.diff(a, axis=1))[:-2, :-1][: m.shape[0], : m.shape[1]]
    gy = np.abs(np.diff(a, axis=0))[:-1, :-2][: m.shape[0], : m.shape[1]]
    g = gx + gy
    seuil = np.percentile(g, 10)
    plat = sd[g <= seuil]
    return float(np.median(plat)), float(np.median(a))


fichiers = sorted(glob.glob(os.path.join(DOSSIER, "*.JPG")))
print("%d photos dans %s" % (len(fichiers), DOSSIER))
print("")
print("fichier                 grain (niveaux)   luminance mediane")
mesures = []
for f in fichiers:
    try:
        gr, lum = grain(f)
    except Exception as e:
        print("%-22s ERREUR %s" % (os.path.basename(f), e))
        continue
    mesures.append((gr, lum, f))
    marque = "   <-- campagne" if os.path.samefile(f, REFERENCE) else ""
    print("%-22s %10.3f %17.1f%s" % (os.path.basename(f), gr, lum, marque))

mesures.sort()
print("")
if mesures:
    print("La plus PROPRE : %s (grain %.3f)" % (os.path.basename(mesures[0][2]), mesures[0][0]))
    print("La plus GRENUE : %s (grain %.3f)" % (os.path.basename(mesures[-1][2]), mesures[-1][0]))

# Le temoin controle : DSCF5171 reduite d'un facteur 4, meme scene.
im = Image.open(REFERENCE)
w, h = im.size
petite = im.resize((w // 4, h // 4), Image.LANCZOS)
chemin = os.path.join(SORTIE, "DSCF5171-quart.jpg")
petite.save(chemin, quality=97)
gr4, _ = grain(chemin)
gr1, _ = grain(REFERENCE)
print("")
print("TEMOIN CONTROLE — meme scene, grain divise :")
print("  DSCF5171 pleine      grain %.3f" % gr1)
print("  DSCF5171 au quart    grain %.3f   (%s)" % (gr4, chemin))
