"""Le panneau DETAIL de Lightroom, mine avant toute calibration.

Consigne permanente d'Antoine : le binaire donne la FORME (espace, canal, ordre
des etages, ce qui module quoi), les mesures donnent les AMPLITUDES. Deux modeles
plausibles et faux ont deja ete rattrapes comme ca.

Ce que ce script cherche, dans l'ordre :
  1. les NOMS DE REGLAGES du panneau (ceux que le catalogue et XMP persistent) ;
  2. les UNIFORMES des etages de bruit et de nettete — ce qu'un noyau lit dit ce
     qu'il calcule ;
  3. l'ORDRE : ce qui est nomme autour du guide de Texture et du small content.
"""
import re

DLL = r"C:\Program Files\Adobe\Adobe Lightroom Classic\CameraRaw.dll"
with open(DLL, "rb") as f:
    s = f.read().decode("latin-1")


def uniques(motif, limite=60, flags=0):
    vus, seen = [], set()
    for m in re.finditer(motif, s, flags):
        t = m.group(0)
        if t not in seen:
            seen.add(t)
            vus.append(t)
            if len(vus) >= limite:
                break
    return vus


print("=== 1. REGLAGES persistes du panneau Detail (noms ACR/XMP) ===")
# Les noms ACR sont en CamelCase et stables depuis des annees : on les cherche
# par leur radical, jamais par une liste ecrite de memoire.
for radical in ("Sharpen", "LuminanceSmoothing", "LuminanceNoise", "ColorNoise",
                "NoiseReduction", "Luminance.*Detail", "Color.*Smooth"):
    trouve = uniques(r"\b[A-Z][A-Za-z0-9]{0,30}" + radical + r"[A-Za-z0-9]{0,30}\b", 30)
    if trouve:
        print("  %-22s %s" % (radical, ", ".join(trouve[:14])))

print("")
print("=== 2. UNIFORMES des etages de bruit ===")
motif = r"u[A-Z][A-Za-z0-9_]{2,44}"
bruit = [t for t in uniques(motif, 4000) if re.search(r"noise|denoise|wavelet|sharp|luma.*smooth|chroma", t, re.I)]
for t in sorted(set(bruit))[:60]:
    print("  " + t)

print("")
print("=== 3. UNIFORMES du filtre guide de Texture / small content ===")
guide = [t for t in uniques(motif, 4000) if re.search(r"guide|guided|smallcontent|small_content|boxconv|box_conv|texture", t, re.I)]
for t in sorted(set(guide))[:60]:
    print("  " + t)

print("")
print("=== 4. Voisinage de cr_stage_insert_small_content ===")
cible = "cr_stage_insert_small_content"
vus = set()
n = 0
for m in re.finditer(re.escape(cible), s):
    a, b = max(0, m.start() - 900), min(len(s), m.end() + 900)
    for t in re.findall(r"[A-Za-z_][A-Za-z0-9_]{6,60}", s[a:b]):
        vus.add(t)
    n += 1
    if n >= 8:
        break
for t in sorted(vus):
    print("  " + t)
