// LA CLE `ColorGradeGlobalHue` EST-ELLE HONOREE PAR LIGHTROOM ?
//
// CE QUI REND LA QUESTION NECESSAIRE. colorGradingTable.ts documente une panne de
// PLOMBERIE trouvee sur piece : les teintes Ombres / Hautes lumieres du Color
// Grading vivent sous les cles HERITEES `SplitToningShadow*` / `SplitToningHighlight*`,
// et `ColorGradeShadowHue` / `ColorGradeHighlightHue` sont IGNOREES — les exports
// rendent une rampe de gris strictement neutre. Deux autres cles `ColorGrade*`
// fonctionnent pourtant (`ColorGradeMidtoneHue` via grading-moyens-vert,
// `ColorGradeGlobalLum` via grading-global-lum-p50). On ne peut donc pas deduire
// le sort de `ColorGradeGlobalHue` : il se mesure.
//
// POURQUOI ÇA DECIDE DE LA CAMPAGNE A. campagne-a-couverture.mjs chiffre, sur le
// twin, le nombre de niveaux ou un angle de teinte se lit : 102 pour la forme
// actuelle (roue des ombres seule), 218 avec `SplitToningBalance=-100`, et 245
// pour la roue GLOBALE. Le twin est d'accord avec Lightroom a 5 niveaux pres sur
// les deux formes deja mesurees. Si la cle globale est honoree, la campagne A doit
// etre ecrite avec elle.
//
// LA MESURE DISPONIBLE. `grading2-global-bleu` existe au disque. Elle est exclue
// des treize parce que sa base n'est pas l'identite mais `temoin2` — d'autres
// reglages y sont actifs. Pour une question d'ANGLE ça ne disqualifie pas : on
// SOUSTRAIT la chroma de la base et on lit le vecteur ajoute.
import { readFileSync } from "node:fs";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const angleDe = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const ecartAngle = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

function dirFromHue(hueDeg) {
  const [r, g, b] = hsl2rgb((((hueDeg % 360) + 360) % 360) / 360, 1, 0.5);
  const lab = linearSrgbToOklab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]);
  const c = Math.hypot(lab[1], lab[2]) || 1;
  return [lab[1] / c, lab[2] / c];
}
const lab = (nom) => {
  const rgb = JSON.parse(readFileSync(`${M}/${nom}.json`, "utf8")).rampe_rgb;
  return rgb.map((c) => linearSrgbToOklab([s2l(c[0] / 255), s2l(c[1] / 255), s2l(c[2] / 255)]));
};

const scene = lab("grading2-global-bleu");
const base = lab("temoin2");

// ⚠️ QUELLE TEINTE la scene pose-t-elle ? Le nom dit « bleu ». Les autres scenes
// `grading-*` de teinte posent 220 (ombres bleu) et 140 (medians vert), donc 220
// est l'hypothese — mais c'est l'ANGLE MESURE qui compte, pas le nom. On imprime
// les deux et on laisse l'ecart parler.
const TEINTE_SUPPOSEE = 220;
const attendu = dirFromHue(TEINTE_SUPPOSEE);
const angAttendu = angleDe(attendu[0], attendu[1]);

const SEUIL = 0.02;
console.log("La roue GLOBALE ajoute-t-elle une chroma ? (grading2-global-bleu moins temoin2)");
console.log("");
console.log("  niv | chroma base  chroma scene | chroma AJOUTEE   angle ajoute");
console.log("".padEnd(74, "-"));
const lus = [];
for (let n = 0; n <= 255; n++) {
  const da = scene[n][1] - base[n][1], db = scene[n][2] - base[n][2];
  const c = Math.hypot(da, db);
  if (c >= SEUIL) lus.push([n, angleDe(da, db), c]);
}
for (const n of [8, 32, 64, 96, 128, 160, 190, 220, 240]) {
  const da = scene[n][1] - base[n][1], db = scene[n][2] - base[n][2];
  const c = Math.hypot(da, db);
  console.log("  %s | %s %s | %s %s",
    String(n).padStart(3),
    Math.hypot(base[n][1], base[n][2]).toFixed(4).padStart(11),
    Math.hypot(scene[n][1], scene[n][2]).toFixed(4).padStart(12),
    c.toFixed(4).padStart(14),
    (c < SEUIL ? "—" : angleDe(da, db).toFixed(1)).padStart(14));
}

console.log("");
if (lus.length === 0) {
  console.log("❌ AUCUN niveau au-dessus du seuil : la cle `ColorGradeGlobalHue` est IGNOREE,");
  console.log("   comme ses voisines Ombres et Hautes lumieres. La campagne A doit donc");
  console.log("   passer par `SplitToningShadowHue` + `SplitToningBalance=-100` (218 niveaux).");
} else {
  let sx = 0, sy = 0;
  for (const [, a, c] of lus) { sx += c * Math.cos(a * Math.PI / 180); sy += c * Math.sin(a * Math.PI / 180); }
  const moyen = angleDe(sx, sy);
  const ecarts = lus.map(([, a]) => ecartAngle(a, moyen));
  const et = Math.sqrt(ecarts.reduce((s, v) => s + v * v, 0) / ecarts.length);
  console.log("✅ %d niveaux lisibles — la cle est HONOREE.", lus.length);
  console.log("   angle moyen %s degres, ecart-type %s", moyen.toFixed(2), et.toFixed(2));
  console.log("   si la teinte posee est %s : calcule %s, ECART %s degres",
    TEINTE_SUPPOSEE, angAttendu.toFixed(2), ecartAngle(moyen, angAttendu).toFixed(2));
  console.log("   (a comparer aux -30,67 mesures sur la meme teinte par st-ombres-bleu)");
}
