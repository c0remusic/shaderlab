"""Mine CameraRaw.dll autour de CLARTE, pour en tirer la FORME qui manque.

POURQUOI. research/10 mesure que la composante large de Clarte chez Lightroom
n'est PAS un contraste contre un flou profond : leur deplacement d'aplat est
MAXIMAL au mi-ton et s'eteint aux deux bouts, le notre fait exactement l'inverse.
C'est une FORME qui manque, et la consigne permanente d'Antoine dit ou la
chercher : le binaire donne la FORME, la mesure donne les AMPLITUDES.

COMMENT. Decodage latin-1 du fichier entier puis regex — jamais de boucle par
octet, qui expire sur 145 Mo (memoire projet `miner-un-binaire-windows`).
"""
import re
import sys
from collections import Counter

DLL = r"C:\Program Files\Adobe\Adobe Lightroom Classic\CameraRaw.dll"

with open(DLL, "rb") as f:
    brut = f.read()
s = brut.decode("latin-1")
print("dll : %.1f Mo" % (len(brut) / 1e6))
print("")

mode = sys.argv[1] if len(sys.argv) > 1 else "symboles"


def uniques(motif, limite=200, flags=0):
    vus = []
    seen = set()
    for m in re.finditer(motif, s, flags):
        t = m.group(0)
        if t not in seen:
            seen.add(t)
            vus.append(t)
            if len(vus) >= limite:
                break
    return vus


if mode == "symboles":
    print("=== etages cr_stage_* citant clarity / local_contrast / detail ===")
    for t in uniques(r"cr_stage_[A-Za-z0-9_]*(?:clarity|local_contrast|localcontrast|detail)[A-Za-z0-9_]*", 80, re.I):
        print("  " + t)
    print("")
    print("=== fichiers cr_*.cpp citant clarity ou contrast ===")
    for t in uniques(r"cr_[A-Za-z0-9_]*(?:clarity|contrast)[A-Za-z0-9_]*\.cpp", 40, re.I):
        print("  " + t)
    print("")
    print("=== identifiants portant Clarity (hors .cpp) ===")
    for t in uniques(r"[A-Za-z_][A-Za-z0-9_]{2,60}Clarity[A-Za-z0-9_]{0,60}", 120):
        print("  " + t)
    print("")
    print("=== identifiants LocalContrast ===")
    for t in uniques(r"[A-Za-z_][A-Za-z0-9_]{0,60}LocalContrast[A-Za-z0-9_]{0,60}", 120):
        print("  " + t)

elif mode == "uniforms":
    # Les blobs DXBC portent un chunk RDEF avec les NOMS d'uniformes en clair.
    # Un nom d'uniforme dit ce que le noyau lit, donc la forme de sa ponderation.
    print("=== noms d'uniformes plausibles autour du contraste local ===")
    motif = r"[a-z][A-Za-z0-9_]{3,40}(?:Clarity|LocalContrast|Midtone|MidTone|Pivot|Weight|Mask|Falloff|Bell|Rolloff)[A-Za-z0-9_]{0,30}"
    c = Counter(m.group(0) for m in re.finditer(motif, s))
    for nom, n in c.most_common(120):
        print("  %-52s x%d" % (nom, n))

elif mode == "voisinage":
    # Fenetre de texte autour de chaque occurrence du symbole donne : les
    # symboles voisins dans la table sont ceux du meme etage.
    cible = sys.argv[2]
    fenetre = int(sys.argv[3]) if len(sys.argv) > 3 else 400
    vus = set()
    n = 0
    for m in re.finditer(re.escape(cible), s):
        a = max(0, m.start() - fenetre)
        b = min(len(s), m.end() + fenetre)
        bout = s[a:b]
        for t in re.findall(r"[A-Za-z_][A-Za-z0-9_]{5,70}", bout):
            if t not in vus:
                vus.add(t)
        n += 1
        if n >= 12:
            break
    print("=== %d occurrence(s) de %s, symboles voisins ===" % (n, cible))
    for t in sorted(vus):
        print("  " + t)
