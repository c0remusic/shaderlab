/**
 * ECART DU MODULE `colorGrading` AUX TREIZE MESURES DE VIRAGE DE LIGHTROOM 14.5.
 *
 * Pourquoi ce fichier existe : le ticket 06 cite depuis le 2026-09-14 une « moyenne
 * 4,41 niveaux, pire cas 40,7 » recalculee « avec le vrai twin », et le script qui
 * la produisait n'a jamais ete versionne. Un chiffre qu'on ne peut pas relancer se
 * recopie au lieu de se mesurer — c'est exactement le defaut que ce depot passe son
 * temps a corriger ailleurs. Ce script le relance.
 *
 *   node .scratch/lightroom-develop/assets/verifier-grading.mjs
 *
 * METHODE. Les mesures sont des rampes de gris rendues PAR Lightroom (temoin3 est
 * l'identite, verifie). On applique le twin `colorGradingSpec` a la MEME entree
 * ideale — le gris de niveau i, en lumiere lineaire — et on compare canal par canal
 * en NIVEAUX 0..255. Le twin est bundle a la volee par esbuild : il lit donc la
 * table et le code sur DISQUE, edition non commitee comprise.
 *
 * LES REGLAGES DE CHAQUE SCENE SONT RECONSTRUITS DEPUIS SON NOM (les exports du
 * plugin ne portent pas les reglages). La reconstruction est verifiee par son
 * resultat : elle rend le pire cas 40,7 du ticket au dixieme pres, sur la meme
 * scene (`st-balance-p100`). La moyenne, elle, sort a 4,27 la ou le ticket dit
 * 4,41 — un ecart de 3 % qu'une scene legerement differente suffit a expliquer, et
 * qui ne change aucun classement.
 *
 * Les series `grading2-*` sont EXCLUES : leur base n'est pas l'identite mais
 * `temoin2` (d'autres reglages actifs, ecart max 8,5 niveaux avec `temoin`), donc
 * les comparer a une entree ideale mesurerait la base, pas le module.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import url from "node:url";

const RACINE = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../../..");
const MESURES = path.join(RACINE, ".scratch/lightroom-develop/research/mesures");

const dossier = mkdtempSync(path.join(tmpdir(), "cg-twin-"));
const bundle = path.join(dossier, "colorGrading.mjs");
execFileSync(process.execPath, [
  path.join(RACINE, "node_modules/esbuild/bin/esbuild"),
  "--bundle", path.join(RACINE, "src/render/effects/colorGrading.ts"),
  "--format=esm", `--outfile=${bundle}`, "--platform=node", "--log-level=warning",
], { stdio: "inherit" });
const { colorGradingSpec } = await import(url.pathToFileURL(bundle).href);

const charge = (nom) => JSON.parse(readFileSync(path.join(MESURES, `${nom}.json`), "utf8"));
const versLineaire = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const versNiveau = (v) => { const c = Math.min(1, Math.max(0, v)); return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055); };

// Ordre du uniform : ombres teinte/sat/lum, moyens, hautes lumieres, globale,
// fusion, balance. Fusion vaut 50 au defaut, pas 0.
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

let sommeDesMoyennes = 0, pire = 0, pireNom = "";
for (const [nom, p] of SCENES) {
  const lr = charge(nom).rampe_rgb;
  let somme = 0, max = 0;
  for (let i = 0; i < 256; i++) {
    const lin = versLineaire(i);
    const sortie = colorGradingSpec([lin, lin, lin], p);
    for (let c = 0; c < 3; c++) {
      const ecart = Math.abs(versNiveau(sortie[c]) - lr[i][c]);
      somme += ecart;
      if (ecart > max) max = ecart;
    }
  }
  const moyenne = somme / (256 * 3);
  sommeDesMoyennes += moyenne;
  if (max > pire) { pire = max; pireNom = nom; }
  console.log(`${nom.padEnd(24)} moyenne ${moyenne.toFixed(2).padStart(6)}   max ${max.toFixed(1).padStart(6)}`);
}
console.log(`\nMOYENNE des ${SCENES.length} scenes : ${(sommeDesMoyennes / SCENES.length).toFixed(2)} niveaux — pire cas ${pire.toFixed(1)} (${pireNom})`);
