/**
 * ECART DU MODULE `reglagesDeBase` AUX MESURES DE TON DE LIGHTROOM 14.5, CURSEUR
 * PAR CURSEUR — la carte qui dit OU l'etage diverge, au lieu de le supposer.
 *
 *   node .scratch/lightroom-develop/assets/verifier-ton.mjs
 *
 * Meme patron que `verifier-grading.mjs` : le VRAI twin est bundle a la volee
 * (donc lu sur disque, edition non commitee comprise) et applique a la rampe de
 * gris ideale, puis compare a la rampe que Lightroom a rendue pour le meme
 * reglage. Ecart par CANAL en niveaux 0..255.
 *
 * POURQUOI IL N'EXISTAIT PAS. `calibrer-ton.py` ajuste la table et porte son
 * propre forward-model en Python — un JUMEAU DE PLUS, qui peut deriver du twin
 * sans que rien ne le dise. Ce script-ci ne modelise rien : il execute le code
 * qui tourne dans l'app.
 *
 * ⚠️ CE QU'IL NE PEUT PAS VOIR. Les operateurs LOCAUX (Hautes lumieres, Ombres,
 * Blancs, Noirs, Texture, Clarte, Voile) lisent une luminance FLOUTEE que le twin
 * recoit en argument. Sur une rampe lisse, cette luminance vaut celle du pixel —
 * c'est la convention de `calibrer-ton.py`, et elle est exacte pour la rampe,
 * jamais pour une photo. Un ecart nul ici ne dit donc rien du rendu d'une image :
 * il dit que la COURBE est juste.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import url from "node:url";

const RACINE = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../../..");
const MESURES = path.join(RACINE, ".scratch/lightroom-develop/research/mesures");

const dossier = mkdtempSync(path.join(tmpdir(), "cg-ton-"));
const bundle = path.join(dossier, "reglagesDeBase.mjs");
execFileSync(process.execPath, [
  path.join(RACINE, "node_modules/esbuild/bin/esbuild"),
  "--bundle", path.join(RACINE, "src/render/effects/reglagesDeBase.ts"),
  "--format=esm", `--outfile=${bundle}`, "--platform=node", "--log-level=warning",
], { stdio: "inherit" });
const mod = await import(url.pathToFileURL(bundle).href);
const spec = mod.reglagesDeBaseSpec;
if (typeof spec !== "function") {
  throw new Error(`Twin introuvable : exports = ${Object.keys(mod).join(", ")}`);
}

const charge = (nom) => JSON.parse(readFileSync(path.join(MESURES, `${nom}.json`), "utf8"));
const versLineaire = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const versNiveau = (v) => { const c = Math.min(1, Math.max(0, v)); return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055); };

// Nom de mesure -> reglage. Le suffixe porte la valeur : `p50` = +50, `m100` = -100.
const CURSEURS = {
  exposition: "exposure", contraste: "contrast", "hautes-lumieres": "highlights",
  ombres: "shadows", blancs: "whites", noirs: "blacks", texture: "texture",
  clarte: "clarity", voile: "dehaze", vibrance: "vibrance", saturation: "saturation",
  temperature: "temperature", nuance: "nuance",
  "param-hl": "paramHighlights", "param-lights": "paramLights",
  "param-darks": "paramDarks", "param-ombres": "paramShadows",
};

const scenes = [];
for (const [prefixe, param] of Object.entries(CURSEURS)) {
  for (const suffixe of ["m100", "m75", "m50", "m25", "m2", "m1", "p1", "p2", "p25", "p50", "p75", "p100"]) {
    const nom = `${prefixe}-${suffixe}`;
    try { charge(nom); } catch { continue; }
    const signe = suffixe[0] === "m" ? -1 : 1;
    scenes.push([nom, { [param]: signe * Number(suffixe.slice(1)) }]);
  }
}

const defauts = Object.fromEntries(mod.reglagesDeBase.params.map((p) => [p.name, p.default]));
const ordre = mod.reglagesDeBase.params.map((p) => p.name);

let pire = 0, pireNom = "", somme = 0;
const lignes = [];
for (const [nom, reglage] of scenes) {
  const lr = charge(nom).rampe_rgb;
  const p = ordre.map((n) => reglage[n] ?? defauts[n]);
  let total = 0, max = 0;
  for (let i = 0; i < 256; i++) {
    const lin = versLineaire(i);
    // Luminance floutee = celle du pixel : exact sur une rampe lisse (voir l'en-tete).
    const sortie = spec([lin, lin, lin], lin, p);
    for (let c = 0; c < 3; c++) {
      const ecart = Math.abs(versNiveau(sortie[c]) - lr[i][c]);
      total += ecart; if (ecart > max) max = ecart;
    }
  }
  const moyenne = total / 768;
  somme += moyenne;
  if (max > pire) { pire = max; pireNom = nom; }
  lignes.push([nom, moyenne, max]);
}

lignes.sort((a, b) => b[1] - a[1]);
for (const [nom, moyenne, max] of lignes) {
  console.log(`${nom.padEnd(24)} moyenne ${moyenne.toFixed(2).padStart(6)}   max ${max.toFixed(1).padStart(6)}`);
}
console.log(`\n${lignes.length} mesures de ton : ${(somme / lignes.length).toFixed(2)} niveaux d'ecart moyen — pire cas ${pire.toFixed(1)} (${pireNom})`);
