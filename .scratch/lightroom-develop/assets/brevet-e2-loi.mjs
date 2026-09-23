// E2 — caracterisation finale de la loi S(sat), profil commun, lien chroma.
import {
  s2l, l2s, SRGB_VERS_PP, ap, PP_XYZ, pentes, hermite, oklab, charge, lisible,
} from "./brevet-commun.mjs";

function inverse3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}
const PP_VERS_SRGB = inverse3(SRGB_VERS_PP);
const W = PP_XYZ[1];
function ppLinEntree(i) { const g = s2l(i / 255); return ap(SRGB_VERS_PP, [g, g, g]); }
const niv = (lin) => 255 * l2s(Math.max(0, Math.min(1, lin)));
const cod = { code: (v) => v, decode: (v) => v }; // PP lineaire (meilleur codage mesure)

function rampeBrevet(hue, S) {
  const s0 = pentes(hue, S, W);
  const out = [];
  for (let i = 0; i < 256; i++) {
    const x = cod.code(ppLinEntree(i)[0]);
    const outCode = [0, 1, 2].map((c) => hermite(x, s0[c], 1));
    out.push(ap(PP_VERS_SRGB, outCode.map(cod.decode)).map(niv));
  }
  return { out, s0 };
}
function residu(pred, mes) {
  let se = 0, n = 0;
  for (let i = 1; i < 255; i++) for (let c = 0; c < 3; c++) { const e = pred[i][c] - mes[i][c]; se += e * e; n++; }
  return Math.sqrt(se / n);
}
function meilleurS(hue, mes) {
  let best = { S: 0, rms: 1e9 };
  for (let S = 0.05; S <= 0.999; S += 0.002) {
    const rms = residu(rampeBrevet(hue, S).out, mes);
    if (rms < best.rms) best = { S, rms };
  }
  return best;
}

// ── LOI S(sat) ────────────────────────────────────────────────────────────────
console.log("== LOI S(sat), ombres 220 Balance -100 (PP lineaire, modele direct) ==\n");
const pts = [
  { n: "st-ombres-sat20", sat: 20 },
  { n: "st-h220", sat: 60 },
  { n: "st-ombres-sat100", sat: 100 },
];
const donnees = [];
for (const { n, sat } of pts) {
  const mes = charge(n).rampe_rgb;
  const b = meilleurS(sat === 60 ? 220 : 220, mes); // hue 220 pour les trois
  const s0 = pentes(220, b.S, W);
  const M = Math.max(...s0), m = Math.min(...s0);
  const ampli = Math.hypot(...s0.map((v) => v - 1)); // ||s0-1||
  donnees.push({ sat, S: b.S, rms: b.rms, m, d: M - m, ampli });
  console.log(`  sat=${String(sat).padStart(3)}  S*=${b.S.toFixed(3)} (rms ${b.rms.toFixed(2)})  ` +
    `pente_min m=${m.toFixed(3)}  spread d=M-m=${(M - m).toFixed(3)}  ||s0-1||=${ampli.toFixed(3)}`);
}
console.log("");

// lois candidates confrontees aux S* (0..1)
console.log("  Confrontation des lois S(sat) aux S* mesures (0.21 / 0.51 / 0.80) :");
const S20 = donnees[0].S, S60 = donnees[1].S, S100 = donnees[2].S;
console.log(`   (a) S = sat/100         : 0.20 / 0.60 / 1.00   -> ecarts ${(S20 - 0.2).toFixed(2)} / ${(S60 - 0.6).toFixed(2)} / ${(S100 - 1.0).toFixed(2)}`);
console.log(`   (b) S = 0.70*sat/100    : 0.14 / 0.42 / 0.70   -> ecarts ${(S20 - 0.14).toFixed(2)} / ${(S60 - 0.42).toFixed(2)} / ${(S100 - 0.70).toFixed(2)}`);
console.log(`   (c) S = sat/100 borne 0.70 : 0.20 / 0.60 / 0.70 -> ecarts ${(S20 - 0.2).toFixed(2)} / ${(S60 - 0.6).toFixed(2)} / ${(S100 - 0.70).toFixed(2)}`);
// (d) lineaire ajuste sur les 3 points
const sats = donnees.map((d) => d.sat), Ss = donnees.map((d) => d.S);
const nP = 3, sx = sats.reduce((a, b) => a + b), sy = Ss.reduce((a, b) => a + b);
const sxx = sats.reduce((a, b) => a + b * b, 0), sxy = sats.reduce((a, b, i) => a + b * Ss[i], 0);
const bLin = (nP * sxy - sx * sy) / (nP * sxx - sx * sx);
const aLin = (sy - bLin * sx) / nP;
console.log(`   (d) lineaire ajuste     : S = ${aLin.toFixed(4)} + ${bLin.toFixed(5)}*sat  ` +
  `-> ${(aLin + bLin * 20).toFixed(3)} / ${(aLin + bLin * 60).toFixed(3)} / ${(aLin + bLin * 100).toFixed(3)}  (S(0)=${aLin.toFixed(3)})`);
// (e) spread d lineaire en sat ?
console.log(`\n  Autres controles de linearite :`);
console.log(`   spread d(sat) : ${donnees.map((d) => d.d.toFixed(3)).join(" / ")}  ` +
  `(rapports a sat60 : ${donnees.map((d) => (d.d / donnees[1].d).toFixed(3)).join(" / ")})`);
console.log(`   pente_min m(sat) : ${donnees.map((d) => d.m.toFixed(3)).join(" / ")}`);
console.log(`   ||s0-1||(sat) : ${donnees.map((d) => d.ampli.toFixed(3)).join(" / ")}  ` +
  `(rapports a sat60 : ${donnees.map((d) => (d.ampli / donnees[1].ampli).toFixed(3)).join(" / ")})`);
console.log("");

// ── LIEN CHROMA (research/22) : chroma OKLab ajoutee au niveau 160 ─────────────
console.log("== Lien a la chroma OKLab (research/22 : sat20/60=0.347, sat100/60=1.409) ==\n");
function chromaOKLabAjoutee(nom, niveau) {
  const mes = charge(nom).rampe_rgb[niveau];
  const tem = charge("temoin").rampe_rgb[niveau];
  const labM = oklab(mes.map((v) => s2l(v / 255)));
  const labT = oklab(tem.map((v) => s2l(v / 255)));
  return Math.hypot(labM[1] - labT[1], labM[2] - labT[2]);
}
// research/22 mesure au niveau 160 du duo ; ici sur ombres 220 aux 3 sat, niveau ~96
// (les hautes lumieres de sat100 non ecretees). On mesure la ou lisible pour les 3.
for (const nvl of [96, 128, 160]) {
  const c20 = chromaOKLabAjoutee("st-ombres-sat20", nvl);
  const c60 = chromaOKLabAjoutee("st-h220", nvl);
  const c100 = chromaOKLabAjoutee("st-ombres-sat100", nvl);
  const clamp = charge("st-ombres-sat100").rampe_rgb[nvl].some((v) => v < 0.5 || v > 254.5);
  console.log(`  niveau ${nvl}: chroma OKLab 20/60/100 = ${c20.toFixed(4)}/${c60.toFixed(4)}/${c100.toFixed(4)}  ` +
    `rapports 20:60=${(c20 / c60).toFixed(3)} 100:60=${(c100 / c60).toFixed(3)}${clamp ? "  (sat100 ECRETE ici)" : ""}`);
}
console.log("\n  Prediction brevet des memes rapports par ||s0-1|| (S*=0.21/0.51/0.80) :");
console.log(`   20:60 = ${(donnees[0].ampli / donnees[1].ampli).toFixed(3)}   100:60 = ${(donnees[2].ampli / donnees[1].ampli).toFixed(3)}`);
console.log("");

// ── PROFIL COMMUN entre teintes (verif avant de comparer des amplitudes) ───────
console.log("== PROFIL COMMUN : forme de la deviation le long de la rampe, par teinte ==\n");
console.log("  Pour chaque teinte non-jaune : on projette la deviation PP lineaire sur sa");
console.log("  direction propre, on normalise par le pic, et on compare la FORME a x(1-x)^2.\n");
const HUES = [{ h: 0, n: "st-h000" }, { h: 220, n: "st-h220" }, { h: 270, n: "st-h270" },
  { h: 300, n: "st-h300" }, { h: 330, n: "st-h330" }];
const formes = [];
for (const { h, n } of HUES) {
  const mes = charge(n).rampe_rgb;
  // direction = moyenne des dev normalisees sur niveaux lisibles centraux
  let dir = [0, 0, 0];
  const devs = [];
  for (let i = 1; i < 255; i++) {
    if (!lisible(mes[i])) { devs.push(null); continue; }
    const ppOut = ap(SRGB_VERS_PP, mes[i].map((v) => s2l(v / 255)));
    const xin = ppLinEntree(i)[0];
    const d = [ppOut[0] - xin, ppOut[1] - xin, ppOut[2] - xin];
    devs.push({ i, d });
    const nn = Math.hypot(...d);
    if (nn > 0.02) dir = dir.map((v, c) => v + d[c] / nn);
  }
  const nd = Math.hypot(...dir); dir = dir.map((v) => v / nd);
  // profil scalaire = projection ; normalise par pic
  let pic = 0; const prof = [];
  for (const e of devs) {
    if (!e) { prof.push(null); continue; }
    const s = e.d[0] * dir[0] + e.d[1] * dir[1] + e.d[2] * dir[2];
    prof.push({ i: e.i, s });
    if (s > pic) pic = s;
  }
  formes.push({ h, dir, prof: prof.map((p) => p ? { i: p.i, v: p.s / pic } : null) });
}
// compare a x(1-x)^2 normalise (pic a x=1/3) et entre teintes
console.log("  niveau  x(1-x)^2*   " + HUES.map((u) => `h${String(u.h).padStart(3, "0")}`).join("   "));
for (const i of [16, 32, 64, 96, 128, 160, 192, 224]) {
  const x = ppLinEntree(i)[0];
  const theo = x * (1 - x) * (1 - x);
  const picTheo = (1 / 3) * (2 / 3) * (2 / 3);
  const cells = formes.map((f) => {
    const p = f.prof.find((q) => q && q.i === i);
    return p ? p.v.toFixed(3) : " clamp";
  });
  console.log(`   ${String(i).padStart(3)}    ${(theo / picTheo).toFixed(3)}      ${cells.map((c) => c.padStart(6)).join("  ")}`);
}
console.log("\n  (colonnes proches entre elles ET de x(1-x)^2* => profil commun, Hermite s1=1)");
