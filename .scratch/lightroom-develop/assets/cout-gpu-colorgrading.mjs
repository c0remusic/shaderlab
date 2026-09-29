// COUT GPU DE LA PASSE colorGrading, a 26 Mpx — avant/apres le canal par canal.
//
// Le canal par canal evalue l'operateur trois fois par pixel (ALU seulement, aucune
// lecture de texture en plus). Ca se mesure au lieu de se supposer : temps GPU de la
// passe par timestamp-query (Renderer.captureGpuTiming), sur une image synthetique
// 6240 x 4160 rendue par le vrai pipeline (iframe du harnais : le module est lu TEL
// QU'IL EST SUR LE DISQUE, donc on mesure l'autre version en restaurant le fichier).
//
// Prerequis : app lancee avec CDP 9222 et Vite du depot sur 1421.
// Usage : node cout-gpu-colorgrading.mjs [etiquette]
const ETIQ = process.argv[2] ?? "courant";
const ORIGIN = "http://localhost:1421";
const REPS = 7;
const REGLAGE = { shadowHue: 220, shadowSat: 60, highlightHue: 40, highlightSat: 60, midtoneLum: 30, globalHue: 140, globalSat: 20 };

const targets = await (await fetch("http://localhost:9222/json")).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map(), contexts = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.executionContextCreated") contexts.push(m.params.context);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
await send("Runtime.enable");
const evalIn = async (expression, contextId) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...(contextId === undefined ? {} : { contextId }) });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
  return r.result?.result?.value;
};
const FRAME_ID = "__coutCgFrame";
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
const ctx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || c.auxData?.type === "iframe"));

const res = JSON.parse(await evalIn(`(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const W = 6240, H = 4160;
  const c2 = new OffscreenCanvas(W, H), g = c2.getContext("2d");
  const grad = g.createLinearGradient(0, 0, W, H);
  ["#101830", "#c04020", "#f0d060", "#20a080", "#6030c0", "#f0f0f0"].forEach((c, i, a) => grad.addColorStop(i / (a.length - 1), c));
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const bmp = await createImageBitmap(c2);
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const r = new Renderer(await initGpu(cv), undefined, undefined, () => 0);
  await r.loadImage(bmp);
  const stack = openDocument(r, "fond").stack;
  const mesure = async (dev) => {
    r.setDevelop(dev);
    r.render(stack.layers);                    // chauffe : compile et alloue hors mesure
    await new Promise((ok) => setTimeout(ok, 50));
    const ms = [];
    for (let i = 0; i < ${REPS}; i++) {
      const promesse = r.captureGpuTiming();
      if (!promesse) throw new Error("captureGpuTiming indisponible");
      r.render(stack.layers);
      const rep = await promesse;
      const passes = rep.passes ?? rep;
      const cg = passes.filter((p) => /colorGrading/i.test(p.label ?? ""));
      ms.push({ total: +(rep.totalMs ?? passes.reduce((s, p) => s + (p.ms ?? p.durationMs ?? 0), 0)).toFixed(3),
                cg: +cg.reduce((s, p) => s + (p.ms ?? p.durationMs ?? 0), 0).toFixed(3),
                labels: passes.map((p) => p.label) });
    }
    return ms;
  };
  const vide = await mesure({});
  const cg = await mesure({ colorGrading: ${JSON.stringify(REGLAGE)} });
  return JSON.stringify({ vide, cg });
})()`, ctx.id));

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
console.log("[%s] passes du rendu avec colorGrading : %s", ETIQ, res.cg[0].labels.join(" | "));
console.log("[%s] passe colorGrading, mediane sur %d : %s ms   (total frame %s ms ; frame sans etage %s ms)",
  ETIQ, REPS, med(res.cg.map((m) => m.cg)), med(res.cg.map((m) => m.total)), med(res.vide.map((m) => m.total)));
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
