// E2 REFUTATION — le biais d'ecretage sur la procedure d'estimation de S*.
//
// La conclusion porteuse de l'explorateur (S(sat) sous-lineaire, S=sat/100 refute,
// S sature sous 1) et la valeur sat100 (0,80) sortent TOUTES du fit parametrique
// meilleurS (residu sur TOUTE la rampe 1..254, ecretes compris). Son propre controle
// ne verifie que l'inversion Hermite LIBRE sur une rampe quasi non ecretee ; il ne
// mesure JAMAIS si la procedure parametrique elle-meme est biaisee par l'ecretage.
//
// Test decisif : je fabrique une rampe brevet a S CONNU (hue 220, PP lineaire, s1=1),
// je l'ecrete comme un export, PUIS je relance la MEME procedure meilleurS que
// modele-direct/loi, et je regarde quel S* elle rend. Si S=0,60 ecrete -> S*~0,60 et
// S=1,0 ecrete -> S*~0,80, la sous-linearite mesuree est REELLE et S=sat/100 tombe.
// Si S=1,0 ecrete -> S*~0,80, alors le sat100 mesure est compatible avec un VRAI S=1
// biaise vers le bas par l'ecretage : la "saturation sous 1" serait un artefact, et
// parties 2 et 3 (0,80 vs 1,0) se reconcilieraient sur S=1.
import { s2l, l2s, SRGB_VERS_PP, ap, PP_XYZ, pentes, hermite, charge } from "./brevet-commun.mjs";

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

// rampe brevet exportee (PP lineaire, s1=1, ecretage export [0,1])
function rampeBrevet(hue, S) {
  const s0 = pentes(hue, S, W);
  const out = [];
  for (let i = 0; i < 256; i++) {
    const x = ppLinEntree(i)[0];
    const outCode = [0, 1, 2].map((c) => hermite(x, s0[c], 1));
    out.push(ap(PP_VERS_SRGB, outCode).map(niv));
  }
  return { out, s0 };
}
// MEME procedure que modele-direct/loi : residu sRGB niveaux sur TOUTE la rampe.
function residu(pred, mes) {
  let se = 0, n = 0, mx = 0;
  for (let i = 1; i < 255; i++) for (let c = 0; c < 3; c++) {
    const e = pred[i][c] - mes[i][c]; se += e * e; n++; if (Math.abs(e) > mx) mx = Math.abs(e);
  }
  return { rms: Math.sqrt(se / n), max: mx };
}
function meilleurS(hue, mes) {
  let best = { S: 0, rms: 1e9 };
  for (let S = 0.05; S <= 0.999; S += 0.002) {
    const rms = residu(rampeBrevet(hue, S).out, mes).rms;
    if (rms < best.rms) best = { S, rms };
  }
  return best;
}
function nbEcretes(rampe) {
  let c = 0;
  for (let i = 1; i < 255; i++) if (rampe[i].some((v) => v < 0.5 || v > 254.5)) c++;
  return c;
}

// ── 1) CALIBRATION DU BIAIS : vrai S -> S* recupere par la procedure, sur rampe ecretee
console.log("== 1) BIAIS D'ECRETAGE DE LA PROCEDURE meilleurS (hue 220, PP lineaire) ==");
console.log("   vrai S  ecretes  S* recupere  (si S*<vrai S : la procedure sous-estime a cause du clamp)\n");
const vrais = [0.20, 0.30, 0.40, 0.51, 0.60, 0.70, 0.80, 0.90, 0.999];
const table = [];
for (const Svrai of vrais) {
  const r = rampeBrevet(220, Svrai);
  const ec = nbEcretes(r.out);
  const est = meilleurS(220, r.out);
  table.push({ Svrai, ec, Sest: est.S });
  console.log(`   ${Svrai.toFixed(3)}    ${String(ec).padStart(3)}/254   ${est.S.toFixed(3)}   (rms fit ${est.rms.toFixed(2)})`);
}

// ── 2) INVERSION : les S* mesures (0,21 / 0,51 / 0,80) correspondent a quel VRAI S ?
console.log("\n== 2) INVERSION : quel VRAI S rend les S* mesures 0,21 / 0,51 / 0,80 ? ==");
function vraiSpourSest(cible) {
  // interpolation lineaire sur la table Svrai -> Sest
  for (let k = 0; k < table.length - 1; k++) {
    const a = table[k], b = table[k + 1];
    if ((a.Sest - cible) * (b.Sest - cible) <= 0) {
      const t = (cible - a.Sest) / (b.Sest - a.Sest);
      return a.Svrai + t * (b.Svrai - a.Svrai);
    }
  }
  return NaN;
}
for (const [sat, sest] of [[20, 0.210], [60, 0.510], [100, 0.796]]) {
  const vs = vraiSpourSest(sest);
  console.log(`   sat=${sat}  S* mesure=${sest.toFixed(3)}  -> VRAI S ~ ${isNaN(vs) ? "hors table" : vs.toFixed(3)}`);
}

// ── 3) LE POINT sat100 : S=1,0 ecrete est-il indiscernable de S=0,80 sur la mesure ?
console.log("\n== 3) sat100 : S=1,0 (part 3) contre S=0,80 (part 2), residu a la MESURE reelle ==");
const mes100 = charge("st-ombres-sat100").rampe_rgb;
for (const S of [0.75, 0.80, 0.85, 0.90, 0.95, 0.999]) {
  const r = residu(rampeBrevet(220, S).out, mes100);
  console.log(`   S=${S.toFixed(3)}  rms=${r.rms.toFixed(2)}  max=${r.max.toFixed(0)}`);
}

// ── 4) sat60 : le refus de S=sat/100 tient-il ? vrai S=0,60 ecrete -> S* attendu
console.log("\n== 4) sat60 : la procedure rend quel S* pour un VRAI S=0,60 ecrete ? ==");
const r60vrai = rampeBrevet(220, 0.60);
console.log(`   vrai S=0,60 -> ecretes ${nbEcretes(r60vrai.out)}/254, S* procedure=${meilleurS(220, r60vrai.out).S.toFixed(3)}`);
const mes60 = charge("st-h220").rampe_rgb;
console.log(`   mesure st-h220 : S* procedure=${meilleurS(220, mes60).S.toFixed(3)}`);
console.log("   (si le vrai-0,60 ecrete rend deja ~0,51, le refus de S=sat/100 a sat60 est un artefact d'ecretage)");
