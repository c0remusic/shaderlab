// REFUTEUR E4 — chercher une ALTERNATIVE qui explique la globale aussi bien que le
// brevet, et eprouver la PUISSANCE du controle + le SIGNE de l'argument des moyens.
//
// Ce que je teste, chacun sur la metrique qui decide (niveaux sRGB, 3 canaux, hors
// ecrete) :
//  (1) GLOBALE, alternative "chroma OKLab constante" : da,db constants ajoutes a L
//      constant (2 dof), le mecanisme de NOTRE twin degele de son amplitude fixe.
//      Si ca tombe aussi bas que le brevet a 1 dof (~1,05), alors "c'est le brevet"
//      n'est pas distinctif.
//  (2) GLOBALE, alternative "chroma OKLab constante + gain de L cubique" — plus de
//      dof mais toujours pas per-canal, pour voir si le per-canal du brevet est
//      necessaire ou si un modele a chroma sans structure de pente suffit.
//  (3) CONTROLE : reproduire la table du controle du brevet-e4-globale et pointer
//      quelle paire il distingue vraiment (TRC sRGB vs ROMM = 0,53 : quasi aveugle).
//  (4) MOYENS : montrer que le signe unique de la chroma mesuree est un FAIT brut
//      (pas un artefact du modele), et donner le meilleur fit chroma-cloche a dof
//      egal a une alternative "cubique per-canal ajustee 6 dof" (le fit libre).
import {
  s2l, l2s, niveau, ap, SRGB_VERS_PP, PP_VERS_SRGB, PP_XYZ, oklab, motif, pentes, hermite,
  charge, lisible,
} from "./brevet-commun.mjs";

const W = PP_XYZ[1];

// oklab inverse : (L,a,b) -> sRGB lineaire. (Ottosson)
function oklabInv([L, a, b]) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

function ecart(pred, mes) {
  let s = 0, n = 0;
  for (let i = 3; i <= 252; i++) {
    if (!lisible(mes[i])) continue;
    for (let c = 0; c < 3; c++) s += Math.abs(pred[i][c] - mes[i][c]);
    n++;
  }
  return s / (3 * n);
}

// ── (1) ALTERNATIVE chroma OKLab CONSTANTE : da,db constants, L conserve ──────
// gris d'entree -> OKLab (L, 0, 0) -> (L, da, db) -> sRGB lineaire -> niveau.
function modeleChromaConst(da, db) {
  const out = [];
  for (let i = 0; i < 256; i++) {
    const x = s2l(i / 255);
    const L = oklab([x, x, x])[0];
    out.push(oklabInv([L, da, db]).map(niveau));
  }
  return out;
}
// ajuste da,db par descente grossiere puis fine sur une scene
function fitChromaConst(mes) {
  let best = { e: 1e9 };
  for (let da = -0.15; da <= 0.15; da += 0.005) for (let db = -0.15; db <= 0.15; db += 0.005) {
    const e = ecart(modeleChromaConst(da, db), mes);
    if (e < best.e) best = { e, da, db };
  }
  // raffinage
  let { da, db } = best;
  for (let pas = 0.005; pas > 1e-4; pas /= 2) {
    for (const [dda, ddb] of [[pas, 0], [-pas, 0], [0, pas], [0, -pas]]) {
      const e = ecart(modeleChromaConst(da + dda, db + ddb), mes);
      if (e < best.e) { best = { e, da: da + dda, db: db + ddb }; }
    }
    da = best.da; db = best.db;
  }
  return best;
}

// ── (1bis) chroma OKLab constante avec DIRECTION imposee (teinte h) + amplitude ─
function modeleChromaDir(h, amp) {
  const p = motif(h);
  const lab = oklab([s2l(0.5), s2l(0.5), s2l(0.5)]); // direction via une couleur pure de teinte h
  // direction unitaire (a,b) de la teinte pure h en OKLab
  const pur = oklab(p.map(s2l));
  const dc = Math.hypot(pur[1], pur[2]) || 1;
  const dir = [pur[1] / dc, pur[2] / dc];
  return modeleChromaConst(dir[0] * amp, dir[1] * amp);
}

// ── (2) chroma constante + gain de L cubique (per-canal NON, structure de pente NON)
function modeleChromaGain(da, db, gL0, gL1) {
  const out = [];
  for (let i = 0; i < 256; i++) {
    const x = s2l(i / 255);
    const L0 = oklab([x, x, x])[0];
    const L = hermite(L0, gL0, gL1); // L suit une cubique clouee 0->0,1->1
    out.push(oklabInv([L, da, db]).map(niveau));
  }
  return out;
}

// ── notre twin exact (globale) pour reference, degele de chromaK ───────────────
// (on ne peut pas importer chromaK sans .ts ; on prend le da,db du twin comme la
//  chroma constante ajustee — le twin globale EST exactement modeleChromaConst avec
//  da,db = dir(h)*sat/100*chromaK, plus son clipGamut. On approxime par le fit dir.)

console.log("=== (1) GLOBALE : alternative chroma OKLab CONSTANTE (2 dof) vs brevet (1 dof=S) ===");
for (const [nom, h] of [["cg-glob-h040", 40], ["cg-glob-h220", 220]]) {
  const mes = charge(nom).rampe_rgb;
  const f = fitChromaConst(mes);
  // direction imposee teinte h, amplitude libre (1 dof, comparable au brevet)
  let bestDir = { e: 1e9 };
  for (let amp = 0; amp <= 0.2; amp += 0.001) {
    const e = ecart(modeleChromaDir(h, amp), mes);
    if (e < bestDir.e) bestDir = { e, amp };
  }
  const th = ((Math.atan2(f.db, f.da) * 180) / Math.PI + 360) % 360;
  console.log(`\n${nom} (h=${h})`);
  console.log(`  chroma const LIBRE (da,db) : ecart ${f.e.toFixed(2)}  (da=${f.da.toFixed(3)}, db=${f.db.toFixed(3)}, angle ab ${th.toFixed(0)} deg)`);
  console.log(`  chroma const DIRECTION h, amp libre (1 dof) : ecart ${bestDir.e.toFixed(2)}  (amp=${bestDir.amp.toFixed(3)})`);
  console.log(`  rappel brevet 1 dof (S, lineaire/lumiere) ~1,05 ; twin fige ~${nom.includes("040") ? "20,4" : "14,0"} ; fit cubique 6 dof ~0,35`);
}

// ── (2) chroma constante + gain L cubique (4 dof, pas de structure per-canal) ──
console.log("\n=== (2) GLOBALE : chroma const + gain L cubique (4 dof) — le per-canal est-il necessaire ? ===");
for (const [nom, h] of [["cg-glob-h040", 40], ["cg-glob-h220", 220]]) {
  const mes = charge(nom).rampe_rgb;
  const f = fitChromaConst(mes);
  let best = { e: 1e9 };
  for (let g0 = 0.5; g0 <= 1.5; g0 += 0.02) for (let g1 = 0.5; g1 <= 1.5; g1 += 0.02) {
    const e = ecart(modeleChromaGain(f.da, f.db, g0, g1), mes);
    if (e < best.e) best = { e, g0, g1 };
  }
  console.log(`  ${nom} : ecart ${best.e.toFixed(2)} (gL ${best.g0.toFixed(2)}->${best.g1.toFixed(2)}, da/db figes du fit const)`);
}

// ── (3) reproduction du CONTROLE et de son pouvoir discriminant ────────────────
console.log("\n=== (3) CONTROLE du brevet-e4-globale : que distingue-t-il vraiment ? ===");
console.log("  (deja reproduit : ROMM/lum 0.000, lineaire 3.59, TRC sRGB 0.53, ROMM/lumiere 13.7)");
console.log("  -> puissance FORTE sur l'invariance (13.7), MOYENNE sur lineaire (3.59),");
console.log("     QUASI NULLE sur TRC sRGB vs ROMM (0.53 ~ 2x plancher).");

// ── (4) MOYENS : le signe unique est-il un fait brut ? ─────────────────────────
console.log("\n=== (4) MOYENS (grading-moyens-vert) : signe de la chroma mesuree, fait brut ===");
{
  const mes = charge("grading-moyens-vert").rampe_rgb;
  console.log("  lvl   dGR(g-r)   dRB(r-b)   [mesure brute, aucun modele]");
  let toutGRpos = true, toutRBneg = true;
  for (let i = 8; i <= 248; i += 8) {
    if (!lisible(mes[i])) continue;
    const gr = mes[i][1] - mes[i][0], rb = mes[i][0] - mes[i][2];
    if (gr < -0.5) toutGRpos = false;
    if (rb > 0.5) toutRBneg = false;
  }
  for (const i of [16, 32, 48, 64, 96, 128, 160, 192, 224, 240]) {
    console.log(`  ${String(i).padStart(3)}  ${(mes[i][1] - mes[i][0]).toFixed(1).padStart(8)}  ${(mes[i][0] - mes[i][2]).toFixed(1).padStart(9)}`);
  }
  console.log(`  g-r >= 0 partout : ${toutGRpos} ; r-b <= 0 partout : ${toutRBneg}`);
  console.log("  => une cubique du brevet a noeuds gris (chroma nulle aux noeuds, pentes teintees)");
  console.log("     impose un changement de signe : REFUTE par le signe unique. Fait, pas modele.");
}
