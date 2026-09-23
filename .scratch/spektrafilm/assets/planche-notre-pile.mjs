// Rend les photos de la planche film par NOTRE pipeline reel — glow, halation,
// grain, chacun a ses reglages par DEFAUT — pour les poser a cote des rendus
// spektrafilm. Meme cadrage que le lot spektrafilm : image entiere reduite a
// 0,25 et crop 1:1 a pleine resolution (centre et taille en fraction du grand
// cote, geometrie de spektrafilm crop_image).
//
// Rendu a PLEINE resolution, comme dans l'app : grain et halation dependent de la
// taille de l'image, donc reduire avant de rendre mentirait sur ce qu'Antoine voit.
// La reduction et le crop se font dans la page, apres exportFrame (jamais par
// drawImage du canvas WebGPU, qui rend du noir hors frame).
//
// Prerequis : app lancee avec le port CDP 9222 (skill run-shaderlab). Usage :
//   node planche-notre-pile.mjs <dossier-de-sortie> [origine]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const OUT = process.argv[2];
if (!OUT) throw new Error("usage: node planche-notre-pile.mjs <dossier-de-sortie> [origine]");
const ORIGIN = process.argv[3] ?? "http://localhost:1420";
mkdirSync(OUT, { recursive: true });

const PHOTOS = {
  "5163-bougie": ["C:\\Users\\LEETJ\\Pictures\\2018\\2018-01-25\\DSCF5163.JPG", [0.52, 0.86], 0.16],
  "5160-agave": ["C:\\Users\\LEETJ\\Pictures\\2018\\2018-01-22\\DSCF5160.JPG", [0.40, 0.55], 0.16],
  "5171-lys": ["C:\\Users\\LEETJ\\Pictures\\2018\\2018-01-25\\DSCF5171.JPG", [0.47, 0.42], 0.16],
};
// Deux piles. Les DEFAUTS sont faits pour montrer chaque effet seul, pas pour un
// look film : empiles, ils delavent les noirs et plaquent un grain fort (ecart
// moyen de 29 a 49 niveaux sur les crops). La variante DOSEE est un reglage a
// l'oeil de la session, pas un preset : glow a un cinquieme avec retenue des
// noirs (Black Pro-Mist), halation a moitie, grain a moitie et plus fin.
const PILES = {
  "notre-pile": { glow: {}, halation: {}, grain: {} },
  "notre-pile-dosee": {
    glow: { intensity: 0.35, threshold: 0.75, shadowHold: 0.5 },
    halation: { intensity: 0.6 },
    grain: { intensity: 0.06, size: 1.5 },
  },
};
const ECHELLE = 0.25;

const targets = await (await fetch("http://localhost:9222/json")).json();
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
  const r = await send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
    ...(contextId === undefined ? {} : { contextId }),
  });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
  return r.result?.result?.value;
};

const FRAME_ID = "__plancheFilmFrame";
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
await new Promise((r) => setTimeout(r, 400));
const frameCtx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || (c.auxData && c.auxData.type === "iframe")));
if (!frameCtx) throw new Error("contexte iframe introuvable");

for (const [nom, [chemin, centre, taille]] of Object.entries(PHOTOS)) {
  const b64 = readFileSync(chemin).toString("base64");
  await evalIn(`window.__photoParts = []; "ok"`, frameCtx.id);
  const CHUNK = 2_000_000;
  for (let i = 0; i < b64.length; i += CHUNK) {
    await evalIn(`window.__photoParts.push(${JSON.stringify(b64.slice(i, i + CHUNK))}); "ok"`, frameCtx.id);
  }
  const script = `(async () => {
    const { initGpu } = await import("/src/render/gpuContext.ts");
    const { Renderer } = await import("/src/render/renderer.ts");
    const { openDocument } = await import("/src/layers/openedDocument.ts");
    const bin = atob(window.__photoParts.join(""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
    const cv = document.createElement("canvas");
    cv.width = bmp.width; cv.height = bmp.height;
    const ctx = await initGpu(cv);
    const r = new Renderer(ctx, undefined, undefined, () => 0);
    await r.loadImage(bmp);
    const plein = (frame) => {
      const c = document.createElement("canvas");
      c.width = frame.width; c.height = frame.height;
      c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
      return c;
    };
    const reduit = (c) => {
      const s = document.createElement("canvas");
      s.width = Math.round(c.width * ${ECHELLE}); s.height = Math.round(c.height * ${ECHELLE});
      const g = s.getContext("2d"); g.imageSmoothingQuality = "high";
      g.drawImage(c, 0, 0, s.width, s.height);
      return s.toDataURL("image/png");
    };
    const crop = (c) => {
      // Geometrie de spektrafilm crop_image : centre (x, y), taille en fraction du grand cote.
      const L = Math.max(c.width, c.height);
      const w = Math.round(L * ${taille}), h = Math.round(L * ${taille});
      let x0 = Math.round(Math.round(c.width * ${centre[0]}) - w / 2);
      let y0 = Math.round(Math.round(c.height * ${centre[1]}) - h / 2);
      x0 = Math.max(0, Math.min(x0, c.width - w)); y0 = Math.max(0, Math.min(y0, c.height - h));
      const s = document.createElement("canvas");
      s.width = w; s.height = h;
      s.getContext("2d").drawImage(c, x0, y0, w, h, 0, 0, w, h);
      return s.toDataURL("image/png");
    };
    const temoin = plein(await r.exportFrame(openDocument(r, "fond").stack.layers));
    const res = {
      "temoin-app__entier": reduit(temoin), "temoin-app__crop": crop(temoin),
      taille: [bmp.width, bmp.height], calques: [],
    };
    for (const [nomPile, pile] of Object.entries(${JSON.stringify(PILES)})) {
      const stack = openDocument(r, "fond").stack;
      for (const [effet, reglages] of Object.entries(pile)) {
        const id = stack.addLayer(effet);
        if (Object.keys(reglages).length) stack.updateParams(id, reglages);
      }
      const rendu = plein(await r.exportFrame(stack.layers));
      res[nomPile + "__entier"] = reduit(rendu);
      res[nomPile + "__crop"] = crop(rendu);
      res.calques.push(nomPile + " = " + stack.layers.map((l) => l.effectId + JSON.stringify(Object.fromEntries(Object.entries(l.params ?? {}).filter(([k]) => ["intensity", "threshold", "shadowHold", "size"].includes(k))))).join(" > "));
    }
    r.dispose?.();
    return JSON.stringify(res);
  })()`;
  const res = JSON.parse(await evalIn(script, frameCtx.id));
  for (const [cle, val] of Object.entries(res)) {
    if (typeof val !== "string" || !val.startsWith("data:")) continue;
    const fichier = path.join(OUT, `${nom}__${cle}.png`);
    writeFileSync(fichier, Buffer.from(val.split(",")[1], "base64"));
  }
  console.log(`${nom} : ${res.taille.join("x")}`);
  for (const c of res.calques) console.log("  " + c);
}
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
