// Chrono wall-clock exportFrame (dev) : temoin vs "tout" v3. Warm-up puis min/median
// sur N iterations. Meme harnais iframe que planche-06-rendu-3.
import { readFileSync } from "node:fs";
const PHOTO = "C:\\Users\\LEETJ\\Pictures\\vram-test\\photo-1.jpg";
const ORIGIN = "http://localhost:1421";
const photoB64 = readFileSync(PHOTO).toString("base64");
const targets = await (await fetch("http://localhost:9222/json")).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(); const contexts = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data);
  if (m.method === "Runtime.executionContextCreated") contexts.push(m.params.context);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
await send("Runtime.enable");
const evalIn = async (expression, contextId) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...(contextId === undefined ? {} : { contextId }) });
  const ex = r.result?.exceptionDetails; if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex)); return r.result?.result?.value; };
const FRAME_ID = "__chronoAq3";
const before = new Set(contexts.map((c) => c.uniqueId));
await evalIn(`new Promise((res)=>{document.getElementById(${JSON.stringify(FRAME_ID)})?.remove();const f=document.createElement("iframe");f.id=${JSON.stringify(FRAME_ID)};f.style.cssText="position:absolute;left:-9999px;width:16px;height:16px";f.src=${JSON.stringify(`${ORIGIN}/scripts/render-check-page.html`)};f.onload=()=>res("ok");document.body.appendChild(f);})`);
await new Promise((r) => setTimeout(r, 300));
const frameCtx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || (c.auxData && c.auxData.type === "iframe")));
await evalIn(`window.__cp=[];"ok"`, frameCtx.id);
const CH = 2_000_000;
for (let i = 0; i < photoB64.length; i += CH) await evalIn(`window.__cp.push(${JSON.stringify(photoB64.slice(i, i + CH))});"ok"`, frameCtx.id);
const res = await evalIn(`(async()=>{
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const bin = atob(window.__cp.join("")); const bytes = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]));
  const cv = document.createElement("canvas"); cv.width=bmp.width; cv.height=bmp.height;
  const ctx = await initGpu(cv); const r = new Renderer(ctx, undefined, undefined, ()=>0);
  await r.loadImage(bmp);
  const P = { washRadius:5, spread:1.5, frontWidth:8, bloom:0.15, wash:1, wetness:0.6, fibers:4, edgeDarkening:0.9, lace:0.6 };
  const mk = (withFx)=>{ const st=openDocument(r,"fond").stack; if(withFx){const a=st.addLayer("aquarelle"); st.updateParams(a,P);} return st; };
  const bench = async (withFx)=>{ const st=mk(withFx); for(let i=0;i<5;i++) await r.exportFrame(st.layers); // warm
    const ts=[]; for(let i=0;i<12;i++){ const t=performance.now(); await r.exportFrame(st.layers); ts.push(performance.now()-t); }
    ts.sort((a,b)=>a-b); return { min: ts[0], med: ts[6], max: ts[11] }; };
  const off = await bench(false); const on = await bench(true);
  return JSON.stringify({ off, on });
})()`, frameCtx.id);
const { off, on } = JSON.parse(res);
console.log(`SANS effet : min ${off.min.toFixed(1)} med ${off.med.toFixed(1)} max ${off.max.toFixed(1)} ms`);
console.log(`AVEC "tout": min ${on.min.toFixed(1)} med ${on.med.toFixed(1)} max ${on.max.toFixed(1)} ms`);
console.log(`DELTA (med): +${(on.med - off.med).toFixed(1)} ms  (min +${(on.min - off.min).toFixed(1)})`);
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove();"ok"`);
ws.close();
