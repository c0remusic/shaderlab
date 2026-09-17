// Temps GPU PAR PASSE sur une frame reelle.
//
// Protocole impose par l'instrument : ARMER, puis PROVOQUER un vrai rendu.
// Le rendu est provoque par un reglage de l'etage de developpement, qui commite
// et redemande un rendu — pas par la sonde elle-meme.
//
// ATTENTION : seules les passes passant par runEffectPass sont chronometrees.
// La passe de PRESENTATION ne l'est pas — elle ecrit pourtant 26 Mpx.
//
// Usage : node timing.mjs <module> <param> <valeurDeDepart> [repetitions]
import { setTimeout as dormir } from "node:timers/promises";
import { connecter } from "./cdp.mjs";

const MODULE = process.argv[2] ?? "reglagesDeBase";
const PARAM = process.argv[3] ?? "exposure";
const DEPART = Number(process.argv[4] ?? 1);
const REPETITIONS = Number(process.argv[5] ?? 3);

const c = await connecter();

const rapports = [];
for (let i = 0; i < REPETITIONS; i++) {
  // Valeur differente a chaque tour : une valeur identique pourrait etre
  // court-circuitee en amont et ne rendrait alors aucune frame.
  const v = DEPART + i;
  await c.evaluer(
    "(() => { window.__rapportGpu = null;" +
      " window.__shaderlabDebug.capturerTimingGpu().then(r => { window.__rapportGpu = r; });" +
      " return 'arme'; })()",
  );
  await dormir(80);
  await c.evaluer(
    "window.__shaderlabDebug.reglerDeveloppement(" +
      JSON.stringify(MODULE) + ", { " + PARAM + ": " + v + " })",
  );
  let r = null;
  for (let essai = 0; essai < 80 && !r; essai++) {
    await dormir(100);
    r = await c.evaluer("window.__rapportGpu");
  }
  if (!r) throw new Error("Aucun rapport GPU apres 8 s — la frame a-t-elle ete rendue ?");
  rapports.push(r);
}

const dernier = rapports[rapports.length - 1];
console.log("module=" + MODULE + " param=" + PARAM);
console.log("quantumNs=" + dernier.quantumNs + " droppedPasses=" + dernier.droppedPasses);
console.log("");

// Les passes d'un MEME libelle se distinguent par leur RANG d'encodage : un
// effet a N passes rend N lignes du meme nom. On les indexe pour ne pas
// moyenner la passe 1 avec la passe 9.
const parCle = new Map();
for (const rap of rapports) {
  const vus = new Map();
  for (const p of rap.passes) {
    const n = (vus.get(p.label) ?? 0) + 1;
    vus.set(p.label, n);
    const cle = p.label + "#" + n;
    if (!parCle.has(cle)) parCle.set(cle, []);
    parCle.get(cle).push(p.durationMs);
  }
}
const lignes = [...parCle.entries()].map(([cle, xs]) => ({
  cle,
  mediane: [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)],
  min: Math.min(...xs),
  max: Math.max(...xs),
  n: xs.length,
}));
for (const l of lignes) {
  console.log(
    l.cle.padEnd(34) +
      l.mediane.toFixed(3).padStart(8) + " ms" +
      "   [" + l.min.toFixed(3) + " .. " + l.max.toFixed(3) + "]  n=" + l.n,
  );
}
const totaux = rapports.map((r) => r.totalMs);
console.log("");
console.log("passes par frame : " + rapports.map((r) => r.passes.length).join(" | "));
console.log("total chronometre : " + totaux.map((t) => t.toFixed(2)).join(" | ") + " ms");

// Remise a zero, pour ne pas laisser la scene reglee.
await c.evaluer(
  "window.__shaderlabDebug.reglerDeveloppement(" + JSON.stringify(MODULE) + ", { " + PARAM + ": 0 })",
);
c.fermer();
