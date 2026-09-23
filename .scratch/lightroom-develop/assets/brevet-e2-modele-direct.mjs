// E2 — MODELE DIRECT, robuste a l'ecretage. Parties 2 et 3, puis 1.
//
// Le fit Hermite sur niveaux lisibles est BIAISE quand l'ecretage retire la region
// informative (x~1/3, ou la deviation Hermite culmine). A sat100 R s'ecrete sur les
// niveaux 8-128 : la pente R n'y est plus mesurable. La seule mesure honnete est un
// MODELE DIRECT qui predit le clamp : brevet en ProPhoto -> sRGB lineaire -> clamp
// export [0,1] -> niveau, compare a la rampe mesuree en NIVEAUX sRGB (3 canaux).
//
// Loi testee : s0 = pentes(hue, S, W) avec S=S(sat) candidat ; courbe = Hermite en
// PP (codage teste), s1=1 (ombres seules). Invariance Y ProPhoto.
import {
  s2l, l2s, SRGB_VERS_PP, ap, PP_XYZ, pentes, hermite, charge, lisible,
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

const CODAGES = {
  "PP lineaire": { code: (v) => v, decode: (v) => v },
  "PP gamma 1,8": {
    code: (v) => Math.sign(v) * Math.pow(Math.abs(v), 1 / 1.8),
    decode: (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.8),
  },
  "PP TRC sRGB": {
    code: (v) => Math.sign(v) * l2s(Math.abs(v)),
    decode: (v) => Math.sign(v) * s2l(Math.abs(v)),
  },
};

function ppLinEntree(i) { const g = s2l(i / 255); return ap(SRGB_VERS_PP, [g, g, g]); }
const niv = (lin) => 255 * l2s(Math.max(0, Math.min(1, lin)));

// Rampe sRGB predite par le brevet, hue/S, codage. Renvoie [256][3] + PP lineaire brut.
function rampeBrevet(hue, S, cod) {
  const s0 = pentes(hue, S, W);
  const out = [], ppBrut = [];
  for (let i = 0; i < 256; i++) {
    const x = cod.code(ppLinEntree(i)[0]);
    const outCode = [0, 1, 2].map((c) => hermite(x, s0[c], 1));
    const ppLin = outCode.map(cod.decode);
    ppBrut.push(ppLin);
    const srgbLin = ap(PP_VERS_SRGB, ppLin);
    out.push(srgbLin.map(niv));
  }
  return { out, ppBrut, s0 };
}

// residu sRGB niveaux entre rampe predite et mesuree, sur TOUS les niveaux 1..254
// (le modele predit le clamp, donc on n'exclut pas les niveaux ecretes).
function residu(pred, mes) {
  let se = 0, n = 0, mx = 0;
  for (let i = 1; i < 255; i++) {
    for (let c = 0; c < 3; c++) {
      const e = pred[i][c] - mes[i][c];
      se += e * e; n++; if (Math.abs(e) > mx) mx = Math.abs(e);
    }
  }
  return { rms: Math.sqrt(se / n), max: mx };
}

// ── PARTIE 2 : loi S(sat) par balayage de S, modele direct ────────────────────
function partie2() {
  console.log("== PARTIE 2 : loi S(sat), ombres 220 Balance -100, modele direct (residu sRGB sur TOUTE la rampe) ==\n");
  const scenes = [
    { n: "st-ombres-sat20", sat: 20 },
    { n: "st-h220", sat: 60 },
    { n: "st-ombres-sat100", sat: 100 },
  ];
  for (const codeName of Object.keys(CODAGES)) {
    const cod = CODAGES[codeName];
    console.log(`--- codage ${codeName} ---`);
    for (const { n, sat } of scenes) {
      const mes = charge(n).rampe_rgb;
      // balaye S de 0,05 a 0,999
      let best = { S: 0, rms: 1e9 };
      for (let S = 0.05; S <= 0.999; S += 0.005) {
        const { out } = rampeBrevet(220, S, cod);
        const r = residu(out, mes);
        if (r.rms < best.rms) best = { S, rms: r.rms, max: r.max };
      }
      // comparaisons aux lois : S=sat/100
      const rLin = residu(rampeBrevet(220, Math.min(0.999, sat / 100), cod).out, mes);
      console.log(`  ${n.padEnd(20)} sat=${String(sat).padStart(3)}  ` +
        `S* (meilleur)=${best.S.toFixed(3)} (rms ${best.rms.toFixed(2)}, max ${best.max.toFixed(0)})   ` +
        `S=sat/100 -> rms ${rLin.rms.toFixed(2)} max ${rLin.max.toFixed(0)}`);
    }
    console.log("");
  }
}

// ── PARTIE 3 : sat100, R=0 vient-il de PP->sRGB d'une courbe restee dans [0,1] PP ?
function partie3() {
  console.log("== PARTIE 3 : sat100, origine du R=0 a l'export ==\n");
  const mes = charge("st-ombres-sat100").rampe_rgb;
  for (const codeName of Object.keys(CODAGES)) {
    const cod = CODAGES[codeName];
    // a S=1, m=0 : la pente min (R) vaut 0. Courbe R = Hermite(x, 0, 1).
    const S = 0.999;
    const { out, ppBrut, s0 } = rampeBrevet(220, S, cod);
    // combien de niveaux ou R_PP reste dans [0,1] MAIS R_sRGB < 0 (donc clampe) ?
    let ppOk = 0, srgbNeg = 0, ppNeg = 0, coincide = 0, total = 0;
    for (let i = 1; i < 255; i++) {
      const ppR = ppBrut[i][0];
      const srgbLin = ap(PP_VERS_SRGB, ppBrut[i]);
      const rMesClamp = mes[i][0] < 0.5;
      total++;
      if (ppR >= -1e-4) ppOk++; else ppNeg++;
      if (srgbLin[0] < 0) srgbNeg++;
      // coincidence : la ou le modele predit srgbR<0 (clamp), la mesure a R~0
      if ((srgbLin[0] < 0) === rMesClamp) coincide++;
    }
    console.log(`  ${codeName}: s0=(${s0.map((v) => v.toFixed(3)).join(",")})  ` +
      `R_PP>=0 sur ${ppOk}/${total} niv, R_PP<0 sur ${ppNeg}  |  R_sRGB<0 (clampe) sur ${srgbNeg}  ` +
      `|  accord clamp modele/mesure ${coincide}/${total}`);
  }
  // detail : montrer quelques niveaux pour PP lineaire
  console.log("\n  Detail PP lineaire, S=1 (pente R=0), niveaux 8..200 :");
  const cod = CODAGES["PP lineaire"];
  const { ppBrut } = rampeBrevet(220, 0.999, cod);
  for (const i of [8, 16, 32, 64, 96, 128, 160, 200]) {
    const srgbLin = ap(PP_VERS_SRGB, ppBrut[i]);
    console.log(`   niv ${String(i).padStart(3)}: R_PP=${ppBrut[i][0].toFixed(4)} (dans[0,1]:${ppBrut[i][0] >= 0}) ` +
      `-> R_sRGB_lin=${srgbLin[0].toFixed(4)} -> R_export=${niv(srgbLin[0]).toFixed(1)}   ` +
      `R_mesure=${mes[i][0].toFixed(1)}`);
  }
  console.log("");
}

// ── PARTIE 1 : amplitude entre teintes, PUR brevet (aucun fit par teinte) ──────
function partie1(Ssat60) {
  console.log(`== PARTIE 1 : rampe PUR brevet par teinte a S=${Ssat60} (sat 60), residu sRGB decisif ==\n`);
  const HUES = [0, 220, 270, 300, 330, 140, 150, 180];
  for (const codeName of ["PP lineaire", "PP gamma 1,8"]) {
    const cod = CODAGES[codeName];
    console.log(`--- codage ${codeName} ---`);
    for (const h of HUES) {
      const n = ({ 0: "st-h000", 220: "st-h220", 270: "st-h270", 300: "st-h300",
        330: "st-h330", 140: "st-h140", 150: "st-h150", 180: "st-h180" })[h];
      const mes = charge(n).rampe_rgb;
      const { out } = rampeBrevet(h, Ssat60, cod);
      const r = residu(out, mes);
      // meilleur S par teinte (pour voir si la teinte veut un S different)
      let best = { S: 0, rms: 1e9 };
      for (let S = 0.2; S <= 0.9; S += 0.01) {
        const rr = residu(rampeBrevet(h, S, cod).out, mes);
        if (rr.rms < best.rms) best = { S, rms: rr.rms };
      }
      const jaune = [140, 150, 180].includes(h) ? "  (cyan/vert : hors preuve)" : "";
      console.log(`  h${String(h).padStart(3, "0")}  S=${Ssat60} -> rms ${r.rms.toFixed(2)} (max ${r.max.toFixed(0)})   ` +
        `| S* propre=${best.S.toFixed(2)} (rms ${best.rms.toFixed(2)})${jaune}`);
    }
    console.log("");
  }
}

partie2();
partie3();
partie1(0.55);
