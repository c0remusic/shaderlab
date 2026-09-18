// QUELLE PROFONDEUR FAUT-IL A LA GACHETTE ?
//
// La mesure de `gachette.mjs` dit que notre canal de detail ne franchit pas le
// portail : 0,15 octet sur la moitie PLATE, la ou Lightroom agit le plus fort
// (-11,71). Sa portee est de deux cents pixels quand celle de Lightroom couvre
// les quatre mille pixels du demi-plateau.
//
// Ce script balaie la profondeur du dernier niveau et lit, pour chacune, le
// canal de detail des deux moities du portail. Le critere est simple et il ne
// depend d'aucun ajustement : la moitie PLATE doit remonter vers la moitie
// DETAILLEE, puisque la moitie de l'image porte du detail. Une gachette assez
// profonde tend vers un rapport de un demi ; une trop courte reste a zero.
import { readFileSync } from "node:fs";

const ORIGIN = "http://localhost:1421";
const CDP = "http://localhost:9222";
const MIRE = "C:/dev/shaderlab/.scratch/lightroom-develop/assets/mire/shaderlab-mire-portee-2048x16384.jpg";
const ANCRE = "  return vec4<f32>(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);";

// Zone PORTAIL : aplat 128 en haut (8192..12288), reseau 128 en bas.
const ZONES = [
  { nom: "aplat, loin", y0: 8400, y1: 11400 },
  { nom: "aplat, pres du bord", y0: 11900, y1: 12200 },
  { nom: "reseau, pres du bord", y0: 12400, y1: 12700 },
  { nom: "reseau, loin", y0: 13200, y1: 16100 },
];

// Le dernier niveau de la descente. La remontee s'arrete a 1/16 dans tous les
// cas : ce qui change est la PORTEE, pas la finesse de reconstruction.
const FONDS = [0.0078125, 0.00390625, 0.001953125, 0.0009765625, 0.00048828125];

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

const FRAME_ID = "__profondeur";
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

const b64 = readFileSync(MIRE).toString("base64");
await evalIn(`window.__parts = []; "ok"`, ctxFrame.id);
for (let i = 0; i < b64.length; i += 2_000_000) {
  await evalIn(`window.__parts.push(${JSON.stringify(b64.slice(i, i + 2_000_000))}); "ok"`, ctxFrame.id);
}

await evalIn(`(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const { developApplyOrder } = await import("/src/render/developRegistry.ts");
  const mod = developApplyOrder.find((m) => m.id === "reglagesDeBase");
  const bin = atob(window.__parts.join(""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
  const cv = document.createElement("canvas");
  cv.width = bmp.width; cv.height = bmp.height;
  const ctx = await initGpu(cv);
  const r = new Renderer(ctx, undefined, undefined, () => 0);
  await r.loadImage(bmp);
  const passesOrigine = mod.passes.slice();
  window.__p = { r, mod, openDocument, passesOrigine, origine: mod.wgsl,
                 bas: passesOrigine[1].wgsl, haut: passesOrigine[4].wgsl, utile: passesOrigine[0].enabled,
                 W: bmp.width, H: bmp.height };
  return "ok";
})()`, ctxFrame.id);

console.log("mire 2048 x 16384 — zone PORTAIL, canal de detail par profondeur");
console.log("");
console.log("fond      texels    " + ZONES.map((z) => z.nom.padStart(22)).join(""));
for (const fond of FONDS) {
  const res = JSON.parse(await evalIn(`(async () => {
    const p = window.__p;
    const { r, mod, openDocument, passesOrigine, origine, bas, haut, utile } = p;
    const descente = [];
    for (let s = 0.25; s >= ${fond} - 1e-12; s /= 2) descente.push({ scale: s, wgsl: bas, enabled: utile });
    const montee = [];
    for (let s = ${fond} * 2; s <= 0.0625 + 1e-12; s *= 2) montee.push({ scale: s, wgsl: haut, enabled: utile });
    mod.passes = passesOrigine.concat(descente, montee);
    mod.wgsl = origine.replace(${JSON.stringify(ANCRE)},
      "  return vec4<f32>(vec3<f32>(textureSample(prevPass, srcSampler, uv).b), 1.0);");
    const develop = { reglagesDeBase: { clarity: 60 } };
    const stack = openDocument(r, "photo").stack;
    r.setDevelop(develop);
    const f = await r.exportFrame(stack.layers, null, develop);
    const W = f.width, px = f.pixels;
    const x0 = Math.round(W * 0.3), x1 = Math.round(W * 0.7);
    const vals = ${JSON.stringify(ZONES)}.map((z) => {
      let s = 0, n = 0;
      for (let y = z.y0; y < z.y1; y++) for (let x = x0; x < x1; x++) { s += px[(y * W + x) * 4]; n++; }
      return s / n;
    });
    mod.wgsl = origine;
    mod.passes = passesOrigine;
    return JSON.stringify({ vals, nb: descente.length + montee.length,
      texels: Math.max(1, Math.round(p.W * ${fond})) + "x" + Math.max(1, Math.round(p.H * ${fond})) });
  })()`, ctxFrame.id));
  console.log(
    ("1/" + Math.round(1 / fond)).padEnd(10) +
    res.texels.padEnd(10) +
    res.vals.map((v) => v.toFixed(2).padStart(22)).join("") +
    "   (+" + res.nb + " passes)");
}
console.log("");
console.log("Critere : la moitie PLATE doit remonter vers la moitie DETAILLEE.");
console.log("Lightroom deplace l'aplat de -11,71 et le reseau de -8,14 : il AGIT sur la moitie plate.");
ws.close();
