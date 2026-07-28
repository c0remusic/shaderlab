// Compile sur le GPU REEL les shaders COMPOSES de chaque effet et de chaque
// mode de fusion, comme le renderer les produit.
//
// Pourquoi ce script existe : `npm run test` tourne en env Node, sans GPU. Les
// tests d'effet verrouillent la formule en TS et la presence textuelle des
// appels dans le WGSL — ils ne COMPILENT jamais le shader. Une construction
// WGSL invalide (indexation dynamique d'un tableau a portee module, `select`
// sur un vecteur, un helper appele avant sa definition) passe donc tous les
// tests au vert et ne casse qu'a la premiere utilisation de l'effet dans
// l'app. Ce script ferme ce trou.
//
// Prerequis : l'app doit tourner avec le port CDP ouvert.
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev
//   (ou `npm run dev:debug`, qui pose la meme variable)
// Puis : npm run test:gpu-shaders
//
// Piege a ne pas reproduire : les `wgsl` du registre d'effets sont des
// FRAGMENTS, pas des shaders. `params`, `srcTexture`, `prevPass` et les
// bindings sont declares par `composeShader`. Les compiler isolement produit
// une volee de « unresolved value 'params' » qui ne prouve rien — il faut
// passer par `composeShader` avec les MEMES options que le renderer, y compris
// `hasPrevPass` coherent avec le nombre de passes internes de l'effet.
//
// Compte attendu (a tenir a jour si le registre bouge) :
//   passes internes (glow: 5)
// + 3 variantes de compositing x 6 effets (composite, +photo, +clip) = 18
// + 11 modes de fusion sur un effet neutre
// + 1 passe neutre passthrough (court-circuit « 0 calque » et neutralisation
//   d'un calque ecrete `suppressed`)
// + 4 variantes de morphologie du masque (2 modes erode/dilate x 2 axes H/V,
//   depuis la separation de la fenetre carree — 2026-07-27)
// = 39 shaders composes, + 1 garde d'exclusion mutuelle (non compilee).
//
// Les shaders de MASQUE ne passent pas par `composeShader` : ce sont des
// sources WGSL completes (elles embarquent deja FULLSCREEN_VERTEX_WGSL), donc
// elles se compilent telles quelles.
const targets = await (await fetch("http://localhost:9222/json")).json();
const page = targets.find((t) => t.type === "page" && t.url.includes("1420"));
if (!page) throw new Error("aucune page shaderlab sur le port 1420");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) =>
  new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });

await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");

const script = `(async () => {
  const out = { cas: [], echecs: [], device: null };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    out.device = adapter.info ? adapter.info.vendor + " " + adapter.info.architecture : "ok";
    device.addEventListener("uncapturederror", () => {});

    const reg = await import("/src/render/effects/registry.ts");
    const { composeShader } = await import("/src/render/shaderCompose.ts");
    const blend = await import("/src/render/blend/registry.ts");
    const { PASSTHROUGH_EFFECT } = await import("/src/render/effectPassRunner.ts");
    const effects = reg.effectRegistry ?? reg.default ?? [];
    out.nbEffets = effects.length;
    out.nbBlend = (blend.blendRegistry ?? []).length;

    // Un GARDE n'est pas un shader : c'est une combinaison d'options que
    // \`composeShader\` doit REFUSER. On ne la compile pas (il n'y a rien a
    // compiler), on verifie qu'elle leve. Comptee a part des shaders composes,
    // mais elle FAIT ECHOUER le script si la levee disparait — sans quoi la
    // regression passerait inapercue.
    out.gardes = [];
    const garde = (nom, fn) => {
      let leve = null;
      try { fn(); } catch (e) { leve = String(e && e.message ? e.message : e); }
      const ok = leve !== null;
      out.gardes.push({ nom, ok, leve });
      if (!ok) out.echecs.push("garde:" + nom);
    };

    const compile = async (nom, code) => {
      device.pushErrorScope("validation");
      const mod = device.createShaderModule({ code });
      const info = await mod.getCompilationInfo();
      const scoped = await device.popErrorScope();
      const errs = info.messages.filter((m) => m.type === "error")
        .map((m) => m.lineNum + ":" + m.linePos + " " + m.message);
      const ok = errs.length === 0 && !scoped;
      out.cas.push({ nom, ok, errs, scope: scoped ? scoped.message.split("\\n")[0] : null });
      if (!ok) out.echecs.push(nom);
    };

    const normal = blend.getBlendMode("normal").wgsl;

    for (const e of effects) {
      // 1) passes internes : pas de masque, pas de compositing
      if (Array.isArray(e.passes)) {
        for (let i = 0; i < e.passes.length; i++) {
          const p = e.passes[i];
          if (!p.wgsl) continue;
          await compile(e.id + " passe" + i,
            composeShader(p.wgsl, { applyMask: false, hasPrevPass: i > 0 }));
        }
      }
      // 2) passe de compositing : masque + blend, avec et sans calque photo
      if (e.wgsl) {
        await compile(e.id + " composite",
          composeShader(e.wgsl, { applyMask: true, hasPrevPass: (e.passes || []).length > 0, blendWgsl: normal }));
        await compile(e.id + " composite+photo",
          composeShader(e.wgsl, { applyMask: true, hasPrevPass: (e.passes || []).length > 0, blendWgsl: normal, hasImageSource: true }));
        // Écrêtage (2026-07-27) : même binding 6, autre expression de poids —
        // une variante de pipeline distincte, donc à compiler séparément.
        await compile(e.id + " composite+clip",
          composeShader(e.wgsl, { applyMask: true, hasPrevPass: (e.passes || []).length > 0, blendWgsl: normal, clipToCoverage: true }));
      }
    }

    // 3) chaque mode de fusion, sur un effet neutre
    const neutre = effects.find((e) => e.wgsl && !(e.passes || []).length) || effects.find((e) => e.wgsl);
    const neutrePrev = (neutre.passes || []).length > 0;
    out.effetNeutre = neutre.id + " (hasPrevPass=" + neutrePrev + ")";
    for (const b of (blend.blendRegistry ?? [])) {
      await compile("blend:" + b.id,
        composeShader(neutre.wgsl, { applyMask: true, hasPrevPass: neutrePrev, blendWgsl: b.wgsl }));
    }

    // 4) passe NEUTRE : celle qu'encode le court-circuit « 0 calque active »
    // et, depuis P2, la neutralisation d'un calque ecrete \`suppressed\`
    // (framePipelineExecutor.ts:251-267). \`passthrough\` n'est PAS dans
    // effectRegistry (il n'est pas choisissable par l'utilisateur), donc la
    // boucle ci-dessus ne le voyait pas — et \`runEffectPass\` a
    // \`applyMask = true\` PAR DEFAUT (effectPassRunner.ts:155) : options \`{}\`
    // produit bien le chemin de compositing complet, masque + blend normal.
    await compile("passthrough neutre (compositing)",
      composeShader(PASSTHROUGH_EFFECT.wgsl, { applyMask: true, hasPrevPass: false, blendWgsl: normal }));

    // 5) morphologie du masque : 2 modes x 2 axes. Une source par variante,
    // et le pipeline est cache PAR SOURCE (maskTextureResolver.ts:534) — une
    // variante qui ne compilerait pas ne casserait qu'au premier usage reel
    // du slider Contracter/Dilater, pas aux tests Node.
    const refine = await import("/src/mask/refineEdgeWgsl.ts");
    for (const mode of ["erode", "dilate"])
      for (const axis of refine.MORPHOLOGY_PASS_AXES)
        await compile("masque morphologie:" + mode + ":" + axis,
          refine.buildMorphologyWgsl(mode, axis));

    // 6) garde : un calque photo ne peut pas etre ecrete. Les deux drapeaux
    // partagent le binding 6 mais n'ont pas le meme sens — \`composeShader\`
    // leve plutot que de replier silencieusement (shaderCompose.ts:87-91), et
    // \`LayerStack.setLayerClip\` refuse deja un calque photo en amont.
    garde("hasImageSource+clipToCoverage rejete", () =>
      composeShader(neutre.wgsl, { applyMask: true, hasPrevPass: neutrePrev, blendWgsl: normal, hasImageSource: true, clipToCoverage: true }));
  } catch (e) {
    out.fatal = String(e && e.stack ? e.stack : e);
  }
  return JSON.stringify(out);
})()`;

const r = await send("Runtime.evaluate", { expression: script, awaitPromise: true, returnByValue: true });
const val = r.result?.result?.value ?? JSON.stringify(r.result?.exceptionDetails ?? r, null, 2);
const d = typeof val === "string" ? JSON.parse(val) : val;

console.log(`GPU: ${d.device} | ${d.nbEffets} effets, ${d.nbBlend} modes de fusion`);
console.log(`${d.cas.length} shaders composes compiles, ${(d.gardes ?? []).length} garde(s) d'exclusion, ${d.echecs.length} en echec\n`);
for (const c of d.cas) console.log(`${c.ok ? "OK  " : "FAIL"}  ${c.nom}${c.ok ? "" : "\n      " + (c.errs.join("\n      ") || c.scope)}`);
for (const g of d.gardes ?? [])
  console.log(`${g.ok ? "OK  " : "FAIL"}  garde: ${g.nom}${g.ok ? " (leve: " + g.leve + ")" : "\n      AUCUNE LEVEE — la combinaison interdite a produit un shader"}`);
if (d.fatal) console.log("\nFATAL: " + d.fatal);
ws.close();
