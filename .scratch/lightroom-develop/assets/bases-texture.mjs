// Mesure les DEUX BANDES de Texture SEPAREMENT, dans le pipeline reel, portail
// compris. L'ajustement precedent supposait un portail constant ; il ne l'est
// pas, puisqu'il lit la variance de la pyramide, qui depend de la periode. La
// seule facon honnete de caler les deux poids est donc de mesurer chaque bande
// telle qu'elle se comporte, puis de resoudre.
//
// Usage : node bases-texture.mjs   (restaure la table quoi qu'il arrive)
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const TABLE = "C:/dev/shaderlab/src/render/effects/reglagesDeBaseTable.ts";
const ASSETS = "C:/dev/shaderlab/.scratch/lightroom-develop/assets";
const origine = readFileSync(TABLE, "utf-8");

const pose = (fin, moyen) =>
  origine.replace(/textureFin: [\d.]+,/, `textureFin: ${fin},`)
         .replace(/textureMoyen: [\d.]+,/, `textureMoyen: ${moyen},`);

async function mesure(fin, moyen) {
  writeFileSync(TABLE, pose(fin, moyen));
  let derniere;
  for (let essai = 0; essai < 4; essai++) {
    // Vite doit re-transformer le module avant que l'iframe le redemande.
    await new Promise((r) => setTimeout(r, 3000));
    try {
      execFileSync("node", [`${ASSETS}/mesure-presence-shaderlab.mjs`], { cwd: ASSETS, stdio: "pipe" });
      const j = JSON.parse(readFileSync(`${ASSETS}/presence-shaderlab.json`, "utf-8"));
      const ech = (d) => d.bandes.filter((b) => b.zone === "echelle");
      const t = ech(j["pres-temoin"]), m = ech(j["pres-texture-p100"]);
      return m.map((b, i) => b.amp / t[i].amp - 1);
    } catch (e) { derniere = e; }
  }
  throw derniere;
}

try {
  const fine = await mesure(1, 0);
  const moyenne = await mesure(0, 1);
  const LR = [1.746, 1.696, 1.637, 1.586, 1.535, 1.513, 1.491, 1.497, 1.454, 1.374, 1.261, 1.203, 1.149, 1.120]
    .map((g) => g - 1);
  // Moindres carres a deux inconnues, resolu a la main (matrice 2x2).
  const s11 = fine.reduce((a, v) => a + v * v, 0);
  const s22 = moyenne.reduce((a, v) => a + v * v, 0);
  const s12 = fine.reduce((a, v, i) => a + v * moyenne[i], 0);
  const b1 = fine.reduce((a, v, i) => a + v * LR[i], 0);
  const b2 = moyenne.reduce((a, v, i) => a + v * LR[i], 0);
  const det = s11 * s22 - s12 * s12;
  const a1 = (b1 * s22 - b2 * s12) / det;
  const a2 = (s11 * b2 - s12 * b1) / det;
  const modele = fine.map((v, i) => a1 * v + a2 * moyenne[i]);
  const err = modele.map((v, i) => Math.abs(v - LR[i]));
  const PER = [3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 98, 128, 186, 256];
  const l = (t, a) => t.padEnd(12) + a.map((v) => v.toFixed(3).padStart(8)).join("");
  console.log(l("periode", PER));
  console.log(l("base fine", fine));
  console.log(l("base moyen", moyenne));
  console.log(l("Lightroom", LR));
  console.log(l("modele", modele));
  console.log(l("ecart", modele.map((v, i) => v - LR[i])));
  console.log(`\npoids fin ${a1.toFixed(3)}, poids moyen ${a2.toFixed(3)}`);
  console.log(`ecart moyen ${(err.reduce((a, v) => a + v, 0) / err.length).toFixed(4)}, pire ${Math.max(...err).toFixed(4)}`);
} finally {
  writeFileSync(TABLE, origine);
  console.log("table remise a son etat d'origine");
}
