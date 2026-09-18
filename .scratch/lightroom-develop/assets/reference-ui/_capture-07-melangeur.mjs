// Capture du MÉLANGEUR EN DEUX VUES (ticket 07, item 5), dans la vraie fenêtre.
//
// ⚠️ PAS DE CÔTE À CÔTE AVEC LIGHTROOM ICI, et ce n'est pas un oubli : le
// mélangeur DÉPLIÉ n'a jamais été capturé chez eux. Le ticket 07 le dit — piloter
// leur fenêtre par messages postés ne marche pas (clics inertes, mesuré), et la
// piloter à la souris prendrait la main sur la machine d'Antoine. Les deux crops
// 1:1 versionnés montrent le mélangeur REPLIÉ. La comparaison se fait donc contre
// son écran, pas contre un fichier ; fabriquer une « référence » qu'on n'a pas
// mesurée serait pire que de s'en passer.
//
// Ce que ce script rend : nos DEUX vues l'une à côté de l'autre, à l'échelle de
// l'écran, sur la même photo et le même réglage.
//   node .scratch/lightroom-develop/assets/reference-ui/_capture-07-melangeur.mjs
// Env : SHADERLAB_CDP (défaut 9222), SHADERLAB_APP, SHADERLAB_PHOTO.
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const CDP = process.env.SHADERLAB_CDP ?? "http://localhost:9222";
const APP = process.env.SHADERLAB_APP ?? "http://localhost:1420/";
const PHOTO = process.env.SHADERLAB_PHOTO ?? "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG";
const DIR = ".scratch/lightroom-develop/assets/reference-ui";

async function connect() {
  const cibles = await (await fetch(`${CDP}/json/list`)).json();
  const page = cibles.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error("aucune page CDP sur " + CDP);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", () => rej(new Error("ws refusee")), { once: true }); });
  let id = 0; const attente = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && attente.has(m.id)) { attente.get(m.id)(m); attente.delete(m.id); } });
  const envoyer = (method, params = {}) => new Promise((res) => { const n = ++id; attente.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluer = async (expr, awaitPromise = true) => {
    const r = await envoyer("Runtime.evaluate", { expression: expr, awaitPromise, returnByValue: true });
    if (r.result?.exceptionDetails || r.result?.result?.subtype === "error") throw new Error("eval: " + JSON.stringify(r.result));
    return r.result?.result?.value;
  };
  return { envoyer, evaluer, ws };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const p = await connect();
await p.envoyer("Page.enable");
await p.envoyer("Runtime.enable");
await p.envoyer("Page.navigate", { url: APP });
await sleep(1500);
await p.envoyer("Page.reload", { ignoreCache: true });
for (let i = 0; i < 40; i++) { await sleep(500); const ok = await p.evaluer("!!(window.__shaderlabDebug && window.__shaderlabDebug.openByPath)").catch(() => false); if (ok) break; }
await p.evaluer(`window.__shaderlabDebug.openByPath(${JSON.stringify(PHOTO)})`).catch((e) => console.log("open:", e.message));
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const pret = await p.evaluer(`(() => [...document.querySelectorAll('.docked-panel-card__title')].some(t => t.textContent === 'Développement') && !!document.querySelector('canvas'))()`).catch(() => false);
  if (pret) break;
}

// ⚠️ LES CURSEURS SONT A ZERO SUR CETTE PLANCHE, et c'est assume. Le pont de
// debug n'expose AUCUN poseur de reglages d'etage ; une premiere version de ce
// script appelait un `setDevelop` inexistant derriere un `.catch` vide, donc
// elle ne posait rien et ne le disait pas — exactement la sonde qui mesure un
// proxy. Poser des valeurs par l'interface demanderait de piloter huit champs.
// Ce que cette planche montre est la MISE EN PAGE des deux vues ; que changer
// de pastille change bien les curseurs est prouve par la story « Autre Bande »,
// qui lit les valeurs affichees.

// Replier tout sauf le melangeur.
await p.evaluer(`(() => {
  for (const t of document.querySelectorAll('.develop-panel button')) {
    const txt = (t.textContent || '').trim();
    const cible = txt.includes('Réglages de base') || txt.includes('Color Grading') || txt.includes('Étalonnage');
    if (cible && t.getAttribute('aria-expanded') === 'true') t.click();
  }
  return true;
})()`).catch((e) => console.log("collapse:", e.message));
await sleep(400);

async function croquer(nom) {
  const info = await p.evaluer(`(() => {
    const card = [...document.querySelectorAll('.docked-panel-card')].find(c => c.querySelector('.docked-panel-card__title')?.textContent === 'Développement');
    if (!card) return null;
    const r = card.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, dpr: window.devicePixelRatio };
  })()`);
  if (!info) throw new Error("carte Développement introuvable");
  const cap = await p.envoyer("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const full = PNG.sync.read(Buffer.from(cap.result.data, "base64"));
  const dpr = info.dpr || 1;
  const sx = Math.max(0, Math.round(info.x * dpr)), sy = Math.max(0, Math.round(info.y * dpr));
  const sw = Math.min(full.width - sx, Math.round(info.w * dpr)), sh = Math.min(full.height - sy, Math.round(info.h * dpr));
  const crop = new PNG({ width: sw, height: sh });
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const s = ((sy + y) * full.width + (sx + x)) * 4, d = (y * sw + x) * 4;
    full.data.copy(crop.data, d, s, s + 4);
  }
  // TEMOIN : une capture noire a l'air d'une reussite jusqu'a ce qu'on l'ouvre.
  let somme = 0;
  for (let i = 0; i < crop.data.length; i += 4) somme += crop.data[i];
  const moy = somme / (sw * sh);
  if (moy < 5) throw new Error(nom + " : capture quasi noire (moyenne " + moy.toFixed(1) + ")");
  console.log(nom, sw + "x" + sh, "moyenne", moy.toFixed(1));
  writeFileSync(`${DIR}/${nom}.png`, PNG.sync.write(crop));
  return crop;
}

const cliquer = async (nom) => {
  const ok = await p.evaluer(`(() => {
    const b = [...document.querySelectorAll('.color-mixer button')].find(x => (x.textContent || '').trim() === ${JSON.stringify(nom)} || x.getAttribute('aria-label') === ${JSON.stringify(nom)});
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!ok) throw new Error("bouton introuvable : " + nom);
  await sleep(250);
};

const vueCouleur = await croquer("notre-07-melangeur-couleur");
await cliquer("Mélange");
await cliquer("Tous les canaux");
const vueMelange = await croquer("notre-07-melangeur-melange");

// Composite : les deux vues cote a cote, echelle 1.
const gap = 12;
const outW = vueCouleur.width + gap + vueMelange.width;
const outH = Math.max(vueCouleur.height, vueMelange.height);
const out = new PNG({ width: outW, height: outH });
out.data.fill(0x1e);
for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
function blit(src, ox) {
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const s = (y * src.width + x) * 4, d = (y * outW + (ox + x)) * 4;
    src.data.copy(out.data, d, s, s + 4);
  }
}
blit(vueCouleur, 0);
blit(vueMelange, vueCouleur.width + gap);
writeFileSync(`${DIR}/comparaison-07-melangeur-deux-vues.png`, PNG.sync.write(out));
console.log("écrit comparaison-07-melangeur-deux-vues.png", outW, "x", outH);
p.ws.close();
process.exit(0);
