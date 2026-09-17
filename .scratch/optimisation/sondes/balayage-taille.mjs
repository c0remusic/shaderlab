// LOI D'ECHELLE du cout GPU : meme photo, meme pile de cinq effets, quatre
// tailles. Toute difference de temps vient donc du nombre de pixels.
//
// La question a laquelle ce script repond : si le rendu se faisait a la
// resolution REELLEMENT AFFICHEE au lieu de la resolution native, que
// coutrait-il ? La reponse est la pente de cette droite, pas une opinion.
import { setTimeout as dormir } from "node:timers/promises";
import { connecter } from "./cdp.mjs";

const PHOTOS = [
  ["26.0 Mpx", "C:\\Users\\LEETJ\\Pictures\\vram-test\\photo-1.jpg"],
  ["6.5 Mpx", "C:\\Users\\LEETJ\\Pictures\\vram-test\\echelle\\echelle-2.jpg"],
  ["1.6 Mpx", "C:\\Users\\LEETJ\\Pictures\\vram-test\\echelle\\echelle-4.jpg"],
  ["0.41 Mpx", "C:\\Users\\LEETJ\\Pictures\\vram-test\\echelle\\echelle-8.jpg"],
];
const EFFETS = ["Glow", "Grain", "Courbes", "Netteté", "Lens distortion"];
const REPETITIONS = 3;

const c = await connecter();

async function ajouter(nom) {
  const ouvert = await c.evaluer(
    "(function(){var b=Array.prototype.slice.call(document.querySelectorAll('button'))" +
      ".find(function(x){return x.textContent.trim()==='Ajouter un effet';});" +
      " if(!b) return 'absent'; b.click(); return 'ok';})()",
  );
  if (ouvert === "absent") throw new Error("Bouton Ajouter un effet introuvable");
  await dormir(600);
  const choisi = await c.evaluer(
    "(function(){var c=Array.prototype.slice.call(document.querySelectorAll('button,li,[role=option]'))" +
      ".filter(function(e){return e.textContent.trim()===" + JSON.stringify(nom) + ";});" +
      " if(!c.length) return 'absent'; c[c.length-1].click(); return 'ok';})()",
  );
  if (choisi === "absent") throw new Error("Effet " + nom + " absent");
  await dormir(700);
}

async function mesurer(i) {
  await c.evaluer(
    "(() => { window.__rapportGpu = null;" +
      " window.__shaderlabDebug.capturerTimingGpu().then(r => { window.__rapportGpu = r; });" +
      " return 'arme'; })()",
  );
  await dormir(80);
  await c.evaluer("window.__shaderlabDebug.reglerDeveloppement('reglagesDeBase', { exposure: " + (1 + i) + " })");
  let r = null;
  for (let essai = 0; essai < 80 && !r; essai++) {
    await dormir(100);
    r = await c.evaluer("window.__rapportGpu");
  }
  if (!r) throw new Error("Aucun rapport GPU");
  return r;
}

const resultats = [];
for (const [libelle, chemin] of PHOTOS) {
  await c.evaluer("window.__shaderlabDebug.openByPath(" + JSON.stringify(chemin) + ")");
  await dormir(2500);
  for (const e of EFFETS) await ajouter(e);
  const rapports = [];
  for (let i = 0; i < REPETITIONS; i++) rapports.push(await mesurer(i));
  const totaux = rapports.map((r) => r.totalMs).sort((a, b) => a - b);
  const etat = await c.evaluer(`(() => {
    const cv = document.querySelector("canvas");
    const r = cv.getBoundingClientRect();
    return { w: cv.width, h: cv.height, cssW: Math.round(r.width), cssH: Math.round(r.height) };
  })()`);
  const mpx = (etat.w * etat.h) / 1e6;
  const parPasse = new Map();
  for (const p of rapports[rapports.length - 1].passes) {
    parPasse.set(p.label, (parPasse.get(p.label) ?? 0) + p.durationMs);
  }
  resultats.push({
    libelle,
    mpx: +mpx.toFixed(3),
    affiche: +((etat.cssW * etat.cssH) / 1e6).toFixed(3),
    passes: rapports[0].passes.length,
    medianeMs: +totaux[Math.floor(totaux.length / 2)].toFixed(2),
    parEffet: Object.fromEntries([...parPasse].map(([k, v]) => [k, +v.toFixed(2)])),
  });
  console.log(JSON.stringify(resultats[resultats.length - 1]));
}

console.log("");
console.log("taille        Mpx    passes   total GPU   ms par Mpx");
for (const r of resultats) {
  console.log(
    r.libelle.padEnd(12) +
      String(r.mpx).padStart(7) +
      String(r.passes).padStart(8) +
      (r.medianeMs + " ms").padStart(12) +
      (r.medianeMs / r.mpx).toFixed(3).padStart(13),
  );
}
c.fermer();
