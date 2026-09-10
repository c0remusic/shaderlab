// Echantillonne les deux photos sur une grille grossiere (RGB moyen par cellule)
// pour localiser les bandes de teinte et placer les crops. N'ecrit rien.
import { readFileSync } from "node:fs";
import path from "node:path";
const ORIGIN = "http://localhost:1421";
const PHOTOS = {
  A: "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG",
  B: "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5169-edited-2.JPG",
};
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
const evalIn = async (expr, cid) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, ...(cid===undefined?{}:{contextId:cid}) });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
const FRAME_ID = "__samp06";
const before = new Set(contexts.map((c) => c.uniqueId));
await evalIn(`new Promise((res)=>{document.getElementById(${JSON.stringify(FRAME_ID)})?.remove();const f=document.createElement("iframe");f.id=${JSON.stringify(FRAME_ID)};f.style.cssText="position:absolute;left:-9999px;width:16px;height:16px";f.src=${JSON.stringify(ORIGIN+"/scripts/render-check-page.html")};f.onload=()=>res("ok");document.body.appendChild(f);})`);
await new Promise((r) => setTimeout(r, 300));
const fc = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || (c.auxData && c.auxData.type === "iframe")));
const GW = 26, GH = 17;
for (const [tag, file] of Object.entries(PHOTOS)) {
  const b64 = readFileSync(file).toString("base64");
  await evalIn(`window.__sp=[]; "ok"`, fc.id);
  for (let i = 0; i < b64.length; i += 2_000_000) await evalIn(`window.__sp.push(${JSON.stringify(b64.slice(i, i + 2_000_000))});"ok"`, fc.id);
  const grid = JSON.parse(await evalIn(`(async()=>{const bin=atob(window.__sp.join(""));const by=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)by[i]=bin.charCodeAt(i);
    const bmp=await createImageBitmap(new Blob([by]),{imageOrientation:"from-image"});const cv=document.createElement("canvas");cv.width=${GW};cv.height=${GH};const cx=cv.getContext("2d");cx.drawImage(bmp,0,0,${GW},${GH});const d=cx.getImageData(0,0,${GW},${GH}).data;const g=[];for(let y=0;y<${GH};y++){const row=[];for(let x=0;x<${GW};x++){const o=(y*${GW}+x)*4;row.push([d[o],d[o+1],d[o+2]]);}g.push(row);}return JSON.stringify({g,bw:bmp.width,bh:bmp.height});})()`, fc.id));
  console.log(`\n=== ${tag} (${grid.bw}x${grid.bh}, cellule ${Math.round(grid.bw/GW)}x${Math.round(grid.bh/GH)} px) ===`);
  // Affiche par cellule un code teinte simple + coord native du centre
  const cw = grid.bw / GW, ch = grid.bh / GH;
  for (let y = 0; y < GH; y++) {
    let line = "";
    for (let x = 0; x < GW; x++) {
      const [r, g, b] = grid.g[y][x];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      let c = ".";
      if (mx < 40) c = "#";              // noir
      else if (mx - mn < 25) c = (mx>150?"W":(mx>80?"o":"x")); // gris clair/moyen/sombre
      else if (r >= g && r >= b) c = (g > b ? (g>r*0.7?"Y":"R") : "R"); // rouge/jaune
      else if (g >= r && g >= b) c = "G"; // vert
      else c = (r > g ? "P" : "B");       // bleu / violet
      line += c;
    }
    console.log(String(Math.round((y+0.5)*ch)).padStart(4), line);
  }
  process.stdout.write("colX:");
  for (let x = 0; x < GW; x++) process.stdout.write(String(Math.round((x+0.5)*cw)).padStart(5));
  console.log();
}
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove();delete window.__sp;"ok"`);
ws.close();
