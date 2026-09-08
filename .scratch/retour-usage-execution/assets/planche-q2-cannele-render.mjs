// Complement Q2 : la dispersion sur une matiere A PENTE (Cannelé, material 0, le
// defaut). La mesure a montre qu'elle est quasi inerte sur Poli et Depoli (plats)
// — grief (a) "distortion de la couleur" ne peut donc pas s'y lire. Ici elle mord.
// current seulement (dispersion independante du matcap). Aucun accent/backtick injecte.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const photoB64 = readFileSync("C:\\Users\\LEETJ\\Pictures\\vram-test\\photo-1.jpg").toString("base64");
const targets = await (await fetch("http://localhost:9222/json")).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(); const contexts = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.executionContextCreated") contexts.push(m.params.context); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
await send("Runtime.enable");
const evalIn = async (expression, contextId) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...(contextId === undefined ? {} : { contextId }) }); const ex = r.result?.exceptionDetails; if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex)); return r.result?.result?.value; };
const FRAME_ID = "__q2cannele";
const before = new Set(contexts.map((c) => c.uniqueId));
await evalIn(`new Promise((res) => { document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); const f=document.createElement("iframe"); f.id=${JSON.stringify(FRAME_ID)}; f.style.cssText="position:absolute;left:-9999px;width:16px;height:16px"; f.src=${JSON.stringify(`${ORIGIN}/scripts/render-check-page.html`)}; f.onload=()=>res("ok"); document.body.appendChild(f); })`);
await new Promise((r) => setTimeout(r, 400));
const frameCtx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || (c.auxData && c.auxData.type === "iframe")));
await evalIn(`window.__pp = []; "ok"`, frameCtx.id);
for (let i = 0; i < photoB64.length; i += 2_000_000) await evalIn(`window.__pp.push(${JSON.stringify(photoB64.slice(i, i + 2_000_000))}); "ok"`, frameCtx.id);
const CROPS = [{ id: "toit", x: 410, y: 150 }, { id: "droite", x: 545, y: 160 }, { id: "auto", x: 293, y: 230 }];
const res = JSON.parse(await evalIn(`(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const bin = atob(window.__pp.join("")); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]));
  const LW = 640, LH = Math.round((LW * bmp.height) / bmp.width);
  const cvp = document.createElement("canvas"); cvp.width = LW; cvp.height = LH; cvp.getContext("2d").drawImage(bmp, 0, 0, LW, LH);
  const photo = await createImageBitmap(cvp);
  const cv = document.createElement("canvas"); cv.width = LW; cv.height = LH;
  const ctx = await initGpu(cv); const r = new Renderer(ctx, undefined, undefined, () => 0); await r.loadImage(photo);
  const S = 128, CROPS = ${JSON.stringify(CROPS)};
  const versDataUrl = (f) => { const c = document.createElement("canvas"); c.width=f.width; c.height=f.height; c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(f.pixels), f.width, f.height),0,0); return c.toDataURL("image/png"); };
  const cropUrl = (f, cx, cy) => { const w=f.width,h=f.height,x0=Math.max(0,Math.min(w-S,cx-(S>>1))),y0=Math.max(0,Math.min(h-S,cy-(S>>1))); const src=new Uint8ClampedArray(f.pixels),sub=new Uint8ClampedArray(S*S*4); for(let y=0;y<S;y++) sub.set(src.subarray(((y0+y)*w+x0)*4,((y0+y)*w+x0+S)*4),y*S*4); const c=document.createElement("canvas"); c.width=S;c.height=S;c.getContext("2d").putImageData(new ImageData(sub,S,S),0,0); return c.toDataURL("image/png"); };
  const stat = (f)=>{const p=f.pixels;let s=0,s2=0;const n=f.width*f.height;for(let i=0;i<p.length;i+=4){const l=0.299*p[i]+0.587*p[i+1]+0.114*p[i+2];s+=l;s2+=l*l;}const m=s/n;return {moyenne:+m.toFixed(2),ecartType:+Math.sqrt(Math.max(0,s2/n-m*m)).toFixed(2)};};
  const out = {};
  for (const dp of [["d25", 0.25], ["d0", 0]]) {
    const s = openDocument(r, "fond").stack; const l = s.addLayer("glass"); s.updateParams(l, { material: 0, dispersion: dp[1] });
    const f = await r.exportFrame(s.layers);
    const crops = {}; for (const cr of CROPS) crops[cr.id] = cropUrl(f, cr.x, cr.y);
    out["cannele-" + dp[0]] = { img: versDataUrl(f), crops, stat: stat(f) };
  }
  return JSON.stringify(out);
})()`, frameCtx.id));
const manifest = {};
for (const [k, o] of Object.entries(res)) {
  writeFileSync(path.join(OUT, `q2-current-${k}.png`), Buffer.from(o.img.split(",")[1], "base64"));
  for (const [cid, durl] of Object.entries(o.crops)) writeFileSync(path.join(OUT, `q2-current-${k}-crop-${cid}.png`), Buffer.from(durl.split(",")[1], "base64"));
  manifest[k] = o.stat;
  console.log(`${k.padEnd(12)} moyenne ${o.stat.moyenne} ecart-type ${o.stat.ecartType}`);
}
writeFileSync(path.join(OUT, "q2-manifest-cannele.json"), JSON.stringify(manifest, null, 2));
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
