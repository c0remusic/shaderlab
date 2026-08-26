// Planche de decision du ticket 05 : fidelite des apercus de galerie.
// Deux sources candidates — composite REDUIT vs CROP 1:1 — rendues par le VRAI
// pipeline (iframe 1421, module map vierge, meme technique que render-check).
// Sortie : PNG dans le scratchpad. Aucun accent ni backtick dans le code evalue.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PHOTO = "C:\\Users\\LEETJ\\Pictures\\vram-test\\photo-1.jpg";
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const EFFETS = ["dither", "halftone", "glow", "lensFlare", "grain", "glass"];

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

// Iframe neuf sur l'origine du Vite (module map vierge).
const FRAME_ID = "__planche05Frame";
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
if (!frameCtx) throw new Error("contexte iframe introuvable : " + JSON.stringify(contexts.map((c) => c.origin)));

// Injection de la photo par morceaux (une seule grosse chaine passe mal).
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

  const LARGEUR = 240;
  const hReduite = Math.round((LARGEUR * bmp.height) / bmp.width);

  // Source A : composite reduit (ici la photo nue, reduite par drawImage).
  const cv2 = document.createElement("canvas");
  cv2.width = LARGEUR; cv2.height = hReduite;
  const c2 = cv2.getContext("2d");
  c2.drawImage(bmp, 0, 0, LARGEUR, hReduite);
  const bmpReduit = await createImageBitmap(cv2);

  // Source B : crop 1:1 au centre, memes dimensions que la vignette.
  const sx = Math.round((bmp.width - LARGEUR) / 2);
  const sy = Math.round((bmp.height - hReduite) / 2);
  const bmpCrop = await createImageBitmap(bmp, sx, sy, LARGEUR, hReduite);

  const rendreSource = async (bitmap) => {
    const cv = document.createElement("canvas");
    cv.width = bitmap.width; cv.height = bitmap.height;
    const ctx = await initGpu(cv);
    const r = new Renderer(ctx, undefined, undefined, () => 0);
    await r.loadImage(bitmap);
    const sortie = {};
    const versDataUrl = (frame) => {
      const c = document.createElement("canvas");
      c.width = frame.width; c.height = frame.height;
      const g = c.getContext("2d");
      g.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
      return c.toDataURL("image/png");
    };
    const temoinStack = openDocument(r, "fond").stack;
    sortie.temoin = versDataUrl(await r.exportFrame(temoinStack.layers));
    for (const effectId of ${JSON.stringify(EFFETS)}) {
      const stack = openDocument(r, "fond").stack;
      stack.addLayer(effectId);
      sortie[effectId] = versDataUrl(await r.exportFrame(stack.layers));
    }
    return sortie;
  };

  const reduit = await rendreSource(bmpReduit);
  const crop = await rendreSource(bmpCrop);
  return JSON.stringify({ largeur: LARGEUR, hauteur: hReduite, plein: { w: bmp.width, h: bmp.height }, reduit, crop });
})()`;

const brut = await evalIn(script, frameCtx.id);
const res = JSON.parse(brut);
console.log(`photo ${res.plein.w}x${res.plein.h}, vignettes ${res.largeur}x${res.hauteur}`);
for (const [source, images] of [["reduit", res.reduit], ["crop", res.crop]]) {
  for (const [nom, dataUrl] of Object.entries(images)) {
    const fichier = path.join(OUT, `planche05-${source}-${nom}.png`);
    writeFileSync(fichier, Buffer.from(dataUrl.split(",")[1], "base64"));
    console.log("ecrit " + fichier);
  }
}
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
