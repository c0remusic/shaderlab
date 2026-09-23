// L'ANOMALIE DE LA TEINTE 220 EST-ELLE DANS LIGHTROOM, OU DANS MA FAMILLE ?
//
// CE QUE LE WORKFLOW A ETABLI. Sur 28 familles d'espace a zero parametre,
// ProPhoto lineaire reste premiere a 5,00 degres, et la teinte 220 porte a elle
// seule 21,3 de ces degres — 47 % du residu total. Sans elle, les dix autres font
// 2,37, DANS le bruit de quantification (1,28-2,51). Le chantier n'est donc pas
// « trouver la loi » mais « comprendre ce point ».
//
// LE SOUPÇON, souleve par le refuteur de H1 et non encore eprouve. Ma famille
// ProPhoto calcule la direction en convertissant une couleur ProPhoto SATUREE vers
// le sRGB lineaire, puis en lisant son angle OKLab. A la teinte 220 ce sRGB
// lineaire vaut [-0,549 ; 0,408 ; 1,111] : deux composantes HORS de [0,1], dont une
// NEGATIVE. La composante l du LMS d'OKLab y traverse zero (aux teintes 228,5 et
// 245,8) et la racine cubique a une derivee infinie en zero — d'ou un gain local
// dA/dh de 0,22 a la teinte 220 contre 29,86 a 246.
//
// Autrement dit : le +21,3 compare une mesure a une EXTRAPOLATION prise a 8,5
// degres d'un point de branchement. Si l'angle que ma famille attribue a la teinte
// 220 depend fortement de la SATURATION a laquelle je le calcule, alors la
// « direction de la teinte 220 » n'est pas une quantite bien definie dans cette
// construction, et l'anomalie est la MIENNE.
//
// LE TEST. Une direction de teinte ne doit rien devoir a la saturation qui sert a
// la lire : en desaturant vers le gris, la couleur reste la meme teinte. On calcule
// donc l'angle de chaque teinte a saturations decroissantes et on regarde s'il est
// STABLE. Une teinte dont l'angle bouge en desaturant est une teinte ou la famille
// ne definit pas de direction.
import { readFileSync, existsSync } from "node:fs";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const ecartAngle = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

const PP = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XS = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const ap = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);

/** Direction ProPhoto a saturation `s` : la couleur de teinte h est melangee vers
 *  le gris de meme clarte AVANT conversion. A s = 1 c'est la famille en place. */
function angleProPhotoSat(h, s) {
  const rgb = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5);
  const gris = (rgb[0] + rgb[1] + rgb[2]) / 3;
  const melange = rgb.map((c) => gris + s * (c - gris));
  const lin = ap(XS, ap(PP, melange));
  const lab = linearSrgbToOklab(lin);
  // Le vecteur de chroma, c'est l'ecart au gris — pas la couleur absolue.
  const labGris = linearSrgbToOklab(ap(XS, ap(PP, [gris, gris, gris])));
  return { angle: deg(lab[1] - labGris[1], lab[2] - labGris[2]), lin };
}

const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];
const SATS = [1.0, 0.7, 0.5, 0.3, 0.15, 0.05, 0.01];

console.log("STABILITE DE LA DIRECTION EN DESATURANT — une teinte bien definie ne bouge pas.");
console.log("");
console.log("teinte" + SATS.map((s) => ("s=" + s).padStart(9)).join("") + "   etendue   hors gamut a s=1");
console.log("".padEnd(96, "-"));
const instables = [];
for (const t of TEINTES) {
  const angles = SATS.map((s) => angleProPhotoSat(t, s).angle);
  const ref = angles[angles.length - 1];
  const rel = angles.map((a) => ecartAngle(a, ref));
  const etendue = Math.max(...rel) - Math.min(...rel);
  const lin = angleProPhotoSat(t, 1).lin;
  const hors = lin.filter((v) => v < -1e-6 || v > 1 + 1e-6).length;
  if (etendue > 3) instables.push([t, etendue]);
  console.log("%s%s %s %s",
    String(t).padStart(6),
    angles.map((a) => a.toFixed(2).padStart(9)).join(""),
    etendue.toFixed(2).padStart(9),
    (hors === 0 ? "non" : `${hors} canal/aux`).padStart(18));
}

console.log("");
if (instables.length) {
  console.log("⚠️ INSTABLES (etendue > 3 deg) : %s",
    instables.map(([t, e]) => `${t} a ${e.toFixed(1)} deg`).join(", "));
  console.log("   Pour ces teintes, la famille ne definit PAS de direction : l'angle qu'on");
  console.log("   lui attribue depend de la saturation choisie pour le lire.");
} else {
  console.log("✅ Toutes stables : la direction est bien definie partout, et le residu de la");
  console.log("   teinte 220 est un ecart REEL entre Lightroom et cette famille.");
}

// ── LE RESIDU, RECALCULE A LA LIMITE DESATUREE ──────────────────────────────
// Si la direction infinitesimale (s -> 0) est la bonne definition, le residu
// change. On le mesure au lieu d'en parler.
function mesureAngle(nom) {
  const f = `${M}/${nom}.json`;
  if (!existsSync(f)) return null;
  const rgb = JSON.parse(readFileSync(f, "utf8")).rampe_rgb;
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i <= 255; i++) {
    const lab = linearSrgbToOklab([s2l(rgb[i][0] / 255), s2l(rgb[i][1] / 255), s2l(rgb[i][2] / 255)]);
    const c = Math.hypot(lab[1], lab[2]);
    if (c < 0.02) continue;
    sx += c * Math.cos(Math.atan2(lab[2], lab[1])); sy += c * Math.sin(Math.atan2(lab[2], lab[1])); n++;
  }
  return n < 20 ? null : deg(sx, sy);
}

console.log("");
console.log("RESIDU selon la SATURATION a laquelle la direction est lue :");
console.log("");
console.log("teinte" + SATS.map((s) => ("s=" + s).padStart(9)).join(""));
console.log("".padEnd(69, "-"));
const totaux = SATS.map(() => 0);
let compte = 0;
for (const t of TEINTES) {
  const m = mesureAngle(`st-h${String(t).padStart(3, "0")}`);
  if (m === null) continue;
  compte++;
  const cols = SATS.map((s, i) => {
    const r = ecartAngle(m, angleProPhotoSat(t, s).angle);
    totaux[i] += Math.abs(r);
    return ((r >= 0 ? "+" : "") + r.toFixed(1)).padStart(9);
  });
  console.log("%s%s", String(t).padStart(6), cols.join(""));
}
console.log("".padEnd(69, "-"));
console.log("%s%s", "moyenne".padStart(6), totaux.map((s) => (s / compte).toFixed(2).padStart(9)).join(""));
console.log("");
console.log("⚠️ Si la colonne la plus desaturee bat nettement s=1, la famille en place");
console.log("   lisait sa direction a une saturation ou elle n'est pas definie.");
