import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const PHOTOS = { A: "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG", B: "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5169-edited-2.JPG" };
// candidats [label, x, y] top-left, crop 256
const CAND = {
  A: [["g 3600,720",3600,720],["g 3500,860",3500,860],["g 3680,640",3680,640],["g 3800,600",3800,600],["g 3560,980",3560,980],["wrLOCK",2600,2500]],
  B: [["3a",2990,1470],["4b",1500,2300]],
};
const targets = await (await fetch("http://localhost:9222/json")).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(); const contexts = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.executionContextCreated") contexts.push(m.params.context); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
await send("Runtime.enable");
const evalIn = async (expr, cid) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, ...(cid===undefined?{}:{contextId:cid}) }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
const FID = "__cprev06"; const before = new Set(contexts.map((c) => c.uniqueId));
await evalIn(`new Promise((res)=>{document.getElementById(${JSON.stringify(FID)})?.remove();const f=document.createElement("iframe");f.id=${JSON.stringify(FID)};f.style.cssText="position:absolute;left:-9999px;width:16px;height:16px";f.src=${JSON.stringify(ORIGIN+"/scripts/render-check-page.html")};f.onload=()=>res("ok");document.body.appendChild(f);})`);
await new Promise((r) => setTimeout(r, 300));
const fc = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || (c.auxData && c.auxData.type === "iframe")));
for (const [tag, file] of Object.entries(PHOTOS)) {
  const b64 = readFileSync(file).toString("base64");
  await evalIn(`window.__cp=[];"ok"`, fc.id);
  for (let i = 0; i < b64.length; i += 2_000_000) await evalIn(`window.__cp.push(${JSON.stringify(b64.slice(i, i + 2_000_000))});"ok"`, fc.id);
  const url = await evalIn(`(async()=>{const bin=atob(window.__cp.join(""));const by=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)by[i]=bin.charCodeAt(i);
    const bmp=await createImageBitmap(new Blob([by]),{imageOrientation:"from-image"});const cand=${JSON.stringify(CAND[tag])};
    const cols=cand.length; const cw=140,ch=160; const cv=document.createElement("canvas");cv.width=cols*cw;cv.height=ch;const cx=cv.getContext("2d");cx.fillStyle="#111";cx.fillRect(0,0,cv.width,cv.height);
    for(let i=0;i<cand.length;i++){const [lab,x,y]=cand[i];cx.drawImage(bmp,x,y,256,256,i*cw+6,20,128,128);cx.fillStyle="#fff";cx.font="11px monospace";cx.fillText(lab,i*cw+6,14);cx.fillStyle="#8fae7a";cx.fillText(x+","+y,i*cw+6,162);}
    return cv.toDataURL("image/png");})()`, fc.id);
  writeFileSync(path.join(OUT, `cropprev-${tag}.png`), Buffer.from(url.split(",")[1], "base64"));
  console.log(`cropprev-${tag}.png`);
}
await evalIn(`document.getElementById(${JSON.stringify(FID)})?.remove();delete window.__cp;"ok"`);
ws.close();
