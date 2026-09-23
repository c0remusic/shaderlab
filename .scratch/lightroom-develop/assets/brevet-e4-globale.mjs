// E4 — LA ROUE GLOBALE, CONSTRUCTION DU BREVET A ZERO PARAMETRE LIBRE.
//
// brevet-courbes a montre qu'une cubique d'Hermite par canal AJUSTEE (s0, s1
// libres) tient cg-glob-h040 et cg-glob-h220 au plancher 8 bits (0,35-0,37).
// Ici on n'ajuste RIEN : on PREDIT les pentes par le brevet et on regarde si la
// mesure tombe quand meme au plancher.
//
// Roue globale de teinte h : le brevet donne la meme teinte h aux deux bouts.
//   - pente en 0 = pentes(h, S)      -> teinte h au noir ;
//   - pente en 1 = pentes(h+180, S)  -> l'Hospital inverse l'ordre, donc la
//     couleur pres du blanc porte aussi la teinte h.
// Une cubique d'Hermite par canal entre (0,0,s0) et (1,1,s1), dans un CODAGE E de
// ProPhoto lineaire, avec l'invariance qui fixe (m, M) des pentes.
//
// Inconnues discretes (zero param CONTINU) : le codage E, l'invariance, S.
// Prediction du brevet a S=0,6, invariance Y ProPhoto : voir le brief. On cherche
// le triplet (E, invariance, S) qui rend la mesure au plancher SANS ajuster les
// pentes, et on le compare a l'ajustement libre et a notre twin.
//
// CONTROLE : une rampe fabriquee par CE modele dans un codage connu doit etre
// retrouvee au plancher par le modele du meme codage, et RATEE par un autre.
import {
  s2l, l2s, niveau, ap, SRGB_VERS_PP, PP_VERS_SRGB, PP_XYZ, pentes, hermite, charge, lisible,
} from "./brevet-commun.mjs";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";

const W = PP_XYZ[1]; // poids Y ProPhoto

// ── Codages E de ProPhoto lineaire (code = lineaire -> non lineaire) ──────────
const gam = (g) => ({
  nom: `gamma ${g}`,
  code: (v) => Math.sign(v) * Math.pow(Math.abs(v), 1 / g),
  decode: (v) => Math.sign(v) * Math.pow(Math.abs(v), g),
});
const lineaire = { nom: "lineaire", code: (v) => v, decode: (v) => v };
const trcSrgb = {
  nom: "TRC sRGB",
  code: (v) => Math.sign(v) * l2s(Math.abs(v)),
  decode: (v) => Math.sign(v) * s2l(Math.abs(v)),
};
// ROMM (ProPhoto reel) : gamma 1,8 avec pied lineaire sous Et = 1/512.
const ET = 1 / 512;
const romm = {
  nom: "ROMM 1,8",
  code: (v) => {
    const a = Math.abs(v);
    return Math.sign(v) * (a < ET ? a * 16 : Math.pow(a, 1 / 1.8));
  },
  decode: (v) => {
    const a = Math.abs(v);
    const seuil = 16 * ET; // = Et^(1/1.8) a la jointure
    return Math.sign(v) * (a < seuil ? a / 16 : Math.pow(a, 1.8));
  },
};
const CODAGES = [lineaire, gam(1.6), gam(1.8), gam(2.0), gam(2.2), gam(2.4), trcSrgb, romm];
const INVAR = ["luminance", "lumiere", "moyenne"];

// ── Le modele du brevet, pentes PREDITES ─────────────────────────────────────
// rampe grise d'entree, sortie = niveaux sRGB predits. h = teinte globale.
function modelePredit(h, S, E, inv) {
  const s0 = pentes(h, S, W, inv);
  const s1 = pentes((h + 180) % 360, S, W, inv);
  const out = [];
  for (let i = 0; i < 256; i++) {
    const xlin = s2l(i / 255); // gris lineaire sRGB
    // gris sRGB lineaire -> ProPhoto lineaire : reste gris (blanc->blanc, lineaire).
    const X = E.code(xlin);
    const pp = [0, 1, 2].map((c) => E.decode(hermite(X, s0[c], s1[c])));
    out.push(ap(PP_VERS_SRGB, pp).map((v) => niveau(v)));
  }
  return out;
}

function ecartRampe(predite, mesuree) {
  let somme = 0, n = 0;
  for (let i = 3; i <= 252; i++) {
    if (!lisible(mesuree[i])) continue;
    for (let c = 0; c < 3; c++) somme += Math.abs(predite[i][c] - mesuree[i][c]);
    n++;
  }
  return { ecart: somme / (3 * n), n };
}

// ── Cubique AJUSTEE (rappel de brevet-courbes) : s0, s1 libres par canal ──────
function ajusteLibre(mesuree, E) {
  const pts = [];
  for (let i = 3; i <= 252; i++) {
    if (!lisible(mesuree[i])) continue;
    const X = E.code(s2l(i / 255));
    const pp = ap(SRGB_VERS_PP, mesuree[i].map((c) => s2l(c / 255)));
    pts.push([i, X, pp.map(E.code)]);
  }
  const s0 = [], s1 = [];
  for (let c = 0; c < 3; c++) {
    let aa = 0, ab = 0, bb = 0, ay = 0, by = 0;
    for (const [, X, Yc] of pts) {
      const a = X * (1 - X) * (1 - X), b = -X * X * (1 - X), y = Yc[c] - X;
      aa += a * a; ab += a * b; bb += b * b; ay += a * y; by += b * y;
    }
    const det = aa * bb - ab * ab;
    s0.push(1 + (ay * bb - by * ab) / det);
    s1.push(1 + (aa * by - ab * ay) / det);
  }
  let somme = 0;
  for (const [i, X] of pts) {
    const out = ap(PP_VERS_SRGB, [0, 1, 2].map((c) => E.decode(hermite(X, s0[c], s1[c]))));
    for (let c = 0; c < 3; c++) somme += Math.abs(niveau(out[c]) - mesuree[i][c]);
  }
  return { s0, s1, ecart: somme / (3 * pts.length) };
}

// ── Notre twin sur la roue globale (sat 60, fusion 50, balance 0) ─────────────
function twinRampe(h) {
  const p = [0, 0, 0, 0, 0, 0, 0, 0, 0, h, 60, 0, 50, 0];
  const out = [];
  for (let i = 0; i < 256; i++) {
    const xlin = s2l(i / 255);
    const lin = colorGradingSpec([xlin, xlin, xlin], p);
    out.push(lin.map((v) => niveau(v)));
  }
  return out;
}

// ── CONTROLE ──────────────────────────────────────────────────────────────────
console.log("CONTROLE — rampe fabriquee par le modele (ROMM 1,8, luminance, S=0,6, h=220)");
{
  const vraie = modelePredit(220, 0.6, romm, "luminance");
  for (const E of [romm, lineaire, trcSrgb]) {
    for (const inv of ["luminance", "lumiere"]) {
      const { ecart } = ecartRampe(modelePredit(220, 0.6, E, inv), vraie);
      const bon = E.nom === "ROMM 1,8" && inv === "luminance";
      console.log(`  ${(bon ? "* " : "  ")}${E.nom.padEnd(10)} ${inv.padEnd(10)} ecart ${ecart.toFixed(3)}`);
    }
  }
}

// ── PENTES PREDITES vs mesurees au ras du noir ────────────────────────────────
console.log("\nPENTES PREDITES (S=0,6, luminance Y ProPhoto), et l'orientation attendue");
for (const [nom, h] of [["cg-glob-h040", 40], ["cg-glob-h220", 220]]) {
  const s0 = pentes(h, 0.6, W, "luminance");
  const s1 = pentes((h + 180) % 360, 0.6, W, "luminance");
  console.log(`  ${nom}  s0=[${s0.map((x) => x.toFixed(3)).join(", ")}]  s1=[${s1.map((x) => x.toFixed(3)).join(", ")}]`);
}

// ── PREDIT : balayage (codage x invariance) a S=0,6 ───────────────────────────
for (const [nom, h] of [["cg-glob-h040", 40], ["cg-glob-h220", 220]]) {
  const mes = charge(nom).rampe_rgb;
  console.log(`\n${nom} — ecart du modele PREDIT (S=0,6), niveaux sRGB`);
  console.log("codage".padEnd(12) + INVAR.map((i) => i.padStart(12)).join("") + "   libre");
  let best = { ecart: 1e9 };
  for (const E of CODAGES) {
    const cols = INVAR.map((inv) => {
      const r = ecartRampe(modelePredit(h, 0.6, E, inv), mes);
      if (r.ecart < best.ecart) best = { ecart: r.ecart, E: E.nom, inv };
      return r.ecart;
    });
    const libre = ajusteLibre(mes, E).ecart;
    console.log(E.nom.padEnd(12) + cols.map((v) => v.toFixed(2).padStart(12)).join("") + libre.toFixed(2).padStart(8));
  }
  console.log(`  meilleur PREDIT : ${best.E} / ${best.inv} = ${best.ecart.toFixed(3)}`);
  const tw = ecartRampe(twinRampe(h), mes);
  console.log(`  notre TWIN (OKLab) : ${tw.ecart.toFixed(3)}`);
}

// ── S balaye, sur le meilleur codage/invariance de chaque scene ───────────────
console.log("\nS BALAYE — meilleur (codage, invariance) par S, sur cg-glob-h220");
{
  const mes = charge("cg-glob-h220").rampe_rgb;
  for (const S of [0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8]) {
    let best = { ecart: 1e9 };
    for (const E of CODAGES) for (const inv of INVAR) {
      const r = ecartRampe(modelePredit(220, S, E, inv), mes);
      if (r.ecart < best.ecart) best = { ecart: r.ecart, E: E.nom, inv };
    }
    console.log(`  S=${S.toFixed(2)}  ${best.E.padEnd(10)} ${best.inv.padEnd(10)} ${best.ecart.toFixed(3)}`);
  }
}
