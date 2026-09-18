// SONDE DU TROISIEME CANAL de la pyramide — que porte-t-il vraiment ?
//
// Le canal vient d'etre pose (ecart-type local de y, gratuit). Avant d'ecrire
// quoi que ce soit dessus, on le REGARDE : la mire PORTAIL est faite pour ca —
// aplat 128 en haut, reseau fin autour de 128 en bas, donc MEME TON des deux
// cotes et une marche de DETAIL pur. Un canal de presence de detail doit y faire
// une marche ; s'il n'en fait pas, il ne porte pas ce qu'on croit.
//
// La sonde detourne la sortie de la passe finale par mutation du corps WGSL dans
// la page. Rien n'est ecrit sur le disque.
//
// ── DEUX PIEGES PAYES ICI, ET AUCUN DES DEUX NE SE VOIT AU RENDU ────────────
//
// 1. LE MODULE SE PREND DANS LE REGISTRE, JAMAIS PAR UN import() NU. Vite
//    suffixe l'URL d'un fichier EDITE dans la session (?t=...) ; un import par
//    chemin nu rend alors une SECONDE instance du module, qu'on mute sans que le
//    moteur la voie. Symptome : la sonde rendait exactement le ton de la source.
//    Diagnostique en comparant les deux references — elles differaient.
//
// 2. LE DETOUR SE POSE SUR LE RETOUR FINAL, JAMAIS EN COURS DE FONCTION. Un
//    `return` anticipe, meme sous une condition toujours vraie, rend tout ce qui
//    suit du FLOT NON UNIFORME, et WGSL y interdit `textureSample`. Le
//    compilateur le dit mot pour mot — « 'textureSample' must only be called
//    from uniform control flow », en pointant `rb_fine_stats`. Le RENDU, lui, ne
//    dit rien : il sort du BLANC. Sept detours differents ont rendu 255,255,255
//    avant que getCompilationInfo() nomme la cause.
import { readFileSync, writeFileSync } from "node:fs";

const ORIGIN = "http://localhost:1421";
const CDP = "http://localhost:9222";
const SORTIE = "C:/Users/LEETJ/AppData/Local/Temp/claude/C--dev-shaderlab/5cd8e3ee-e6ce-40b9-9de5-528e15ea775a/scratchpad/opti";

const MIRE = "C:/Users/LEETJ/Pictures/shaderlab-mire/shaderlab-mire-portee-2048x16384.jpg";
const PHOTO = "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG";
const cible = process.argv[2] === "photo" ? PHOTO : MIRE;
const nom = process.argv[2] === "photo" ? "photo" : "portail";

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

const FRAME_ID = "__sondeCanal";
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
if (!ctxFrame) throw new Error("contexte iframe introuvable");

const b64 = readFileSync(cible).toString("base64");
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
  if (!mod) throw new Error("module absent du registre de l'etage");
  if (!mod.wgsl.includes(${JSON.stringify(ANCRE)})) throw new Error("ancre du detour introuvable");
  const bin = atob(window.__parts.join(""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
  const cv = document.createElement("canvas");
  cv.width = bmp.width; cv.height = bmp.height;
  const ctx = await initGpu(cv);
  const r = new Renderer(ctx, undefined, undefined, () => 0);
  await r.loadImage(bmp);
  // Clarte a 60 : assez pour REVEILLER la pyramide (le predicat teste !== 0).
  const develop = { reglagesDeBase: { clarity: 60 } };
  const stack = openDocument(r, "photo").stack;
  r.setDevelop(develop);
  window.__s = { r, stack, develop, mod, origine: mod.wgsl };
  return "ok";
})()`, ctxFrame.id);

// Un rendu par canal, plus un TEMOIN qui renvoie `color` : si le temoin ne rend
// pas l'image, le detour est casse et les autres colonnes ne mesurent rien.
const canaux = [
  ["temoin", "color"],
  ["r", "vec4<f32>(vec3<f32>(pyr.r), 1.0)"],
  ["g", "vec4<f32>(vec3<f32>(pyr.g), 1.0)"],
  ["b", "vec4<f32>(vec3<f32>(pyr.b), 1.0)"],
];
const sortie = {};
for (const [cle, expr] of canaux) {
  const res = JSON.parse(await evalIn(`(async () => {
    const { r, stack, develop, mod, origine } = window.__s;
    mod.wgsl = origine.replace(${JSON.stringify(ANCRE)}, "  return " + ${JSON.stringify(expr)} + ";");
    const frame = await r.exportFrame(stack.layers, null, develop);
    const W = frame.width, H = frame.height, px = frame.pixels;
    const x0 = Math.round(W * 0.25), x1 = Math.round(W * 0.75);
    const profil = new Array(H), ampli = new Array(H);
    for (let y = 0; y < H; y++) {
      let s = 0, lo = 255, hi = 0;
      for (let x = x0; x < x1; x++) {
        const v = px[(y * W + x) * 4];
        s += v; if (v < lo) lo = v; if (v > hi) hi = v;
      }
      profil[y] = s / (x1 - x0);
      ampli[y] = hi - lo;
    }
    return JSON.stringify({ W, H, profil, ampli });
  })()`, ctxFrame.id));
  sortie[cle] = res;
  console.log("  canal " + cle + " : " + res.W + " x " + res.H);
}
await evalIn(`window.__s.mod.wgsl = window.__s.origine; "ok"`, ctxFrame.id);

writeFileSync(SORTIE + "/canal-detail-" + nom + ".json", JSON.stringify(sortie));
console.log(nom + " : ecrit");
ws.close();
