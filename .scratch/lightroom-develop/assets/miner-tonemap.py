"""Le bloc UniformsToneMap dans l'ordre du binaire, et ce qu'il dit de Clarte.

uGlobalAmtClarity vit dans le MEME bloc d'uniformes que uGlobalAmtHighlights et
uGlobalAmtShadows — la machinerie que ce depot a deja calibree (rb_ligne_poids,
gain en log2). Ce script sort le bloc TEL QUEL, sans le trier, pour voir quels
champs accompagnent Clarte et lesquels lui manquent.
"""
import re

DLL = r"C:\Program Files\Adobe\Adobe Lightroom Classic\CameraRaw.dll"
with open(DLL, "rb") as f:
    s = f.read().decode("latin-1")

m = re.search(r"UniformsToneMap", s)
if not m:
    raise SystemExit("UniformsToneMap absent")

# Fenetre large autour, dans l'ORDRE du binaire : un bloc RDEF liste ses champs
# a la suite, donc l'ordre porte de l'information que le tri detruit.
a, b = max(0, m.start() - 2500), min(len(s), m.end() + 2500)
bout = s[a:b]
noms = re.findall(r"[A-Za-z_][A-Za-z0-9_]{4,60}", bout)
print("=== champs autour de UniformsToneMap, DANS L'ORDRE ===")
vus = set()
for n in noms:
    if n in vus:
        continue
    vus.add(n)
    print("  " + n)

print("")
print("=== y a-t-il une LIGNE ou un POIDS DE LUMINANCE propres a Clarte ? ===")
for motif in (r"u?Line[A-Za-z]*Clarity[A-Za-z]*", r"u?LumWeight[A-Za-z]*Clarity[A-Za-z]*",
              r"u?Clarity[A-Za-z]*(?:Line|LumWeight|Offset|Scale|Pivot|Center)[A-Za-z]*"):
    trouve = sorted(set(re.findall(motif, s)))
    print("  %-52s -> %s" % (motif, trouve if trouve else "AUCUN"))

print("")
print("=== les trois familles du bloc, cote a cote ===")
for famille in ("Highlights", "Shadows", "Clarity", "Highlight", "Shadow"):
    champs = sorted(set(re.findall(r"u[A-Za-z]*" + famille + r"[A-Za-z]*", s)))
    if champs:
        print("  %-12s : %s" % (famille, ", ".join(champs)))
