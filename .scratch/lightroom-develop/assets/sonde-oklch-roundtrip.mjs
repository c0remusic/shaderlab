// Sonde ticket 04 (volet 2) : reproduire EXACTEMENT le constat du ticket 01.
// On execute les VRAIES fonctions OKLAB_WGSL (oklab_to_oklch, oklch_to_oklab)
// sur GPU, sur des couleurs sRGB reelles (dont le bleu, 3e quadrant a<0 b<0),
// valeurs LUES d'un buffer (runtime, pas de const-fold), et on compare :
//   - hue GPU vs hue TS (oklabToOklch)         -> le symptome cite : 0,262 vs 0,733
//   - round-trip oklch_to_oklab(oklab_to_oklch(lab)) vs lab -> identite ?
// Usage : node sonde-oklch-roundtrip.mjs   (app CDP 9223 + Vite 1421)
import path from "node:path";
import { writeFileSync } from "node:fs";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const CDP = "http://localhost:9223";

// Couleurs sRGB perceptuelles (0..1). Le bleu est le cas du ticket 01.
const SRGB = [
  { label: "bleu pur", r: 0, g: 0, b: 1 },
  { label: "bleu roi", r: 0.1, g: 0.2, b: 0.9 },
  { label: "rouge pur", r: 1, g: 0, b: 0 },
  { label: "vert pur", r: 0, g: 1, b: 0 },
  { label: "cyan", r: 0, g: 1, b: 1 },
  { label: "magenta", r: 1, g: 0, b: 1 },
  { label: "violet", r: 0.4, g: 0.1, b: 0.7 },
  { label: "orange", r: 1, g: 0.5, b: 0 },
  { label: "gris 50", r: 0.5, g: 0.5, b: 0.5 },
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

const FRAME_ID = "__sondeOklch";
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

// Le compute lit un LAB (lue au runtime), calcule oklch et le round-trip.
// sortie par couleur : oklch (3) + roundtrip lab (3) = 6 f32.
const COMPUTE = [
  "@group(0) @binding(0) var<storage, read> labIn: array<vec3<f32>>;",
  "@group(0) @binding(1) var<storage, read_write> outp: array<vec3<f32>>;",
  "@compute @workgroup_size(1)",
  "fn main(@builtin(global_invocation_id) gid: vec3<u32>) {",
  "  let i = gid.x;",
  "  let lab = labIn[i];",
  "  let lch = oklab_to_oklch(lab);",
  "  let back = oklch_to_oklab(lch);",
  "  outp[i*2u] = lch;",
  "  outp[i*2u + 1u] = back;",
  "}",
].join("\n");

const expr = `(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { OKLAB_WGSL, linearSrgbToOklab, oklabToOklch } = await import("/src/render/effects/oklab.ts");
  const { srgbToLinear } = await import("/src/render/effects/srgbTransfer.ts");
  const cv = document.createElement("canvas"); cv.width = 4; cv.height = 4;
  const ctx = await initGpu(cv);
  const device = ctx.device;
  const srgb = ${JSON.stringify(SRGB)};
  const N = srgb.length;

  // sRGB -> lineaire -> OKLab cote TS (reference), et on envoie le LAB au GPU.
  const labs = srgb.map((c) => linearSrgbToOklab([srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b)]));
  const tsOklch = labs.map((lab) => oklabToOklch(lab));

  // vec3 en WGSL = 16 octets d'alignement dans un storage array : stride 16.
  const inData = new Float32Array(N * 4);
  for (let k = 0; k < N; k++) { inData[k*4] = labs[k][0]; inData[k*4+1] = labs[k][1]; inData[k*4+2] = labs[k][2]; }
  const inBuf = device.createBuffer({ size: inData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(inBuf, 0, inData);

  const outCount = N * 2; // vec3 chacun -> stride 16
  const outBuf = device.createBuffer({ size: outCount * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

  const code = OKLAB_WGSL + "\\n" + ${JSON.stringify(COMPUTE)};
  const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo();
  const msgs = info.messages.map((m) => m.type + ": " + m.message);

  const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
  const bg = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: inBuf } },
    { binding: 1, resource: { buffer: outBuf } },
  ]});
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(N);
  pass.end();
  const readBuf = device.createBuffer({ size: outCount * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  enc.copyBufferToBuffer(outBuf, 0, readBuf, 0, outCount * 16);
  device.queue.submit([enc.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const raw = new Float32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();

  const rows = [];
  for (let k = 0; k < N; k++) {
    const lchGpu = [raw[k*8], raw[k*8+1], raw[k*8+2]];
    const backGpu = [raw[k*8+4], raw[k*8+5], raw[k*8+6]];
    const lab = labs[k];
    const rtErr = Math.max(Math.abs(backGpu[0]-lab[0]), Math.abs(backGpu[1]-lab[1]), Math.abs(backGpu[2]-lab[2]));
    rows.push({
      label: srgb[k].label,
      lab,
      hueTs: tsOklch[k][2],
      hueGpu: lchGpu[2],
      chromaTs: tsOklch[k][1],
      chromaGpu: lchGpu[1],
      roundtripMaxErr: rtErr,
    });
  }
  return JSON.stringify({ msgs, rows });
})()`;

let res;
for (let attempt = 0; attempt < 3; attempt++) {
  try { res = JSON.parse(await evalIn(expr, frameCtx.id)); break; }
  catch (err) { if (attempt === 2) throw err; await new Promise((r) => setTimeout(r, 3000)); }
}

console.log("Compilation WGSL:", res.msgs.length ? res.msgs : "aucun message");
console.log("");
console.log("label           a       b       hueTS   hueGPU  dHue    rtErr");
let anyHueBug = false, anyRtBug = false;
for (const r of res.rows) {
  const dHue = Math.abs(((r.hueGpu - r.hueTs) % 1 + 1.5) % 1 - 0.5); // ecart circulaire en tours
  if (dHue > 0.002 && r.chromaTs > 1e-3) anyHueBug = true;
  if (r.roundtripMaxErr > 1e-3) anyRtBug = true;
  console.log(
    `${r.label.padEnd(14)} ${r.lab[1].toFixed(3).padStart(6)} ${r.lab[2].toFixed(3).padStart(6)}  ${r.hueTs.toFixed(4)}  ${r.hueGpu.toFixed(4)}  ${dHue.toFixed(4)}  ${r.roundtripMaxErr.toExponential(2)}`
  );
}
console.log("");
console.log("Hue GPU != Hue TS (sur couleur chromatique) ?", anyHueBug);
console.log("Round-trip oklch->oklab casse ?", anyRtBug);
writeFileSync(path.join(OUT, "sonde-oklch-resultats.json"), JSON.stringify({ anyHueBug, anyRtBug, rows: res.rows }, null, 2));
console.log("-> sonde-oklch-resultats.json");
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
