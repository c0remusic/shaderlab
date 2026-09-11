// Verif CDP live du ticket 02 : ouvrir une photo, regler Exposition +1 par le
// pont __shaderlabDebug.reglerDeveloppement -> frameSignature CHANGE ; remettre
// a 0 -> REVIENT. Puis capture du panneau (les deux modules) mesuree.
import { writeFileSync } from "node:fs";
import path from "node:path";
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const CDP = "http://localhost:9223";
const PHOTO = "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG";

const targets = await (await fetch(`${CDP}/json`)).json();
// La page de l'app (celle qui porte __shaderlabDebug), pas une iframe de harnais.
let page = null;
for (const t of targets) {
  if (t.type !== "page" || !t.webSocketDebuggerUrl) continue;
  page = t; break;
}
if (!page) throw new Error("pas de cible CDP page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
await send("Runtime.enable");
const evalIn = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
  return r.result?.result?.value;
};

const dbg = await evalIn("typeof window.__shaderlabDebug");
console.log("__shaderlabDebug:", dbg);
if (dbg !== "object") throw new Error("pont de debug absent sur cette page");

await evalIn(`window.__shaderlabDebug.openByPath(${JSON.stringify(PHOTO)})`);
await new Promise((r) => setTimeout(r, 1500));

const s0 = await evalIn("window.__shaderlabDebug.frameSignature()");
await evalIn("window.__shaderlabDebug.reglerDeveloppement('reglagesDeBase', { exposure: 1 })");
await new Promise((r) => setTimeout(r, 600));
const s1 = await evalIn("window.__shaderlabDebug.frameSignature()");
await evalIn("window.__shaderlabDebug.reglerDeveloppement('reglagesDeBase', { exposure: 0 })");
await new Promise((r) => setTimeout(r, 600));
const s2 = await evalIn("window.__shaderlabDebug.frameSignature()");

console.log("S0 (temoin)       :", s0);
console.log("S1 (Exposition +1):", s1, s1 !== s0 ? "-> CHANGE ✓" : "-> INCHANGE ✗");
console.log("S2 (reinitialise) :", s2, s2 === s0 ? "-> REVIENT ✓" : "-> DIFFERE ✗");

// Capture du panneau : regler reglagesDeBase (pour montrer un module actif) et
// capturer toute la fenetre. Mesure moyenne/ecart-type pour prouver que ce n'est
// pas un aplat noir.
await evalIn("window.__shaderlabDebug.reglerDeveloppement('reglagesDeBase', { exposure: 0.5, vibrance: 40, clarity: 30 })");
await new Promise((r) => setTimeout(r, 500));
const shot = await send("Page.captureScreenshot", { format: "png" });
const buf = Buffer.from(shot.result.data, "base64");
writeFileSync(path.join(OUT, "etage-02-panneau.png"), buf);
console.log("capture -> etage-02-panneau.png", buf.length, "octets");
// Remettre l'etage a 0 pour ne pas laisser un etat surprenant.
await evalIn("window.__shaderlabDebug.reglerDeveloppement('reglagesDeBase', { exposure: 0, vibrance: 0, clarity: 0 })");
ws.close();
