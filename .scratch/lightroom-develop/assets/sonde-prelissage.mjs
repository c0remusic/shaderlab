// LE PRE-LISSAGE, MESURE AVANT D'ETRE CONSTRUIT.
//
// research/14 : le portail actuel fonctionne des que le grain baisse — sa course
// passe de 1,5 % a 41 % sur la MEME photo reduite au quart. La correction n'est
// donc pas un portail neuf mais une variance calculee sur un signal DEJA LISSE
// (la « small content image » du binaire).
//
// Reste une question a laquelle aucune mesure n'a repondu : COMBIEN de lissage,
// et a quel ecartement ? Ce script la pose sans rien construire — le pre-lissage
// est simule dans la passe finale, en registres, par des prelevements
// BILINEAIRES (un prelevement place entre quatre texels en moyenne quatre pour
// le prix d'un).
//
// La cible a atteindre est connue : 2,20 de discrimination, la valeur que le
// champ ACTUEL rend sur la photo au quart.
import { readFileSync } from "node:fs";

const ORIGIN = "http://localhost:1421";
const CDP = "http://localhost:9222";
const PHOTO = process.argv[2] ?? "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG";
const ANCRE = "  return vec4<f32>(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);";

// (rayon du pre-lissage en px, ecartement de la tente en px)
const CAS = [
  ["actuel (aucun pre-lissage)", null, null],
  ["lissage 1 px, ecart 4", 1, 4],
  ["lissage 2 px, ecart 4", 2, 4],
  ["lissage 2 px, ecart 8", 2, 8],
  ["lissage 4 px, ecart 8", 4, 8],
  ["lissage 4 px, ecart 16", 4, 16],
  ["lissage 8 px, ecart 16", 8, 16],
  ["lissage 8 px, ecart 32", 8, 32],
];

const AIDE = `
fn rb_y_lisse(uv: vec2<f32>, r: f32) -> f32 {
  // Quatre prelevements bilineaires aux coins d un carre de cote 2r : chacun
  // moyenne quatre texels, donc seize texels pour quatre taps. C est ce qui
  // rend le pre-lissage abordable dans la passe finale.
  let o = r / vec2<f32>(textureDimensions(srcTexture));
  var s = 0.0;
  s = s + dot(textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x, -o.y)).rgb, RB_LUMA);
  s = s + dot(textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x, -o.y)).rgb, RB_LUMA);
  s = s + dot(textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x,  o.y)).rgb, RB_LUMA);
  s = s + dot(textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x,  o.y)).rgb, RB_LUMA);
  return sqrt(max(s / 4.0, 0.0));
}
fn rb_sd_prelisse(uv: vec2<f32>, r: f32, ecart: f32) -> f32 {
  let o = ecart / vec2<f32>(textureDimensions(srcTexture));
  var s = 0.0;
  var s2 = 0.0;
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      let v = rb_y_lisse(uv + vec2<f32>(f32(i), f32(j)) * o, r);
      s = s + v;
      s2 = s2 + v * v;
    }
  }
  let m = s / 9.0;
  return sqrt(max(s2 / 9.0 - m * m, 0.0));
}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {`;

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

const FRAME_ID = "__sondePrelissage";
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
  window.__pl = { r, mod, openDocument, origine: mod.wgsl };
  const develop = { reglagesDeBase: { texture: 60 } };
  const stack = openDocument(r, "photo").stack;
  r.setDevelop(develop);
  window.__pl.stack = stack;
  window.__pl.develop = develop;
  window.__pl.ref = await r.exportFrame(stack.layers, null, develop);
  return "ok";
})()`, ctxFrame.id);

console.log("photo : " + PHOTO.split("/").pop());
console.log("");
console.log("champ                          plat(med)   bord(med)   rapport   course du portail");
for (const [nom, r, ecart] of CAS) {
  const expr = r === null
    ? "sqrt(max(varMoyenne, 0.0))"
    : "rb_sd_prelisse(uv, " + r.toFixed(1) + ", " + ecart.toFixed(1) + ")";
  const res = JSON.parse(await evalIn(`(async () => {
    const { r, mod, openDocument, origine, stack, develop, ref } = window.__pl;
    mod.wgsl = origine
      .replace("fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {", ${JSON.stringify(AIDE)})
      .replace(${JSON.stringify(ANCRE)}, "  return vec4<f32>(vec3<f32>(" + ${JSON.stringify(expr)} + "), 1.0);");
    const f = await r.exportFrame(stack.layers, null, develop);
    mod.wgsl = origine;
    const W = f.width, H = f.height;
    const plats = [], bords = [];
    for (let y = 8; y < H - 8; y += 13) {
      for (let x = 8; x < W - 8; x += 13) {
        const i = (y * W + x) * 4;
        const g = Math.abs(ref.pixels[i + 4] - ref.pixels[i - 4]) + Math.abs(ref.pixels[i + W * 4] - ref.pixels[i - W * 4]);
        const v = f.pixels[i];
        if (g <= 2) plats.push(v); else if (g >= 40) bords.push(v);
      }
    }
    plats.sort((a, b) => a - b); bords.sort((a, b) => a - b);
    return JSON.stringify({ plat: plats[Math.floor(plats.length / 2)] ?? -1, bord: bords[Math.floor(bords.length / 2)] ?? -1 });
  })()`, ctxFrame.id));
  const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const vp = s2l(res.plat / 255), vb = s2l(res.bord / 255);
  // Portail a epsilon RECALE sur le plat de ce champ : eps = vp², donc le
  // portail vaut 0,5 sur la matiere plate et se ferme au bord. Sans ce recalage
  // on comparerait des champs d'echelles differentes a un epsilon unique.
  const eps = Math.max(vp * vp, 1e-12);
  const pp = eps / (vp * vp + eps), pb = eps / (vb * vb + eps);
  console.log(
    nom.padEnd(30) + " " + vp.toFixed(5).padStart(9) + " " + vb.toFixed(5).padStart(11) + " " +
    (vb / Math.max(vp, 1e-9)).toFixed(2).padStart(9) + "   " + pp.toFixed(3) + " -> " + pb.toFixed(3));
}
await evalIn(`window.__pl.mod.wgsl = window.__pl.origine; "ok"`, ctxFrame.id);
console.log("");
console.log("Cible : 2,20 — ce que le champ ACTUEL rend sur la meme photo au quart (research/14).");
ws.close();
