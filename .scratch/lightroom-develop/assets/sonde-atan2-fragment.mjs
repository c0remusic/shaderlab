// Sonde ticket 04 (volet 3) : atan2 dans un FRAGMENT shader (le chemin des vrais
// effets), pas un compute. Tint peut abaisser atan2 differemment selon le stage ;
// ce volet ferme cet ecart. On rend Nx1 en rgba16float, chaque pixel k porte
// atan2(y_k, x_k) avec (y_k, x_k) LUS d'un storage buffer read-only (runtime).
// Relu par copyTextureToBuffer. Usage : node sonde-atan2-fragment.mjs (CDP 9223 + Vite 1421)
import path from "node:path";
import { writeFileSync } from "node:fs";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const CDP = "http://localhost:9223";

const CASES = [
  { label: "Q1 (+,+)", y: 0.5, x: 0.5 },
  { label: "Q2 (+,-)", y: 0.5, x: -0.5 },
  { label: "Q3 (-,-)", y: -0.5, x: -0.5 },
  { label: "Q4 (-,+)", y: -0.5, x: 0.5 },
  { label: "Q3 bleu", y: -0.312, x: -0.032 },
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
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...(contextId === undefined ? {} : { contextId }) });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
  return r.result?.result?.value;
};

const FRAME_ID = "__sondeAtan2Frag";
const before = new Set(contexts.map((c) => c.uniqueId));
const loaded = await evalIn(`new Promise((res) => {
  document.getElementById(${JSON.stringify(FRAME_ID)})?.remove();
  const f = document.createElement("iframe");
  f.id = ${JSON.stringify(FRAME_ID)};
  f.style.cssText = "position:absolute;left:-9999px;width:16px;height:16px";
  f.src = ${JSON.stringify(`${ORIGIN}/scripts/render-check-page.html`)};
  f.onload = () => res("ok"); f.onerror = () => res("erreur de chargement");
  document.body.appendChild(f);
})`);
if (loaded !== "ok") throw new Error(`iframe: ${loaded}`);
await new Promise((r) => setTimeout(r, 300));
const frameCtx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || (c.auxData && c.auxData.type === "iframe")));
if (!frameCtx) throw new Error("contexte iframe introuvable");

const WGSL = [
  "@group(0) @binding(0) var<storage, read> inp: array<vec2<f32>>;",
  "@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {",
  "  var p = array<vec2<f32>, 3>(vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));",
  "  return vec4<f32>(p[vi], 0.0, 1.0);",
  "}",
  "@fragment fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {",
  "  let i = u32(pos.x);",
  "  let v = inp[i];",
  "  return vec4<f32>(atan2(v.x, v.y), 0.0, 0.0, 1.0);",
  "}",
].join("\n");

const cases = CASES.map((c) => ({ label: c.label, y: c.y, x: c.x, ref: Math.atan2(c.y, c.x) }));

const expr = `(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const cv = document.createElement("canvas"); cv.width = 4; cv.height = 4;
  const ctx = await initGpu(cv);
  const device = ctx.device;
  const cases = ${JSON.stringify(cases)};
  const N = cases.length;

  const inData = new Float32Array(N * 2);
  for (let k = 0; k < N; k++) { inData[k*2] = cases[k].y; inData[k*2+1] = cases[k].x; }
  const inBuf = device.createBuffer({ size: inData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(inBuf, 0, inData);

  const tex = device.createTexture({ size: [N, 1], format: "rgba16float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const module = device.createShaderModule({ code: ${JSON.stringify(WGSL)} });
  const info = await module.getCompilationInfo();
  const msgs = info.messages.map((m) => m.type + ": " + m.message);
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: "rgba16float" }] },
    primitive: { topology: "triangle-list" },
  });
  const bg = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: inBuf } }] });
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
  // rgba16float = 8 octets/pixel ; bytesPerRow doit etre multiple de 256.
  const bytesPerRow = 256;
  const readBuf = device.createBuffer({ size: bytesPerRow, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  enc.copyTextureToBuffer({ texture: tex }, { buffer: readBuf, bytesPerRow, rowsPerImage: 1 }, [N, 1, 1]);
  device.queue.submit([enc.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  // Decodage half-float -> float32.
  const u16 = new Uint16Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  const half2f = (h) => {
    const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff;
    if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : (s ? -Infinity : Infinity);
    return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
  };
  const out = [];
  for (let k = 0; k < N; k++) out.push(half2f(u16[k * 4])); // canal R
  return JSON.stringify({ msgs, out });
})()`;

let res;
for (let attempt = 0; attempt < 3; attempt++) {
  try { res = JSON.parse(await evalIn(expr, frameCtx.id)); break; }
  catch (err) { if (attempt === 2) throw err; await new Promise((r) => setTimeout(r, 3000)); }
}

console.log("Compilation WGSL:", res.msgs.length ? res.msgs : "aucun message");
console.log("");
let bug = false;
const rows = [];
for (let k = 0; k < cases.length; k++) {
  const c = cases[k]; const g = res.out[k]; const d = Math.abs(g - c.ref);
  const ok = d < 5e-3; // half-float ~3 digits
  if (!ok) bug = true;
  rows.push({ label: c.label, ref: c.ref, fragment: g, ok });
  console.log(`${c.label.padEnd(12)} ref=${c.ref.toFixed(4).padStart(9)}  frag=${g.toFixed(4).padStart(9)} ${ok ? "OK" : "BUG"}`);
}
console.log("");
console.log("Fragment atan2 buggy au 3e quadrant fini ?", bug);
writeFileSync(path.join(OUT, "sonde-atan2-fragment-resultats.json"), JSON.stringify({ bug, rows }, null, 2));
console.log("-> sonde-atan2-fragment-resultats.json");
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
