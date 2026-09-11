// Sonde ISOLEE du ticket 04 : atan2 de Dawn au 3e quadrant.
// Un compute shader calcule atan2(y, x) pour des couples francs des quatre
// quadrants, de DEUX facons : (A) valeurs LUES d'un storage buffer (runtime GPU,
// defait le constant-folding de Tint) et (B) memes valeurs ecrites en LITTERAUX
// dans le source WGSL (potentiellement repliees a la compilation). On compare les
// deux a Math.atan2 cote Node. Teste aussi -0.0 et les couples negatifs nuls.
// Usage : node sonde-atan2-quadrants.mjs   (app CDP 9223 + Vite 1421)
import path from "node:path";
import { writeFileSync } from "node:fs";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const CDP = "http://localhost:9223";

// Couples (y, x). Les quatre quadrants francs, plus les bords a zero signe.
const CASES = [
  { label: "Q1 (+,+)", y: 0.5, x: 0.5 },
  { label: "Q2 (+,-)", y: 0.5, x: -0.5 },
  { label: "Q3 (-,-)", y: -0.5, x: -0.5 },
  { label: "Q4 (-,+)", y: -0.5, x: 0.5 },
  { label: "Q3 bleu OKLab", y: -0.1, x: -0.05 },
  { label: "axe -x, y=+0", y: 0.0, x: -1.0 },
  { label: "axe -x, y=-0", y: -0.0, x: -1.0 },
  { label: "-0,-0", y: -0.0, x: -0.0 },
  { label: "Q3 petit", y: -0.001, x: -0.002 },
];

const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) throw new Error("pas de cible CDP sur " + CDP);
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
  const r = await send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
    ...(contextId === undefined ? {} : { contextId }),
  });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
  return r.result?.result?.value;
};

const FRAME_ID = "__sondeAtan2";
const before = new Set(contexts.map((c) => c.uniqueId));
const loaded = await evalIn(`new Promise((res) => {
  document.getElementById(${JSON.stringify(FRAME_ID)})?.remove();
  const f = document.createElement("iframe");
  f.id = ${JSON.stringify(FRAME_ID)};
  f.style.cssText = "position:absolute;left:-9999px;width:16px;height:16px";
  f.src = ${JSON.stringify(`${ORIGIN}/scripts/render-check-page.html`)};
  f.onload = () => res("ok");
  f.onerror = () => res("erreur de chargement");
  document.body.appendChild(f);
})`);
if (loaded !== "ok") throw new Error(`iframe: ${loaded}`);
await new Promise((r) => setTimeout(r, 300));
const frameCtx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || (c.auxData && c.auxData.type === "iframe")));
if (!frameCtx) throw new Error("contexte iframe introuvable");

// Corps WGSL du compute. binding 0 = entrees (y, x) LUES au runtime ; binding 1 =
// sorties. Deux lignes : atan2 runtime (buffer) et atan2 des memes LITTERAUX.
// Les litteraux sont injectes depuis Node pour rester alignes avec CASES.
const litLines = CASES.map((c, i) =>
  `  out_lit[${i}] = atan2(f32(${c.y}), f32(${c.x}));`
).join("\n");

const WGSL = [
  "@group(0) @binding(0) var<storage, read> inp: array<vec2<f32>>;",
  "@group(0) @binding(1) var<storage, read_write> out_rt: array<f32>;",
  "@group(0) @binding(2) var<storage, read_write> out_lit: array<f32>;",
  "@compute @workgroup_size(1)",
  "fn main(@builtin(global_invocation_id) gid: vec3<u32>) {",
  "  let i = gid.x;",
  "  let v = inp[i];",
  "  out_rt[i] = atan2(v.x, v.y);",
  "  if (i == 0u) {",
  litLines,
  "  }",
  "}",
].join("\n");

const cases = CASES.map((c) => ({ label: c.label, y: c.y, x: c.x, ref: Math.atan2(c.y, c.x) }));

const expr = `(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const cv = document.createElement("canvas"); cv.width = 4; cv.height = 4;
  const ctx = await initGpu(cv);
  const device = ctx.device;
  let adapterInfo = null;
  try {
    const ad = await navigator.gpu.requestAdapter();
    const inf = ad.info ?? (ad.requestAdapterInfo ? await ad.requestAdapterInfo() : null);
    if (inf) adapterInfo = { vendor: inf.vendor, architecture: inf.architecture, device: inf.device, description: inf.description };
  } catch (e) { adapterInfo = { err: String(e) }; }
  const cases = ${JSON.stringify(cases)};
  const N = cases.length;

  // Entrees (y, x) -> vec2 = (y, x), lues au runtime.
  const inData = new Float32Array(N * 2);
  for (let k = 0; k < N; k++) { inData[k*2] = cases[k].y; inData[k*2+1] = cases[k].x; }
  const inBuf = device.createBuffer({ size: inData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(inBuf, 0, inData);

  const rtBuf = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const litBuf = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

  const module = device.createShaderModule({ code: ${JSON.stringify(WGSL)} });
  const info = await module.getCompilationInfo();
  const msgs = info.messages.map((m) => m.type + ": " + m.message);

  const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
  const bg = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: inBuf } },
    { binding: 1, resource: { buffer: rtBuf } },
    { binding: 2, resource: { buffer: litBuf } },
  ]});
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(N);
  pass.end();
  const readRt = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const readLit = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  enc.copyBufferToBuffer(rtBuf, 0, readRt, 0, N * 4);
  enc.copyBufferToBuffer(litBuf, 0, readLit, 0, N * 4);
  device.queue.submit([enc.finish()]);
  await readRt.mapAsync(GPUMapMode.READ);
  await readLit.mapAsync(GPUMapMode.READ);
  const rt = Array.from(new Float32Array(readRt.getMappedRange().slice(0)));
  const lit = Array.from(new Float32Array(readLit.getMappedRange().slice(0)));
  readRt.unmap(); readLit.unmap();
  return JSON.stringify({ adapter: adapterInfo, msgs, rt, lit });
})()`;

let res;
for (let attempt = 0; attempt < 3; attempt++) {
  try { res = JSON.parse(await evalIn(expr, frameCtx.id)); break; }
  catch (err) { if (attempt === 2) throw err; await new Promise((r) => setTimeout(r, 3000)); }
}

console.log("Compilation WGSL:", res.msgs.length ? res.msgs : "aucun message");
console.log("");
const rows = [];
let bugRt = false, bugLit = false;
for (let k = 0; k < cases.length; k++) {
  const c = cases[k];
  const rt = res.rt[k];
  const lit = res.lit[k];
  const dRt = Math.abs(rt - c.ref);
  const dLit = Math.abs(lit - c.ref);
  const okRt = dRt < 1e-3;
  const okLit = dLit < 1e-3;
  if (!okRt) bugRt = true;
  if (!okLit) bugLit = true;
  rows.push({ label: c.label, y: c.y, x: c.x, ref: c.ref, runtime: rt, litteral: lit, okRuntime: okRt, okLitteral: okLit });
  console.log(
    `${c.label.padEnd(16)} ref=${c.ref.toFixed(4).padStart(9)}  rt=${rt.toFixed(4).padStart(9)} ${okRt ? "OK " : "BUG"}  lit=${lit.toFixed(4).padStart(9)} ${okLit ? "OK " : "BUG"}`
  );
}
console.log("");
console.log("Runtime (buffer) buggy ?", bugRt, " | Litteral (const-fold possible) buggy ?", bugLit);
writeFileSync(path.join(OUT, "sonde-atan2-resultats.json"), JSON.stringify({ adapter: res.adapter, msgs: res.msgs, bugRt, bugLit, rows }, null, 2));
console.log("-> sonde-atan2-resultats.json");
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
