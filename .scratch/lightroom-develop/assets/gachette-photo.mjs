// CE QUE LA GACHETTE LIT SUR UNE VRAIE PHOTO.
//
// Les seuils ne se fixent pas sur les mires seules : une mire bi-tonale en JPEG
// a un plancher d'artefacts (1,00 octet) et une photo porte du grain. Si le
// seuil est cale entre les deux mires, il peut eteindre Clarte sur une photo —
// exactement le genre de panne que rien ne signale.
//
// Photo d'ORIGINE BOITIER, regle du depot : un export deja developpe ferait
// juger nos operateurs par-dessus un developpement etranger.
import { readFileSync } from "node:fs";

const ORIGIN = "http://localhost:1421";
const CDP = "http://localhost:9222";
const PHOTO = "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG";
const ANCRE = "  return vec4<f32>(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);";

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

const FRAME_ID = "__gachettePhoto";
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

const out = JSON.parse(await evalIn(`(async () => {
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
  const bas = passesOrigine[1].wgsl, haut = passesOrigine[4].wgsl, utile = passesOrigine[0].enabled;
  const origine = mod.wgsl;
  const develop = { reglagesDeBase: { clarity: 60 } };
  const stack = openDocument(r, "photo").stack;
  r.setDevelop(develop);

  const mesurer = async (fond, expr) => {
    const descente = [], montee = [];
    for (let s = 0.25; s >= fond - 1e-12; s /= 2) descente.push({ scale: s, wgsl: bas, enabled: utile });
    for (let s = fond * 2; s <= 0.0625 + 1e-12; s *= 2) montee.push({ scale: s, wgsl: haut, enabled: utile });
    mod.passes = passesOrigine.concat(descente, montee);
    mod.wgsl = origine.replace(${JSON.stringify(ANCRE)}, "  return " + expr + ";");
    const f = await r.exportFrame(stack.layers, null, develop);
    const px = f.pixels;
    let s = 0, lo = 255, hi = 0, n = 0;
    for (let i = 0; i < px.length; i += 4 * 101) { const v = px[i]; s += v; if (v < lo) lo = v; if (v > hi) hi = v; n++; }
    mod.wgsl = origine; mod.passes = passesOrigine;
    return { moy: s / n, min: lo, max: hi };
  };

  const profond128 = await mesurer(1 / 128, "vec4<f32>(vec3<f32>(textureSample(prevPass, srcSampler, uv).b), 1.0)");
  const profond2048 = await mesurer(1 / 2048, "vec4<f32>(vec3<f32>(textureSample(prevPass, srcSampler, uv).b), 1.0)");
  const local = await mesurer(1 / 128, "vec4<f32>(vec3<f32>(pyr.b), 1.0)");
  return JSON.stringify({ W: bmp.width, H: bmp.height, profond128, profond2048, local });
})()`, ctxFrame.id));

function s2l(c) { const x = Math.max(c, 0); return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
console.log("photo " + out.W + " x " + out.H);
console.log("");
console.log("canal                       moyenne   min   max    valeur (moyenne)");
for (const [nom, v] of [["detail GLOBAL (fond 1/128)", out.profond128],
                        ["detail GLOBAL (fond 1/2048)", out.profond2048],
                        ["detail LOCAL (auxPass.b)", out.local]]) {
  console.log(nom.padEnd(28) + v.moy.toFixed(2).padStart(8) + String(v.min).padStart(6) + String(v.max).padStart(6) +
    s2l(v.moy / 255).toFixed(5).padStart(20));
}
console.log("");
console.log("Reperes des mires (octets) : bi-tonale 0,5 a 1,0 | presence aplats 4,0 (1/128) | portail reseau 50");
ws.close();
