// E1 REFUTATION — l'explorateur n'a teste dans le hue-spread que des luminances
// LINEAIRES et des lumieres HSL. Le brief nomme explicitement « invariance calculee
// dans un codage (gamma 1,8, TRC sRGB) », que l'explorateur a REJETE par un argument
// non mesure (« la pente max du jaune vaut 1 en Y-preservant, donc ^gamma la laisse
// a 1 »). Une luminance en canaux ENCODES w . enc(pp) n'est PAS une transformee
// monotone d'une luminance lineaire (contrairement a L* de CIELAB, qui l'est) : c'est
// le seul type de grandeur genuinement neuf pour le spread. On l'AJOUTE.
//
// CONTROLE (celui qui manquait) : une rampe fabriquee en conservant une luminance
// ENCODEE doit etre designee par cette candidate au plancher de quantification. Si
// oui, l'instrument a de la PUISSANCE pour ce type de reponse — et si aucune candidate
// encodee ne gagne sur la MESURE alors que le controle prouve qu'elle le pourrait, le
// « partiel » de l'explorateur tient plus fort.
import { s2l, l2s, niveau, ap, SRGB_VERS_PP, PP_VERS_SRGB, PP_XYZ, SRGB_XYZ65, motif, oklab, charge, lisible } from "./brevet-commun.mjs";

const pp = (lin) => ap(SRGB_VERS_PP, lin);
const dot = (w, v) => w[0] * v[0] + w[1] * v[1] + w[2] * v[2];
const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
const encSrgb = (v) => Math.sign(v) * l2s(Math.abs(v));
const decSrgb = (v) => Math.sign(v) * s2l(Math.abs(v));

// Un codage : code (lineaire -> encode) et decode. gamma g ou TRC sRGB.
const CODAGES = {
  lin: { code: (v) => v, dec: (v) => v },
  g18: { code: (v) => spow(v, 1 / 1.8), dec: (v) => spow(v, 1.8) },
  g22: { code: (v) => spow(v, 1 / 2.2), dec: (v) => spow(v, 2.2) },
  srgb: { code: encSrgb, dec: decSrgb },
};

// Candidate : sRGB LINEAIRE -> scalaire croissant sur le gris. w agit sur les canaux
// ProPhoto ENCODES (sauf Rec709, qui agit sur sRGB lineaire, et OKLab L).
function candProPhoto(w, cod) {
  const c = CODAGES[cod];
  return (l) => dot(w, pp(l).map(c.code));
}
const PPY = PP_XYZ[1];
const REC601 = [0.299, 0.587, 0.114];
const WFIT = [0.314, 0.580, 0.106];
const CANDIDATES = [
  ["Y ProPhoto lin", candProPhoto(PPY, "lin")],
  ["Rec601 PP lin", candProPhoto(REC601, "lin")],
  ["w'-fit PP lin", candProPhoto(WFIT, "lin")],
  ["Y Rec709 lin (sRGB)", (l) => dot(SRGB_XYZ65[1], l)],
  ["Y PP gamma1.8 (encode)", candProPhoto(PPY, "g18")],
  ["Y PP gamma2.2 (encode)", candProPhoto(PPY, "g22")],
  ["Y PP TRC sRGB (Melissa)", candProPhoto(PPY, "srgb")],
  ["Rec601 PP gamma1.8", candProPhoto(REC601, "g18")],
  ["Rec601 PP TRC sRGB", candProPhoto(REC601, "srgb")],
  ["CIELAB L* (~Y PP, temoin)", (l) => { const Y = dot(PPY, pp(l)); return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y; }],
  ["OKLab L (twin)", (l) => oklab(l)[0]],
];

function equiv(f, val) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (f([m, m, m]) < val) lo = m; else hi = m; }
  return 255 * l2s((lo + hi) / 2);
}

const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];
const NIV = [8, 16, 24, 32, 48, 64, 96, 128, 160, 192, 224];

function spread(scenes) {
  return CANDIDATES.map(([, f]) => {
    let sStd = 0, sMoy = 0, nStd = 0;
    for (const n of NIV) {
      const ec = [];
      for (const { rampe } of scenes) {
        if (!lisible(rampe[n])) continue;
        ec.push(equiv(f, f(rampe[n].map((c) => s2l(c / 255)))) - n);
      }
      if (ec.length < 6) continue;
      const moy = ec.reduce((a, b) => a + b, 0) / ec.length;
      const varr = ec.reduce((a, b) => a + (b - moy) ** 2, 0) / ec.length;
      sStd += Math.sqrt(varr); sMoy += moy; nStd++;
    }
    return { std: sStd / nStd, moy: sMoy / nStd };
  });
}

function imprime(titre, scenes) {
  console.log("\n" + titre);
  const r = spread(scenes);
  const best = r.reduce((b, v, k) => (v.std < r[b].std ? k : b), 0);
  console.log("candidate".padEnd(30) + "spread(std)".padStart(12) + "biais(moy)".padStart(12));
  r.forEach((v, k) => console.log(CANDIDATES[k][0].padEnd(30) + ((k === best ? "*" : " ") + v.std.toFixed(3)).padStart(12) + v.moy.toFixed(2).padStart(12)));
}

// ── CONTROLE : fabriquer des rampes conservant une luminance ENCODEE w.enc(pp) ──
// Pour un gris x, pp(gris)=gris, donc cible = (Sigma w) * code(x). En canaux encodes
// e = m + d*motif, S=(M-m)/(M+m), w.e = cible : d = cible/(q*Sigma_w + w.motif), m=q*d.
// Puis decode -> pp lineaire -> sRGB lineaire -> niveau. La rampe conserve w.enc(pp).
const quant = (lin) => lin.map((v) => Math.round(niveau(v) * 100) / 100);
function rampeCodee(h, S, w, cod) {
  const c = CODAGES[cod], mo = motif(h), q = (1 - S) / (2 * S);
  const sw = w[0] + w[1] + w[2], wm = dot(w, mo);
  return Array.from({ length: 256 }, (_, i) => {
    const x = s2l(i / 255);
    const cible = sw * c.code(x);
    const d = cible / (q * sw + wm), m = q * d;
    const e = mo.map((p) => m + d * p);
    return quant(ap(PP_VERS_SRGB, e.map(c.dec)));
  });
}
imprime("CONTROLE C — rampes conservant Y PP gamma1.8 (doit designer 'Y PP gamma1.8')",
  TEINTES.map((h) => ({ h, rampe: rampeCodee(h, 0.6, PPY, "g18") })));
imprime("CONTROLE D — rampes conservant Y PP TRC sRGB (doit designer 'Y PP TRC sRGB')",
  TEINTES.map((h) => ({ h, rampe: rampeCodee(h, 0.6, PPY, "srgb") })));

// ── MESURES ────────────────────────────────────────────────────────────────
imprime("MESURES LIGHTROOM — st-h* (spread minimal = grandeur conservee)",
  TEINTES.map((h) => ({ h, rampe: charge(`st-h${String(h).padStart(3, "0")}`).rampe_rgb })));

// ── PROFILS par niveau (regle du brief : imprimer des profils, pas des scalaires) ──
// equiv-error par teinte pour les deux meilleures candidates lineaires vs une encodee.
console.log("\nPROFIL equiv-error (niveaux sRGB) par teinte, au niveau 32 et 64 — 3 candidates");
const scenes = TEINTES.map((h) => ({ h, rampe: charge(`st-h${String(h).padStart(3, "0")}`).rampe_rgb }));
for (const [nom, f] of [CANDIDATES[0], CANDIDATES[2], CANDIDATES[4]]) {
  const ligne = (n) => TEINTES.map((h, k) => {
    const r = scenes[k].rampe[n];
    return lisible(r) ? (equiv(f, f(r.map((c) => s2l(c / 255)))) - n).toFixed(1).padStart(6) : "   .  ";
  }).join("");
  console.log("  " + nom.padEnd(26) + " n32" + ligne(32));
  console.log("  " + "".padEnd(26) + " n64" + ligne(64));
}
console.log("  teintes:" + " ".repeat(23) + TEINTES.map((h) => String(h).padStart(6)).join(""));
