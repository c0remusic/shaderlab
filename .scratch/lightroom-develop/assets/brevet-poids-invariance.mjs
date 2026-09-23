// QUELS POIDS DE LUMINANCE LES ONZE DIRECTIONS IMPOSENT-ELLES ?
//
// brevet-directions.mjs : une fois la composante grise retiree, la direction du
// virage suit le motif HSL de ProPhoto a 1,80 degre pres sur onze teintes. Tout
// l'ecart restant est dans la composante GRISE, c'est-a-dire dans l'invariance.
// Y ProPhoto la rend sur huit teintes sur onze et rate les jaunes (40 a 90).
//
// Si l'invariance est LINEAIRE (w . ecart = 0, le brevet la note ainsi), alors les
// onze directions mesurees contraignent w a deux degres de liberte. Moindres
// carres sur w (normalise a somme 1) : si un w unique tient les onze teintes, on
// le lit ; s'il n'en existe pas, l'invariance n'est pas lineaire — ou autre chose
// que l'invariance agit sur les jaunes (une borne de pente, par exemple).
import { s2l, ap, SRGB_VERS_PP, PP_VERS_SRGB, PP_XYZ, SRGB_XYZ65, motif, charge, lisible } from "./brevet-commun.mjs";

const norme = (v) => Math.hypot(v[0], v[1], v[2]);
const unit = (v) => { const n = norme(v); return v.map((c) => c / n); };

function direction(rampe, h) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 6; i <= 250; i++) {
    if (!lisible(rampe[i])) continue;
    const x = s2l(i / 255);
    const pp = ap(SRGB_VERS_PP, rampe[i].map((c) => s2l(c / 255)));
    const d = pp.map((v) => (v - x) / Math.sqrt(x));
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b];
  }
  let v = [1, 0.3, -0.5];
  for (let k = 0; k < 200; k++) v = unit(ap(C, v));
  // Orientation : la composante chromatique doit pointer vers le motif de la teinte.
  const p = motif(h), pm = (p[0] + p[1] + p[2]) / 3, vm = (v[0] + v[1] + v[2]) / 3;
  const dot = (p[0] - pm) * (v[0] - vm) + (p[1] - pm) * (v[1] - vm) + (p[2] - pm) * (v[2] - vm);
  return dot < 0 ? v.map((c) => -c) : v;
}

const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];
const D = TEINTES.map((t) => [t, direction(charge(`st-h${String(t).padStart(3, "0")}`).rampe_rgb, t)]);

function residus(w) { return D.map(([, v]) => w[0] * v[0] + w[1] * v[1] + w[2] * v[2]); }
function ajuste(sousEnsemble) {
  // w = (a, b, 1 - a - b) ; w . v = a (v0 - v2) + b (v1 - v2) + v2 = 0.
  let aa = 0, ab = 0, bb = 0, ay = 0, by = 0;
  for (const [t, v] of D) {
    if (!sousEnsemble.includes(t)) continue;
    const x1 = v[0] - v[2], x2 = v[1] - v[2], y = -v[2];
    aa += x1 * x1; ab += x1 * x2; bb += x2 * x2; ay += x1 * y; by += x2 * y;
  }
  const det = aa * bb - ab * ab;
  const a = (ay * bb - by * ab) / det, b = (aa * by - ab * ay) / det;
  return [a, b, 1 - a - b];
}
const fmt = (w) => "[" + w.map((c) => c.toFixed(4)).join(", ") + "]";
const imprime = (nom, w) => {
  const r = residus(w);
  console.log("%s w = %s", nom.padEnd(40), fmt(w));
  console.log("    w . direction :" + r.map((x, k) => ` h${String(TEINTES[k]).padStart(3, "0")} ${x.toFixed(3).padStart(6)}`).join(""));
};

imprime("Y ProPhoto (D50)", PP_XYZ[1]);
imprime("Y D65 des primaires ProPhoto", ap([[0, 0, 0], [0, 0, 0], [0, 0, 0]].map((_, i) => PP_VERS_SRGB.map((l) => l[i])), SRGB_XYZ65[1]));
imprime("ajuste sur les ONZE", ajuste(TEINTES));
imprime("ajuste SANS les jaunes (40-90)", ajuste(TEINTES.filter((t) => t < 40 || t > 90)));
imprime("ajuste sur les SEULS jaunes (40-90)", ajuste([40, 60, 90]));
