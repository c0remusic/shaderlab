// Ce que k = 0,177 fait UN CRAN AU-DELA de la mesure qui l'a fixe.
//
// Les deux mesures qui ajustent la roue des ombres sont a +50 et -50. Poser le k
// sans regarder +100 et -100 serait exactement le defaut de la memoire
// `mesurer-un-cran-au-dela-du-gain` : un optimum lu a l'interieur de
// l'echantillon, une formule non bornee au-dela.
//
// Ce qu'on cherche : de l'ECRASEMENT. C'est le defaut qui a fait refuser la
// precedente inflation d'amplitude (ticket 06) — a `Luminance des hautes
// lumieres` +50, onze niveaux sortaient tous a 255. On compte donc les niveaux
// DISTINCTS et les niveaux colles aux bornes, aux deux k, aux quatre doses.
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";
import { COLOR_GRADING as CG } from "../../../src/render/effects/colorGradingTable.ts";

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (l) => { const x = Math.max(0, Math.min(1, l)); return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
const Lde = (lin) => Math.cbrt(Math.max(0, lin));
const linDe = (L) => L * L * L;

function appliqueLum(L, dL) {
  const h = dL >= 0 ? 1 - L : L;
  if (h <= 1e-6) return dL >= 0 ? 1 : 0;
  const d = 1 - Math.exp(-Math.abs(dL) / h);
  return dL >= 0 ? L + h * d : L - h * d;
}
function dLdepuisSortie(L, Lout) {
  if (Math.abs(Lout - L) < 1e-12) return 0;
  const monte = Lout > L;
  const h = monte ? 1 - L : L;
  if (h <= 1e-6) return null;
  const d = Math.abs(Lout - L) / h;
  if (d >= 1) return null;
  return (monte ? 1 : -1) * (-h * Math.log(1 - d));
}
const params = (lum) => { const p = new Array(14).fill(0); p[12] = 50; p[2] = lum; return p; };

function profil(k, dose) {
  const sorties = [];
  for (let n = 0; n <= 255; n++) {
    const lin = s2l(n / 255);
    const L = Lde(lin);
    const out = colorGradingSpec([lin, lin, lin], params(dose * 100));
    const dLservice = dLdepuisSortie(L, Lde(Math.max(0, out[0])));
    const w = dLservice === null ? 0 : dLservice / (dose * CG.lumK);
    sorties.push(Math.round(l2s(linDe(appliqueLum(L, dose * k * w))) * 255));
  }
  return sorties;
}

console.log("Roue des OMBRES. k en service %s, k mesure 0,1766.", CG.lumK.toFixed(4));
console.log("");
console.log("dose    k        niveaux distincts   colles a 0   colles a 255   plus grand trou");
console.log("".padEnd(86, "-"));
for (const dose of [1.0, 0.5, -0.5, -1.0]) {
  for (const k of [CG.lumK, 0.1766]) {
    const s = profil(k, dose);
    const distincts = new Set(s).size;
    const zero = s.filter((v) => v === 0).length;
    const blanc = s.filter((v) => v === 255).length;
    const tries = [...new Set(s)].sort((a, b) => a - b);
    let trou = 0;
    for (let i = 1; i < tries.length; i++) trou = Math.max(trou, tries[i] - tries[i - 1]);
    console.log("%s %s %s %s %s %s",
      (dose >= 0 ? "+" : "") + (dose * 100).toFixed(0).padStart(4),
      k.toFixed(4).padStart(8),
      String(distincts).padStart(18),
      String(zero).padStart(12),
      String(blanc).padStart(14),
      String(trou).padStart(16));
  }
}
console.log("");
console.log("⚠️ « colles a 0 » au defaut vaut 1 (le niveau 0 lui-meme) : au-dela,");
console.log("   c'est de l'ecrasement — des niveaux d'entree distincts qui sortent pareil.");
