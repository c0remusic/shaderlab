// Reconnaissance : vignette 780px (echelle x8) de chaque photo d'Antoine via le
// harnais (iframe render-check-page). Grille tous les 65px (=520 natif). Sert a
// placer les crops. N'ecrit que recon-A.png / recon-B.png. Ne touche a aucun src/.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const PHOTOS = {
  A: "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG",
  B: "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5169-edited-2.JPG",
};
const targets = await (await fetch("http://localhost:9222/json")).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) throw new Error("pas de cible CDP");
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
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
  return r.result?.result?.value;
};
const FRAME_ID = "__recon06Frame4";
const before = new Set(contexts.map((c) => c.uniqueId));
const loaded = await evalIn(`new Promise((res) => {
  document.getElementById(${JSON.stringify(FRAME_ID)})?.remove();
  const f = document.createElement("iframe"); f.id = ${JSON.stringify(FRAME_ID)};
  f.style.cssText = "position:absolute;left:-9999px;width:16px;height:16px";
  f.src = ${JSON.stringify(`${ORIGIN}/scripts/render-check-page.html`)};
  f.onload = () => res("ok"); f.onerror = () => res("erreur"); document.body.appendChild(f);
})`);
if (loaded !== "ok") throw new Error(`iframe: ${loaded}`);
await new Promise((r) => setTimeout(r, 300));
const frameCtx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || (c.auxData && c.auxData.type === "iframe")));
if (!frameCtx) throw new Error("contexte iframe introuvable");

for (const [tag, file] of Object.entries(PHOTOS)) {
  const b64 = readFileSync(file).toString("base64");
  await evalIn(`window.__rp = []; "ok"`, frameCtx.id);
  const CHUNK = 2_000_000;
  for (let i = 0; i < b64.length; i += CHUNK) await evalIn(`window.__rp.push(${JSON.stringify(b64.slice(i, i + CHUNK))}); "ok"`, frameCtx.id);
  const res = JSON.parse(await evalIn(`(async () => {
    const bin = atob(window.__rp.join(""));
    const bytes = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
    // controle : Image decode "naturel" pour comparer les dims
    const cv = document.createElement("canvas"); const W=780, H=Math.round(780*bmp.height/bmp.width);
    cv.width=W; cv.height=H; const ctx=cv.getContext("2d");
    ctx.drawImage(bmp,0,0,W,H);
    ctx.strokeStyle="rgba(255,0,255,0.5)"; ctx.lineWidth=1; ctx.font="9px monospace"; ctx.fillStyle="rgba(255,0,255,0.9)";
    for(let x=0;x<W;x+=65){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();ctx.fillText(String(x*8),x+1,10);}
    for(let y=0;y<H;y+=65){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();ctx.fillText(String(y*8),1,y+9);}
    return JSON.stringify({ url: cv.toDataURL("image/png"), bw: bmp.width, bh: bmp.height, W, H });
  })()`, frameCtx.id));
  writeFileSync(path.join(OUT, `recon-${tag}.png`), Buffer.from(res.url.split(",")[1], "base64"));
  console.log(`${tag}: bitmap ${res.bw}x${res.bh} -> vignette ${res.W}x${res.H} (echelle ${(res.bw/res.W).toFixed(2)})`);
}
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); delete window.__rp; "ok"`);
ws.close();
