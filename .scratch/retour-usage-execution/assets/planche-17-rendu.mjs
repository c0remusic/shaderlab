// Rend des configurations de verre sur la photo par le pipeline REEL (iframe
// Vite, module map vierge : sert glass.ts TEL QU'IL EST SUR LE DISQUE, y compris
// une edition non commitee). Usage : node verre-rendu.mjs <suffixe>
// Ecrit planche17-<suffixe>-poli.png et planche17-<suffixe>-pave.png.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SUFFIXE = process.argv[2];
if (!SUFFIXE) throw new Error("usage: node verre-rendu.mjs <suffixe>");
const PHOTO = "C:\\Users\\LEETJ\\Pictures\\vram-test\\photo-1.jpg";
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const LARGEUR = 720;

// Configs de la table d'applicabilite (base optique commune + matiere).
const OPTIQUE = { thickness: 0.5, specular: 0.35, dispersion: 0.35, diffusion: 0.03, relief: 1, grain: 0.2 };
const CONFIGS = {
  poli: { ...OPTIQUE, material: 6, depth: 1, thickness: 1.6, irregularity: 0 },
  pave: { ...OPTIQUE, material: 9, blockSize: 96, mortar: 8, edgeDepth: 0.45, edgeWidth: 0.18, bevel: 0.28, inner: 0.5 },
};

const photoB64 = readFileSync(PHOTO).toString("base64");
const targets = await (await fetch("http://localhost:9222/json")).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) throw new Error("pas de cible CDP");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
const contexts = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.executionContextCreated") contexts.push(m.params.context);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const n = ++id; pending.set(n, res);
  ws.send(JSON.stringify({ id: n, method, params }));
});
await send("Runtime.enable");
const evalIn = async (expression, contextId) => {
  const r = await send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
    ...(contextId === undefined ? {} : { contextId }),
  });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
  return r.result?.result?.value;
};

const FRAME_ID = "__planche17Frame";
const before = new Set(contexts.map((c) => c.uniqueId));
const loaded = await evalIn(`new Promise((res) => {
  document.getElementById(${JSON.stringify(FRAME_ID)})?.remove();
  const f = document.createElement("iframe");
  f.id = ${JSON.stringify(FRAME_ID)};
  f.style.cssText = "position:absolute;left:-9999px;width:16px;height:16px";
  f.src = ${JSON.stringify(`${ORIGIN}/scripts/render-check-page.html`)};
  f.onload = () => res("ok");
  f.onerror = () => res("erreur de chargement");
  document.body.appendChild(f);
})`);
if (loaded !== "ok") throw new Error(`iframe: ${loaded}`);
await new Promise((r) => setTimeout(r, 300));
const frameCtx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || (c.auxData && c.auxData.type === "iframe")));
if (!frameCtx) throw new Error("contexte iframe introuvable");

await evalIn(`window.__photoParts = []; "ok"`, frameCtx.id);
const CHUNK = 2_000_000;
for (let i = 0; i < photoB64.length; i += CHUNK) {
  await evalIn(`window.__photoParts.push(${JSON.stringify(photoB64.slice(i, i + CHUNK))}); "ok"`, frameCtx.id);
}

const script = `(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const b64 = window.__photoParts.join("");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]));
  const L = ${LARGEUR};
  const h = Math.round((L * bmp.height) / bmp.width);
  const cv2 = document.createElement("canvas");
  cv2.width = L; cv2.height = h;
  cv2.getContext("2d").drawImage(bmp, 0, 0, L, h);
  const petit = await createImageBitmap(cv2);
  const cv = document.createElement("canvas");
  cv.width = L; cv.height = h;
  const ctx = await initGpu(cv);
  const r = new Renderer(ctx, undefined, undefined, () => 0);
  await r.loadImage(petit);
  const versDataUrl = (frame) => {
    const c = document.createElement("canvas");
    c.width = frame.width; c.height = frame.height;
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
    return c.toDataURL("image/png");
  };
  const sortie = {};
  for (const [nom, params] of Object.entries(${JSON.stringify(CONFIGS)})) {
    const stack = openDocument(r, "fond").stack;
    const a = stack.addLayer("glass");
    stack.updateParams(a, params);
    sortie[nom] = versDataUrl(await r.exportFrame(stack.layers));
  }
  return JSON.stringify(sortie);
})()`;

const res = JSON.parse(await evalIn(script, frameCtx.id));
for (const [nom, dataUrl] of Object.entries(res)) {
  const fichier = path.join(OUT, `planche17-${SUFFIXE}-${nom}.png`);
  writeFileSync(fichier, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("ecrit " + fichier);
}
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
