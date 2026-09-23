// E3 — LA BALANCE EST UNE CARTE HOMOGRAPHIQUE SUR L'ABSCISSE (divMap)
//
// Le binaire porte balanceMapAlpha, parametre 'a' de cr_div_map
//   f(x, a) = a x / (a x + 1 - x),  clouee en 0 et 1.
// Hypothese : le duo est UNE cubique du brevet (s0 = teinte ombres, s1 = teinte
// hautes), son abscisse remappee par f(., a). Le croisement (ombres = hautes) d'une
// cubique clouee symetrique est a x' = 0,5, donc au niveau ou f(x,a) = 0,5, soit
//   x = 1/(1+a)  ->  niveau = 255/(1+a).
// Donc a = (255 - croisement)/croisement. On MESURE le croisement (angle, insensible
// a l'amplitude et a l'ecretage : research/21), on en tire 'a', et on lit la loi a(balance).
//
// CONTROLE : une rampe duo fabriquee par cubique + divMap a un 'a' connu doit rendre
// ce meme 'a' par l'extracteur de croisement.
import { s2l, l2s, ap, SRGB_VERS_PP, PP_VERS_SRGB, PP_XYZ, oklab, pentes, hermite, charge, lisible } from "./brevet-commun.mjs";

const labDe = (rgbNiv) => oklab(rgbNiv.map((c) => s2l(c / 255)));
const ab = (rgbNiv) => { const l = labDe(rgbNiv); return [l[1], l[2]]; };
const norme2 = (v) => Math.hypot(v[0], v[1]);
const unit2 = (v) => { const n = norme2(v); return n > 0 ? [v[0] / n, v[1] / n] : [0, 0]; };

/** Direction OKLab-chroma d'une roue simple : moyenne ponderee par la chroma. */
function directionRoue(rampe) {
  let a = 0, b = 0;
  for (let i = 6; i <= 250; i++) { if (!lisible(rampe[i])) continue; const [x, y] = ab(rampe[i]); const w = Math.hypot(x, y); a += w * x; b += w * y; }
  return unit2([a, b]);
}
/** Croisement : niveau ou proj(u_sh) = proj(u_hl) sur la chroma OKLab du duo. */
function croisement(rampe, uSh, uHl) {
  const diff = [uSh[0] - uHl[0], uSh[1] - uHl[1]];
  let prev = null;
  for (let i = 6; i <= 252; i++) {
    if (!lisible(rampe[i])) continue;
    const [x, y] = ab(rampe[i]); const m = x * diff[0] + y * diff[1]; // >0 : cote ombres
    if (prev && prev.m > 0 !== m > 0) { const t = prev.m / (prev.m - m); return prev.i + t * (i - prev.i); }
    prev = { i, m };
  }
  return NaN;
}

// Directions des deux teintes du duo, mesurees sur les scenes a roue unique.
const uSh = directionRoue(charge("st-ombres-bleu").rampe_rgb); // bleu 220
const uHl = directionRoue(charge("st-hl-orange").rampe_rgb);   // orange 40
console.log("directions OKLab mesurees : ombres(220) [%s]  hautes(40) [%s]  angle %s deg",
  uSh.map((v) => v.toFixed(3)).join(","), uHl.map((v) => v.toFixed(3)).join(","),
  ((Math.acos(uSh[0] * uHl[0] + uSh[1] * uHl[1]) * 180) / Math.PI).toFixed(1));

// ── CONTROLE : duo fabrique par cubique + divMap ─────────────────────────────
const divMap = (x, a) => (a * x) / (a * x + 1 - x);
function duoFab(aBal, S = 0.6) {
  const s0 = pentes(220, S, PP_XYZ[1]);          // ombres
  const s1 = pentes(40 + 180, S, PP_XYZ[1]);     // hautes : ordre inverse (h+180) au brevet
  return Array.from({ length: 256 }, (_, i) => {
    const x = divMap(s2l(i / 255), aBal);         // remap en LINEAIRE (choix a eprouver plus bas)
    const pp = [0, 1, 2].map((c) => hermite(x, s0[c], s1[c]));
    return ap(PP_VERS_SRGB, pp).map((v) => 255 * l2s(Math.max(0, Math.min(1, v))));
  });
}
console.log("");
console.log("CONTROLE — croisement d'un duo fabrique (divMap en lineaire), a connu -> a retrouve");
for (const a of [0.2, 0.5, 1, 2, 5]) {
  const r = duoFab(a); const c = croisement(r, uSh, uHl);
  console.log("  a=%s  croisement niveau %s  => a_lu=(255-c)/c=%s", String(a).padStart(4), c.toFixed(1), ((255 - c) / c).toFixed(3));
}

// ── MESURES ──────────────────────────────────────────────────────────────────
console.log("");
console.log("MESURES — croisement du duo aux cinq balances, et 'a' = (255-c)/c");
const BAL = [["st-balance-m100", -100], ["st-balance-m50", -50], ["st-duo", 0], ["st-balance-p50", 50], ["st-balance-p100", 100]];
const pts = [];
for (const [nom, b] of BAL) {
  const r = charge(nom)?.rampe_rgb; if (!r) continue;
  const c = croisement(r, uSh, uHl); const a = (255 - c) / c;
  pts.push([b, c, a]);
  console.log("  balance %s  croisement %s  a=%s  log2(a)=%s", String(b).padStart(5), c.toFixed(1), a.toFixed(3), (Math.log2(a)).toFixed(3));
}
// Loi a(balance) : lineaire en niveau (c = c0 + k b) vs geometrique en a (log2 a = m b + p)
{
  const n = pts.length;
  const sb = pts.reduce((s, p) => s + p[0], 0), sc = pts.reduce((s, p) => s + p[1], 0);
  const sbb = pts.reduce((s, p) => s + p[0] * p[0], 0), sbc = pts.reduce((s, p) => s + p[0] * p[1], 0);
  const k = (n * sbc - sb * sc) / (n * sbb - sb * sb), c0 = (sc - k * sb) / n;
  const la = pts.map((p) => Math.log2(p[2]));
  const sla = la.reduce((s, v) => s + v, 0), sbla = pts.reduce((s, p, i) => s + p[0] * la[i], 0);
  const m = (n * sbla - sb * sla) / (n * sbb - sb * sb), p0 = (sla - m * sb) / n;
  console.log("");
  console.log("  loi 1 : croisement lineaire en balance   c = %s %s . balance   (R2 %s)", c0.toFixed(2), k.toFixed(3), r2(pts.map((p) => p[1]), pts.map((p) => c0 + k * p[0])).toFixed(4));
  console.log("  loi 2 : a geometrique en balance   log2(a) = %s %s . balance -> a = 2^(balance/%s)  (R2 %s)",
    p0.toFixed(3), m.toFixed(4), (1 / m).toFixed(1), r2(la, pts.map((p) => p0 + m * p[0])).toFixed(4));
}
function r2(y, yh) { const my = y.reduce((s, v) => s + v, 0) / y.length; const ss = y.reduce((s, v) => s + (v - my) ** 2, 0); const sr = y.reduce((s, v, i) => s + (v - yh[i]) ** 2, 0); return 1 - sr / ss; }

// ── DECIDER : le duo cubique + divMap reproduit-il les rampes en niveaux sRGB ? ──
// On calibre la seule amplitude (saturation effective) et l'espace du remap sur st-duo,
// puis on JUGE sur les quatre autres balances. divMap en niveau sRGB vs lineaire.
console.log("");
console.log("RECONSTRUCTION du duo par cubique+divMap, ecart en niveaux sRGB (3 canaux, niveaux lisibles)");
for (const espace of ["lineaire", "niveau sRGB"]) {
  for (const S of [0.6]) {
    let ligne = ("  divMap en " + espace + ", S=" + S).padEnd(34);
    for (const [nom, b] of BAL) {
      const r = charge(nom)?.rampe_rgb; if (!r) continue;
      const a = 2 ** (b / -31.5); // a<1 quand balance<0 ; calibre plus bas si besoin
      const e = ecartDuo(r, a, S, espace);
      ligne += (nom.replace("st-balance-", "b").replace("st-duo", "b0") + ":" + e.toFixed(2)).padStart(13);
    }
    console.log(ligne);
  }
}
function ecartDuo(rampe, a, S, espace) {
  const s0 = pentes(220, S, PP_XYZ[1]), s1 = pentes(40 + 180, S, PP_XYZ[1]);
  let som = 0, n = 0;
  for (let i = 3; i <= 252; i++) {
    if (!lisible(rampe[i])) continue;
    let x = espace === "lineaire" ? s2l(i / 255) : i / 255;
    x = (a * x) / (a * x + 1 - x);
    const lin = espace === "lineaire" ? x : s2l(x); // ramene en lineaire pour la cubique
    // cubique appliquee dans l'espace du remap :
    const base = espace === "lineaire" ? s2l(i / 255) : s2l(i / 255);
    void base; void lin;
    const pp = [0, 1, 2].map((c) => hermite(espace === "lineaire" ? x : x, s0[c], s1[c]));
    const out = ap(PP_VERS_SRGB, espace === "lineaire" ? pp : pp).map((v) => 255 * l2s(Math.max(0, Math.min(1, v))));
    for (let c = 0; c < 3; c++) som += Math.abs(out[c] - rampe[i][c]); n++;
  }
  return som / n;
}
