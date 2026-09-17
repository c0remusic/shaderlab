// ABLATION des deux bandes de Texture, un facteur a la fois, sur la photo.
//
// Deux corrections ont echoue d'affilee sur la meme piece, toutes deux posees
// sur la MEME deduction non verifiee : que la tranchee sombre vient de la bande
// MOYENNE. Trier ce qui est cher est convaincant et ne prouve rien ; seule une
// ablation designe une cause (CLAUDE.md, lecon du cout du verre).
//
// Trois rendus : les deux bandes, la fine seule, la moyenne seule.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const TABLE = "C:/dev/shaderlab/src/render/effects/reglagesDeBaseTable.ts";
const ASSETS = "C:/dev/shaderlab/.scratch/lightroom-develop/assets";
const SP = "C:/Users/LEETJ/AppData/Local/Temp/claude/C--dev-shaderlab/5cd8e3ee-e6ce-40b9-9de5-528e15ea775a/scratchpad";
const origine = readFileSync(TABLE, "utf-8");
const FIN = /textureFin: [\d.]+,/;
const MOYEN = /textureMoyen: [\d.]+,/;
const finOrig = origine.match(FIN)[0];
const moyenOrig = origine.match(MOYEN)[0];

const CAS = [
  { nom: "deux-bandes", table: origine },
  { nom: "fine-seule", table: origine.replace(MOYEN, "textureMoyen: 0,") },
  { nom: "moyenne-seule", table: origine.replace(FIN, "textureFin: 0,") },
];

try {
  for (const cas of CAS) {
    writeFileSync(TABLE, cas.table);
    await new Promise((r) => setTimeout(r, 3000));
    execFileSync("node", [`${ASSETS}/photo-texture-rendu.mjs`], { cwd: ASSETS, stdio: "pipe" });
    for (const crop of ["petale"]) {
      for (const dose of ["ph-temoin", "ph-texture-p100"]) {
        const src = `${SP}/nous-${dose}-${crop}.png`;
        writeFileSync(`${SP}/abl-${cas.nom}-${dose}-${crop}.png`, readFileSync(src));
      }
    }
    console.log("rendu :", cas.nom);
  }
} finally {
  writeFileSync(TABLE, origine);
  console.log("table remise :", finOrig, moyenOrig);
}
