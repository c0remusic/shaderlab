// CLARTE SUR UNE VRAIE PHOTO — le seul juge qui compte.
//
// Une reference de pixels prouve qu'un operateur porte sa propriete, jamais
// qu'il est beau (CLAUDE.md). Clarte vient d'etre reecrite : elle a desormais
// une action de TON qu'elle n'avait pas, et la question « est-ce que ca bouche
// les noirs sur une photo » ne se repond pas sur une mire.
//
// Photo d'ORIGINE BOITIER uniquement : un export deja developpe ferait juger
// nos operateurs par-dessus un developpement etranger.
import { readFileSync, writeFileSync } from "node:fs";

const ORIGIN = "http://localhost:1421";
const CDP = "http://localhost:9222";
const PHOTO = "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG";
const SORTIE = "C:/Users/LEETJ/AppData/Local/Temp/claude/C--dev-shaderlab/5cd8e3ee-e6ce-40b9-9de5-528e15ea775a/scratchpad/opti";

const DOSES = [
  ["temoin", {}],
  ["clarte-p60", { clarity: 60 }],
  ["clarte-p100", { clarity: 100 }],
  ["clarte-m60", { clarity: -60 }],
];

const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
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
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, contextId });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
  return r.result?.result?.value;
};

const FRAME_ID = "__plancheClarte";
const before = new Set(contexts.map((c) => c.uniqueId));
await evalIn(`new Promise((res) => {
  document.getElementById(${JSON.stringify(FRAME_ID)})?.remove();
  const f = document.createElement("iframe");
  f.id = ${JSON.stringify(FRAME_ID)};
  f.style.cssText = "position:absolute;left:-9999px;width:16px;height:16px";
  f.src = ${JSON.stringify(`${ORIGIN}/scripts/render-check-page.html`)};
  f.onload = () => res("ok");
  document.body.appendChild(f);
})`);
await new Promise((r) => setTimeout(r, 400));
const ctxFrame = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || c.auxData?.type === "iframe"));

const b64 = readFileSync(PHOTO).toString("base64");
await evalIn(`window.__parts = []; "ok"`, ctxFrame.id);
for (let i = 0; i < b64.length; i += 2_000_000) {
  await evalIn(`window.__parts.push(${JSON.stringify(b64.slice(i, i + 2_000_000))}); "ok"`, ctxFrame.id);
}

await evalIn(`(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const bin = atob(window.__parts.join(""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
  const cv = document.createElement("canvas");
  cv.width = bmp.width; cv.height = bmp.height;
  const ctx = await initGpu(cv);
  const r = new Renderer(ctx, undefined, undefined, () => 0);
  await r.loadImage(bmp);
  window.__pc = { r, openDocument, W: bmp.width, H: bmp.height };
  return "ok";
})()`, ctxFrame.id);

for (const [nom, params] of DOSES) {
  const res = JSON.parse(await evalIn(`(async () => {
    const { r, openDocument } = window.__pc;
    const params = ${JSON.stringify(params)};
    const develop = Object.keys(params).length ? { reglagesDeBase: params } : {};
    const stack = openDocument(r, "photo").stack;
    r.setDevelop(develop);
    const frame = await r.exportFrame(stack.layers, null, develop);
    const full = document.createElement("canvas");
    full.width = frame.width; full.height = frame.height;
    full.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
    // Vue d'ensemble reduite (jugement de masses) + detourage 1:1 dans une
    // zone SOMBRE (jugement de la tenue des noirs).
    const vue = document.createElement("canvas");
    vue.width = 420; vue.height = Math.round(420 * frame.height / frame.width);
    const g = vue.getContext("2d");
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(full, 0, 0, vue.width, vue.height);
    const crop = document.createElement("canvas");
    crop.width = 340; crop.height = 340;
    crop.getContext("2d").drawImage(full, 900, 2400, 340, 340, 0, 0, 340, 340);
    // Statistiques sur l'image ENTIERE : c'est elles qui disent si les noirs tiennent.
    const px = frame.pixels;
    let s = 0, n = 0, noirs = 0, clips = 0;
    for (let i = 0; i < px.length; i += 4 * 37) {
      const v = (px[i] + px[i + 1] + px[i + 2]) / 3;
      s += v; n++;
      if (px[i] + px[i + 1] + px[i + 2] === 0) noirs++;
      if (v >= 254.5) clips++;
    }
    return JSON.stringify({ vue: vue.toDataURL("image/png"), crop: crop.toDataURL("image/png"),
      moy: s / n, noirs: 100 * noirs / n, clips: 100 * clips / n });
  })()`, ctxFrame.id));
  writeFileSync(SORTIE + "/pc-" + nom + "-vue.png", Buffer.from(res.vue.split(",")[1], "base64"));
  writeFileSync(SORTIE + "/pc-" + nom + "-crop.png", Buffer.from(res.crop.split(",")[1], "base64"));
  console.log(nom.padEnd(14) + "moyenne " + res.moy.toFixed(2).padStart(7) +
    "   noirs purs " + res.noirs.toFixed(3) + " %   ecretes " + res.clips.toFixed(3) + " %");
}
ws.close();
