// LE MASQUE DE DETAIL AUX TROIS APLATS — la mesure qui tranche la forme du 11.
//
// research/11 etablit par le binaire que Clarte est un GAIN de tone map pilote
// par un masque de DETAIL, sans aucune ponderation par la luminance. Reste a
// savoir si ce masque suffit a produire le profil mesure chez Lightroom, qui
// correspond a un gain lineaire de 0,855 / 0,700 / 1,030 aux bases 32 / 128 / 224
// (converti depuis -2,66 / -19,59 / +2,68 niveaux a Clarte +100).
//
// Si le masque vaut a peu pres la MEME chose aux trois aplats, la ponderation ne
// peut pas venir de lui et il manque encore un terme. S'il varie dans le bon
// sens, la forme du 11 tient et il ne reste qu'a fitter.
//
// AUCUN FICHIER N'EST TOUCHE : les passes profondes sont ajoutees a `mod.passes`
// DANS LA PAGE, et la sortie est detournee sur le retour final. Les deux pieges
// de research/09 s'appliquent et sont respectes — module pris dans le REGISTRE,
// detour sur le RETOUR FINAL.
import { readFileSync } from "node:fs";

const ORIGIN = "http://localhost:1421";
const CDP = "http://localhost:9222";
const MIRE = "C:/dev/shaderlab/.scratch/lightroom-develop/assets/mire/shaderlab-mire-presence-2048x7584.jpg";
const ANCRE = "  return vec4<f32>(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);";

// Bandes lues dans la geometrie de la mire (zone `plat`).
const APLATS = [
  { base: 32, y0: 3576, y1: 3640 },
  { base: 128, y0: 3880, y1: 3944 },
  { base: 224, y0: 4184, y1: 4248 },
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

const FRAME_ID = "__masqueAplats";
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

const prep = JSON.parse(await evalIn(`(async () => {
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

  // Les corps des deux noyaux se PRENNENT dans les passes existantes, jamais
  // recopies : une copie deriverait du jour ou l'une des deux change.
  const passesOrigine = mod.passes.slice();
  const bas = passesOrigine[1].wgsl;   // DOWNSAMPLE
  const haut = passesOrigine[4].wgsl;  // UPSAMPLE a ecartement fixe
  const utile = passesOrigine[0].enabled;
  const profondes = [];
  for (const scale of [0.25, 0.125, 0.0625, 0.03125, 0.015625, 0.0078125]) profondes.push({ scale, wgsl: bas, enabled: utile });
  for (const scale of [0.015625, 0.03125, 0.0625]) profondes.push({ scale, wgsl: haut, enabled: utile });
  mod.passes = passesOrigine.concat(profondes);

  window.__m = { r, mod, openDocument, passesOrigine, origine: mod.wgsl,
                 nbAvant: passesOrigine.length, nbApres: mod.passes.length };
  return JSON.stringify({ W: bmp.width, H: bmp.height, nbAvant: passesOrigine.length, nbApres: mod.passes.length });
})()`, ctxFrame.id));
console.log("mire " + prep.W + " x " + prep.H + " — passes " + prep.nbAvant + " -> " + prep.nbApres);

const SORTIES = [
  ["detail profond (prevPass.b)", "vec4<f32>(vec3<f32>(textureSample(prevPass, srcSampler, uv).b), 1.0)"],
  ["detail moyen (auxPass.b)", "vec4<f32>(vec3<f32>(pyr.b), 1.0)"],
  ["luma profonde (prevPass.r)", "vec4<f32>(vec3<f32>(textureSample(prevPass, srcSampler, uv).r), 1.0)"],
  ["temoin (color)", "color"],
];

const lignes = {};
for (const [nom, expr] of SORTIES) {
  const res = JSON.parse(await evalIn(`(async () => {
    const { r, mod, openDocument, origine } = window.__m;
    mod.wgsl = origine.replace(${JSON.stringify(ANCRE)}, "  return " + ${JSON.stringify(expr)} + ";");
    const develop = { reglagesDeBase: { clarity: 60 } };
    const stack = openDocument(r, "photo").stack;
    r.setDevelop(develop);
    const frame = await r.exportFrame(stack.layers, null, develop);
    const W = frame.width, px = frame.pixels;
    const x0 = Math.round(W * 0.3), x1 = Math.round(W * 0.7);
    const bandes = ${JSON.stringify(APLATS)}.map((a) => {
      let s = 0, n = 0;
      for (let y = a.y0 + 8; y < a.y1 - 8; y++) {
        for (let x = x0; x < x1; x++) { s += px[(y * W + x) * 4]; n++; }
      }
      return { base: a.base, octet: s / n };
    });
    return JSON.stringify(bandes);
  })()`, ctxFrame.id));
  lignes[nom] = res;
}
await evalIn(`window.__m.mod.wgsl = window.__m.origine; window.__m.mod.passes = window.__m.passesOrigine; "ok"`, ctxFrame.id);

console.log("");
console.log("sortie                           base 32    base 128   base 224");
for (const [nom, bandes] of Object.entries(lignes)) {
  console.log(nom.padEnd(32) + bandes.map((b) => b.octet.toFixed(2).padStart(10)).join(" "));
}
console.log("");
console.log("Cible : le gain LINEAIRE de Lightroom a Clarte +100 vaut");
console.log("  base  32 : 0.855      base 128 : 0.700      base 224 : 1.030");
console.log("Si le masque est PLAT aux trois aplats, il ne peut pas produire ce profil.");
ws.close();
