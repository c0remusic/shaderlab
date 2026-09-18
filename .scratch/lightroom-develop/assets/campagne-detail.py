"""Arme la campagne DETAIL du pont de mesure Lightroom.

Ecrit les deux sentinelles dans Documents/. Elles sont INERTES tant que
Lightroom n'est pas redemarre ; la course les consomme (elle les supprime).

⚠️ POURQUOI CHAQUE LIGNE PORTE TOUTE LA BASE. `mesures.lua` remet a zero une
longue liste de reglages (M.ZERO) mais elle ne contient PAS les modulateurs du
panneau Detail : LuminanceNoiseReductionDetail, LuminanceNoiseReductionContrast,
ColorNoiseReductionDetail, ColorNoiseReductionSmoothness, SharpenRadius,
SharpenDetail, SharpenEdgeMasking. Sans les poser, ils gardent ce que le
catalogue a pour cette photo, et la campagne mesurerait l'historique d'une image
au lieu d'une loi. Chaque mesure les ecrit donc en entier.

⚠️ NOMS VERIFIES DANS LE BINAIRE (issues/10-module-detail.md), pas ecrits de
memoire : chacun apparait cinq a onze fois dans CameraRaw.dll. Ce sont aussi les
cles du SDK, ce que la campagne du Color Grading avait appris a ne pas supposer
(les teintes y vivent sous SplitToning*, pas sous ColorGrade*).
"""
import os

DOCS = os.path.join(os.path.expanduser("~"), "Documents")
# Photo d'ORIGINE BOITIER, et celle dont le grain est deja mesure a 6,663
# (assets/trouver-photo-propre.py) : les deux cotes se comparent au meme
# instrument, sinon les chiffres ne sont pas comparables.
PHOTO = r"C:\Users\LEETJ\Pictures\2018\2018-01-25\DSCF5171.JPG"

# Defauts Lightroom des modulateurs, poses partout sauf quand la mesure les vise.
BASE = {
    "LuminanceSmoothing": 0,
    "LuminanceNoiseReductionDetail": 50,
    "LuminanceNoiseReductionContrast": 0,
    "ColorNoiseReduction": 0,
    "ColorNoiseReductionDetail": 50,
    "ColorNoiseReductionSmoothness": 50,
    "Sharpness": 0,
    "SharpenRadius": 1,
    "SharpenDetail": 25,
    "SharpenEdgeMasking": 0,
    "Texture": 0,
}

MESURES = [
    # 1. LA LOI DE REDUCTION — combien de grain part, par dose.
    ("det-temoin", {}),
    ("det-lum25", {"LuminanceSmoothing": 25}),
    ("det-lum50", {"LuminanceSmoothing": 50}),
    ("det-lum75", {"LuminanceSmoothing": 75}),
    ("det-lum100", {"LuminanceSmoothing": 100}),
    # 2. CE QUE LES MODULATEURS RETIENNENT, a dose fixe.
    ("det-lum50-det0", {"LuminanceSmoothing": 50, "LuminanceNoiseReductionDetail": 0}),
    ("det-lum50-det100", {"LuminanceSmoothing": 50, "LuminanceNoiseReductionDetail": 100}),
    ("det-lum50-con100", {"LuminanceSmoothing": 50, "LuminanceNoiseReductionContrast": 100}),
    # 3. CE QUE LE DEBRUITAGE COUTE EN NETTETE — le compromis que tout
    #    debruiteur arbitre, lu sur un profil de bord.
    ("det-lum100-det0", {"LuminanceSmoothing": 100, "LuminanceNoiseReductionDetail": 0}),
    # 4. L'INTERACTION AVEC TEXTURE, qui est la raison de tout ce chantier :
    #    leur Texture amplifie un grain deja reduit (research/15).
    ("det-tex100-nr0", {"Texture": 100}),
    ("det-tex100-nr50", {"Texture": 100, "LuminanceSmoothing": 50}),
    ("det-tex100-nr100", {"Texture": 100, "LuminanceSmoothing": 100}),
    # 5. NETTETE — les quatre reglages, un axe a la fois.
    ("det-sh40-r1", {"Sharpness": 40}),
    ("det-sh40-r3", {"Sharpness": 40, "SharpenRadius": 3}),
    ("det-sh40-det100", {"Sharpness": 40, "SharpenDetail": 100}),
    ("det-sh40-mask100", {"Sharpness": 40, "SharpenEdgeMasking": 100}),
]


def ligne(nom, surcharge):
    valeurs = dict(BASE)
    valeurs.update(surcharge)
    corps = ";".join("%s=%s" % (k, v) for k, v in sorted(valeurs.items()))
    return nom + "\t" + corps


go = os.path.join(DOCS, "shaderlab-mesures-go.txt")
extra = os.path.join(DOCS, "shaderlab-mesures-extra.txt")

with open(go, "w", encoding="utf-8") as f:
    f.write(PHOTO + "\n")
with open(extra, "w", encoding="utf-8") as f:
    for nom, surcharge in MESURES:
        f.write(ligne(nom, surcharge) + "\n")

print("arme : %d mesures sur %s" % (len(MESURES), os.path.basename(PHOTO)))
print("  " + go)
print("  " + extra)
print("")
print("Les deux fichiers sont INERTES jusqu'au REDEMARRAGE de Lightroom.")
print("Les exports atterrissent dans Documents/shaderlab-lightroom-mesures/.")
print("")
for nom, surcharge in MESURES:
    print("  %-20s %s" % (nom, surcharge if surcharge else "(base seule)"))
