"""Calibre la table de bandes HSL de shaderlab sur les profils MESURES de
Lightroom 14.5 (research/mesures/*.json, produits par shaderlab-dump.lrdevplugin
puis analyse-mesures.py). Remplace la version « squelette » : les exports
existent desormais.

CE QUE FAIT LE SCRIPT (moindres carres sans scipy, forward-model exact) :

  Pour chaque bande, il AJUSTE les parametres du twin `hslSpec`/du shader en
  MINIMISANT l'ecart de SORTIE MESURE, dans les termes memes du modele — pas une
  formule fermee. Le residu (rmse) est donc en degres de teinte de sortie (teinte),
  en points de saturation HLS (sat) ou de luminance HLS (lum/gris), directement
  comparable a Lightroom.

  1. TEINTE : chaque bande est une DIRECTION (a,b) d'OKLab, definie par une COULEUR
     representative. On ajuste (a) le centre = teinte HLS de cette couleur (sat 1,
     L 0.5), (b) l'amplitude en degres a +100, (c) DEUX demi-largeurs gaussiennes
     sigmaLeft/sigmaRight (le cote se lit au signe du produit vectoriel a*db - b*da,
     SANS atan2). L'ajustement porte a la fois sur `hsl-teinte-<b>-p100` (contre
     temoin) et `hsl2-teinte-<b>-m100` (contre temoin2, differencie).
     Le modele est SYMETRIQUE EN SIGNE (+100 et -100 donnent des courbes miroir) ;
     Lightroom ne l'est pas (le pic de +100 et de -100 ne tombent pas a la meme
     teinte d'entree), d'ou un residu irreductible, surtout Vert/Bleu/Violet.
  2. SATURATION : satK ajuste sur `hsl2-sat-<b>-m100` (differencie a temoin2) —
     la desaturation atteinte de la bande a -100.
  3. LUMINANCE : lumK ajuste conjointement sur `hsl2-lum-<b>-p100/m100`. Le modele
     n'a qu'UN k (pas de k par sens) ; l'amplitude mesuree est asymetrique, on prend
     le meilleur k commun et on note l'ecart p/m.
  4. GRIS (N&B) : grayK ajuste sur `hsl2-gris-<b>-p100` par DIFFERENCE croisee au
     `nb` de la serie 1. BRUITE : la serie 2 porte une contamination SplitToning
     (les gris sortent legerement teintes), donc grayK est indicatif — l'incertitude
     est imprimee (ecart-type du ratio dL/L sur la fenetre de la bande).

  Sortie : la table `HSL_BANDES` a coller dans src/render/effects/hslBandes.ts,
  les residus par courbe, et un JSON (assets/hsl-calibration.json) reutilisable.

grayK et le SIGNE de teinte : plus d'approximation « usuelle » — tout vient de la
mesure. Seule HSL_CHROMA_REF (la porte anti-gris) reste a 0.05 : le balayage est a
sat 100 %, il ne contraint pas la porte ; a laisser tel quel.

Usage : python calibrer-hsl.py [dossier_des_json]   (defaut : ../research/mesures)
"""
import sys, os, json, math
import numpy as np
import colorsys

BANDES = ["rouge", "orange", "jaune", "vert", "aqua", "bleu", "violet", "magenta"]
ID_TS = {"rouge": "red", "orange": "orange", "jaune": "yellow", "vert": "green",
         "aqua": "aqua", "bleu": "blue", "violet": "purple", "magenta": "magenta"}
CENTRE_USUEL = {"rouge": 0, "orange": 30, "jaune": 60, "vert": 120,
                "aqua": 180, "bleu": 240, "violet": 270, "magenta": 300}
CHROMA_REF = 0.05

# ── OKLab / transfert sRGB, jumeaux numpy de oklab.ts / srgbTransfer.ts ──────────
def srgb_to_lin(x):
    x = np.clip(np.asarray(x, float), 0, None)
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)

def lin_to_srgb(x):
    x = np.clip(np.asarray(x, float), 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)

def _cb(x):
    return np.sign(x) * np.abs(x) ** (1 / 3)

def lin_to_oklab(r, g, b):
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = _cb(l), _cb(m), _cb(s)
    return (0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
            1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
            0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_)

def oklab_to_lin(L, a, b):
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    return (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)

def hls_srgb01(hdeg, s, l):
    return colorsys.hls_to_rgb((hdeg % 360) / 360.0, l, s)

def band_dir(hdeg):
    r, g, b = hls_srgb01(hdeg, 1.0, 0.5)
    la = lin_to_oklab(srgb_to_lin(r), srgb_to_lin(g), srgb_to_lin(b))
    c = math.hypot(float(la[1]), float(la[2])) or 1.0
    return float(la[1]) / c, float(la[2]) / c

def dhue(x, y):
    return ((x - y + 180) % 360) - 180

# ── I/O mesures ────────────────────────────────────────────────────────────────
def load(dossier, nom):
    p = os.path.join(dossier, nom + ".json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None

def hls_arrays(hin):
    rgb = np.array([hls_srgb01(h, 1.0, 0.5) for h in hin])
    r, g, b = srgb_to_lin(rgb[:, 0]), srgb_to_lin(rgb[:, 1]), srgb_to_lin(rgb[:, 2])
    L, a, bb = lin_to_oklab(r, g, b)
    chroma = np.hypot(a, bb)
    t = np.clip(chroma / CHROMA_REF, 0, 1)
    return L, a, bb, chroma, t * t * (3 - 2 * t)

def out_hls_h(rl, gl, bl):
    R, G, B = lin_to_srgb(rl), lin_to_srgb(gl), lin_to_srgb(bl)
    h = np.array([colorsys.rgb_to_hls(float(min(1, max(0, R[i]))), float(min(1, max(0, G[i]))),
                                      float(min(1, max(0, B[i]))))[0] for i in range(len(R))])
    return h * 360.0

def out_hls_sl(rl, gl, bl):
    R, G, B = lin_to_srgb(rl), lin_to_srgb(gl), lin_to_srgb(bl)
    hls = np.array([colorsys.rgb_to_hls(float(min(1, max(0, R[i]))), float(min(1, max(0, G[i]))),
                                        float(min(1, max(0, B[i])))) for i in range(len(R))])
    return hls[:, 2], hls[:, 1]  # sat, lum

def weight(a, bb, chroma, gate, dirx, diry, sL, sR):
    cosd = np.where(chroma > 1e-5, (a * dirx + bb * diry) / np.where(chroma == 0, 1, chroma), 0.0)
    ang = np.arccos(np.clip(cosd, -1, 1))
    cross = a * diry - bb * dirx
    sig = np.radians(np.where(cross >= 0, sR, sL))
    return np.exp(-(ang * ang) / (sig * sig)) * gate

# ── ajustements ─────────────────────────────────────────────────────────────────
def fit_teinte(dossier, nom, temoin, temoin2):
    blocks = []
    for src, ref, sens in [(f"hsl-teinte-{nom}-p100", temoin, +100),
                           (f"hsl2-teinte-{nom}-m100", temoin2, -100)]:
        m = load(dossier, src)
        if m is None:
            continue
        rb = {round(p[0]): p for p in ref["balayage"]}
        hin, dh = [], []
        for p in m["balayage"][::2]:
            h = round(p[0])
            if h in rb:
                hin.append(p[0]); dh.append(dhue(p[1], rb[h][1]))
        hin = np.array(hin); dh = np.array(dh)
        blocks.append((hls_arrays(hin), hin, dh, sens))

    def resid(tc, amp, sL, sR):
        dx, dy = band_dir(tc)
        se, n = 0.0, 0
        for (L, a, bb, chroma, gate), hin, dh, sens in blocks:
            w = weight(a, bb, chroma, gate, dx, dy, sL, sR)
            rot = w * (sens / 100.0) * math.radians(amp)
            c, s = np.cos(rot), np.sin(rot)
            rl, gl, bl = oklab_to_lin(L, a * c - bb * s, a * s + bb * c)
            e = dhue(dhue(out_hls_h(rl, gl, bl), hin), dh)
            se += float(np.sum(e * e)); n += len(e)
        return math.sqrt(se / n)

    cu = CENTRE_USUEL[nom]
    SIG = (10, 15, 20, 26, 34, 44, 58, 72)
    best = (None, 1e18)
    for tc in [cu + d for d in range(-25, 26, 5)]:
        for amp in range(10, 170, 6):
            for sL in SIG:
                for sR in SIG:
                    r = resid(tc % 360, amp, sL, sR)
                    if r < best[1]:
                        best = ((tc % 360, amp, sL, sR), r)
    tc, amp, sL, sR = best[0]
    for tc2 in [tc + d for d in (-3, -1.5, 0, 1.5, 3)]:
        for amp2 in [amp + d for d in range(-6, 7, 2)]:
            for sL2 in [sL + d for d in (-6, -3, 0, 3, 6)]:
                for sR2 in [sR + d for d in (-6, -3, 0, 3, 6)]:
                    if sL2 <= 2 or sR2 <= 2 or amp2 <= 0:
                        continue
                    r = resid(tc2 % 360, amp2, sL2, sR2)
                    if r < best[1]:
                        best = ((tc2 % 360, amp2, sL2, sR2), r)
    return best  # (tc, amp, sL, sR), rmse

def fit_1d_sat(dossier, nom, dirx, diry, sL, sR, temoin2):
    m = load(dossier, f"hsl2-sat-{nom}-m100")
    if m is None:
        return None, None
    rb = {round(p[0]): p for p in temoin2["balayage"]}
    hin, dsat = [], []
    for p in m["balayage"][::2]:
        h = round(p[0])
        if h in rb:
            hin.append(p[0]); dsat.append(p[2] - rb[h][2])
    hin = np.array(hin); dsat = np.array(dsat)
    L, a, bb, chroma, gate = hls_arrays(hin)
    w = weight(a, bb, chroma, gate, dirx, diry, sL, sR)
    base_s, _ = out_hls_sl(*oklab_to_lin(L, a, bb))

    def resid(k):
        mul = 1 + w * (-100 / 100.0) * k
        s, _ = out_hls_sl(*oklab_to_lin(L, a * mul, bb * mul))
        e = (s - base_s) - dsat
        return math.sqrt(float(np.mean(e * e)))
    # satK borne a 1.0 : au-dela, satMul = 1 + w*(-1)*satK devient NEGATIF au centre,
    # ce qui INVERSE la chroma vers la complementaire (non physique). A 1.0, -100 amene
    # exactement la bande a chroma nulle. Lightroom desature parfois « plus » que ca
    # (nonlinearite HLS/OKLab) ; le residu le porte plutot qu'un signe inverse.
    best = min(np.arange(0.0, 1.001, 0.01), key=resid)
    return round(float(best), 3), round(resid(best), 4)

def fit_1d_lum(dossier, nom, dirx, diry, sL, sR, temoin2):
    blocks = []
    for src, sens in [(f"hsl2-lum-{nom}-p100", +100), (f"hsl2-lum-{nom}-m100", -100)]:
        m = load(dossier, src)
        if m is None:
            continue
        rb = {round(p[0]): p for p in temoin2["balayage"]}
        hin, dl = [], []
        for p in m["balayage"][::2]:
            h = round(p[0])
            if h in rb:
                hin.append(p[0]); dl.append(p[3] - rb[h][3])
        hin = np.array(hin); dl = np.array(dl)
        L, a, bb, chroma, gate = hls_arrays(hin)
        w = weight(a, bb, chroma, gate, dirx, diry, sL, sR)
        _, base_l = out_hls_sl(*oklab_to_lin(L, a, bb))
        blocks.append((L, a, bb, w, base_l, dl, sens))

    def resid(k):
        se, n = 0.0, 0
        for L, a, bb, w, base_l, dl, sens in blocks:
            mul = 1 + w * (sens / 100.0) * k
            _, l = out_hls_sl(*oklab_to_lin(L * mul, a, bb))
            e = (l - base_l) - dl
            se += float(np.sum(e * e)); n += len(e)
        return math.sqrt(se / n)
    best = min(np.arange(0.0, 1.01, 0.01), key=resid)
    # amplitudes p/m separees, pour noter l'asymetrie
    amp = {}
    for L, a, bb, w, base_l, dl, sens in blocks:
        amp[sens] = round(float(np.max(np.abs(dl))), 3)
    return round(float(best), 3), round(resid(best), 4), amp

def fit_1d_gray(dossier, nom, tc, dirx, diry, sL, sR, nb):
    m = load(dossier, f"hsl2-gris-{nom}-p100")
    if m is None:
        return None, None, None
    nbm = {round(p[0]): p[3] for p in nb["balayage"]}
    # fenetre +-30 deg autour du centre (la ou la bande agit)
    hin, dl, lnb = [], [], []
    for p in m["balayage"][::2]:
        h = round(p[0])
        if h in nbm and abs(dhue(p[0], tc)) <= 30:
            hin.append(p[0]); dl.append(p[3] - nbm[h]); lnb.append(nbm[h])
    if len(hin) < 3:
        return None, None, None
    hin = np.array(hin); dl = np.array(dl); lnb = np.array(lnb)
    L, a, bb, chroma, gate = hls_arrays(hin)
    w = weight(a, bb, chroma, gate, dirx, diry, sL, sR)
    _, base_l = out_hls_sl(*oklab_to_lin(L, a, bb))  # L HLS du gris modele (mode N&B ~ base)

    def resid(k):
        # mode N&B : Lout = L_oklab * (1 + w*k) ; on lit la L HLS de sortie
        Lg = np.clip(L * (1 + w * k), 0, 1)
        _, l = out_hls_sl(*oklab_to_lin(Lg, 0 * a, 0 * bb))
        # difference croisee : (l - l_nb_modele) vs (mesure - nb)
        Lg0 = np.clip(L, 0, 1)
        _, l0 = out_hls_sl(*oklab_to_lin(Lg0, 0 * a, 0 * bb))
        e = (l - l0) - dl
        return math.sqrt(float(np.mean(e * e)))
    best = min(np.arange(0.0, 2.001, 0.01), key=resid)
    incert = round(float(np.std(dl / np.maximum(lnb, 1e-3))), 3)  # dispersion du ratio -> incertitude
    return round(float(best), 3), round(resid(best), 4), incert

def main():
    dossier = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "research", "mesures")
    temoin = load(dossier, "temoin"); temoin2 = load(dossier, "temoin2"); nb = load(dossier, "nb")
    if temoin is None or temoin2 is None:
        print("temoin/temoin2 absent dans", dossier); sys.exit(1)

    table, resume = [], []
    for nom in BANDES:
        (tc, amp, sL, sR), rmse_h = fit_teinte(dossier, nom, temoin, temoin2)
        dx, dy = band_dir(tc)
        satK, rmse_s = fit_1d_sat(dossier, nom, dx, dy, sL, sR, temoin2)
        lumK, rmse_l, ampl = fit_1d_lum(dossier, nom, dx, dy, sL, sR, temoin2)
        grayK, rmse_g, incert = fit_1d_gray(dossier, nom, tc, dx, dy, sL, sR, nb)
        rgb = [round(float(v), 4) for v in hls_srgb01(tc, 1.0, 0.5)]
        row = {"id": ID_TS[nom], "rgb": rgb, "amplitudeDeg": round(amp, 1),
               "sigmaLeftDeg": round(sL, 1), "sigmaRightDeg": round(sR, 1),
               "satK": satK if satK is not None else 0.85,
               "lumK": lumK if lumK is not None else 0.3,
               "grayK": grayK if grayK is not None else 0.5}
        table.append(row)
        resume.append({"bande": nom, "centre": round(tc, 1), **row,
                       "rmse_teinte": round(rmse_h, 2), "rmse_sat": rmse_s,
                       "rmse_lum": rmse_l, "lum_amp_pm": ampl,
                       "rmse_gris": rmse_g, "gris_incert": incert})
        print(f"{nom:8s} centre {tc:5.1f}  amp {amp:5.1f}  sL {sL:4.1f} sR {sR:4.1f}  "
              f"satK {row['satK']}  lumK {row['lumK']} (p/m {ampl})  grayK {row['grayK']} (+/-{incert})  "
              f"| rmse teinte {rmse_h:.2f} sat {rmse_s} lum {rmse_l} gris {rmse_g}")

    print("\n// ── A COLLER DANS src/render/effects/hslBandes.ts ──")
    print("export const HSL_BANDES: readonly HslBande[] = [")
    for r in table:
        print(f'  {{ id: "{r["id"]}", rgb: {r["rgb"]}, amplitudeDeg: {r["amplitudeDeg"]}, '
              f'sigmaLeftDeg: {r["sigmaLeftDeg"]}, sigmaRightDeg: {r["sigmaRightDeg"]}, '
              f'satK: {r["satK"]}, lumK: {r["lumK"]}, grayK: {r["grayK"]} }},')
    print("];")
    out = os.path.join(os.path.dirname(__file__), "hsl-calibration.json")
    json.dump(resume, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("\necrit", out)


if __name__ == "__main__":
    main()
