// LA BORNE INFERIEURE QUE H4 N'A PAS — AUCUN GAMUT RGB NE PEUT-IL FAIRE MIEUX ?
//
// CE QUI EST CONTESTE. loi-h4-espaces.mjs conclut « le residu n'est PAS un choix
// d'espace mal devine », en s'appuyant sur 28 candidates a zero parametre dont
// aucune n'atteint le bruit. Sa propre limite le dit : « un classement par ecart
// moyen ne prouve pas qu'une famille non testee ne ferait pas mieux : il n'y a
// pas de borne inferieure ici, seulement 28 candidats. »
//
// 28 echantillons d'un espace continu ne bornent rien. La question se tranche en
// OPTIMISANT sur la famille entiere au lieu de l'echantillonner : si le MEILLEUR
// gamut RGB possible — primaires libres, six degres de liberte — laisse encore un
// residu de l'ordre de 5 degres, alors la conclusion est PROUVEE et non seulement
// non refutee. S'il descend au bruit, elle est FAUSSE et le bon espace existe.
//
// ⚠️ UN OPTIMISEUR QUI NE RETROUVE PAS UNE REPONSE CONNUE NE PROUVE RIEN. Le
// controle vient donc AVANT le resultat : on genere des mesures sous un gamut
// CHOISI et on verifie que l'optimiseur le retrouve. S'il echoue la, son verdict
// sur les vraies mesures est sans valeur.
import { readFileSync } from "node:fs";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer.ts";

const M = process.env.MESURES ?? ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const ecartAngle = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const SEUIL = 0.02;
const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];

const mv = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
const mm = (a, b) => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
function inv(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}
const diag = (v) => [[v[0], 0, 0], [0, v[1], 0], [0, 0, v[2]]];
const xyToXYZ = ([x, y]) => [x / y, 1, (1 - x - y) / y];
function rgbVersXyz(prim, blancXy) {
  const W = xyToXYZ(blancXy);
  const Mp = [0, 1, 2].map((l) => prim.map((p) => xyToXYZ(p)[l]));
  const Mi = inv(Mp);
  if (!Mi) return null;
  return mm(Mp, diag(mv(Mi, W)));
}
const PRIM = {
  srgb:     [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]],
  prophoto: [[0.734699, 0.265301], [0.159597, 0.840403], [0.036598, 0.000105]],
  rec2020:  [[0.708, 0.292], [0.170, 0.797], [0.131, 0.046]],
};
const D65 = [0.3127, 0.3290];
const XYZ_D65_VERS_SRGB_LIN = inv(rgbVersXyz(PRIM.srgb, D65));

/** L'angle OKLab de la teinte h, si la roue est posee sur un gamut de primaires
 *  `prim` (point blanc D65, lineaire). C'est EXACTEMENT la forme des familles
 *  lineaires de H4 — seules les primaires bougent. */
function angleDe(prim) {
  const Mx = rgbVersXyz(prim, D65);
  if (!Mx) return null;
  const Mfin = mm(XYZ_D65_VERS_SRGB_LIN, Mx);
  return (h) => {
    const rgb = hsl2rgb((((h % 360) + 360) % 360) / 360, 1, 0.5);
    const lab = linearSrgbToOklab(mv(Mfin, rgb));
    return deg(lab[1], lab[2]);
  };
}
const aplatis = (p) => [p[0][0], p[0][1], p[1][0], p[1][1], p[2][0], p[2][1]];
const gonfle = (v) => [[v[0], v[1]], [v[2], v[3]], [v[4], v[5]]];

// ── LECTURE DES MESURES, instrument de H4 a la ligne pres ───────────────────
const nonEcrete = (p) => Math.min(...p) > 0.5 && Math.max(...p) < 254.5;
function lireRampe(rampe, filtre = () => true) {
  const lus = [];
  for (let n = 0; n <= 255; n++) {
    const p = rampe[n];
    const lab = linearSrgbToOklab([s2l(p[0] / 255), s2l(p[1] / 255), s2l(p[2] / 255)]);
    const c = Math.hypot(lab[1], lab[2]);
    if (c < SEUIL || !filtre(p)) continue;
    lus.push([deg(lab[1], lab[2]), c]);
  }
  if (lus.length < 20) return null;
  let sx = 0, sy = 0;
  for (const [a, c] of lus) { sx += c * Math.cos((a * Math.PI) / 180); sy += c * Math.sin((a * Math.PI) / 180); }
  return deg(sx, sy);
}
const mesures = {}, mesuresPropres = {};
for (const t of TEINTES) {
  const r = JSON.parse(readFileSync(`${M}/st-h${String(t).padStart(3, "0")}.json`, "utf8")).rampe_rgb;
  mesures[t] = lireRampe(r);
  mesuresPropres[t] = lireRampe(r, nonEcrete);
}

/** Cout = ecart moyen absolu entre la mesure et le modele a primaires `v`.
 *  ⚠️ La borne sur y doit laisser passer ProPhoto, dont le BLEU est a
 *  y = 0,000105. Une premiere version bornait a y > 0,0005 et murait donc le
 *  gamut de reference hors de l'espace de recherche : le controle « retrouve-t-il
 *  ProPhoto ? » echouait, et la comparaison au premier de H4 rendait 1e6. */
function cout(v, obs, teintes = TEINTES) {
  const prim = gonfle(v);
  for (const [x, y] of prim) if (!(y > 1e-6) || !isFinite(x) || !isFinite(y) || x < -0.6 || x > 1.6 || y > 1.6) return 1e6;
  const f = angleDe(prim);
  if (!f) return 1e6;
  let s = 0, n = 0;
  for (const t of teintes) {
    if (obs[t] === null || obs[t] === undefined) continue;
    const a = f(t);
    if (!isFinite(a)) return 1e6;
    s += Math.abs(ecartAngle(obs[t], a)); n++;
  }
  return n ? s / n : 1e6;
}

// ── NELDER-MEAD ─────────────────────────────────────────────────────────────
function nelderMead(f, x0, pas, iters = 4000) {
  const n = x0.length;
  let simplexe = [x0.slice()];
  for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += pas[i]; simplexe.push(p); }
  let val = simplexe.map(f);
  for (let it = 0; it < iters; it++) {
    const ordre = val.map((v, i) => i).sort((a, b) => val[a] - val[b]);
    simplexe = ordre.map((i) => simplexe[i]); val = ordre.map((i) => val[i]);
    const centre = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) centre[k] += simplexe[i][k] / n;
    const pire = simplexe[n];
    const refl = centre.map((c, k) => c + (c - pire[k]));
    const vr = f(refl);
    if (vr < val[0]) {
      const exp = centre.map((c, k) => c + 2 * (c - pire[k]));
      const ve = f(exp);
      if (ve < vr) { simplexe[n] = exp; val[n] = ve; } else { simplexe[n] = refl; val[n] = vr; }
    } else if (vr < val[n - 1]) { simplexe[n] = refl; val[n] = vr; }
    else {
      const con = centre.map((c, k) => c + 0.5 * (pire[k] - c));
      const vc = f(con);
      if (vc < val[n]) { simplexe[n] = con; val[n] = vc; }
      else for (let i = 1; i <= n; i++) { simplexe[i] = simplexe[i].map((x, k) => simplexe[0][k] + 0.5 * (x - simplexe[0][k])); val[i] = f(simplexe[i]); }
    }
  }
  const best = val.map((v, i) => i).sort((a, b) => val[a] - val[b])[0];
  return { x: simplexe[best], v: val[best] };
}
/** Optimise avec des redemarrages aleatoires — un seul depart ne borne rien. */
function optimise(obs, graine = 12345, essais = 140, teintes = TEINTES) {
  let rng = graine;
  const rand = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };
  let best = null;
  const departs = [aplatis(PRIM.srgb), aplatis(PRIM.prophoto), aplatis(PRIM.rec2020)];
  for (let e = 0; e < essais; e++) {
    const x0 = e < departs.length ? departs[e].slice()
      : aplatis(PRIM.prophoto).map((x) => x + (rand() - 0.5) * 0.9);
    const r = nelderMead((v) => cout(v, obs, teintes), x0, new Array(6).fill(0.06));
    if (!best || r.v < best.v) best = r;
  }
  return best;
}

console.log("BORNE INFERIEURE — LE MEILLEUR GAMUT RGB POSSIBLE");
console.log("");
console.log("Famille examinee : « la teinte est une couleur SATUREE posee sur un gamut RGB,");
console.log("en LINEAIRE, lue en OKLab » — exactement la forme des familles D/H/K/O/P/M/N/F");
console.log("de H4. Les 28 candidates de H4 en sont des ECHANTILLONS ; ici on optimise sur");
console.log("la famille entiere, six degres de liberte (les trois primaires en xy).");
console.log("");

// ── CONTROLE : L'OPTIMISEUR RETROUVE-T-IL UN GAMUT CONNU ? ──────────────────
console.log("CONTROLE — l'optimiseur retrouve-t-il un gamut CONNU ?");
console.log("");
console.log("On fabrique des mesures parfaites sous un gamut choisi, puis on lance");
console.log("l'optimiseur dessus. S'il ne le retrouve pas, son verdict plus bas ne vaut rien.");
console.log("");
console.log("gamut genere     residu atteint   angle max d'ecart au vrai gamut   verdict");
console.log("".padEnd(92, "-"));
let controleOk = true;
for (const nom of ["srgb", "prophoto", "rec2020"]) {
  const vrai = angleDe(PRIM[nom]);
  const faux = {};
  for (const t of TEINTES) faux[t] = vrai(t);
  const r = optimise(faux, 999, 40);
  const f = angleDe(gonfle(r.x));
  let pire = 0;
  for (const t of TEINTES) pire = Math.max(pire, Math.abs(ecartAngle(f(t), vrai(t))));
  const ok = r.v < 0.05 && pire < 0.5;
  if (!ok) controleOk = false;
  console.log("%s %s %s   %s", nom.padEnd(16), r.v.toFixed(4).padStart(14), pire.toFixed(4).padStart(33),
    ok ? "OK — retrouve" : "RATE");
}
console.log("");
console.log(controleOk
  ? "✅ L'optimiseur retrouve chaque gamut genere. Son verdict ci-dessous est licite."
  : "⚠️ L'optimiseur NE retrouve PAS un gamut connu — ne rien conclure de la suite.");

// ── LE VERDICT SUR LES VRAIES MESURES ───────────────────────────────────────
for (const [etiquette, obs] of [["TOUS LES NIVEAUX (la mesure de H4)", mesures], ["NIVEAUX NON ECRETES", mesuresPropres]]) {
  console.log("");
  console.log("");
  console.log("MEILLEUR GAMUT SUR LES VRAIES MESURES — %s", etiquette);
  console.log("");
  const r = optimise(obs);
  const prim = gonfle(r.x);
  const f = angleDe(prim);
  console.log("  primaires trouvees :  R (%s, %s)   V (%s, %s)   B (%s, %s)",
    prim[0][0].toFixed(4), prim[0][1].toFixed(4), prim[1][0].toFixed(4), prim[1][1].toFixed(4),
    prim[2][0].toFixed(4), prim[2][1].toFixed(4));
  console.log("  pour memoire, ProPhoto :  R (0.7347, 0.2653)   V (0.1596, 0.8404)   B (0.0366, 0.0001)");
  console.log("");
  console.log("  ECART MOYEN DU MEILLEUR GAMUT POSSIBLE : %s deg", r.v.toFixed(2));
  console.log("  ProPhoto D50/Bradford lineaire (le premier de H4) : %s deg",
    cout(aplatis(PRIM.prophoto), obs).toFixed(2));
  console.log("");
  console.log("  residu par teinte :");
  console.log("    teinte %s", TEINTES.map((t) => String(t).padStart(7)).join(""));
  console.log("    residu %s", TEINTES.map((t) => {
    if (obs[t] === null) return "—".padStart(7);
    const d = ecartAngle(obs[t], f(t));
    return ((d >= 0 ? "+" : "") + d.toFixed(1)).padStart(7);
  }).join(""));
  console.log("");
  // ── VALIDATION CROISEE — six parametres sur onze points ACHETENT du residu ──
  console.log("  VALIDATION CROISEE LEAVE-ONE-OUT");
  console.log("");
  console.log("  Six parametres libres pour onze points : un residu en baisse ne prouve rien");
  console.log("  par lui-meme. On refait donc l'ajustement ONZE fois, chaque fois en retirant");
  console.log("  une teinte, et on lit l'erreur sur la teinte RETIREE — celle-la n'a pas paye");
  console.log("  de parametre. Si elle reste basse, la famille explique vraiment la mesure ;");
  console.log("  si elle explose, l'ajustement ne faisait qu'epouser le bruit.");
  console.log("");
  console.log("    teinte  erreur HORS echantillon");
  console.log("    " + "".padEnd(34, "-"));
  const horsEch = [];
  for (const tOut of TEINTES) {
    if (obs[tOut] === null) continue;
    const reste = TEINTES.filter((t) => t !== tOut);
    const rr = optimise(obs, 4242, 60, reste);
    const ff = angleDe(gonfle(rr.x));
    const e = Math.abs(ecartAngle(obs[tOut], ff(tOut)));
    horsEch.push(e);
    console.log("    %s %s", String(tOut).padStart(6), e.toFixed(2).padStart(23));
  }
  const moyHors = horsEch.reduce((s, x) => s + x, 0) / horsEch.length;
  const medHors = [...horsEch].sort((a, b) => a - b)[Math.floor(horsEch.length / 2)];
  console.log("    " + "".padEnd(34, "-"));
  console.log("    moyenne HORS echantillon : %s deg   (mediane %s)", moyHors.toFixed(2), medHors.toFixed(2));
  console.log("    pour memoire, dans l'echantillon : %s deg ; ProPhoto a 0 parametre : %s deg",
    r.v.toFixed(2), cout(aplatis(PRIM.prophoto), obs).toFixed(2));
  console.log("");
  if (moyHors < 3.0) {
    console.log("  ⚠️ LA FAMILLE TIENT HORS ECHANTILLON : un gamut RGB EXPLIQUE la mesure, et");
    console.log("     la conclusion « le residu n'est pas un choix d'espace » est FAUSSE.");
  } else if (r.v < 3.0) {
    console.log("  L'ajustement descend au bruit DANS l'echantillon (%s deg) et n'y tient PAS",
      r.v.toFixed(2));
    console.log("  dehors (%s deg) : les six parametres epousaient le bruit. La famille des",
      moyHors.toFixed(2));
    console.log("  gamuts RGB n'explique donc pas la mesure, et la conclusion de H4 TIENT —");
    console.log("  mais elle tient pour cette raison-la, qui est une borne, pas parce que");
    console.log("  28 echantillons auraient suffi a le dire.");
  } else {
    console.log("  Ni dans l'echantillon ni dehors : aucun gamut RGB ne descend au bruit.");
    console.log("  C'est une BORNE sur la famille entiere, pas un classement de 28 candidats.");
  }
}
