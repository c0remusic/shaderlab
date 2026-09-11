// Capture côte à côte pour le ticket 07 : notre carte « Développement » (Réglages
// de base déplié, HSL et Étalonnage repliés) face au crop 1:1 de Lightroom.
// Lancer APRÈS le gate de rendu (partage le CDP). Env : SHADERLAB_CDP (défaut 9223).
//   node .scratch/lightroom-develop/assets/reference-ui/_capture-07.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const CDP = process.env.SHADERLAB_CDP ?? "http://localhost:9223";
const PHOTO = process.env.SHADERLAB_PHOTO ?? "C:/Users/LEETJ/Pictures/photo-1-edited.jpg";
const REF = "lightroom-14.5-reglages-de-base-1x.png";
const DIR = ".scratch/lightroom-develop/assets/reference-ui";

async function connect() {
  const cibles = await (await fetch(`${CDP}/json/list`)).json();
  const page = cibles.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error("aucune page CDP");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", () => rej(new Error("ws refusée")), { once: true }); });
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
console.log("connecté", CDP);
await p.envoyer("Page.enable");
await p.envoyer("Runtime.enable");

// Naviguer vers l'app (le harness a pu laisser la page sur 1421) puis recharger
// pour prendre le dockLayout édité (Développement en groupe propre).
const APP = process.env.SHADERLAB_APP ?? "http://localhost:1420/";
await p.envoyer("Page.navigate", { url: APP });
await sleep(1500);
await p.envoyer("Page.reload", { ignoreCache: true });
for (let i = 0; i < 40; i++) { await sleep(500); const ok = await p.evaluer("!!(window.__shaderlabDebug && window.__shaderlabDebug.openByPath)").catch(() => false); if (ok) break; }
await p.evaluer(`window.__shaderlabDebug.openByPath(${JSON.stringify(PHOTO)})`).catch((e) => console.log("open:", e.message));
// Attendre qu'une image soit chargée (un canvas non vide + carte Développement présente).
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const pret = await p.evaluer(`(() => { const c = [...document.querySelectorAll('.docked-panel-card__title')].some(t => t.textContent === 'Développement'); return c && !!document.querySelector('canvas'); })()`).catch(() => false);
  if (pret) break;
}

// Replier HSL et Étalonnage pour ne montrer que Réglages de base (parité avec le
// crop). Best-effort : on clique le déclencheur de chaque accordéon dont le titre
// n'est pas « Réglages de base ».
await p.evaluer(`(() => {
  const triggers = [...document.querySelectorAll('.develop-panel [data-panel-open], .develop-panel button')];
  for (const t of triggers) {
    const txt = (t.textContent || '').trim();
    if ((txt.includes('Noir et blanc') || txt.includes('Étalonnage')) && t.getAttribute('aria-expanded') !== 'false') t.click();
  }
  return true;
})()`).catch((e) => console.log("collapse:", e.message));
await sleep(400);

// Rect de la carte Développement + dpr.
const info = await p.evaluer(`(() => {
  const card = [...document.querySelectorAll('.docked-panel-card')].find(c => c.querySelector('.docked-panel-card__title')?.textContent === 'Développement');
  if (!card) return null;
  const r = card.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, dpr: window.devicePixelRatio };
})()`);
if (!info) throw new Error("carte Développement introuvable dans le DOM");
console.log("carte", info);

const cap = await p.envoyer("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
const full = PNG.sync.read(Buffer.from(cap.result.data, "base64"));
const dpr = info.dpr || 1;
const sx = Math.max(0, Math.round(info.x * dpr)), sy = Math.max(0, Math.round(info.y * dpr));
const sw = Math.min(full.width - sx, Math.round(info.w * dpr)), sh = Math.min(full.height - sy, Math.round(info.h * dpr));
const crop = new PNG({ width: sw, height: sh });
for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const s = ((sy + y) * full.width + (sx + x)) * 4, d = (y * sw + x) * 4; crop.data.copy(crop.data, 0, 0, 0); full.data.copy(crop.data, d, s, s + 4); }
writeFileSync(`${DIR}/notre-07-reglages-de-base.png`, PNG.sync.write(crop));
console.log("crop", sw, sh);

// Mise à l'échelle de notre crop à la largeur du crop Lightroom (346), voisin le
// plus proche (une comparaison de layout, pas de pixels).
const ref = PNG.sync.read(readFileSync(`${DIR}/${REF}`));
const targetW = ref.width;
const scale = targetW / sw;
const scaledH = Math.round(sh * scale);
const scaled = new PNG({ width: targetW, height: scaledH });
for (let y = 0; y < scaledH; y++) for (let x = 0; x < targetW; x++) {
  const srcX = Math.min(sw - 1, Math.floor(x / scale)), srcY = Math.min(sh - 1, Math.floor(y / scale));
  const s = (srcY * sw + srcX) * 4, d = (y * targetW + x) * 4;
  crop.data.copy(scaled.data, d, s, s + 4);
}

// Composite côte à côte (notre carte à gauche, Lightroom à droite), fond neutre.
const gap = 12;
const outW = targetW * 2 + gap;
const outH = Math.max(scaledH, ref.height);
const out = new PNG({ width: outW, height: outH });
out.data.fill(0x1e);
for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
function blit(src, ox) {
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const s = (y * src.width + x) * 4, d = (y * outW + (ox + x)) * 4;
    src.data.copy(out.data, d, s, s + 4);
  }
}
blit(scaled, 0);
blit(ref, targetW + gap);
writeFileSync(`${DIR}/comparaison-07-reglages-de-base.png`, PNG.sync.write(out));
console.log("écrit comparaison-07-reglages-de-base.png", outW, "x", outH);
p.ws.close();
process.exit(0);
