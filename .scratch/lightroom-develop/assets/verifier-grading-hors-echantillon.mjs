/**
 * ECART DU MODULE `colorGrading` AUX MESURES LIGHTROOM, **HORS ECHANTILLON**.
 *
 * `verifier-grading.mjs` compare sur la RAMPE DE GRIS, et c'est sur elle que les
 * constantes s'ajustent. Un ajustement qui ne se valide que sur ce qui l'a produit
 * ne prouve rien : ce script rejoue la comparaison sur les QUATRE BALAYAGES DE
 * TEINTE des memes exports (256 teintes a saturation 100 % / L 50 %, a saturation
 * 50 %, et les deux balayages sombres / clairs a L 25 % et 75 %), qui n'ont servi a
 * ajuster aucune constante.
 *
 *   node .scratch/lightroom-develop/assets/verifier-grading-hors-echantillon.mjs
 *
 * METHODE. Le plugin n'exporte pas les pixels bruts mais un profil deja reduit :
 * `[teinte_entree, teinte_sortie, saturation, luminance]` en HLS. On RECONSTRUIT
 * donc la couleur de sortie de Lightroom depuis son profil, et on applique le twin
 * a la couleur d'entree ideale `HLS(teinte_entree, S, L)` — meme convention que
 * `comparer-lightroom.py` pour le module HSL. Ecart par CANAL en niveaux 0..255.
 *
 * ⚠️ DEUX LIMITES MESUREES, et la seconde a deja fait conclure a l'envers.
 *
 * 1. Le passage par HLS coute de la precision. PLANCHER mesure en passant le
 *    TEMOIN (identite) dans le meme aller-retour : 1,08 niveau sur `balayage`,
 *    0,61 / 0,69 / 0,63 sur les trois autres. Les chiffres absolus sont donc plus
 *    gros que ceux de la rampe ; ils ne se comparent qu'entre eux.
 *
 * 2. **100 % des entrees de `balayage` et de `balayage_l75` ont deja un canal a
 *    1,0** (HLS saturation 1 : a L 0,5 comme a L 0,75, le canal dominant vaut 1).
 *    Elever la luminance y sort du gamut PAR CONSTRUCTION, donc sur ces deux-la on
 *    compare deux politiques d'ecretage, pas deux formes de poids. Les deux
 *    balayages informatifs sur un changement de LUMINANCE sont `balayage_sat50` et
 *    `balayage_l25` (0 % d'entrees saturees). Un verdict rendu sur le total a deja
 *    fait rejeter un changement qui gagnait partout ailleurs — lire le detail par
 *    balayage avant de conclure.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import url from "node:url";

const RACINE = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../../..");
const MESURES = path.join(RACINE, ".scratch/lightroom-develop/research/mesures");

const dossier = mkdtempSync(path.join(tmpdir(), "cg-hors-"));
const bundle = path.join(dossier, "colorGrading.mjs");
execFileSync(process.execPath, [
  path.join(RACINE, "node_modules/esbuild/bin/esbuild"),
  "--bundle", path.join(RACINE, "src/render/effects/colorGrading.ts"),
  "--format=esm", `--outfile=${bundle}`, "--platform=node", "--log-level=warning",
], { stdio: "inherit" });
const { colorGradingSpec } = await import(url.pathToFileURL(bundle).href);

const charge = (nom) => JSON.parse(readFileSync(path.join(MESURES, `${nom}.json`), "utf8"));
const versLineaire = (s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
const versNiveau = (v) => { const c = Math.min(1, Math.max(0, v)); return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055); };

// HLS -> RGB 0..1, meme convention que colorsys (h en degres).
const hlsVersRgb = (hDeg, l, s) => {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const m1 = 2 * l - m2;
  const canal = (t) => {
    let u = t; if (u < 0) u += 1; if (u > 1) u -= 1;
    if (u < 1 / 6) return m1 + (m2 - m1) * 6 * u;
    if (u < 0.5) return m2;
    if (u < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - u) * 6;
    return m1;
  };
  return [canal(h + 1 / 3), canal(h), canal(h - 1 / 3)];
};

const reglages = (o = {}) => {
  const d = {
    shHue: 0, shSat: 0, shLum: 0, mHue: 0, mSat: 0, mLum: 0,
    hHue: 0, hSat: 0, hLum: 0, gHue: 0, gSat: 0, gLum: 0, blending: 50, balance: 0, ...o,
  };
  return [d.shHue, d.shSat, d.shLum, d.mHue, d.mSat, d.mLum,
    d.hHue, d.hSat, d.hLum, d.gHue, d.gSat, d.gLum, d.blending, d.balance];
};

const duo = { shHue: 220, shSat: 60, hHue: 40, hSat: 60 };
const SCENES = [
  ["st-ombres-bleu", reglages({ shHue: 220, shSat: 60 })],
  ["st-hl-orange", reglages({ hHue: 40, hSat: 60 })],
  ["st-duo", reglages(duo)],
  ["st-balance-p100", reglages({ ...duo, balance: 100 })],
  ["st-balance-m100", reglages({ ...duo, balance: -100 })],
  ["cg-fusion-0", reglages({ ...duo, blending: 0 })],
  ["cg-fusion-100", reglages({ ...duo, blending: 100 })],
  ["cg-hl-lum-p50", reglages({ hLum: 50 })],
  ["cg-moyens-lum-p50", reglages({ mLum: 50 })],
  ["cg-ombres-lum-p50", reglages({ shLum: 50 })],
  ["cg-ombres-lum-m50", reglages({ shLum: -50 })],
  ["grading-moyens-vert", reglages({ mHue: 140, mSat: 60 })],
  ["grading-global-lum-p50", reglages({ gLum: 50 })],
];

// Les quatre balayages, avec la saturation et la luminance D'ENTREE de chacun.
const BALAYAGES = [
  ["balayage", 1.0, 0.5],
  ["balayage_sat50", 0.5, 0.5],
  ["balayage_l25", 1.0, 0.25],
  ["balayage_l75", 1.0, 0.75],
];

let total = 0, n = 0, pire = 0, pireNom = "";
for (const [nom, p] of SCENES) {
  const mesure = charge(nom);
  let somme = 0, compte = 0, max = 0;
  for (const [champ, sEntree, lEntree] of BALAYAGES) {
    for (const [hEntree, hSortie, sSortie, lSortie] of mesure[champ]) {
      const entree = hlsVersRgb(hEntree, lEntree, sEntree).map(versLineaire);
      const nous = colorGradingSpec(entree, p);
      const lr = hlsVersRgb(hSortie, lSortie, sSortie);
      for (let c = 0; c < 3; c++) {
        const ecart = Math.abs(versNiveau(nous[c]) - lr[c] * 255);
        somme += ecart; compte++;
        if (ecart > max) max = ecart;
      }
    }
  }
  const moyenne = somme / compte;
  total += moyenne; n++;
  if (max > pire) { pire = max; pireNom = nom; }
  console.log(`${nom.padEnd(24)} moyenne ${moyenne.toFixed(2).padStart(6)}   max ${max.toFixed(1).padStart(6)}`);
}
console.log(`\nHORS ECHANTILLON, ${n} scenes x 1024 teintes : ${(total / n).toFixed(2)} niveaux — pire cas ${pire.toFixed(1)} (${pireNom})`);
