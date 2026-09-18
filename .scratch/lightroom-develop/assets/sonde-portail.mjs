// LE PORTAIL DE TEXTURE — REGARDER LES CHAMPS AVANT D'ECRIRE UNE FORMULE.
//
// research/08 : le portail est un detecteur de GRAIN, pas de bord. La variance
// vaut 0,015 partout parce que le grain du capteur la remplit a lui seul, et le
// portail reste bloque a 0,33 avec 15 % de course au bord. Deux corrections ont
// deja ete ecrites et revertees pour avoir module un coefficient JAMAIS REGARDE.
// Le fichier ordonne donc ce geste-ci, et pas une formule de plus.
//
// LA QUESTION, et une seule : une mesure de structure calculee sur le signal
// DEJA LISSE separe-t-elle un bord d'un grain, la ou la variance locale ne le
// fait pas ? « Variance du flou » contre « flou de la variance ».
//
// Le classement bord / plat se fait sur le GRADIENT de l'image elle-meme, pas
// sur une position ecrite en dur : la discrimination se mesure sur toute
// l'image, pas sur un bord choisi.
import { readFileSync } from "node:fs";

const ORIGIN = "http://localhost:1421";
const CDP = "http://localhost:9222";
// Usage : node sonde-portail.mjs [chemin-photo] [facteur-d-ecartement]
const PHOTO = process.argv[2] ?? "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG";
const FACTEUR = Number(process.argv[3] ?? 1);
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

const FRAME_ID = "__sondePortail";
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

// CANDIDATS. Chacun sort dans le canal ROUGE, en LINEAIRE (la cible est sRGB
// par le format, donc la valeur ecrite est encodee a l'ecriture : on redecode
// cote lecture, jamais avant).
//
// `varMoyenne` est l'actuel : E[y²] - E[y]² sur le support de la pyramide, donc
// grain COMPRIS. Les candidats calculent la variance de `auxPass.g`, c'est-a-dire
// du signal DEJA LISSE, sur une tente 3x3 dont l'ecartement est donne en texels
// de la pyramide — le grain y est deja moyenne, seule la structure survit.
const ECARTS = [2, 4, 8, 16];
const CANDIDATS = [["actuel (variance locale)", "sqrt(max(varMoyenne, 0.0))"]];
for (const n of ECARTS) {
  CANDIDATS.push([
    "structure, ecart " + n + " px",
    "rb_sd_structure(uv, " + (n * FACTEUR).toFixed(3) + ")",
  ]);
}

// La fonction de diagnostic, injectee devant fs_main. Variance d'une tente 3x3
// de `auxPass.g` calculee EN REGISTRES : c'est le point — un aller-retour par une
// cible 8 bits detruirait une variance de l'ordre de 1e-4.
const AIDE = `
fn rb_sd_structure(uv: vec2<f32>, ecart: f32) -> f32 {
  let o = ecart / vec2<f32>(textureDimensions(srcTexture));
  var s = 0.0;
  var s2 = 0.0;
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      let v = textureSample(auxPass, srcSampler, uv + vec2<f32>(f32(i), f32(j)) * o).g;
      s = s + v;
      s2 = s2 + v * v;
    }
  }
  let m = s / 9.0;
  return sqrt(max(s2 / 9.0 - m * m, 0.0));
}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {`;

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
  window.__sp = { r, mod, openDocument, origine: mod.wgsl };
  return "ok";
})()`, ctxFrame.id);

// Le TEMOIN d'abord : sans lui, aucune colonne ne mesure rien (research/09).
const temoin = JSON.parse(await evalIn(`(async () => {
  const { r, mod, openDocument, origine } = window.__sp;
  mod.wgsl = origine;
  const develop = { reglagesDeBase: { texture: 60 } };
  const stack = openDocument(r, "photo").stack;
  r.setDevelop(develop);
  const f = await r.exportFrame(stack.layers, null, develop);
  window.__sp.ref = f;
  let s = 0, n = 0;
  for (let i = 0; i < f.pixels.length; i += 4 * 97) { s += f.pixels[i]; n++; }
  return JSON.stringify({ W: f.width, H: f.height, moy: s / n });
})()`, ctxFrame.id));
console.log("photo : " + PHOTO.split("/").pop() + "   facteur " + FACTEUR);
console.log("temoin : " + temoin.W + "x" + temoin.H + ", moyenne du rouge " + temoin.moy.toFixed(1));
if (temoin.moy < 5 || temoin.moy > 250) throw new Error("le temoin ne rend pas l'image");

console.log("");
console.log("champ                        plat(med)   bord(med)   rapport   course du portail");
for (const [nom, expr] of CANDIDATS) {
  const res = JSON.parse(await evalIn(`(async () => {
    const { r, mod, openDocument, origine } = window.__sp;
    mod.wgsl = origine
      .replace("fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {", ${JSON.stringify(AIDE)})
      .replace(${JSON.stringify(ANCRE)}, "  return vec4<f32>(vec3<f32>(" + ${JSON.stringify(expr)} + "), 1.0);");
    const develop = { reglagesDeBase: { texture: 60 } };
    const stack = openDocument(r, "photo").stack;
    r.setDevelop(develop);
    const f = await r.exportFrame(stack.layers, null, develop);
    mod.wgsl = origine;
    // Classement bord / plat par le GRADIENT du temoin, pas par une position.
    const ref = window.__sp.ref, W = f.width, H = f.height;
    const plats = [], bords = [];
    for (let y = 8; y < H - 8; y += 13) {
      for (let x = 8; x < W - 8; x += 13) {
        const i = (y * W + x) * 4;
        const gx = Math.abs(ref.pixels[i + 4] - ref.pixels[i - 4]);
        const gy = Math.abs(ref.pixels[i + W * 4] - ref.pixels[i - W * 4]);
        const g = gx + gy;
        const v = f.pixels[i];
        if (g <= 2) plats.push(v); else if (g >= 40) bords.push(v);
      }
    }
    plats.sort((a, b) => a - b); bords.sort((a, b) => a - b);
    return JSON.stringify({
      plat: plats[Math.floor(plats.length * 0.50)] ?? -1,
      bord: bords[Math.floor(bords.length * 0.50)] ?? -1,
      nPlats: plats.length, nBords: bords.length,
    });
  })()`, ctxFrame.id));
  const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const vp = s2l(res.plat / 255), vb = s2l(res.bord / 255);
  // Course utile du portail eps/(v²+eps) entre plat et bord, a eps courant.
  const eps = 0.0082;
  const portePlat = eps / (vp * vp + eps), porteBord = eps / (vb * vb + eps);
  console.log(
    nom.padEnd(28) +
    vp.toFixed(5).padStart(10) + " " + vb.toFixed(5).padStart(11) + " " +
    (vb / Math.max(vp, 1e-9)).toFixed(2).padStart(10) + " " +
    ("  " + portePlat.toFixed(3) + " -> " + porteBord.toFixed(3)).padStart(16));
}
await evalIn(`window.__sp.mod.wgsl = window.__sp.origine; "ok"`, ctxFrame.id);
console.log("");
console.log("Actuel mesure a 0,369 -> 0,315 au bord (15 % de course) — research/08.");
ws.close();
