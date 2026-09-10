// Planche-contact d'inspection : pour une photo, tuile les 9 vignettes (rangee 1),
// 9 crop1 (rangee 2), 9 crop2 (rangee 3). Une image par photo, pour lecture. Ne
// sert qu'a l'inspection de l'agent, pas a la planche finale.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const tag = process.argv[2] || "A";
const KEYS = ["temoin","lavis","bave","fibres","plages","front","tout","portee2x","bavemax"];
const targets = await (await fetch("http://localhost:9222/json")).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(); const contexts = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.executionContextCreated") contexts.push(m.params.context); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
await send("Runtime.enable");
const evalIn = async (expr, cid) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, ...(cid===undefined?{}:{contextId:cid}) }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
const FID = "__contact06"; const before = new Set(contexts.map((c) => c.uniqueId));
await evalIn(`new Promise((res)=>{document.getElementById(${JSON.stringify(FID)})?.remove();const f=document.createElement("iframe");f.id=${JSON.stringify(FID)};f.style.cssText="position:absolute;left:-9999px;width:16px;height:16px";f.src=${JSON.stringify(ORIGIN+"/scripts/render-check-page.html")};f.onload=()=>res("ok");document.body.appendChild(f);})`);
await new Promise((r) => setTimeout(r, 300));
const fc = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || (c.auxData && c.auxData.type === "iframe")));
// charge les 27 PNG en dataURL
const imgs = {};
for (let i = 0; i < 9; i++) for (const kind of ["vign","crop1","crop2"]) {
  imgs[`${kind}${i}`] = "data:image/png;base64," + readFileSync(path.join(OUT, `aq4-${tag}-col${i}-${kind}.png`)).toString("base64");
}
await evalIn(`window.__ci = ${JSON.stringify(imgs)}; "ok"`, fc.id);
const url = await evalIn(`(async () => {
  const load = (u) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = u; });
  const keys = ${JSON.stringify(KEYS)};
  const VW = 200, CW = 160, pad = 6, labelH = 16;
  const W = 9 * (VW + pad) + pad;
  const vh = Math.round(VW * 4160 / 6240);
  const rowH = [vh + labelH, CW, CW];
  const H = pad + labelH + rowH[0] + pad + rowH[1] + pad + rowH[2] + pad;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const cx = cv.getContext("2d"); cx.fillStyle = "#15161a"; cx.fillRect(0,0,W,H);
  cx.fillStyle = "#e8e6e1"; cx.font = "12px monospace";
  let y0 = pad + labelH;
  for (let i = 0; i < 9; i++) { const x = pad + i * (VW + pad);
    cx.fillStyle = "#8fae7a"; cx.fillText(i + " " + keys[i], x, pad + 11);
    const v = await load(window.__ci["vign"+i]); cx.drawImage(v, x, y0, VW, vh);
    const c1 = await load(window.__ci["crop1"+i]); cx.drawImage(c1, x, y0 + vh + pad, CW, CW);
    const c2 = await load(window.__ci["crop2"+i]); cx.drawImage(c2, x, y0 + vh + pad + CW + pad, CW, CW);
  }
  return cv.toDataURL("image/png");
})()`, fc.id);
writeFileSync(path.join(OUT, `contact-${tag}.png`), Buffer.from(url.split(",")[1], "base64"));
console.log(`contact-${tag}.png`);
await evalIn(`document.getElementById(${JSON.stringify(FID)})?.remove(); delete window.__ci; "ok"`);
ws.close();
