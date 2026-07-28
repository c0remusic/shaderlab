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
//
//   A. Shaders COMPOSES (via `composeShader`, a partir de FRAGMENTS) :
//     passes internes (glow: 5)
//   + 3 variantes de compositing x 6 effets (composite, +photo, +clip) = 18
//   + 11 modes de fusion sur un effet neutre
//   + 1 passe neutre passthrough (court-circuit « 0 calque » et neutralisation
//     d'un calque ecrete `suppressed`)
//   = 35
//
//   B. Sources WGSL COMPLETES du masque / de la pre-passe photo (elles
//      embarquent deja FULLSCREEN_VERTEX_WGSL, donc se compilent telles
//      quelles — voir la note « deux categories » plus bas) :
//     4 variantes de morphologie (2 modes erode/dilate x 2 axes H/V, depuis la
//       separation de la fenetre carree — 2026-07-27)
//   + 3 combinaisons de fold (add/subtract/intersect) + 1 inversion
//   + 14 passes edge-aware (luminance, pack, squareCorr, computeAB, composite,
//       downsample, satWiden, satScan H/V, satLookup, box-filter H/V x
//       channels 1|2)
//   + 1 overlay de masque (MASK_OVERLAY_WGSL)
//   + 1 pre-passe d'entree d'un calque photo (PHOTO_LAYER_INPUT_WGSL)
//   = 24
//
//   C. Sources de masque PARAMETRIQUES : ce sont des FRAGMENTS `fs_generate`
//      (comme les effets, mais avec un autre wrapper — `wrapMaskSourceWgsl`,
//      PAS `composeShader`), un par module de `mask/sources/registry.ts`,
//      chacun avec son propre nombre de slots `PARAM_COUNT_BY_TYPE` (un N
//      different = une source differente) = 3
//
// = 62 shaders compiles au total, + 1 garde d'exclusion mutuelle (non
//   compilee).
//
// DEUX CATEGORIES, a ne pas confondre (2e piege) : les `wgsl` du registre
// d'effets et le `wgsl` d'un module de source de masque sont des FRAGMENTS et
// doivent passer par leur wrapper (`composeShader` / `wrapMaskSourceWgsl`) ;
// les shaders de MASQUE construits par `mask/*Wgsl.ts` et les constantes
// `*_WGSL` de `render/` sont des sources COMPLETES et se compilent telles
// quelles. Verifier la categorie AVANT d'ajouter une source ici.
//
// Note : `buildBoxFilter{H,V}Wgsl(2)` (channels=2) n'est appele par aucun
// chemin de rendu actuel (`maskTextureResolver.ts` n'utilise que channels=1
// depuis le passage a la SAT) — il reste compile ici parce que c'est une API
// exportee et une source DIFFERENTE, donc une regression y serait invisible
// partout ailleurs.
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

    // 5bis) fold du masque : combinaison (une source par mode) + inversion.
    // Encodees par \`maskTextureResolver.foldSources\` (maskTextureResolver.ts:
    // 638/646) et mises en cache PAR SOURCE — une variante invalide ne
    // casserait qu'au premier masque multi-sources reel.
    const fold = await import("/src/mask/maskFoldWgsl.ts");
    for (const mode of ["add", "subtract", "intersect"])
      await compile("masque fold:" + mode, fold.buildCombineWgsl(mode));
    await compile("masque fold:invert", fold.buildInvertWgsl());

    // 5ter) chaine edge-aware (guided filter + SAT). Toutes ces passes sont
    // des sources COMPLETES construites par src/mask/edgeAwareWgsl.ts, aucune
    // ne passe par \`composeShader\`. Elles ne s'executent que quand
    // \`refineEdge.edgeAware\` est actif : sans ce harnais, une regression WGSL
    // y dort jusqu'a ce que quelqu'un coche la case.
    const ea = await import("/src/mask/edgeAwareWgsl.ts");
    await compile("masque edge:luminance", ea.buildLuminanceWgsl());
    await compile("masque edge:downsample", ea.buildDownsampleWgsl());
    await compile("masque edge:pack", ea.buildPackWgsl());
    await compile("masque edge:squareCorr", ea.buildSquareCorrWgsl());
    await compile("masque edge:computeAB", ea.buildComputeABWgsl());
    await compile("masque edge:composite", ea.buildCompositeWgsl());
    await compile("masque edge:satWiden", ea.buildSatWidenWgsl());
    await compile("masque edge:satLookup", ea.buildSatLookupWgsl());
    for (const dir of ["H", "V"]) {
      await compile("masque edge:satScan:" + dir, ea.buildSatScanWgsl(dir));
      // channels 1|2 changent le type echantillonne ET l'expression de sortie
      // -> deux sources distinctes, pas un uniforme.
      for (const ch of [1, 2])
        await compile("masque edge:box" + dir + ":ch" + ch,
          dir === "H" ? ea.buildBoxFilterHWgsl(ch) : ea.buildBoxFilterVWgsl(ch));
    }

    // 5quater) sources de masque PARAMETRIQUES. Ce sont des FRAGMENTS
    // \`fs_generate\` : les compiler nus produirait « unresolved value
    // 'genParams' » (meme piege que les effets, autre wrapper). On passe donc
    // par \`wrapMaskSourceWgsl\` avec le MEME \`PARAM_COUNT_BY_TYPE\` que le
    // resolver — les deux sont importes de maskTextureResolver.ts plutot que
    // recopies ici, pour qu'un changement de N ne puisse pas deriver.
    const resolver = await import("/src/render/maskTextureResolver.ts");
    const sources = await import("/src/mask/sources/registry.ts");
    for (const m of sources.maskSourceRegistry)
      await compile("masque source:" + m.id,
        resolver.wrapMaskSourceWgsl(m.wgsl, resolver.PARAM_COUNT_BY_TYPE[m.id]));

    // 5quinquies) sources completes hors masque : l'overlay de masque
    // (effectPassRunner.ts:20, pipeline cache par source) et la pre-passe
    // d'entree d'un calque photo (photoLayerInput.ts:16). Aucune des deux ne
    // passe par \`composeShader\`.
    const runner = await import("/src/render/effectPassRunner.ts");
    await compile("overlay de masque", runner.MASK_OVERLAY_WGSL);
    const photo = await import("/src/render/photoLayerInput.ts");
    await compile("pre-passe entree photo", photo.PHOTO_LAYER_INPUT_WGSL);

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
