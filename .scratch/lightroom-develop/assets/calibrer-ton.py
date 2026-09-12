"""Calibre la table de FORME du ton de shaderlab (reglagesDeBaseTable.ts) sur les
rampes MESUREES de Lightroom 14.5 (research/mesures/<nom>.json, cle `rampe`, sortie
sRGB 0..255 pour l'entree sRGB 0..255). Meme patron que calibrer-hsl.py : moindres
carres sans scipy (grille grossiere + raffinage), forward-model EXACT (jumeau du
twin reglagesDeBaseSpec / du WGSL), imprime AVANT/APRES par mesure.

CONVENTION DE MESURE (celle du shader, sRGB PAR LE FORMAT) :
  entree sRGB v -> lineaire srgb_to_lin(v/255) -> twin -> lineaire ->
  sortie sRGB round(lin_to_srgb(out)*255). Sur une rampe grise le ton vit
  entierement en espace sRGB `s = v/255` (les aller-retours lineaires sont
  l'identite), donc le forward-model travaille en s-space.

  La luminance FLOUTEE (sBlur) des Ombres/Hautes lumieres vaut la luminance du
  pixel sur une rampe (= v/255), car prevPass floute une rampe lisse.

AVANT = ANCIEN modele (gain lineaire 2^EV, contraste non ancre 0.5+(s-.5)(1+k),
ombres (1-sBlur)^2*(1-s), noirs (1-s)^4, blancs s^4) mesure a la MEME convention
correcte — l'etat que ce ticket corrige (Antoine : « contraste et luminosite
rendent un peu bizarre »). APRES = nouvelles formes ancrees, table calibree.

Chaque curseur de ton est mesure SEUL (une rampe par curseur), donc les operateurs
se fittent INDEPENDAMMENT, groupe par groupe, par grille.

Usage : python calibrer-ton.py [dossier_des_json]   (defaut ../research/mesures)
"""
import sys, os, json, re, itertools, colorsys
import numpy as np

def srgb_to_lin(x):
    x = np.clip(np.asarray(x, float), 0, None)
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)

def lin_to_srgb(x):
    x = np.clip(np.asarray(x, float), 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)

def clamp01(x):
    return np.clip(x, 0.0, 1.0)

def smoothstep(a, b, x):
    t = clamp01((x - a) / (b - a))
    return t * t * (3 - 2 * t)

# ── formes NOUVELLES (jumeaux de reglagesDeBase.ts) ──────────────────────────
def bump(v, c, k):
    ec = k * c; e1 = k * (1.0 - c)
    peak = (c ** ec) * ((1.0 - c) ** e1)
    vv = clamp01(v)
    return (vv ** ec) * ((1.0 - vv) ** e1) / max(peak, 1e-6)

def contrast_op(s, kC, pv, cg):
    if kC == 0:
        return s
    gamma = np.exp(cg * kC)
    below = pv * np.power(np.clip(s / pv, 0, None), gamma)
    above = 1.0 - (1.0 - pv) * np.power(np.clip((1.0 - s) / (1.0 - pv), 0, None), gamma)
    return np.where(s <= pv, below, above)

def expo_op(s, ev, g):
    if ev == 0:
        return s
    return 1.0 - np.power(1.0 - s, np.exp(g * ev))

def courbe_param(s, kSh, kDk, kLt, kHi, sSplit, mSplit, hSplit, amt, win):
    ts = smoothstep(sSplit - win, sSplit + win, s)
    tm = smoothstep(mSplit - win, mSplit + win, s)
    th = smoothstep(hSplit - win, hSplit + win, s)
    delta = kSh * (1 - ts) + kDk * (ts - tm) + kLt * (tm - th) + kHi * th
    return clamp01(s + amt * delta)

def forward_new(vin, T, reg):
    s = vin / 255.0
    sBlur = vin / 255.0
    ev = reg.get("exposure", 0.0)
    kC = reg.get("contrast", 0.0) / 100.0
    kHl = reg.get("highlights", 0.0) / 100.0
    kSh = reg.get("shadows", 0.0) / 100.0
    kWh = reg.get("whites", 0.0) / 100.0
    kBk = reg.get("blacks", 0.0) / 100.0
    shAmt = T["shadowAmtPos"] if kSh >= 0 else T["shadowAmtNeg"]
    hlAmt = T["highlightAmtPos"] if kHl >= 0 else T["highlightAmtNeg"]
    bkAmt = T["blackAmtPos"] if kBk >= 0 else T["blackAmtNeg"]
    whAmt = T["whiteAmtPos"] if kWh >= 0 else T["whiteAmtNeg"]
    s = expo_op(s, ev, T["expoG"])
    s = contrast_op(s, kC, T["contrastPivot"], T["contrastG"])
    s = clamp01(s)
    s = s + kSh * shAmt * bump(sBlur, T["shadowCenter"], T["shadowKappa"])
    s = s + kHl * hlAmt * bump(sBlur, T["highlightCenter"], T["highlightKappa"])
    s = clamp01(s)
    # Blancs / Noirs LOCAUX : cloche sur la luminance floutee (sBlur), comme le
    # shader (parite 02b, LR local_whites_blacks). Sur une rampe sBlur = s, donc
    # le fit est inchange ; le twin reste jumeau du shader.
    s = s + kBk * bkAmt * bump(sBlur, T["blackCenter"], T["blackKappa"])
    s = s + kWh * whAmt * bump(sBlur, T["whiteCenter"], T["whiteKappa"])
    s = clamp01(s)
    kSh2 = reg.get("paramShadows", 0.0) / 100.0
    kDk = reg.get("paramDarks", 0.0) / 100.0
    kLt = reg.get("paramLights", 0.0) / 100.0
    kHi = reg.get("paramHighlights", 0.0) / 100.0
    if kSh2 or kDk or kLt or kHi:
        s = courbe_param(s, kSh2, kDk, kLt, kHi, reg.get("shadowSplit", 25) / 100.0,
                         reg.get("midtoneSplit", 50) / 100.0, reg.get("highlightSplit", 75) / 100.0,
                         T["curveAmt"], T["curveWin"])
    return np.rint(clamp01(s) * 255.0)

# ── VOILE : composante GLOBALE par canal (parite 02b, audit 09) ──────────────
# d = dehaze/100. d>0 : recuperation ancree (canal sombre) ; d<0 : ecran vers
# airlight. Jumeau de veilOp() TS / rb_veil WGSL.
def veil_op(s, d, T):
    s = clamp01(s)
    if d > 0:
        w = T["dehazeOmega"] * d
        return clamp01(s * (1 - w) / (1 - w * s))
    if d < 0:
        a = T["dehazeAirlight"] * (-d)
        g = 1 + (T["dehazeGamma"] - 1) * (-d)
        return clamp01(1 - (1 - a) * np.power(1 - s, g))
    return s

# ── OKLab (jumeau de oklab.ts) pour le fit de desaturation du voile ──────────
def lin_to_oklab(rgb):
    r, g, b = rgb
    l = np.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = np.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = np.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s)

def oklab_to_lin(lab):
    L, a, b = lab
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    return (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)

# ── formes ANCIENNES (etat AVANT ce ticket), meme convention ─────────────────
def forward_old(vin, reg):
    lin = srgb_to_lin(vin / 255.0)
    ev = reg.get("exposure", 0.0)
    lin = lin * (2.0 ** ev)
    s = lin_to_srgb(clamp01(lin))
    sBlur = vin / 255.0
    wSh = (1 - sBlur) ** 2
    wHl = sBlur ** 2
    kC = reg.get("contrast", 0.0) / 100.0
    kHl = reg.get("highlights", 0.0) / 100.0
    kSh = reg.get("shadows", 0.0) / 100.0
    kWh = reg.get("whites", 0.0) / 100.0
    kBk = reg.get("blacks", 0.0) / 100.0
    s = 0.5 + (s - 0.5) * (1 + kC)
    s = clamp01(s)
    s = s + kSh * 0.5 * wSh * (1 - s)
    s = s + kHl * 0.5 * wHl * (1 - s)
    s = clamp01(s)
    s = s + kBk * 0.4 * (1 - s) ** 4
    s = s + kWh * 0.4 * s ** 4
    s = clamp01(s)
    kSh2 = reg.get("paramShadows", 0.0) / 100.0
    kDk = reg.get("paramDarks", 0.0) / 100.0
    kLt = reg.get("paramLights", 0.0) / 100.0
    kHi = reg.get("paramHighlights", 0.0) / 100.0
    if kSh2 or kDk or kLt or kHi:
        s = courbe_param(s, kSh2, kDk, kLt, kHi, reg.get("shadowSplit", 25) / 100.0,
                         reg.get("midtoneSplit", 50) / 100.0, reg.get("highlightSplit", 75) / 100.0, 0.35, 0.15)
    return np.rint(clamp01(s) * 255.0)

MES = {
    "exposition-p1": {"exposure": 1}, "exposition-p2": {"exposure": 2},
    "exposition-m1": {"exposure": -1}, "exposition-m2": {"exposure": -2},
    "contraste-p100": {"contrast": 100}, "contraste-p50": {"contrast": 50},
    "contraste-m50": {"contrast": -50}, "contraste-m100": {"contrast": -100},
    "ombres-p100": {"shadows": 100}, "ombres-p50": {"shadows": 50},
    "ombres-m50": {"shadows": -50}, "ombres-m100": {"shadows": -100},
    "hautes-lumieres-p100": {"highlights": 100}, "hautes-lumieres-p50": {"highlights": 50},
    "hautes-lumieres-m50": {"highlights": -50}, "hautes-lumieres-m100": {"highlights": -100},
    "noirs-p100": {"blacks": 100}, "noirs-p50": {"blacks": 50},
    "noirs-m50": {"blacks": -50}, "noirs-m100": {"blacks": -100},
    "blancs-p100": {"whites": 100}, "blancs-p50": {"whites": 50},
    "blancs-m50": {"whites": -50}, "blancs-m100": {"whites": -100},
    "param-hl-p100": {"paramHighlights": 100}, "param-hl-m100": {"paramHighlights": -100},
    "param-lights-p100": {"paramLights": 100}, "param-darks-p100": {"paramDarks": 100},
    "param-ombres-p100": {"paramShadows": 100}, "param-ombres-m100": {"paramShadows": -100},
}
GROUPES = {
    "expo": ["exposition-p1", "exposition-p2", "exposition-m1", "exposition-m2"],
    "contrast": ["contraste-p100", "contraste-p50", "contraste-m50", "contraste-m100"],
    "shadow": ["ombres-p100", "ombres-p50", "ombres-m50", "ombres-m100"],
    "highlight": ["hautes-lumieres-p100", "hautes-lumieres-p50", "hautes-lumieres-m50", "hautes-lumieres-m100"],
    "black": ["noirs-p100", "noirs-p50", "noirs-m50", "noirs-m100"],
    "white": ["blancs-p100", "blancs-p50", "blancs-m50", "blancs-m100"],
    "curve": ["param-hl-p100", "param-hl-m100", "param-lights-p100", "param-darks-p100",
              "param-ombres-p100", "param-ombres-m100"],
}

VIN = np.arange(256, dtype=float)

def load_rampe(dossier, nom):
    p = os.path.join(dossier, nom + ".json")
    if not os.path.exists(p):
        return None
    return np.rint(np.array(json.load(open(p, encoding="utf-8"))["rampe"], float))

def err(rampeLR, pred):
    e = np.abs(pred - rampeLR)
    return float(e.mean()), float(e.max())

def fit_groupe(dossier, T, noms, keys, grids):
    data = [(nom, load_rampe(dossier, nom), MES[nom]) for nom in noms]
    data = [d for d in data if d[1] is not None]
    if not data:
        return
    best_cost, best = 1e18, None
    for combo in itertools.product(*[grids[k] for k in keys]):
        Tt = dict(T)
        for k, v in zip(keys, combo):
            Tt[k] = float(v)
        cost = sum(err(ra, forward_new(VIN, Tt, reg))[0] for _, ra, reg in data)
        if cost < best_cost:
            best_cost, best = cost, combo
    for k, v in zip(keys, best):
        T[k] = round(float(v), 4)

def refine(dossier, T, noms, keys, spans, n=9):
    grids = {k: np.linspace(max(lo, T[k] - sp), T[k] + sp, n) for k, (sp, lo) in zip(keys, spans)}
    fit_groupe(dossier, T, noms, keys, grids)

# ── BALANCE DES BLANCS : gains lineaires par canal, PAR SIGNE (parite 02b) ────
# Fittes sur rampe_rgb (rampe grise par canal) SANS renormalisation : Lightroom
# regle la WB en espace camera et ne preserve pas la luminance (les deux extremes
# eclaircissent). Chaque axe/signe isole une mesure ; le gain constant + clamp est
# un compromis a la reponse en S de la courbe de ton camera de LR (residu note).
def load_rgb(dossier, nom):
    p = os.path.join(dossier, nom + ".json")
    if not os.path.exists(p):
        return None
    return np.array(json.load(open(p, encoding="utf-8"))["rampe_rgb"], float)

def fit_wb_triplet(dossier, nom):
    rgb = load_rgb(dossier, nom)
    if rgb is None:
        return None
    lin_in = srgb_to_lin(VIN / 255.0)
    gains, errs = [], []
    for c in range(3):
        best = None
        for g in np.arange(0.05, 8.0, 0.01):
            pred = lin_to_srgb(np.clip(g * lin_in, 0, 1)) * 255.0
            e = np.abs(pred - rgb[:, c]).mean()
            if best is None or e < best[0]:
                best = (e, g)
        gains.append(round(float(best[1]), 3)); errs.append(round(float(best[0]), 1))
    return gains, errs

def fit_wb(dossier, T):
    axes = [("wbTempPos", "temperature-p100"), ("wbTempNeg", "temperature-m100"),
            ("wbTintPos", "nuance-p100"), ("wbTintNeg", "nuance-m100")]
    rows = []
    for key, nom in axes:
        r = fit_wb_triplet(dossier, nom)
        if r is None:
            continue
        gains, errs = r
        T[key] = gains
        rows.append(f"  {key:11s} <- {nom:16s} gains R/G/B={gains}  errRGB={errs}")
    return rows

# ── VOILE : composante globale, fittee sur les rampes grises voile-p100/m100 ──
def fit_veil(dossier, T):
    p = load_rampe(dossier, "voile-p100")
    m = load_rampe(dossier, "voile-m100")
    sp = VIN / 255.0
    rows = []
    if p is not None:
        avant = np.abs(VIN - p).mean()  # AVANT : voile inerte sur un ton plat = identite
        best = None
        for w in np.arange(0.5, 0.95, 0.005):
            Tt = dict(T); Tt["dehazeOmega"] = w
            pred = np.array([veil_op(s, 1.0, Tt) for s in sp]) * 255.0
            e = np.abs(pred - p).mean()
            if best is None or e < best[0]:
                best = (e, w)
        T["dehazeOmega"] = round(float(best[1]), 3)
        rows.append(f"  dehazeOmega   <- voile-p100  = {T['dehazeOmega']}  (err moy AVANT {avant:.1f} -> APRES {best[0]:.1f})")
    if m is not None:
        avant_m = np.abs(VIN - m).mean()
        best = None
        for a in np.arange(0.15, 0.40, 0.005):
            for g in np.arange(1.5, 4.0, 0.05):
                Tt = dict(T); Tt["dehazeAirlight"] = a; Tt["dehazeGamma"] = g
                pred = np.array([veil_op(s, -1.0, Tt) for s in sp]) * 255.0
                e = np.abs(pred - m).mean()
                if best is None or e < best[0]:
                    best = (e, a, g)
        T["dehazeAirlight"] = round(float(best[1]), 3); T["dehazeGamma"] = round(float(best[2]), 3)
        rows.append(f"  dehazeAirlight/Gamma <- voile-m100 = {T['dehazeAirlight']}/{T['dehazeGamma']}  (err moy AVANT {avant_m:.1f} -> APRES {best[0]:.1f})")
    return rows

# ── VOILE : desaturation des couleurs en ajout, fittee sur le balayage ────────
def fit_desat(dossier, T):
    tem = load_rgb_col(dossier, "temoin", "balayage")
    meas = load_rgb_col(dossier, "voile-m100", "balayage")
    if tem is None or meas is None:
        return []
    target = float((meas[:, 2] - tem[:, 2]).mean())  # dSat HSL mesure (colonne 2)
    def dsat(kc):
        out = []
        for row in tem:
            H, L, S = row[1] / 360.0, row[3], row[2]
            r, g, b = colorsys.hls_to_rgb(H, L, S)
            rr = float(veil_op(r, -1.0, T)); gg = float(veil_op(g, -1.0, T)); bb = float(veil_op(b, -1.0, T))
            lab = list(lin_to_oklab((srgb_to_lin(rr), srgb_to_lin(gg), srgb_to_lin(bb))))
            lab[1] *= (1 - kc); lab[2] *= (1 - kc)
            rl, gl, bl = oklab_to_lin(lab)
            rs, gs, bs = [min(1.0, max(0.0, float(lin_to_srgb(x)))) for x in (rl, gl, bl)]
            out.append(colorsys.rgb_to_hls(rs, gs, bs)[2])
        return float(np.mean(out)) - float(tem[:, 2].mean())
    best = min(np.arange(0.0, 0.5, 0.01), key=lambda k: abs(dsat(k) - target))
    T["dehazeDesatK"] = round(float(best), 3)
    return [f"  dehazeDesatK  <- balayage    = {T['dehazeDesatK']}  (dSat {dsat(best):+.3f} vs LR {target:+.3f})"]

def load_rgb_col(dossier, nom, cle):
    p = os.path.join(dossier, nom + ".json")
    if not os.path.exists(p):
        return None
    return np.array(json.load(open(p, encoding="utf-8"))[cle], float)

def rapport(dossier, Tnew):
    lignes = [f"{'mesure':22s} | {'AVANT moy':>9s} {'max':>5s} | {'APRES moy':>9s} {'max':>5s}"]
    somme_a, somme_b, n = 0.0, 0.0, 0
    for noms in GROUPES.values():
        for nom in noms:
            ra = load_rampe(dossier, nom)
            if ra is None:
                continue
            am, ax = err(ra, forward_old(VIN, MES[nom]))
            bm, bx = err(ra, forward_new(VIN, Tnew, MES[nom]))
            lignes.append(f"{nom:22s} | {am:9.1f} {ax:5.0f} | {bm:9.1f} {bx:5.0f}")
            somme_a += am; somme_b += bm; n += 1
    lignes.append(f"{'MOYENNE':22s} | {somme_a/n:9.1f}       | {somme_b/n:9.1f}")
    return "\n".join(lignes)

def fmt_scalar(v):
    return f"{v:.1f}" if float(v).is_integer() else f"{v}"

def reecrire_table(Tnew):
    path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "src", "render", "effects", "reglagesDeBaseTable.ts")
    txt = open(path, encoding="utf-8").read()
    for k, v in Tnew.items():
        if isinstance(v, (list, tuple)):
            val = "[" + ", ".join(fmt_scalar(x) for x in v) + "]"
            pat = re.compile(rf"(\n  {re.escape(k)}: )\[[^\]]*\](,)")
        else:
            val = fmt_scalar(v)
            pat = re.compile(rf"(\n  {re.escape(k)}: )[-\d.]+(,)")
        new, cnt = pat.subn(lambda m: m.group(1) + val + m.group(2), txt)
        if cnt != 1:
            raise SystemExit(f"ancre '{k}' trouvee {cnt} fois (attendu 1) — abandon, table intacte")
        txt = new
    open(path, "w", encoding="utf-8").write(txt)
    print("reecrit", os.path.normpath(path))

def main():
    dossier = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "research", "mesures")
    T = {"wbTempPos": [1.0, 1.0, 1.0], "wbTempNeg": [1.0, 1.0, 1.0],
         "wbTintPos": [1.0, 1.0, 1.0], "wbTintNeg": [1.0, 1.0, 1.0],
         "expoG": 0.58, "contrastG": 0.72, "contrastPivot": 0.58,
         "shadowAmtPos": 0.35, "shadowAmtNeg": 0.2, "shadowCenter": 0.12, "shadowKappa": 6.0,
         "highlightAmtPos": 0.3, "highlightAmtNeg": 0.3, "highlightCenter": 0.8, "highlightKappa": 6.0,
         "blackAmtPos": 0.15, "blackAmtNeg": 0.4, "blackCenter": 0.06, "blackKappa": 10.0,
         "whiteAmtPos": 0.4, "whiteAmtNeg": 0.3, "whiteCenter": 0.85, "whiteKappa": 6.0,
         "curveAmt": 0.35, "curveWin": 0.15,
         "dehazeOmega": 0.7, "dehazeAirlight": 0.275, "dehazeGamma": 2.9, "dehazeDesatK": 0.2}

    fit_groupe(dossier, T, GROUPES["expo"], ["expoG"], {"expoG": np.arange(0.3, 0.901, 0.01)})
    fit_groupe(dossier, T, GROUPES["contrast"], ["contrastG", "contrastPivot"],
               {"contrastG": np.arange(0.3, 1.51, 0.02), "contrastPivot": np.arange(0.45, 0.681, 0.01)})
    refine(dossier, T, GROUPES["contrast"], ["contrastG", "contrastPivot"], [(0.05, 0.1), (0.02, 0.4)])

    # OMBRES / HL / NOIRS / BLANCS : cloche (center, kappa) + amplitude PAR SIGNE.
    for grp, pfx, cgrid, kgrid in [
        ("shadow", "shadow", np.arange(0.03, 0.451, 0.02), np.arange(2, 31, 2)),
        ("highlight", "highlight", np.arange(0.5, 0.951, 0.02), np.arange(2, 31, 2)),
        ("black", "black", np.arange(0.02, 0.301, 0.02), np.arange(3, 45, 2)),
        ("white", "white", np.arange(0.6, 0.981, 0.02), np.arange(2, 31, 2)),
    ]:
        keys = [pfx + "AmtPos", pfx + "AmtNeg", pfx + "Center", pfx + "Kappa"]
        grids = {pfx + "AmtPos": np.arange(0.05, 0.71, 0.03), pfx + "AmtNeg": np.arange(0.05, 0.71, 0.03),
                 pfx + "Center": cgrid, pfx + "Kappa": kgrid}
        fit_groupe(dossier, T, GROUPES[grp], keys, grids)
        refine(dossier, T, GROUPES[grp], keys,
               [(0.04, 0.02), (0.04, 0.02), (0.03, 0.02), (3, 1.0)])

    fit_groupe(dossier, T, GROUPES["curve"], ["curveAmt", "curveWin"],
               {"curveAmt": np.arange(0.15, 0.801, 0.01), "curveWin": np.arange(0.06, 0.261, 0.01)})

    # PARITE 02b — groupes fittes sur des mesures HORS rampe grise de ton :
    print("\n// ── BALANCE DES BLANCS (rampe_rgb, sans renormalisation) ──")
    for r in fit_wb(dossier, T):
        print(r)
    print("// ── VOILE (composante globale + desaturation) ──")
    for r in fit_veil(dossier, T):
        print(r)
    for r in fit_desat(dossier, T):
        print(r)

    print()
    print(rapport(dossier, T))
    print("\n// ── TABLE CALIBREE ──")
    for k in T:
        print(f"  {k}: {T[k]},")
    reecrire_table(T)

if __name__ == "__main__":
    main()
