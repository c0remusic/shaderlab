// E1 — LES PENTES QUE LIGHTROOM POSE VRAIMENT AU NOIR, PAR CANAL, PAR TEINTE.
//
// Ombres seules (Balance -100, s1 = 1). En ProPhoto lineaire, chaque canal est une
// cubique C(x) = hermite(x, s0, 1) (a la deformation de balance pres, qui affecte
// l'abscisse mais pas la pente AU NOIR — l'Hospital lit la pente en x=0). On ajuste
// s0 par canal sur les BAS niveaux, en n'utilisant QUE les niveaux ou CE canal est
// lisible cote mesure (le bleu des jaunes est ecrete : on ne peut pas fitter sa
// pente, on la laisse vide). On compare aux pentes du brevet sous Y ProPhoto et
// sous lumiere HSL, puis on lit la luminance implicite w . s.
//
// CONTROLE : sur une rampe fabriquee par le brevet (Y ProPhoto), le fit doit
// retrouver les pentes injectees.
import { s2l, ap, SRGB_VERS_PP, PP_VERS_SRGB, PP_XYZ, pentes, hermite, niveau, charge, lisible } from "./brevet-commun.mjs";

const dot = (w, v) => w[0] * v[0] + w[1] * v[1] + w[2] * v[2];

/** Ajuste s0 d'un canal : minimise sum (pp_c(x) - hermite(x,s0,1))^2 sur bas niveaux
 *  ou le canal mesure est lisible. hermite - x = (s0-1) x(1-x)^2, lineaire en (s0-1). */
function fitS0(rampe, canal, nmax = 96) {
  let num = 0, den = 0, n = 0;
  for (let i = 4; i <= nmax; i++) {
    if (!lisible(rampe[i])) continue;                 // canal mesure non ecrete
    if (rampe[i][canal] < 0.6 || rampe[i][canal] > 254) continue;
    const x = s2l(i / 255);
    const pp = ap(SRGB_VERS_PP, rampe[i].map((c) => s2l(c / 255)))[canal];
    const base = x * (1 - x) * (1 - x);
    num += base * (pp - x); den += base * base; n++;
  }
  return n >= 3 ? { s0: 1 + num / den, n } : null;
}

const quant = (lin) => lin.map((v) => Math.round(niveau(v) * 100) / 100);
function rampeFab(h, S, inv) {
  const s0 = pentes(h, S, PP_XYZ[1], inv);
  return Array.from({ length: 256 }, (_, i) => {
    const x = s2l(i / 255);
    return quant(ap(PP_VERS_SRGB, [0, 1, 2].map((c) => hermite(x, s0[c], 1))));
  });
}

const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];
function ligne(nom, rampe) {
  const f = [0, 1, 2].map((c) => fitS0(rampe, c));
  return f;
}

console.log("CONTROLE — rampe fabriquee Y ProPhoto h060 : pentes attendues (1.000,1.000,0.250)");
{
  const f = ligne("fab", rampeFab(60, 0.6, "luminance"));
  console.log("  fit = [%s]", f.map((v) => v ? v.s0.toFixed(3) : "  .  ").join(", "));
}

console.log("");
console.log("PENTES AU NOIR — mesure vs brevet(Y ProPhoto) vs brevet(lumiere HSL), et luminance implicite");
console.log("teinte".padEnd(8) + "  mesure (R,G,B)".padEnd(30) + "brevet Y".padEnd(24) + "brevet HSL".padEnd(24) + "  w.s_mes");
for (const t of TEINTES) {
  const nom = `st-h${String(t).padStart(3, "0")}`;
  const f = ligne(nom, charge(nom).rampe_rgb);
  const sY = pentes(t, 0.6, PP_XYZ[1], "luminance");
  const sH = pentes(t, 0.6, PP_XYZ[1], "lumiere");
  const mes = f.map((v) => v ? v.s0 : null);
  // Luminance Y ProPhoto implicite : w.s sur les canaux mesures (si bleu manque, on
  // complete par la pente brevet Y du bleu, dont le poids est ~0 de toute facon).
  const sPlein = mes.map((v, c) => v == null ? sY[c] : v);
  const ws = dot(PP_XYZ[1], sPlein);
  const fmt = (a) => "[" + a.map((v) => v == null ? "  .  " : v.toFixed(3)).join(",") + "]";
  console.log(("h" + String(t).padStart(3, "0")).padEnd(8)
    + fmt(mes).padEnd(30)
    + fmt(sY).padEnd(24)
    + fmt(sH).padEnd(24)
    + ws.toFixed(3).padStart(8));
}
console.log("");
console.log("(w.s = 1 exactement => Y ProPhoto conservee au noir. > 1 => plus clair.)");
