// VERDICT sur le modele en COURBE : les trois gardes qui ont tue les precedents.
//
// CE QUI EST ACQUIS AVANT CE SCRIPT :
//   forme-lum-ombres      a dose negative, lin_sortie/lin_entree = 0,5000 aux
//                         niveaux 2, 4, 6 — une PENTE en lumiere lineaire ;
//   espace-sans-poids     aucun espace ne rend plat le rapport des deux signes,
//                         donc ce n'est pas « un decalage pondere », nulle part ;
//   asymetrie-twin        notre operateur est symetrique (ecart-type 0,034),
//                         Lightroom derive d'un facteur 7 (0,64) ;
//   extraire-poids        le poids extrait du signe negatif predit le signe
//                         positif a 0,578 niveau, contre 3,735 en service.
//
// CE QUE CE SCRIPT AJOUTE, et c'est ce qui decide :
//   A. L'EXTRACTION SUPPOSE UNE FORME. On la refait sous l'hypothese CONCURRENTE
//      (un offset en lumiere lineaire) et on regarde lequel des deux poids est
//      lisse et monotone. Un poids extrait sous la mauvaise forme ne l'est pas.
//   B. L'ECRASEMENT aux doses extremes — le critere qui a fait refuser k = 0,177.
//      Il ne s'achete avec aucun parametre.
//   C. L'ECONOMIE : est-ce qu'imposer g(+) = 1/g(-) coute cher ? Si non, le
//      modele n'a qu'UN parametre de gain plus un point noir, pas deux gains.
import { readFileSync } from "node:fs";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (l) => { const x = Math.max(0, Math.min(1, l)); return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
const niveau = (lin) => l2s(lin) * 255;

const plus = JSON.parse(readFileSync(`${M}/cg-ombres-lum-p50.json`, "utf8")).rampe;
const moins = JSON.parse(readFileSync(`${M}/cg-ombres-lum-m50.json`, "utf8")).rampe;

const defs = [];
for (let n = 1; n <= 255; n++) if (Math.abs(moins[n] - n) >= 1) defs.push(n);

/** Deux extractions concurrentes du poids, depuis la MEME rampe negative. */
function extraire(mode) {
  const brut = new Array(256).fill(null);
  for (const n of defs) {
    const lin = s2l(n / 255), out = s2l(moins[n] / 255);
    brut[n] = mode === "pente" ? 1 - out / lin : lin - out;
  }
  const max = Math.max(...brut.filter((v) => v !== null));
  return brut.map((v) => (v === null ? null : v / max));
}
function qualite(w) {
  let ruptures = 0, pire = 0;
  const d = defs.filter((n) => w[n] !== null);
  for (let i = 1; i < d.length; i++) {
    const saut = w[d[i]] - w[d[i - 1]];
    if (saut > 0) { ruptures++; pire = Math.max(pire, saut); }
  }
  return { ruptures, pire };
}
console.log("GARDE A — l'extraction suppose une forme. Les deux hypotheses, meme rampe.");
console.log("");
console.log("hypothese sur le signe negatif   remontees   pire remontee   w(4)    w(48)   w(128)");
console.log("".padEnd(82, "-"));
const poidsPar = {};
for (const mode of ["pente", "offset"]) {
  const w = extraire(mode);
  poidsPar[mode] = w;
  const q = qualite(w);
  console.log("%s %s %s %s %s %s",
    (mode === "pente" ? "pente : lin*(1+w(g-1))" : "offset : lin - w*c").padEnd(32),
    String(q.ruptures).padStart(9),
    q.pire.toFixed(4).padStart(15),
    w[4].toFixed(4).padStart(8),
    w[48].toFixed(4).padStart(7),
    w[128].toFixed(4).padStart(8));
}
console.log("");
console.log("   Un poids de plage DECROIT. Celui des deux qui remonte a ete extrait");
console.log("   sous la mauvaise forme — c'est la forme qui est testee, pas le poids.");

const w = poidsPar["pente"];

// ── AJUSTEMENTS ──────────────────────────────────────────────────────────────
const courbe = (g, b) => (lin, ww) => Math.max(0, Math.min(1, lin * (1 + ww * (g - 1)) + ww * b));
function residu(ramp, f) {
  let s = 0, c = 0;
  for (const n of defs) { s += Math.abs(niveau(f(s2l(n / 255), w[n])) - ramp[n]); c++; }
  return s / c;
}
function ajuster(ramp, gFixe) {
  let best = null;
  for (let ig = 0; ig <= 400; ig++) {
    const g = gFixe ?? 0.3 + ig * 0.01;
    for (let ib = -100; ib <= 400; ib++) {
      const b = ib * 5e-5;
      const r = residu(ramp, courbe(g, b));
      if (!best || r < best[2]) best = [g, b, r];
    }
    if (gFixe) break;
  }
  return best;
}
const [gM, bM, rM] = ajuster(moins);
const [gP, bP, rP] = ajuster(plus);
console.log("");
console.log("GARDE C — economie du modele.");
console.log("   signe -50 : g = %s, b = %s, residu %s", gM.toFixed(3), bM.toExponential(2), rM.toFixed(3));
console.log("   signe +50 : g = %s, b = %s, residu %s", gP.toFixed(3), bP.toExponential(2), rP.toFixed(3));
const [, bC, rC] = ajuster(plus, 1 / gM);
console.log("   signe +50 avec g IMPOSE a 1/g(-50) = %s : b = %s, residu %s",
  (1 / gM).toFixed(3), bC.toExponential(2), rC.toFixed(3));
console.log("   -> le gain reciproque coute %s niveau. Le point noir porte le reste.",
  (rC - rP).toFixed(3));

// ── GARDE B : l'ECRASEMENT ───────────────────────────────────────────────────
// Extrapolation sur la dose : un gain se COMPOSE (puissance), un lift s'ADDITIONNE.
function profil(f) {
  const s = [];
  for (let n = 0; n <= 255; n++) {
    const ww = w[n] === null ? (n < 4 ? 1 : 0) : w[n];
    s.push(Math.round(niveau(f(s2l(n / 255), ww))));
  }
  const tries = [...new Set(s)].sort((a, b) => a - b);
  let trou = 0;
  for (let i = 1; i < tries.length; i++) trou = Math.max(trou, tries[i] - tries[i - 1]);
  return { distincts: new Set(s).size, zero: s.filter((v) => v === 0).length, blanc: s.filter((v) => v === 255).length, trou };
}
function profilService(dose) {
  const s = [];
  for (let n = 0; n <= 255; n++) {
    const lin = s2l(n / 255);
    const p = new Array(14).fill(0); p[12] = 50; p[2] = dose * 100;
    s.push(Math.round(niveau(Math.max(0, colorGradingSpec([lin, lin, lin], p)[0]))));
  }
  const tries = [...new Set(s)].sort((a, b) => a - b);
  let trou = 0;
  for (let i = 1; i < tries.length; i++) trou = Math.max(trou, tries[i] - tries[i - 1]);
  return { distincts: new Set(s).size, zero: s.filter((v) => v === 0).length, blanc: s.filter((v) => v === 255).length, trou };
}
console.log("");
console.log("GARDE B — ecrasement, y compris UN CRAN au-dela des mesures (+-100).");
console.log("");
console.log("dose   modele        distincts   colles a 0   colles a 255   plus grand trou");
console.log("".padEnd(78, "-"));
for (const dose of [1.0, 0.5, -0.5, -1.0]) {
  const f = Math.abs(dose / 0.5);
  const src = dose >= 0 ? [gP, bP] : [gM, bM];
  const lignes = [
    ["en service", profilService(dose)],
    ["courbe", profil(courbe(Math.pow(src[0], f), f * src[1]))],
  ];
  for (const [nom, pr] of lignes) {
    console.log("%s %s %s %s %s %s",
      ((dose >= 0 ? "+" : "") + (dose * 100).toFixed(0)).padStart(5),
      nom.padEnd(14), String(pr.distincts).padStart(10), String(pr.zero).padStart(12),
      String(pr.blanc).padStart(14), String(pr.trou).padStart(16));
  }
}

console.log("");
console.log("Le bas de rampe, la ou tout s'est joue (+50) :");
console.log("  niv   Lightroom   en service   courbe");
for (const n of [0, 1, 2, 4, 8, 16, 32]) {
  const lin = s2l(n / 255);
  const p = new Array(14).fill(0); p[12] = 50; p[2] = 50;
  const ww = w[n] === null ? 1 : w[n];
  console.log("  %s %s %s %s",
    String(n).padStart(3),
    plus[n].toFixed(2).padStart(11),
    niveau(Math.max(0, colorGradingSpec([lin, lin, lin], p)[0])).toFixed(2).padStart(12),
    niveau(courbe(gP, bP)(lin, ww)).toFixed(2).padStart(9));
}
