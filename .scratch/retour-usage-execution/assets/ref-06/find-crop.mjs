// Cherche la meilleure origine de crop 256 sur le temoin : une fenetre qui
// straddle sombre/clair (frontiere de couleur nette). Rend le temoin plein res,
// scanne la luminance, renvoie la meilleure origine + un apercu du crop.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PHOTO = "C:\\Users\\LEETJ\\Pictures\\vram-test\\photo-1.jpg";
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";

const photoB64 = readFileSync(PHOTO).toString("base64");
const targets = await (await fetch("http://localhost:9222/json")).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(); const contexts = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.executionContextCreated") contexts.push(m.params.context);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
await send("Runtime.enable");
const evalIn = async (expression, contextId) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...(contextId === undefined ? {} : { contextId }) });
  const ex = r.result?.exceptionDetails; if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
  return r.result?.result?.value;
};
const FRAME_ID = "__findcropFrame";
const before = new Set(contexts.map((c) => c.uniqueId));
await evalIn(`new Promise((res)=>{document.getElementById(${JSON.stringify(FRAME_ID)})?.remove();const f=document.createElement("iframe");f.id=${JSON.stringify(FRAME_ID)};f.style.cssText="position:absolute;left:-9999px;width:16px;height:16px";f.src=${JSON.stringify(`${ORIGIN}/scripts/render-check-page.html`)};f.onload=()=>res("ok");document.body.appendChild(f);})`);
await new Promise((r) => setTimeout(r, 300));
const frameCtx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || (c.auxData && c.auxData.type === "iframe")));
await evalIn(`window.__photoParts = []; "ok"`, frameCtx.id);
const CHUNK = 2_000_000;
for (let i = 0; i < photoB64.length; i += CHUNK) await evalIn(`window.__photoParts.push(${JSON.stringify(photoB64.slice(i, i + CHUNK))}); "ok"`, frameCtx.id);

const script = `(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const b64 = window.__photoParts.join(""); const bin = atob(b64);
  const bytes = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]));
  const cv = document.createElement("canvas"); cv.width=bmp.width; cv.height=bmp.height;
  const ctx = await initGpu(cv); const r = new Renderer(ctx, undefined, undefined, () => 0);
  await r.loadImage(bmp);
  const stack = openDocument(r, "fond").stack;
  const frame = await r.exportFrame(stack.layers);
  const W = frame.width, H = frame.height, px = frame.pixels;
  const lum = (x,y) => { const i=(y*W+x)*4; return 0.2126*px[i]+0.7152*px[i+1]+0.0722*px[i+2]; };
  const S = 256, stride = 96;
  let best = null;
  for (let y=0; y+S<H; y+=stride) for (let x=0; x+S<W; x+=stride) {
    let dark=0, bright=0, n=0;
    for (let j=0;j<S;j+=8) for (let i=0;i<S;i+=8) { const l=lum(x+i,y+j); if(l<35)dark++; if(l>150)bright++; n++; }
    const bal = Math.min(dark,bright)/n; // fraction of the smaller class
    if (!best || bal>best.bal) best={x,y,bal,darkF:dark/n,brightF:bright/n};
  }
  // apercu du crop retenu, agrandi x3 pour l'oeil
  const full = document.createElement("canvas"); full.width=W; full.height=H;
  full.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
  const prev = document.createElement("canvas"); prev.width=768; prev.height=768;
  const pctx = prev.getContext("2d"); pctx.imageSmoothingEnabled=false;
  pctx.drawImage(full, best.x, best.y, 256, 256, 0, 0, 768, 768);
  return JSON.stringify({ best, W, H, prev: prev.toDataURL("image/png") });
})()`;
const res = JSON.parse(await evalIn(script, frameCtx.id));
writeFileSync(path.join(OUT, "find-crop-preview.png"), Buffer.from(res.prev.split(",")[1], "base64"));
console.log(JSON.stringify(res.best), "native", res.W + "x" + res.H);
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
