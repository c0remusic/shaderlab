"""Dans QUEL ESPACE la luminance des roues de Color Grading agit-elle ?

Consigne permanente d'Antoine : le binaire donne la FORME (espace, canal, log ou
lineaire), les mesures donnent les AMPLITUDES. Ce script ne calibre rien — il
cherche la FORME, et elle est ouverte depuis le 2026-09-15.

LE FAIT QUI MOTIVE LA QUESTION. A `Luminance des ombres` +50, Lightroom porte le
niveau 0 a 14,33 ; nous a 0,16 — facteur 100 en lumiere lineaire, et le pire
residu des treize mesures de virage. Un decalage de L en OKLab ne PEUT PAS lever
un noir absolu (L = 0 implique lin = 0) ; un offset en lumiere LINEAIRE le fait
par construction.

⚠️ ET LE TEST QUI PRETENDAIT TRANCHER A ETE REFUTE. Il extrayait le poids
implicite des deux signes et cherchait l'espace ou ils se superposent ; un
controle synthetique a montre qu'il repond « OKLab » sur des rampes fabriquees en
LINEAIRE. Il mesurait la compression, pas l'espace. D'ou ce minage : demander au
binaire au lieu de fabriquer un troisieme estimateur indirect.

CE QU'ON CHERCHE, et chaque motif est cherche SEUL puis borne :
  1. le bloc d'uniformes du Color Grading, dans l'ORDRE du binaire ;
  2. les noms de STAGES qui l'entourent (cr_stage_*), qui nomment l'etage ;
  3. tout terme d'espace autour : Linear, Oklab, Lab, Log, Gamma, Luma, Luminance.
"""
import re

DLL = r"C:\Program Files\Adobe\Adobe Lightroom Classic\CameraRaw.dll"
with open(DLL, "rb") as f:
    s = f.read().decode("latin-1")
print("binaire : %.1f Mo" % (len(s) / 1048576))
print("")

# ── 1. Les noms exacts des reglages, deja connus du SDK (campagne 06) ─────────
# ⚠️ Les teintes du Color Grading vivent sous SplitToning* dans le SDK, pas sous
# ColorGrade* — piege paye a la campagne 06. On cherche donc LES DEUX familles.
print("=== 1. NOMS DE REGLAGE PRESENTS DANS LE BINAIRE ===")
for nom in ("ColorGradeShadowLum", "ColorGradeMidtoneLum", "ColorGradeHighlightLum",
            "ColorGradeGlobalLum", "ColorGradeBlending", "ColorGradeBalance",
            "SplitToningShadowHue", "SplitToningHighlightHue"):
    n = len(re.findall(re.escape(nom), s))
    print("  %-26s %s" % (nom, ("%d occurrence(s)" % n) if n else "ABSENT"))

# ── 2. Les STAGES qui nomment l'etage ─────────────────────────────────────────
print("")
print("=== 2. STAGES cr_stage_* citant le grading ou le virage ===")
stages = sorted(set(re.findall(r"cr_stage_[a-z0-9_]{3,60}", s)))
interessants = [x for x in stages if any(k in x for k in
                ("grad", "tone", "split", "color_grade", "lum", "shadow", "highlight", "midtone"))]
for x in interessants:
    print("  " + x)
print("  (%d stages au total dans le binaire)" % len(stages))

# ── 3. Le BLOC D'UNIFORMES, dans l'ordre ─────────────────────────────────────
# Un bloc RDEF liste ses champs a la suite : l'ordre porte de l'information que
# le tri detruit, et les VOISINS d'un champ disent dans quelle machinerie il vit
# (c'est ce qui avait tranche Clarte — uGlobalAmtClarity vit dans
# UniformsToneMap, donc Clarte est un gain de tone map, pas un operateur local).
print("")
print("=== 3. BLOCS D'UNIFORMES QUI CITENT LE GRADING ===")
for m in re.finditer(r"Uniforms[A-Za-z0-9_]{2,40}", s):
    bloc = m.group(0)
    a, b = max(0, m.start() - 200), min(len(s), m.end() + 3000)
    bout = s[a:b]
    if not re.search(r"ColorGrade|SplitToning|uGrade|uToning", bout):
        continue
    print("")
    print("  --- %s @ %d ---" % (bloc, m.start()))
    vus = []
    for n in re.findall(r"[A-Za-z_][A-Za-z0-9_]{4,60}", bout):
        if n not in vus:
            vus.append(n)
    print("   " + " ".join(vus[:60]))

# ── 4. Les TERMES D'ESPACE au voisinage ──────────────────────────────────────
# La question est binaire : lumiere LINEAIRE ou L d'OKLab. Un nom de fonction ou
# de stage qui dit « linear » a cote du grading tranche ; son absence ne tranche
# rien (conclure d'une absence est le defaut le plus repete de ce dossier).
print("")
print("=== 4. TERMES D'ESPACE AU VOISINAGE DU GRADING ===")
ESPACES = ("linear", "oklab", "_lab", "logc", "gamma", "srgb", "luma", "luminance", "lift", "gain")
fenetres = [m.start() for m in re.finditer(r"ColorGrade|cr_stage_[a-z0-9_]*grad", s)]
print("  %d ancres de grading" % len(fenetres))
compte = {}
for p in fenetres:
    bout = s[max(0, p - 1500):p + 1500].lower()
    for e in ESPACES:
        if e in bout:
            compte[e] = compte.get(e, 0) + 1
for e in ESPACES:
    print("  %-12s dans %d fenetre(s) sur %d" % (e, compte.get(e, 0), len(fenetres)))

# ── 5. Fonctions nommees qui appliquent un LIFT ──────────────────────────────
print("")
print("=== 5. NOMS CONTENANT lift / gain / offset (signature d'un lift lineaire) ===")
for motif in (r"[A-Za-z_]{0,30}[Ll]ift[A-Za-z_]{0,30}",
              r"[A-Za-z_]{0,20}(?:Shadow|Highlight|Midtone)[A-Za-z_]{0,10}(?:Lift|Gain|Offset)[A-Za-z_]{0,20}"):
    trouve = sorted(set(re.findall(motif, s)))
    trouve = [t for t in trouve if len(t) > 5][:40]
    print("  %-56s -> %s" % (motif[:54], trouve if trouve else "AUCUN"))
