// ABLATION DE `grain` — un facteur a la fois.
//
// POURQUOI. La ventilation du 01 dit que grain coute 4,65 ms a 26 Mpx, soit
// 5,9 fois le plancher de copie et 39 % de tout le calcul de la frame. Un
// CLASSEMENT ne donne pas la CAUSE (lecon du verre, `19-le-cout-du-verre`) :
// seule une ablation, un facteur a la fois, la designe.
//
// COMMENT. Le corps WGSL d'un module d'effet est une simple chaine, et la cle
// du cache de pipelines EST la chaine composee. Muter `grain.wgsl` dans la page
// suffit donc a obtenir une variante compilee, sans toucher au disque et sans
// rien committer.
//
// Chaque variante retire UN terme et garde la structure de passe identique :
// meme nombre de passes, meme resolution, meme uniform. Seul le travail par
// pixel change.
import { readFileSync } from "node:fs";

const ORIGIN = "http://localhost:1421";
const CDP = "http://localhost:9222";
const PHOTO = "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG";
const REPETITIONS = 5;

const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) throw new Error("pas de cible CDP");
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

const FRAME_ID = "__ablationGrain";
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

const b64 = readFileSync(PHOTO).toString("base64");
await evalIn(`window.__parts = []; "ok"`, ctxFrame.id);
for (let i = 0; i < b64.length; i += 2_000_000) {
  await evalIn(`window.__parts.push(${JSON.stringify(b64.slice(i, i + 2_000_000))}); "ok"`, ctxFrame.id);
}

const init = JSON.parse(await evalIn(`(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const { grain } = await import("/src/render/effects/grain.ts");
  const bin = atob(window.__parts.join(""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
  const cv = document.createElement("canvas");
  cv.width = bmp.width; cv.height = bmp.height;
  const ctx = await initGpu(cv);
  const r = new Renderer(ctx, undefined, undefined, () => 0);
  await r.loadImage(bmp);
  window.__ab = { r, openDocument, grain, wgslOrigine: grain.wgsl };
  return JSON.stringify({ W: bmp.width, H: bmp.height, timing: !!ctx.device.features.has("timestamp-query") });
})()`, ctxFrame.id));
console.log("photo " + init.W + " x " + init.H + " — timestamp-query : " + init.timing);
if (!init.timing) throw new Error("pas de timestamp-query : aucune mesure GPU possible");

// ── Les variantes ────────────────────────────────────────────────────────────
// Chacune est une liste de remplacements litteraux appliques au corps d'origine.
// Un remplacement qui ne trouve pas sa cible LEVE : une ablation silencieusement
// inappliquee mesurerait le temoin en croyant mesurer autre chose.
const VARIANTES = [
  { nom: "temoin", bitExact: true, remplacements: [] },

  // ⚠️ CONTROLE DE BRUIT, et il n'est pas decoratif. Corps STRICTEMENT identique
  // au temoin — un commentaire de plus, donc une autre chaine, donc un autre
  // pipeline, mais exactement le meme travail. L'ecart entre `temoin` et
  // `temoin-bis` EST le plancher de bruit de cette campagne : aucune ablation
  // plus petite que lui ne peut etre conclue. Pose apres deux passes ou les
  // termes secondaires ont echange leurs rangs d'un run a l'autre (le transfert
  // sRGB a rendu 7 % puis 27 %), ce qui ne se voit pas sans temoin double.
  { nom: "temoin-bis", bitExact: true, remplacements: [["fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {", "// controle de bruit\nfn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {"]] },

  // `select(a, b, c)` evalue LES DEUX branches. Les deux champs de bruit sont
  // donc calcules a chaque pixel, quel que soit le mode. La condition est
  // UNIFORME (elle vient de params), donc un vrai branchement ne diverge pas.
  {
    nom: "branche-au-lieu-de-select",
    bitExact: true,
    remplacements: [[
      "  let couches = select(analogique, capteur, numerique);",
      "  var couches = vec3<f32>(0.0);\n  if (numerique) { couches = capteur; } else { couches = analogique; }",
    ]],
  },

  // Isole le cout des DOUZE hash du bruit de valeur (3 canaux x 4 coins).
  {
    nom: "sans-bruit-analogique",
    bitExact: false,
    remplacements: [[
      "  let analogique = vec3<f32>(\n    valueNoise(ap) - 0.5,\n    valueNoise(ap + offG) - 0.5,\n    valueNoise(ap + offB) - 0.5\n  )",
      "  let analogique = vec3<f32>(ap.x * 0.0 + 0.1, 0.2, 0.3)",
    ]],
  },

  // Isole le cout des TROIS hash du bruit capteur — celui qui ne sert jamais
  // en mode analogique et que `select` calcule quand meme.
  {
    nom: "sans-bruit-capteur",
    bitExact: false,
    remplacements: [[
      "  let capteur = vec3<f32>(\n    hash(dp) - 0.5,\n    hash(dp + offG) - 0.5,\n    hash(dp + offB) - 0.5\n  );",
      "  let capteur = vec3<f32>(dp.x * 0.0 + 0.1, 0.2, 0.3);",
    ]],
  },

  // Isole les CINQ pow() : un linear_to_srgb et quatre srgb_to_linear.
  {
    nom: "sans-transferts-srgb",
    bitExact: false,
    remplacements: [
      ["fn srgb_to_linear(c: f32) -> f32 {\n  let x = max(c, 0.0);\n  return select(pow((x + 0.055) / 1.055, 2.4), x / 12.92, x <= 0.04045);\n}",
       "fn srgb_to_linear(c: f32) -> f32 {\n  return max(c, 0.0);\n}"],
      ["fn linear_to_srgb(c: f32) -> f32 {\n  let x = max(c, 0.0);\n  return select(1.055 * pow(x, 1.0 / 2.4) - 0.055, x * 12.92, x <= 0.0031308);\n}",
       "fn linear_to_srgb(c: f32) -> f32 {\n  return max(c, 0.0);\n}"],
    ],
  },

  // Isole le sqrt de la normalisation d'amplitude.
  {
    nom: "sans-sqrt-normalisation",
    bitExact: false,
    remplacements: [[
      "  let noise = melange / sqrt(1.0 / 3.0 + (2.0 / 3.0) * chroma * chroma);",
      "  let noise = melange * 1.732;",
    ]],
  },

  // PISTE DE CORRECTION, pas une ablation : les trois couches sortent d'UN seul
  // hachage a trois sorties (hash32 de Dave Hoskins, domaine public) au lieu de
  // trois hachages scalaires. Quatre appels au lieu de douze, meme structure de
  // bruit, meme statistique — mais un TIRAGE different, donc pas bit-exact.
  {
    nom: "piste-hash-a-trois-sorties",
    bitExact: false,
    remplacements: [
      ["fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {",
       `fn hash3(p: vec2<f32>) -> vec3<f32> {
  var p3 = fract(vec3<f32>(p.xyx) * vec3<f32>(0.1031, 0.1030, 0.0973));
  p3 = p3 + dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
fn valueNoise3(p: vec2<f32>) -> vec3<f32> {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash3(i), hash3(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash3(i + vec2<f32>(0.0, 1.0)), hash3(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {`],
      ["  let analogique = vec3<f32>(\n    valueNoise(ap) - 0.5,\n    valueNoise(ap + offG) - 0.5,\n    valueNoise(ap + offB) - 0.5\n  )",
       "  let analogique = (valueNoise3(ap) - vec3<f32>(0.5))"],
    ],
  },

  // Les deux corrections cumulees : un seul champ de bruit calcule (le mode
  // sert a la COMPOSITION du corps, pas a un select), et trois sorties par
  // hachage. C'est le plafond de ce qu'on peut gagner sur cet effet.
  {
    nom: "piste-les-deux",
    bitExact: false,
    remplacements: [
      ["fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {",
       `fn hash3(p: vec2<f32>) -> vec3<f32> {
  var p3 = fract(vec3<f32>(p.xyx) * vec3<f32>(0.1031, 0.1030, 0.0973));
  p3 = p3 + dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
fn valueNoise3(p: vec2<f32>) -> vec3<f32> {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash3(i), hash3(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash3(i + vec2<f32>(0.0, 1.0)), hash3(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {`],
      ["  let analogique = vec3<f32>(\n    valueNoise(ap) - 0.5,\n    valueNoise(ap + offG) - 0.5,\n    valueNoise(ap + offB) - 0.5\n  )",
       "  let analogique = (valueNoise3(ap) - vec3<f32>(0.5))"],
      ["  let capteur = vec3<f32>(\n    hash(dp) - 0.5,\n    hash(dp + offG) - 0.5,\n    hash(dp + offB) - 0.5\n  );",
       "  let capteur = vec3<f32>(dp.x * 0.0 + 0.1, 0.2, 0.3);"],
    ],
  },

  // Plancher : l'effet ne fait plus que recopier. Donne le cout de la PASSE,
  // tout calcul retire — a comparer au passthrough du 01 (0,786 ms).
  {
    nom: "plancher-copie",
    bitExact: false,
    remplacements: [[
      "  return vec4<f32>(color.rgb + (perturbe - vec3<f32>(base)), color.a);",
      "  return vec4<f32>(color.rgb, color.a);",
    ]],
  },
];

// ── Protocole ────────────────────────────────────────────────────────────────
// ⚠️ PREMIERE PASSE JETEE : 5 repetitions par variante, mesurees en bloc, ont
// rendu TROIS ablations plus LENTES que le temoin — physiquement impossible,
// donc du bruit. Deux corrections, et elles ne sont pas cosmetiques :
//
//  1. ROUND-ROBIN. Mesurer une variante entierement avant la suivante fait
//     porter toute derive d'horloge GPU par la variante qui passe a ce
//     moment-la. En tournant variante par variante a chaque tour, la derive
//     frappe tout le monde pareil.
//  2. MINIMUM, PAS MEDIANE. Le travail est deterministe : le bruit ne peut
//     qu'AJOUTER du temps (preemption, changement d'etat d'horloge). Le
//     minimum sur N tours est donc l'estimateur du cout reel ; la mediane
//     mesure l'etat de la machine autant que celui du shader.
const TOURS = 30;

await evalIn(`(async () => {
  const { r, openDocument, grain, wgslOrigine } = window.__ab;
  window.__ab.prepare = (remplacements) => {
    let corps = wgslOrigine;
    for (const [avant, apres] of remplacements) {
      if (!corps.includes(avant)) throw new Error("cible d'ablation introuvable");
      corps = corps.replace(avant, apres);
    }
    grain.wgsl = corps;
  };
  const stack = openDocument(r, "photo").stack;
  stack.addLayer("grain");
  window.__ab.stack = stack;
  window.__ab.unTour = async () => {
    const p = r.captureGpuTiming();
    const frame = await r.exportFrame(stack.layers, null, {});
    const rap = await p;
    const g = rap.passes.filter((x) => x.label === "grain");
    if (g.length !== 1) throw new Error("passes grain = " + g.length);
    let s = 0;
    for (let k = 0; k < frame.pixels.length; k += 4 * 9973) {
      s = (s + frame.pixels[k] * 31 + frame.pixels[k + 1] * 7 + frame.pixels[k + 2]) % 2147483647;
    }
    return { duree: g[0].durationMs, signature: s };
  };
  return "ok";
})()`, ctxFrame.id);

const mesures = new Map(VARIANTES.map((v) => [v.nom, []]));
const signatures = new Map();
for (let tour = 0; tour <= TOURS; tour++) {
  for (const v of VARIANTES) {
    const res = JSON.parse(await evalIn(`(async () => {
      window.__ab.prepare(${JSON.stringify(v.remplacements)});
      const t = await window.__ab.unTour();
      return JSON.stringify(t);
    })()`, ctxFrame.id));
    // Tour 0 = compilation des sept pipelines et montee en horloge : jete.
    if (tour > 0) mesures.get(v.nom).push(res.duree);
    signatures.set(v.nom, res.signature);
  }
  if (tour % 5 === 0) console.log("  tour " + tour + "/" + TOURS);
}

const resultats = VARIANTES.map((v) => {
  const xs = mesures.get(v.nom);
  const tries = [...xs].sort((a, b) => a - b);
  return {
    ...v,
    min: tries[0],
    mediane: tries[Math.floor(tries.length / 2)],
    max: tries[tries.length - 1],
    signature: signatures.get(v.nom),
  };
});

// Remise du corps d'origine : la page ne doit pas garder une variante.
await evalIn(`window.__ab.grain.wgsl = window.__ab.wgslOrigine; "ok"`, ctxFrame.id);

const temoin = resultats.find((x) => x.nom === "temoin");
const plancher = resultats.find((x) => x.nom === "plancher-copie");
console.log("");
console.log("variante                        min     mediane      max    ce que l'ablation retire");
for (const r of resultats) {
  const delta = temoin.min - r.min;
  const partCalcul = (100 * delta) / (temoin.min - plancher.min);
  console.log(
    r.nom.padEnd(28) +
      (r.min.toFixed(3)).padStart(7) +
      (r.mediane.toFixed(3)).padStart(11) +
      (r.max.toFixed(3)).padStart(9) +
      (r.nom === "temoin" ? "      —" : ("   -" + delta.toFixed(3) + " ms = " + partCalcul.toFixed(0) + " % du calcul")),
  );
}
console.log("");
console.log("plancher de passe : " + plancher.min.toFixed(3) + " ms (le passthrough du 01 vaut 0,786)");
console.log("calcul de grain au-dessus du plancher : " + (temoin.min - plancher.min).toFixed(3) + " ms");
console.log("");
for (const r of resultats) {
  if (r.bitExact && r.signature !== temoin.signature) {
    console.log("⚠️  " + r.nom + " est annoncee BIT-EXACTE et sa signature differe (" + r.signature + " vs " + temoin.signature + ")");
  } else if (r.bitExact && r.nom !== "temoin") {
    console.log("✅ " + r.nom + " : signature IDENTIQUE au temoin (" + r.signature + ") — meme image, moins de travail");
  }
}
ws.close();
