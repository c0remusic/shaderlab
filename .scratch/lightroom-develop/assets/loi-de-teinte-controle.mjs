// L'INSTRUMENT DISCRIMINE-T-IL ? Controle de `loi-de-teinte.mjs` sur des mesures
// SYNTHETIQUES dont la loi est connue.
//
// POURQUOI AVANT LES DONNEES. `loi-de-teinte.mjs` classera cinq familles par
// ecart moyen. Un classement rend toujours un premier — et rien ne garantit que
// ce premier soit la bonne reponse plutot que le hasard sur des familles trop
// proches. La question se tranche MAINTENANT, pendant que la course tourne :
// on fabrique onze rampes sous une loi CHOISIE, on lance le lecteur dessus, et on
// regarde s'il la retrouve. Une fois par loi candidate : c'est une matrice de
// confusion.
//
// ⚠️ SI L'INSTRUMENT NE DISCRIMINE PAS, LA CAMPAGNE NE TRANCHERA RIEN — et il vaut
// mieux le savoir avant d'avoir les exports que pendant leur lecture, ou la
// tentation de retenir le premier du classement sera forte.
//
// CE QUI EST SIMULE, ET CE QUI NE L'EST PAS. On genere la chroma directement en
// OKLab : pour chaque niveau, une direction (celle de la loi testee) et une
// amplitude decroissante qui imite le poids des ombres a Balance -100. La
// QUANTIFICATION 8 bits est appliquee, parce que c'est elle qui borne la precision
// des vraies mesures. Ce qui n'est PAS simule : l'ecretage de gamut, le bruit
// JPEG, et une eventuelle derive de l'angle avec le niveau. L'instrument est donc
// teste dans des conditions PLUS FAVORABLES que le reel — s'il echoue ici, il
// echouera la-bas.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { oklabToLinearSrgb, linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear, linearToSrgb } from "../../../src/render/effects/srgbTransfer.ts";

const DOSSIER = "C:/Users/LEETJ/AppData/Local/Temp/claude/C--dev-shaderlab/5cd8e3ee-e6ce-40b9-9de5-528e15ea775a/scratchpad/mesures-synthetiques";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;

// Les memes familles que le lecteur — recopiees ici EXPRES : si le lecteur les
// importait de ce fichier, le controle testerait sa propre copie au lieu de la
// sienne, et un desaccord entre les deux passerait inapercu.
function angleSrgbHsl(h) {
  const [r, g, b] = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5);
  const lab = linearSrgbToOklab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]);
  return deg(lab[1], lab[2]);
}
const PROPHOTO_VERS_XYZ = [
  [0.7976749, 0.1351917, 0.0313534],
  [0.2880402, 0.7118741, 0.0000857],
  [0.0000000, 0.0000000, 0.8252100],
];
const XYZ_VERS_SRGB = [
  [3.1338561, -1.6168667, -0.4906146],
  [-0.9787684, 1.9161415, 0.0334540],
  [0.0719453, -0.2289914, 1.4052427],
];
const applique = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
function angleProPhoto(h) {
  const rgb = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5).map((c) => Math.pow(c, 1.8));
  return deg(...linearSrgbToOklab(applique(XYZ_VERS_SRGB, applique(PROPHOTO_VERS_XYZ, rgb))).slice(1));
}
function angleProPhotoLineaire(h) {
  const rgb = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5);
  return deg(...linearSrgbToOklab(applique(XYZ_VERS_SRGB, applique(PROPHOTO_VERS_XYZ, rgb))).slice(1));
}
const ZERO = angleSrgbHsl(0);
const angleOklch = (h) => ZERO + h;
const angleRotationVraie = (h) => angleSrgbHsl(h) - 20;

const GENERATRICES = [
  ["A. HSL sur sRGB", angleSrgbHsl],
  ["B. angle direct OKLCh", angleOklch],
  ["C. ProPhoto RGB (gamma 1,8)", angleProPhoto],
  ["D. ProPhoto lineaire", angleProPhotoLineaire],
  ["E. rotation constante -20 deg", angleRotationVraie],
];
const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];

/** Amplitude de chroma par niveau : imite le poids des ombres a Balance -100 —
 *  haute en bas, qui s'eteint vers le blanc. Calee pour depasser le seuil de
 *  lecture (0,02) sur environ 215 niveaux, comme le twin le predit. */
const amplitude = (n) => 0.085 * Math.exp(-Math.pow(n / 255, 2.2) * 2.6);

function fabrique(teinte, angleDe) {
  const a = (angleDe(teinte) * Math.PI) / 180;
  const rampe_rgb = [];
  for (let n = 0; n <= 255; n++) {
    const lin = s2l(n / 255);
    const L = Math.cbrt(lin);
    const c = amplitude(n);
    const rgb = oklabToLinearSrgb([L, c * Math.cos(a), c * Math.sin(a)]);
    // QUANTIFICATION 8 bits — c'est elle qui borne la precision du reel.
    rampe_rgb.push(rgb.map((v) => Math.round(linearToSrgb(Math.max(0, Math.min(1, v))) * 255)));
  }
  return { nom: "synthetique", rampe_rgb };
}

console.log("MATRICE DE CONFUSION — genere sous une loi, classe par le lecteur.");
console.log("");
console.log("loi generatrice                 -> designee par le lecteur         ecart   2e");
console.log("".padEnd(94, "-"));

let bonnes = 0;
for (const [nomGen, genAngle] of GENERATRICES) {
  rmSync(DOSSIER, { recursive: true, force: true });
  mkdirSync(DOSSIER, { recursive: true });
  for (const t of TEINTES) {
    const nom = `st-h${String(t).padStart(3, "0")}`;
    writeFileSync(`${DOSSIER}/${nom}.json`, JSON.stringify(fabrique(t, genAngle)));
  }
  const sortie = execFileSync("npx", ["tsx", ".scratch/lightroom-develop/assets/loi-de-teinte.mjs"], {
    encoding: "utf8", env: { ...process.env, MESURES: DOSSIER }, shell: true, stdio: ["ignore", "pipe", "ignore"],
  });
  // Les lignes du classement suivent l'en-tete « famille ... ecart moyen ».
  const lignes = sortie.split("\n");
  const i = lignes.findIndex((l) => l.startsWith("famille "));
  const classement = lignes.slice(i + 2).filter((l) => /^[A-E]\. /.test(l.trim()));
  // ⚠️ NE PAS ancrer sur une largeur de colonne. Une premiere version lisait
  // `^(.{40})\s+(\d+)\s+([\d.]+)`, et le libelle de la famille E — qui porte son
  // `k` ajuste — depasse 40 caracteres : la ligne n'etait pas lue, le controle
  // annonçait « RATE » et concluait que l'instrument ne discriminait pas. C'etait
  // le CONTROLE qui etait faux, pas l'instrument. On lit les deux derniers
  // nombres de la ligne, et le libelle est ce qui precede.
  const lire = (l) => {
    const m = l.match(/^(.*?)\s+(\d+)\s+([\d.]+)\s+\d+\s+a\s+[\d.]+\s*deg\s*$/);
    return m ? { nom: m[1].trim(), ecart: parseFloat(m[3]) } : null;
  };
  const premier = lire(classement[0]), second = lire(classement[1]);
  const juste = premier && premier.nom[0] === nomGen[0];
  if (juste) bonnes++;
  console.log("%s %s %s %s %s",
    nomGen.padEnd(31),
    (juste ? "OK  " : "RATE").padEnd(5),
    (premier ? premier.nom : "?").padEnd(32),
    (premier ? premier.ecart.toFixed(2) : "—").padStart(7),
    second ? `${second.nom[0]} a ${second.ecart.toFixed(2)}` : "—");
}
rmSync(DOSSIER, { recursive: true, force: true });

console.log("");
console.log("%d sur %d retrouvees.", bonnes, GENERATRICES.length);
if (bonnes === GENERATRICES.length) {
  console.log("✅ L'instrument DISCRIMINE : chaque loi generatrice se retrouve en tete,");
  console.log("   et l'ecart au second dit de combien. La campagne pourra trancher.");
} else {
  console.log("⚠️ L'instrument NE DISCRIMINE PAS TOUJOURS. Les familles confondues sont");
  console.log("   trop proches sur ces onze teintes — le classement rendra un premier");
  console.log("   qui ne prouvera rien, et il faudra un autre discriminant.");
}
