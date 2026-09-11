"""Calibre la table de bandes HSL de shaderlab sur les mesures Lightroom.

PROVISOIRE tant que les exports n'existent pas. Une fois le plugin
`shaderlab-dump.lrdevplugin` passe (AutoMesures -> Documents/shaderlab-lightroom-mesures/)
et `analyse-mesures.py` lance (research/mesures/*.json), ce script :

  1. lit, pour chaque bande de TEINTE (hsl-teinte-<bande>-p100), le balayage de
     teinte du temoin et de la mesure ;
  2. le decalage de teinte de sortie en fonction de la teinte d'ENTREE dessine le
     poids de la bande a +100 : on y ajuste par moindres carres une gaussienne
     (centre en degres, demi-largeur sigma, amplitude en degres a +100) ;
  3. lit les mesures de SATURATION (hsl-sat-<bande>-p100/m100) et de LUMINANCE
     (hsl-lum-<bande>-p100/m100) pour en tirer satK et lumK quand elles existent ;
  4. imprime la table `HSL_BANDES` a coller dans `src/render/effects/hslBandes.ts`,
     le sigma global, et l'ECART RESIDUEL de chaque ajustement.

Ce que la mesure ne couvre PAS aujourd'hui (mesures.lua ne les exporte pas) :
  - les GrayMixer par bande (grayK) : reste provisoire, note en sortie ;
  - les bandes de SAT/LUM autres que celles listees dans mesures.lua (rouge, bleu,
    vert) : les manquantes gardent leur valeur provisoire.

Usage : python calibrer-hsl.py [dossier_des_json]   (defaut : ../research/mesures)
"""
import sys, os, json, math

BANDES = ["rouge", "orange", "jaune", "vert", "aqua", "bleu", "violet", "magenta"]
# Correspondance nom de mesure -> id de bande cote TS (hslBandes.ts).
ID_TS = {"rouge": "red", "orange": "orange", "jaune": "yellow", "vert": "green",
         "aqua": "aqua", "bleu": "blue", "violet": "purple", "magenta": "magenta"}
# Couleur pure usuelle de chaque bande (sRGB 0..1), pour la direction OKLab. Le
# centre mesure ne DEPLACE pas cette couleur : il sert de controle (si le centre
# ajuste s'ecarte de l'usuel de plus de ~15 degres, on l'imprime en avertissement).
RGB_USUEL = {"red": [1, 0, 0], "orange": [1, 0.5, 0], "yellow": [1, 1, 0],
             "green": [0, 1, 0], "aqua": [0, 1, 1], "blue": [0, 0, 1],
             "purple": [0.5, 0, 1], "magenta": [1, 0, 1]}
CENTRE_USUEL = {"rouge": 0, "orange": 30, "jaune": 60, "vert": 120,
                "aqua": 180, "bleu": 240, "violet": 270, "magenta": 300}


def charger(dossier, nom):
    p = os.path.join(dossier, nom + ".json")
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def delta_teinte(mesure, temoin):
    """Renvoie [(teinte_entree, delta_sortie_deg)] sur le balayage sat 100 %."""
    tb = {round(p[0]): p[1] for p in temoin["balayage"]}
    out = []
    for p in mesure["balayage"]:
        h_in = p[0]
        if round(h_in) not in tb:
            continue
        d = ((p[1] - tb[round(h_in)] + 180) % 360) - 180
        out.append((h_in, d))
    return out


def ajuster_gaussienne(points):
    """Grille coarse-to-fine sur (centre, sigma, amplitude) minimisant l'ecart
    quadratique de delta(h) = amplitude * exp(-((h-centre) enroule)^2 / (2 sigma^2)).
    Sans scipy. Renvoie (centre, sigma, amplitude, rmse)."""
    def enroule(x):
        return ((x + 180) % 360) - 180

    def cout(centre, sigma, amp):
        s = 0.0
        for h, d in points:
            w = math.exp(-(enroule(h - centre) ** 2) / (2 * sigma * sigma))
            s += (amp * w - d) ** 2
        return s / max(len(points), 1)

    best = (0.0, 25.0, 0.0, float("inf"))
    centres = list(range(0, 360, 5))
    sigmas = [10, 15, 20, 25, 30, 40, 50]
    amps = [a for a in range(-45, 46, 3)]
    for c in centres:
        for sg in sigmas:
            for a in amps:
                q = cout(c, sg, a)
                if q < best[3]:
                    best = (c, sg, a, q)
    # raffinage local
    c0, s0, a0, _ = best
    for c in [c0 + d for d in range(-4, 5)]:
        for sg in [s0 + d for d in (-4, -2, 0, 2, 4)]:
            if sg <= 0:
                continue
            for a in [a0 + d * 0.5 for d in range(-6, 7)]:
                q = cout(c % 360, sg, a)
                if q < best[3]:
                    best = (c % 360, sg, a, q)
    c, sg, a, q = best
    return c, sg, a, math.sqrt(q)


def dose_chroma(mesure, temoin):
    """Ecart moyen de SATURATION (0..1) mesure - temoin sur le balayage sat 100 %,
    pour deriver satK ou lumK. Grossier : la moyenne signee du delta de sat."""
    tb = {round(p[0]): p[2] for p in temoin["balayage"]}
    ds = [p[2] - tb[round(p[0])] for p in mesure["balayage"] if round(p[0]) in tb]
    return sum(ds) / max(len(ds), 1)


def main():
    dossier = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "research", "mesures")
    temoin = charger(dossier, "temoin")
    if temoin is None:
        print("Pas de temoin dans", dossier, "— lance d'abord analyse-mesures.py sur les exports.")
        sys.exit(1)

    sigmas = []
    lignes = []
    avert = []
    for nom in BANDES:
        tid = ID_TS[nom]
        rgb = RGB_USUEL[tid]
        amp, sig, satK, lumK = 30.0, None, 1.0, 0.5
        m = charger(dossier, f"hsl-teinte-{nom}-p100")
        if m is not None:
            centre, sg, amplitude, rmse = ajuster_gaussienne(delta_teinte(m, temoin))
            amp, sig = round(amplitude, 2), round(sg, 2)
            sigmas.append(sg)
            ecart_centre = abs(((centre - CENTRE_USUEL[nom] + 180) % 360) - 180)
            note = f"centre {centre:.0f} deg, sigma {sg:.0f} deg, amp {amplitude:+.1f} deg, rmse {rmse:.2f}"
            if ecart_centre > 15:
                avert.append(f"  bande {nom}: centre mesure {centre:.0f} deg s'ecarte de l'usuel {CENTRE_USUEL[nom]} de {ecart_centre:.0f} deg")
        else:
            note = "hsl-teinte absent -> amplitude provisoire 30 deg"
        ms = charger(dossier, f"hsl-sat-{nom}-m100")
        if ms is not None:
            # -100 doit ramener la sat de la bande a ~0 : satK = -delta / sat_temoin.
            d = dose_chroma(ms, temoin)
            satK = round(min(1.5, max(0.0, -d / 0.5)), 3)  # 0.5 ~ sat de reference
            note += f", satK {satK} (mesure)"
        ml = charger(dossier, f"hsl-lum-{nom}-p100")
        if ml is not None:
            note += ", lumK mesure disponible (voir json)"
        lignes.append((tid, rgb, amp, satK, lumK))
        print(f"{nom:9s} {note}")

    sigma_global = round(sum(sigmas) / len(sigmas), 1) if sigmas else 25
    print()
    print("// ── A COLLER DANS src/render/effects/hslBandes.ts ──")
    print(f"export const HSL_SIGMA_DEG = {sigma_global};")
    print("export const HSL_BANDES: readonly HslBande[] = [")
    for tid, rgb, amp, satK, lumK in lignes:
        print(f"  {{ id: \"{tid}\", rgb: {rgb}, amplitudeDeg: {amp}, satK: {satK}, lumK: {lumK}, grayK: 0.5 }},")
    print("];")
    print()
    print("grayK reste PROVISOIRE (0.5) : mesures.lua n'exporte aucun GrayMixer par bande.")
    if avert:
        print("\nAVERTISSEMENTS (centre mesure loin de l'usuel — verifier la mire) :")
        print("\n".join(avert))


if __name__ == "__main__":
    main()
