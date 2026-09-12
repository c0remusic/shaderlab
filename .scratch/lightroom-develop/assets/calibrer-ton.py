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
import sys, os, json, re, itertools
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
    s = s + kBk * bkAmt * bump(s, T["blackCenter"], T["blackKappa"])
    s = s + kWh * whAmt * bump(s, T["whiteCenter"], T["whiteKappa"])
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

def reecrire_table(Tnew):
    path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "src", "render", "effects", "reglagesDeBaseTable.ts")
    txt = open(path, encoding="utf-8").read()
    for k, v in Tnew.items():
        val = (f"{v:.1f}" if float(v).is_integer() else f"{v}")
        pat = re.compile(rf"(\n  {re.escape(k)}: )[-\d.]+(,)")
        new, cnt = pat.subn(rf"\g<1>{val}\g<2>", txt)
        if cnt != 1:
            raise SystemExit(f"ancre '{k}' trouvee {cnt} fois (attendu 1) — abandon, table intacte")
        txt = new
    open(path, "w", encoding="utf-8").write(txt)
    print("reecrit", os.path.normpath(path))

def main():
    dossier = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "research", "mesures")
    T = {"wbTempK": 0.3, "wbTintK": 0.15, "expoG": 0.58, "contrastG": 0.72, "contrastPivot": 0.58,
         "shadowAmtPos": 0.35, "shadowAmtNeg": 0.2, "shadowCenter": 0.12, "shadowKappa": 6.0,
         "highlightAmtPos": 0.3, "highlightAmtNeg": 0.3, "highlightCenter": 0.8, "highlightKappa": 6.0,
         "blackAmtPos": 0.15, "blackAmtNeg": 0.4, "blackCenter": 0.06, "blackKappa": 10.0,
         "whiteAmtPos": 0.4, "whiteAmtNeg": 0.3, "whiteCenter": 0.85, "whiteKappa": 6.0,
         "curveAmt": 0.35, "curveWin": 0.15}

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

    print(rapport(dossier, T))
    print("\n// ── TABLE CALIBREE ──")
    for k in T:
        print(f"  {k}: {T[k]},")
    reecrire_table(T)

if __name__ == "__main__":
    main()
