// LA BALANCE, LUE SANS INVERSER QUOI QUE CE SOIT.
//
// LA TENTATIVE PRECEDENTE ET POURQUOI ELLE EST JETEE. `balance-partage.mjs`
// resolvait le systeme 2x2 « chroma de sortie = chromaK·sat·(dSh·ws + dH·wh) »
// pour extraire les deux poids. Son controle — relire les poids du TWIN sur la
// sortie du TWIN — l'a refuse : ecart 0,21 sur ws et 0,44 sur wh, alors que la
// reponse est connue exactement. Deux causes, chacune suffisante :
//   1. `clipGamut` reduit la chroma APRES le melange, donc la chroma de sortie
//      n'est plus la somme ponderee des deux roues ;
//   2. les deux teintes du duo (bleu 220, orange 40) sont a 170,6 degres l'une de
//      l'autre : conditionnement 12,2, donc la quantification 8 bits de +-0,5
//      niveau ressort a +-6,1 sur les poids.
// ⚠️ Le determinant valait 0,163 et avait l'air sain : pour deux vecteurs
// unitaires il vaut sin(angle), donc il reste gros quand les directions sont
// presque OPPOSEES. C'est le conditionnement qu'il fallait regarder.
//
// CE SCRIPT N'INVERSE RIEN. Il compare la chroma MESUREE a la chroma du TWIN, en
// MODULE et en ANGLE. L'angle dit quelle roue domine — donc le partage — et le
// module dit la force. Les deux sont des lectures directes : pas de systeme, pas
// de conditionnement, et `clipGamut` s'applique des deux cotes puisque le twin
// passe par le meme code.
import { readFileSync } from "node:fs";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer.ts";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function dirFromHue(hueDeg) {
  const [r, g, b] = hsl2rgb((((hueDeg % 360) + 360) % 360) / 360, 1, 0.5);
  const lab = linearSrgbToOklab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]);
  const c = Math.hypot(lab[1], lab[2]) || 1;
  return [lab[1] / c, lab[2] / c];
}
const dSh = dirFromHue(220), dH = dirFromHue(40);
const angleDe = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const angSh = angleDe(dSh[0], dSh[1]), angH = angleDe(dH[0], dH[1]);

/** Chroma (module, angle) d'une couleur lineaire. */
function chroma(rgbLin) {
  const lab = linearSrgbToOklab(rgbLin);
  return [Math.hypot(lab[1], lab[2]), angleDe(lab[1], lab[2])];
}
/** Ecart d'angle signe, ramene dans [-180, 180]. */
const ecartAngle = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

/** « Part des hautes lumieres » : 0 = teinte des ombres pure, 1 = celle des hautes.
 *  Une lecture d'ANGLE, donc insensible a l'amplitude et a l'ecretage de gamut. */
function partHautes(ang) {
  const total = ecartAngle(angH, angSh);
  const depuisOmbres = ecartAngle(ang, angSh);
  return depuisOmbres / total;
}

const p = (bal) => [220, 60, 0, 0, 0, 0, 40, 60, 0, 0, 0, 0, 50, bal];

console.log("teinte des OMBRES (220) a %s degres, des HAUTES (40) a %s degres en OKLab.",
  angSh.toFixed(1), angH.toFixed(1));
console.log("« part hautes » : 0 = la teinte des ombres seule, 1 = celle des hautes seule.");
console.log("");

for (const [nom, bal] of [["st-duo", 0], ["st-balance-p100", 100], ["st-balance-m100", -100]]) {
  const rgb = JSON.parse(readFileSync(`${M}/${nom}.json`, "utf8")).rampe_rgb;
  console.log("=== %s ===", nom);
  console.log("  niv | chroma mes.  chroma svc | part hautes mes.   svc |  ecart de part");
  console.log("".padEnd(82, "-"));
  const partMes = [], partSvc = [];
  for (let n = 0; n <= 255; n++) {
    const lin = s2l(n / 255);
    const [cm, am] = chroma([s2l(rgb[n][0] / 255), s2l(rgb[n][1] / 255), s2l(rgb[n][2] / 255)]);
    const [cs, as] = chroma(colorGradingSpec([lin, lin, lin], p(bal)));
    // Sous une chroma trop faible l'angle est du bruit : on ne lit pas.
    partMes.push(cm < 0.004 ? null : partHautes(am));
    partSvc.push(cs < 0.004 ? null : partHautes(as));
  }
  for (const n of [8, 24, 48, 64, 96, 128, 160, 190, 220, 240]) {
    const lin = s2l(n / 255);
    const [cm] = chroma([s2l(rgb[n][0] / 255), s2l(rgb[n][1] / 255), s2l(rgb[n][2] / 255)]);
    const [cs] = chroma(colorGradingSpec([lin, lin, lin], p(bal)));
    const a = partMes[n], b = partSvc[n];
    console.log("  %s | %s %s | %s %s | %s",
      String(n).padStart(3),
      cm.toFixed(4).padStart(11), cs.toFixed(4).padStart(11),
      (a === null ? "—" : a.toFixed(3)).padStart(16), (b === null ? "—" : b.toFixed(3)).padStart(7),
      (a === null || b === null ? "—" : (b - a >= 0 ? "+" : "") + (b - a).toFixed(3)).padStart(15));
  }
  // Le CROISEMENT : le niveau ou la part vaut 0,5 — les deux roues a egalite.
  // C'est exactement ce que la table dit avoir calibre.
  const croise = (t) => {
    for (let n = 1; n <= 255; n++) {
      if (t[n - 1] === null || t[n] === null) continue;
      if ((t[n - 1] - 0.5) * (t[n] - 0.5) <= 0) return n;
    }
    return null;
  };
  console.log("  croisement (part = 0,5) : mesure au niveau %s, en service au niveau %s",
    croise(partMes), croise(partSvc));
  console.log("");
}
