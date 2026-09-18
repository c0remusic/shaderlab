"""Le voisinage de LiftShadows et de cr_black_lift_curve.

Le premier minage (miner-grading-espace.py) a sorti deux symboles qui portent le
mot LIFT, et un lift est precisement ce qu'un decalage de L en OKLab ne peut pas
faire : lever un noir absolu. On regarde donc DANS QUELLE MACHINERIE ils vivent,
par leurs voisins — la methode qui avait tranche Clarte.

⚠️ Un nom n'est pas une preuve d'emploi. « LiftShadows » peut etre une entree de
preset, un champ d'interface ou un reste. Ce script sort le contexte BRUT pour
qu'on le lise, il ne conclut pas.
"""
import re

DLL = r"C:\Program Files\Adobe\Adobe Lightroom Classic\CameraRaw.dll"
with open(DLL, "rb") as f:
    s = f.read().decode("latin-1")

def voisins(motif, avant=600, apres=600, maxi=6):
    print("")
    print("=== %s ===" % motif)
    trouve = list(re.finditer(motif, s))
    print("  %d occurrence(s)" % len(trouve))
    for m in trouve[:maxi]:
        a, b = max(0, m.start() - avant), min(len(s), m.end() + apres)
        mots = []
        for n in re.findall(r"[A-Za-z_][A-Za-z0-9_]{3,60}", s[a:b]):
            if n not in mots:
                mots.append(n)
        print("  --- @%d ---" % m.start())
        print("   " + " ".join(mots[:45]))

voisins(r"LiftShadows")
voisins(r"cr_black_lift_curve")
voisins(r"RedLiftMatte")

# Les quatre luminances : dans quel bloc vivent-elles ? On elargit la fenetre,
# le bloc d'uniformes du grading n'ayant pas ete trouve par le nom « Uniforms ».
print("")
print("=== VOISINS DE ColorGradeShadowLum (fenetre large) ===")
for m in list(re.finditer(r"ColorGradeShadowLum", s))[:5]:
    a, b = max(0, m.start() - 1200), min(len(s), m.end() + 1200)
    mots = []
    for n in re.findall(r"[A-Za-z_][A-Za-z0-9_]{3,60}", s[a:b]):
        if n not in mots:
            mots.append(n)
    print("  --- @%d ---" % m.start())
    print("   " + " ".join(mots[:60]))

# Un uniforme de shader porte souvent le prefixe u. Cherchons les uniformes du
# grading directement, sans passer par un bloc nomme.
print("")
print("=== UNIFORMES u* CITANT GRADE / TONING / SPLIT ===")
noms = sorted(set(re.findall(r"u[A-Z][A-Za-z0-9]{3,50}", s)))
for n in noms:
    if re.search(r"Grade|Grading|Toning|Split", n):
        print("  " + n)

# Et les fonctions de shader qui appliquent le virage.
print("")
print("=== FONCTIONS / STAGES CITANT split_tone OU color_grade ===")
for motif in (r"[a-z_]{0,30}split_tone[a-z_]{0,30}", r"[a-z_]{0,30}color_grade[a-z_]{0,30}",
              r"[a-z_]{0,30}toning[a-z_]{0,30}"):
    trouve = sorted(set(re.findall(motif, s)))
    trouve = [t for t in trouve if len(t) > 8][:30]
    print("  %-40s -> %s" % (motif[:38], trouve if trouve else "AUCUN"))
