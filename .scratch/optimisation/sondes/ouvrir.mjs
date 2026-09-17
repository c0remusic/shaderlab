// Ouvre une photo et empile les effets nommes. Usage :
//   node ouvrir.mjs <chemin> [Effet1] [Effet2] ...
import { setTimeout as dormir } from "node:timers/promises";
import { connecter } from "./cdp.mjs";

const chemin = process.argv[2];
const effets = process.argv.slice(3);
const c = await connecter();

await c.evaluer("window.__shaderlabDebug.openByPath(" + JSON.stringify(chemin) + ")");
await dormir(3000);

for (const nom of effets) {
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

const etat = await c.evaluer(`(() => {
  const cv = document.querySelector("canvas");
  const r = cv.getBoundingClientRect();
  return {
    canvas: cv.width + "x" + cv.height,
    mpx: +((cv.width * cv.height) / 1e6).toFixed(2),
    afficheMpx: +((r.width * r.height) / 1e6).toFixed(3),
    calques: window.__shaderlabDebug.state().layers.map((l) => l.effectId),
  };
})()`);
console.log(JSON.stringify(etat));
c.fermer();
