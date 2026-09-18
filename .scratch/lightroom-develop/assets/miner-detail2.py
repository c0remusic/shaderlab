"""Les REGLAGES du panneau Detail, par leurs noms ACR exacts.

⚠️ Le premier minage a ramene un bloc de localisation de 40 ko parce que sa
regex acceptait des espaces. Ici chaque nom est cherche SEUL, borne, et on
imprime combien de fois il apparait — un nom absent du binaire n'est pas un
reglage de cette version.

Les noms candidats viennent du binaire lui-meme (premier passage) et de la
convention ACR, jamais d'une liste ecrite de memoire : chacun est VERIFIE ici.
"""
import re

DLL = r"C:\Program Files\Adobe\Adobe Lightroom Classic\CameraRaw.dll"
with open(DLL, "rb") as f:
    s = f.read().decode("latin-1")

CANDIDATS = [
    # Nettete (panneau Detail)
    "Sharpness", "SharpenRadius", "SharpenDetail", "SharpenEdgeMasking",
    # Reduction du bruit — luminance
    "LuminanceSmoothing", "LuminanceNoiseReductionDetail", "LuminanceNoiseReductionContrast",
    # Reduction du bruit — couleur
    "ColorNoiseReduction", "ColorNoiseReductionDetail", "ColorNoiseReductionSmoothness",
    # Voisins, pour situer
    "Texture", "Clarity", "Dehaze", "LocalLuminanceNoise", "PlusNoiseReduction",
]

print("nom ACR                            occurrences")
for nom in CANDIDATS:
    n = len(re.findall(r"(?<![A-Za-z0-9_])" + nom + r"(?![A-Za-z0-9_])", s))
    print("  %-34s %d" % (nom, n))

print("")
print("=== etages nommes autour de la nettete (sharpen) ===")
vus, seen = [], set()
for m in re.finditer(r"cr_stage_[A-Za-z0-9_]*(?:sharp|usm|unsharp|halo|edge_mask)[A-Za-z0-9_]*", s, re.I):
    if m.group(0) not in seen:
        seen.add(m.group(0))
        vus.append(m.group(0))
for t in vus[:40]:
    print("  " + t)

print("")
print("=== etages nommes autour du debruitage, dans l'ordre d'apparition ===")
vus, seen = [], set()
for m in re.finditer(r"cr_stage_[A-Za-z0-9_]*(?:denoise|wavelet|noise|chroma_smooth|luma_smooth)[A-Za-z0-9_]*", s, re.I):
    if m.group(0) not in seen:
        seen.add(m.group(0))
        vus.append((m.start(), m.group(0)))
for pos, t in vus[:40]:
    print("  %10d  %s" % (pos, t))
