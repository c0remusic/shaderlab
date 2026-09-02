// Ticket 25 — balayage des douze parametres de `lensBlur`.
//
// Mesure le POIDS VISUEL de chaque curseur : rendre l'effet avec le parametre a
// une borne, puis a l'autre, config par ailleurs identique, et compter les
// canaux RGB qui different de plus d'un LSB. Trois rayons (8, 24, 60) parce que
// la plainte d'Antoine est « seul le rayon compte » : un curseur ecrase par le
// rayon agit a une echelle et plus a l'autre.
//
// OU TOURNE LE CODE. Iframe sur l'origine du Vite du worktree
// (`render-check-page.html`, module map VIERGE) : les modules servis sont ceux
// du DISQUE, edition non commitee comprise. Aucun IPC Tauri, aucune ecriture
// dans l'app. Meme technique que `planche-05-fidelite.mjs`.
//
// MIRE. Des points lumineux ISOLES sur un fond a 10 %, plus une bande de
// degrade. C'est le piege historique de cet effet : sous un damier, un lens
// blur rend exactement ce que rendrait un gaussien, donc la forme du
// diaphragme, la courbure des lames et la ponderation des hautes lumieres y
// mesurent toutes zero — pas parce qu'elles sont mortes, parce que la mire est
// aveugle.
//
// PIEGE DES BORNES EGALES PAR SYMETRIE : `bladeRotation` et `fieldAngle` vont
// de 0 a 360 degres, et 0 vs 360 EST le meme angle. On balaie 0 vs 37, comme
// `scripts/applicabilite-table.mjs` le fait deja.
//
// Aucun accent ni backtick dans le code injecte dans la page.
import { writeFileSync } from "node:fs";
import path from "node:path";

const ORIGIN = "http://localhost:1421";
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

const DEFAUTS = {
  radius: 24,
  blades: 0,
  bladeRotation: 0,
  highlightThreshold: 0.6,
  highlightBoost: 6,
  fieldShape: 0,
  fieldCenterX: 0.5,
  fieldCenterY: 0.5,
  fieldAngle: 0,
  fieldRange: 0.35,
  fieldFeather: 0.5,
  bladeCurvature: 0,
};

// Une mesure = un parametre, deux valeurs, un contexte.
// `config` surcharge la base ; `note` dit pourquoi ce contexte existe.
const MESURES = [
  { id: "blades", ctx: "defaut", config: {}, param: "blades", a: 0, b: 12 },
  { id: "blades 0->3", ctx: "defaut", config: {}, param: "blades", a: 0, b: 3 },
  { id: "blades 3->6", ctx: "defaut", config: {}, param: "blades", a: 3, b: 6 },
  { id: "blades 6->12", ctx: "defaut", config: {}, param: "blades", a: 6, b: 12 },

  { id: "bladeRotation", ctx: "defaut (blades=0)", config: {}, param: "bladeRotation", a: 0, b: 37 },
  { id: "bladeRotation", ctx: "hexa (blades=6)", config: { blades: 6 }, param: "bladeRotation", a: 0, b: 37 },

  { id: "bladeCurvature", ctx: "defaut (blades=0)", config: {}, param: "bladeCurvature", a: 0, b: 1 },
  { id: "bladeCurvature", ctx: "hexa (blades=6)", config: { blades: 6 }, param: "bladeCurvature", a: 0, b: 1 },
  { id: "bladeCurvature 0->0.5", ctx: "hexa", config: { blades: 6 }, param: "bladeCurvature", a: 0, b: 0.5 },
  { id: "bladeCurvature 0.5->1", ctx: "hexa", config: { blades: 6 }, param: "bladeCurvature", a: 0.5, b: 1 },

  { id: "highlightThreshold", ctx: "defaut", config: {}, param: "highlightThreshold", a: 0, b: 1 },
  { id: "highlightThreshold 0->0.3", ctx: "defaut", config: {}, param: "highlightThreshold", a: 0, b: 0.3 },
  { id: "highlightThreshold 0.3->0.6", ctx: "defaut", config: {}, param: "highlightThreshold", a: 0.3, b: 0.6 },
  { id: "highlightThreshold 0.6->1", ctx: "defaut", config: {}, param: "highlightThreshold", a: 0.6, b: 1 },

  { id: "highlightBoost", ctx: "defaut", config: {}, param: "highlightBoost", a: 0, b: 20 },
  { id: "highlightBoost 0->6", ctx: "defaut", config: {}, param: "highlightBoost", a: 0, b: 6 },
  { id: "highlightBoost 6->13", ctx: "defaut", config: {}, param: "highlightBoost", a: 6, b: 13 },
  { id: "highlightBoost 13->20", ctx: "defaut", config: {}, param: "highlightBoost", a: 13, b: 20 },

  { id: "fieldShape 0->2 (Iris)", ctx: "defaut", config: {}, param: "fieldShape", a: 0, b: 2 },
  { id: "fieldShape 0->3 (Radial)", ctx: "defaut", config: {}, param: "fieldShape", a: 0, b: 3 },

  { id: "fieldCenterX", ctx: "defaut (Uniforme)", config: {}, param: "fieldCenterX", a: 0, b: 1 },
  { id: "fieldCenterX", ctx: "Iris", config: { fieldShape: 2 }, param: "fieldCenterX", a: 0, b: 1 },
  { id: "fieldCenterY", ctx: "defaut (Uniforme)", config: {}, param: "fieldCenterY", a: 0, b: 1 },
  { id: "fieldCenterY", ctx: "Iris", config: { fieldShape: 2 }, param: "fieldCenterY", a: 0, b: 1 },

  { id: "fieldAngle", ctx: "defaut (Uniforme)", config: {}, param: "fieldAngle", a: 0, b: 37 },
  { id: "fieldAngle", ctx: "Lineaire", config: { fieldShape: 1 }, param: "fieldAngle", a: 0, b: 37 },
  { id: "fieldAngle", ctx: "Iris", config: { fieldShape: 2 }, param: "fieldAngle", a: 0, b: 37 },

  { id: "fieldRange", ctx: "defaut (Uniforme)", config: {}, param: "fieldRange", a: 0.01, b: 1.5 },
  { id: "fieldRange", ctx: "Iris", config: { fieldShape: 2 }, param: "fieldRange", a: 0.01, b: 1.5 },

  { id: "fieldFeather", ctx: "defaut (Uniforme)", config: {}, param: "fieldFeather", a: 0, b: 1 },
  { id: "fieldFeather", ctx: "Iris", config: { fieldShape: 2 }, param: "fieldFeather", a: 0, b: 1 },
  { id: "fieldFeather", ctx: "Radial", config: { fieldShape: 3 }, param: "fieldFeather", a: 0, b: 1 },
];

// Rayon : sa course ne depend pas du rayon courant, donc une seule ligne de
// reference — c'est le plafond auquel les autres se comparent.
const MESURES_RAYON = [
  { id: "radius (course entiere)", ctx: "defaut", config: {}, param: "radius", a: 0, b: 120 },
  { id: "radius 0->8", ctx: "defaut", config: {}, param: "radius", a: 0, b: 8 },
  { id: "radius 8->24", ctx: "defaut", config: {}, param: "radius", a: 8, b: 24 },
  { id: "radius 24->60", ctx: "defaut", config: {}, param: "radius", a: 24, b: 60 },
  { id: "radius 60->120", ctx: "defaut", config: {}, param: "radius", a: 60, b: 120 },
];

// SECOND TOUR — les questions que le premier a fait apparaitre, et qu'il ne
// pouvait pas poser : la PERIODE des deux angles (un polygone a n lames a une
// symetrie de 360/n, une bande a une symetrie de 180), et le haut des courses
// dont le premier tour montre qu'il rend moins que le milieu.
const MESURES_2 = [
  // Periode du diaphragme : 0 vs 360/n doit rendre ZERO, et 0 vs 180/n le
  // maximum. Si c'est le cas, la course declaree (0..360) vaut n fois la
  // course utile.
  { id: "bladeRotation 0->30 (demi-periode)", ctx: "blades=6", config: { blades: 6 }, param: "bladeRotation", a: 0, b: 30 },
  { id: "bladeRotation 0->60 (1 periode)", ctx: "blades=6", config: { blades: 6 }, param: "bladeRotation", a: 0, b: 60 },
  { id: "bladeRotation 0->120 (2 periodes)", ctx: "blades=6", config: { blades: 6 }, param: "bladeRotation", a: 0, b: 120 },
  { id: "bladeRotation 0->360 (6 periodes)", ctx: "blades=6", config: { blades: 6 }, param: "bladeRotation", a: 0, b: 360 },
  { id: "bladeRotation 0->72 (1 periode)", ctx: "blades=5", config: { blades: 5 }, param: "bladeRotation", a: 0, b: 72 },
  { id: "bladeRotation 0->120 (1 periode)", ctx: "blades=3", config: { blades: 3 }, param: "bladeRotation", a: 0, b: 120 },

  // Periode du champ lineaire : la bande est symetrique, donc 180 la ramene
  // sur elle-meme.
  { id: "fieldAngle 0->90", ctx: "Lineaire", config: { fieldShape: 1 }, param: "fieldAngle", a: 0, b: 90 },
  { id: "fieldAngle 0->180 (1 periode)", ctx: "Lineaire", config: { fieldShape: 1 }, param: "fieldAngle", a: 0, b: 180 },
  { id: "fieldAngle 0->360 (2 periodes)", ctx: "Lineaire", config: { fieldShape: 1 }, param: "fieldAngle", a: 0, b: 360 },
  // Iris : confirmation sur deux autres couples que le 0 vs 37 du premier tour.
  { id: "fieldAngle 0->90", ctx: "Iris", config: { fieldShape: 2 }, param: "fieldAngle", a: 0, b: 90 },
  { id: "fieldAngle 0->180", ctx: "Iris", config: { fieldShape: 2 }, param: "fieldAngle", a: 0, b: 180 },

  // Haut de course de l etendue nette : a partir d ou le champ ne mord plus ?
  { id: "fieldRange 0.01->0.5", ctx: "Iris", config: { fieldShape: 2 }, param: "fieldRange", a: 0.01, b: 0.5 },
  { id: "fieldRange 0.5->1.0", ctx: "Iris", config: { fieldShape: 2 }, param: "fieldRange", a: 0.5, b: 1.0 },
  { id: "fieldRange 1.0->1.5", ctx: "Iris", config: { fieldShape: 2 }, param: "fieldRange", a: 1.0, b: 1.5 },

  // Haut de course du seuil et de l intensite.
  { id: "highlightThreshold 0.8->1", ctx: "defaut", config: {}, param: "highlightThreshold", a: 0.8, b: 1 },
  { id: "highlightBoost 15->20", ctx: "defaut", config: {}, param: "highlightBoost", a: 15, b: 20 },

  // Haut de course du compte de lames : un 12-gone est-il distinguable d un
  // 10-gone, et d un cercle ?
  { id: "blades 10->12", ctx: "defaut", config: {}, param: "blades", a: 10, b: 12 },
  { id: "blades 12->0 (cercle)", ctx: "defaut", config: {}, param: "blades", a: 12, b: 0 },
  { id: "blades 3->0 (cercle)", ctx: "defaut", config: {}, param: "blades", a: 3, b: 0 },

  { id: "bladeCurvature 0.9->1", ctx: "blades=6", config: { blades: 6 }, param: "bladeCurvature", a: 0.9, b: 1 },
];

const RAYONS = [8, 24, 60];

// ── connexion CDP ────────────────────────────────────────────────────────
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

const FRAME_ID = "__mesure25Frame";
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
if (!frameCtx) throw new Error("contexte iframe introuvable : " + JSON.stringify(contexts.map((c) => c.origin)));

// ── mise en place dans la page ───────────────────────────────────────────
const SETUP = `(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");

  const W = 512, H = 340;

  // MIRE A BOKEH. Fond a 10 pour cent, quinze points lumineux isoles de 1 a 3
  // px repartis sur toute la largeur (donc fieldCenterX a de quoi mordre), et
  // une bande de degrade en bas pour ce qui n est PAS une haute lumiere.
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = 26; d[i + 1] = 26; d[i + 2] = 26; d[i + 3] = 255; }
  const YBANDE = 262;
  for (let y = YBANDE; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = Math.round((x * 255) / (W - 1));
      d[i] = v; d[i + 1] = v; d[i + 2] = v;
    }
  }
  const teintes = [[255, 255, 255], [255, 200, 120], [120, 200, 255]];
  const rayons = [1, 2, 2, 3, 3];
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 3; row++) {
      const cx = ((col + 0.5) * W) / 5;
      const cy = ((row + 0.5) * YBANDE) / 3;
      const rr = rayons[col];
      const t = teintes[row];
      for (let y = Math.floor(cy - rr); y <= cy + rr; y++) {
        for (let x = Math.floor(cx - rr); x <= cx + rr; x++) {
          if (x < 0 || y < 0 || x >= W || y >= YBANDE) continue;
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > rr * rr) continue;
          const i = (y * W + x) * 4;
          d[i] = t[0]; d[i + 1] = t[1]; d[i + 2] = t[2];
        }
      }
    }
  }
  const mire = await createImageBitmap(new ImageData(d, W, H), { premultiplyAlpha: "none", colorSpaceConversion: "none" });

  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = await initGpu(cv);
  const renderer = new Renderer(ctx, undefined, undefined, () => 0);
  await renderer.loadImage(mire);

  window.__m25 = {
    renderer, openDocument, W, H,
    cache: new Map(),
    rendu: async (params) => {
      const cle = JSON.stringify(params);
      const c = window.__m25.cache;
      if (c.has(cle)) return c.get(cle);
      const stack = openDocument(renderer, "fond").stack;
      const lid = stack.addLayer("lensBlur");
      stack.updateParams(lid, params);
      const f = await renderer.exportFrame(stack.layers);
      const px = new Uint8Array(f.pixels);
      c.set(cle, px);
      return px;
    },
    // Ecart sur les CANAUX RGB seulement : l alpha est constant a 255 et
    // diluerait le compte d un quart.
    ecart: (a, b) => {
      let n = 0, somme = 0, max = 0, total = 0;
      for (let i = 0; i < a.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          const dd = Math.abs(a[i + k] - b[i + k]);
          total++;
          if (dd > 1) n++;
          somme += dd;
          if (dd > max) max = dd;
        }
      }
      return { pct: (100 * n) / total, moy: somme / total, max };
    },
  };
  return "ok " + W + "x" + H;
})()`;

const setupOk = await evalIn(SETUP, frameCtx.id);
console.log("setup:", setupOk);

// CONTROLE DE DETERMINISME. Le tirage de la spirale est un hash du pixel, donc
// deux rendus du meme etat doivent etre IDENTIQUES. S ils ne le sont pas, tout
// le reste du tableau est du bruit et non de la mesure.
const controle = await evalIn(`(async () => {
  const m = window.__m25;
  const p = ${JSON.stringify({ ...DEFAUTS, radius: 24 })};
  const a = await m.rendu(p);
  m.cache.clear();
  const b = await m.rendu(p);
  m.cache.clear();
  return JSON.stringify(m.ecart(a, b));
})()`, frameCtx.id);
console.log("controle de determinisme (doit etre 0) :", controle);

const lancer = async (mesures, base) => {
  const script = `(async () => {
    const m = window.__m25;
    const base = ${JSON.stringify(base)};
    const mesures = ${JSON.stringify(mesures)};
    const out = [];
    for (const mes of mesures) {
      const pa = { ...base, ...mes.config, [mes.param]: mes.a };
      const pb = { ...base, ...mes.config, [mes.param]: mes.b };
      const a = await m.rendu(pa);
      const b = await m.rendu(pb);
      out.push({ id: mes.id, ctx: mes.ctx, a: mes.a, b: mes.b, ...m.ecart(a, b) });
    }
    m.cache.clear();
    return JSON.stringify(out);
  })()`;
  return JSON.parse(await evalIn(script, frameCtx.id));
};

const resultats = { rayonReference: [], parRayon: {}, tour2: {} };
const TOUR2 = process.argv.includes("--tour2");

if (!TOUR2) {
  console.log("\n== rayon : course de reference ==");
  resultats.rayonReference = await lancer(MESURES_RAYON, DEFAUTS);
  for (const r of resultats.rayonReference) {
    console.log(`  ${r.id.padEnd(30)} ${r.pct.toFixed(2).padStart(7)} %  moy ${r.moy.toFixed(2).padStart(6)}  max ${String(r.max).padStart(3)}`);
  }
}

for (const R of RAYONS) {
  if (TOUR2 && R === 8) continue; // le tour 2 se lit a 24 et 60, ou le signal est net
  console.log(`\n== rayon ${R} ==`);
  const lignes = await lancer(TOUR2 ? MESURES_2 : MESURES, { ...DEFAUTS, radius: R });
  (TOUR2 ? resultats.tour2 : resultats.parRayon)[R] = lignes;
  for (const r of lignes) {
    console.log(`  ${r.id.padEnd(34)} ${r.ctx.padEnd(12)} ${r.pct.toFixed(2).padStart(7)} %  moy ${r.moy.toFixed(2).padStart(6)}  max ${String(r.max).padStart(3)}`);
  }
}

const fichier = path.join(OUT, TOUR2 ? "mesure-25-lensblur-tour2.json" : "mesure-25-lensblur.json");
writeFileSync(fichier, JSON.stringify(resultats, null, 2));
console.log("\necrit " + fichier);

await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
