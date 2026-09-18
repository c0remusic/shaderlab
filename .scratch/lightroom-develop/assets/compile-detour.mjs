// Les sept detours rendent du BLANC, y compris celui qui renvoie `color` tel
// quel. Un detour qui ne change rien et casse quand meme le rendu ne peut pas
// etre une question de valeur : c'est la COMPILATION. On la fait dire.
//
// getCompilationInfo() rend les messages du compilateur WGSL — la seule source
// qui nomme la ligne fautive. Le rendu, lui, avale l'erreur et sort du blanc.
import { readFileSync } from "node:fs";

const ORIGIN = "http://localhost:1421";
const CDP = "http://localhost:9222";
const ANCRE = "  let sBlur = linear_to_srgb(blurLuma);";

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

const FRAME_ID = "__compileDetour";
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

const out = JSON.parse(await evalIn(`(async () => {
  const { composeShader } = await import("/src/render/shaderCompose.ts");
  const { developApplyOrder } = await import("/src/render/developRegistry.ts");
  const mod = developApplyOrder.find((m) => m.id === "reglagesDeBase");
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const options = { applyMask: false, hasPrevPass: true, hasAuxPass: false,
    hasImageSource: false, hasLibraryTexture: false, hasEffectTransform: false };

  const lire = async (corps) => {
    const code = composeShader(corps, options);
    device.pushErrorScope("validation");
    const m = device.createShaderModule({ code });
    const info = await m.getCompilationInfo();
    const err = await device.popErrorScope();
    return {
      messages: info.messages.filter((x) => x.type !== "info")
        .map((x) => x.type + " L" + x.lineNum + ":" + x.linePos + " " + x.message),
      erreurScope: err ? err.message.slice(0, 400) : null,
      lignes: code.split(String.fromCharCode(10)).length,
    };
  };

  const origine = mod.wgsl;
  const detour = origine.replace(
    ${JSON.stringify(ANCRE)},
    ${JSON.stringify(ANCRE)} + String.fromCharCode(10) + "  if (uv.x >= -1.0) { return color; }",
  );
  return JSON.stringify({ temoin: await lire(origine), detour: await lire(detour) });
})()`, ctxFrame.id));

console.log("TEMOIN (corps intact)");
console.log(JSON.stringify(out.temoin, null, 1));
console.log("");
console.log("DETOUR (return color anticipe)");
console.log(JSON.stringify(out.detour, null, 1));
ws.close();
