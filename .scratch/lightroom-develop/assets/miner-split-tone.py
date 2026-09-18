"""cr_split_tone : la machinerie REELLE du Color Grading, et son espace.

Les deux minages precedents ont ecarte deux fausses pistes AVANT d'en conclure
quoi que ce soit : « LiftShadows » et « RedLiftMatte » sont des noms de PRESETS
(voisins : CoolShadowsAndWarmHighlights, SepiaTone, BlurVignette), et
cr_black_lift_curve vit dans l'etage d'EXPOSITION (voisins : cr_exposure_stage,
cr_stage_local_whites_blacks, whiteClip) — c'est la machinerie des Noirs, pas
celle du virage.

Ce qui reste, et qui est nomme sans ambiguite : cr_split_tone et
cr_split_tone_function, plus les cinq parametres split_toning_*.

LA QUESTION : la luminance des quatre roues agit-elle en lumiere LINEAIRE ou sur
le L d'un espace perceptuel ? Un decalage de L ne peut pas lever un noir absolu ;
Lightroom porte pourtant le niveau 0 a 14,33 a `Luminance des ombres` +50.
"""
import re

DLL = r"C:\Program Files\Adobe\Adobe Lightroom Classic\CameraRaw.dll"
with open(DLL, "rb") as f:
    s = f.read().decode("latin-1")

def contexte(motif, avant, apres, maxi=8, mots=70):
    print("")
    print("=== %s (fenetre -%d/+%d) ===" % (motif, avant, apres))
    trouve = list(re.finditer(motif, s))
    print("  %d occurrence(s)" % len(trouve))
    for m in trouve[:maxi]:
        a, b = max(0, m.start() - avant), min(len(s), m.end() + apres)
        vus = []
        for n in re.findall(r"[A-Za-z_][A-Za-z0-9_]{3,60}", s[a:b]):
            if n not in vus:
                vus.append(n)
        print("  --- @%d ---" % m.start())
        print("   " + " ".join(vus[:mots]))

contexte(r"cr_split_tone_function", 1500, 1500)
contexte(r"cr_split_tone(?!_function)", 1500, 1500)
contexte(r"split_toning_balance", 900, 900, maxi=4)

# Les stages VOISINS dans la sequence : l'ORDRE d'un pipeline dit dans quel etat
# est le signal quand un stage le recoit. Si cr_split_tone est encadre de stages
# qui travaillent en lineaire, la question est tranchee par la place.
print("")
print("=== STAGES NOMMES DANS LA MEME FENETRE QUE cr_split_tone ===")
for m in re.finditer(r"cr_split_tone", s):
    a, b = max(0, m.start() - 4000), min(len(s), m.end() + 4000)
    stages = []
    for x in re.findall(r"cr_stage_[a-z0-9_]{3,60}|cr_[a-z0-9_]{3,60}", s[a:b]):
        if x not in stages:
            stages.append(x)
    print("  --- @%d ---" % m.start())
    print("   " + " ".join(stages[:40]))

# Termes d'espace au ras de cr_split_tone, chacun cherche SEUL.
print("")
print("=== TERMES D'ESPACE AU RAS DE cr_split_tone ===")
ancres = [m.start() for m in re.finditer(r"cr_split_tone|split_toning_", s)]
print("  %d ancres" % len(ancres))
for terme in ("linear", "log", "gamma", "srgb", "lab", "hsl", "hsv", "luma", "luminance",
              "gray", "grey", "pow", "exp", "curve", "lut"):
    n = 0
    for p in ancres:
        if terme in s[max(0, p - 2000):p + 2000].lower():
            n += 1
    print("  %-10s %d / %d" % (terme, n, len(ancres)))
