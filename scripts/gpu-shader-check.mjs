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
// Compte — ⚠️ CE BLOC N'AVAIT PAS ETE TENU A JOUR et annoncait 64 shaders : il
// parlait de 6 effets et de 11 modes de fusion quand le registre en porte 26 et
// 17. MESURE le 2026-08-21 en lancant le script : **156 shaders compiles**,
// 0 en echec. Ne pas recopier ce chiffre de tete au prochain effet — le relancer.
// Ce qui ne se perime pas est la STRUCTURE des categories ci-dessous.
//
//   A. Shaders COMPOSES (via `composeShader`, a partir de FRAGMENTS) :
//     passes internes (glow: 5)
//   + 2 variantes de compositing par effet (composite, +photo) — il y en avait
//     TROIS jusqu'au 2026-08-21, la 3e etant l'ecretage (ADR-0020)
//   + un shader par mode de fusion, sur un effet neutre
//   + 1 passe neutre passthrough (court-circuit « 0 calque ») — variante SANS
//     masque depuis T0 (2026-07-28) : c'est une copie stricte, alpha inclus,
//     pas un compositing
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
//   + 2 passes de presentation (buildPresentWgsl : damier / blanc) — l'unique
//       ecrivain du canvas et de la cible d'export depuis T0 (2026-07-28)
//
//   C. Sources de masque PARAMETRIQUES : ce sont des FRAGMENTS `fs_generate`
//      (comme les effets, mais avec un autre wrapper — `wrapMaskSourceWgsl`,
//      PAS `composeShader`), un par module de `mask/sources/registry.ts`,
//      chacun avec son propre nombre de slots `PARAM_COUNT_BY_TYPE` (un N
//      different = une source differente) = 3
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
// --origin http://localhost:1431 : compile les shaders du WORKTREE servi par ce
// Vite, et non ceux que la fenetre a chargee au demarrage. Sans cette option le
// script importe `/src/**` depuis l'origine de la page (le Vite de l'app, port
// 1420) — sur une machine ou plusieurs worktrees travaillent en parallele, il
// verifie alors le code de QUELQU'UN D'AUTRE en annoncant un vert. Meme piege,
// meme parade que `render-check.mjs` : un iframe servi par le Vite du worktree,
// donc une origine et un module map a lui (voir scripts/render-check-page.html).
const argvGsc = process.argv.slice(2);
const iOrigin = argvGsc.indexOf("--origin");
const ORIGIN = iOrigin === -1 ? null : argvGsc[iOrigin + 1];
// `--port`, comme `render-check.mjs` (ajoute le 2026-08-18). Le commentaire
// ci-dessous raconte deja le cas ou 9222 est tenu par un AUTRE programme ; il
// s est reproduit, et sans ce drapeau la seule issue etait de fermer le
// programme fautif — ici un DAW, qui pouvait avoir du travail non enregistre.
// L app se lance alors avec `--remote-debugging-port=<port>` et les deux gates
// recoivent le meme `--port`.
const iPort = argvGsc.indexOf("--port");
const PORT_CDP = iPort === -1 ? 9222 : Number(argvGsc[iPort + 1]);

// QUELLE PAGE, ET POURQUOI CA DEPEND DE `--origin` (corrige le 2026-08-03).
//
// Sans `--origin`, le script evalue dans le document de l'APP : il lui faut donc
// la fenetre shaderlab elle-meme, reconnue a son port Vite. Avec `--origin`, il
// injecte un iframe servi par le Vite du worktree et tout le code vient de la ;
// la page hote n'est plus qu'un HOTE DE GPU, et exiger que ce soit shaderlab n a
// aucun sens — c'est ce que `render-check.mjs` fait depuis toujours
// (`t.type === "page" && t.webSocketDebuggerUrl`, sans condition d'URL).
//
// Le defaut s'est vu le 2026-08-03 : le port 9222 etait tenu par la fenetre d un
// AUTRE projet, la gate refusait de tourner, et le message accusait shaderlab
// d etre absent alors que le script n avait besoin d aucune page shaderlab. Une
// gate qui echoue pour une raison qui n est pas la sienne finit par etre ignoree.
const targets = await (await fetch(`http://localhost:${PORT_CDP}/json`)).json();
const page = ORIGIN
  ? targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
  : targets.find((t) => t.type === "page" && t.url.includes("1420"));
if (!page) {
  throw new Error(
    ORIGIN
      ? `aucune page CDP sur le port ${PORT_CDP} (l'iframe a besoin d'un hote de GPU, quel qu'il soit)`
      : "aucune page shaderlab sur le port 1420 — ou passer --origin pour compiler le worktree dans un iframe",
  );
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const contexts = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.executionContextCreated") contexts.push(m.params.context);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) =>
  new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });

await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");

// Contexte d'execution cible : celui de l'iframe du worktree si --origin est
// passe, celui de la page sinon.
let contextId;
if (ORIGIN) {
  const FRAME_ID = "__gpuShaderCheckFrame";
  const before = new Set(contexts.map((c) => c.uniqueId));
  const loaded = await send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `new Promise((res) => {
      document.getElementById(${JSON.stringify(FRAME_ID)})?.remove();
      const f = document.createElement("iframe");
      f.id = ${JSON.stringify(FRAME_ID)};
      f.style.cssText = "position:fixed;left:-9999px;top:0;width:8px;height:8px;border:0";
      f.src = ${JSON.stringify(`${ORIGIN}/scripts/render-check-page.html`)};
      f.onload = () => res("ok");
      f.onerror = () => res("erreur de chargement");
      document.body.appendChild(f);
    })`,
  });
  if (loaded.result?.result?.value !== "ok")
    throw new Error(`iframe ${ORIGIN}/scripts/render-check-page.html : ${loaded.result?.result?.value}`);
  let frame = null;
  for (let i = 0; i < 60 && !frame; i++) {
    frame = contexts.find((c) => c.origin === ORIGIN && !before.has(c.uniqueId)) ?? null;
    if (!frame) await new Promise((r) => setTimeout(r, 50));
  }
  if (!frame)
    throw new Error(
      `Aucun contexte d'execution sur ${ORIGIN}. Le Vite du worktree tourne-t-il ` +
        `(\`npx vite --port ${new URL(ORIGIN).port}\`) ?`,
    );
  contextId = frame.id;
}

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
        // Doit refleter EXACTEMENT ce que fait EffectPassRunner : la
        // declaration de l'effet, jamais la presence d'une vue. Sinon le
        // harnais compose un shader que l'application ne composera jamais, et
        // il echoue (ou passe) pour une raison sans rapport avec le rendu reel.
        const hasLibraryTexture = e.libraryTexture !== undefined;
        await compile(e.id + " composite",
          composeShader(e.wgsl, { applyMask: true, hasPrevPass: (e.passes || []).length > 0, blendWgsl: normal, hasLibraryTexture }));
        await compile(e.id + " composite+photo",
          composeShader(e.wgsl, { applyMask: true, hasPrevPass: (e.passes || []).length > 0, blendWgsl: normal, hasImageSource: true, hasLibraryTexture }));
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

    // 4) passe NEUTRE : celle qu'encode le court-circuit « 0 calque active ».
    // Elle avait un SECOND site jusqu'au 2026-08-21, la neutralisation d'un
    // calque ecrete dont la base photo n'etait pas rendue ; il est parti avec
    // l'ecretage (ADR-0020). \`passthrough\` n'est PAS dans effectRegistry (il
    // n'est pas choisissable par l'utilisateur), donc la boucle ci-dessus ne le
    // voyait pas — et \`runEffectPass\` a \`applyMask = true\` PAR DEFAUT
    // (effectPassRunner.ts) — mais depuis T0 (2026-07-28) l'executeur passe
    // explicitement \`{ applyMask: false }\` : c'est une COPIE (alpha inclus),
    // pas un compositing. Le chemin de compositing forcerait l'alpha a 1.
    await compile("passthrough neutre (copie, sans masque)",
      composeShader(PASSTHROUGH_EFFECT.wgsl, { applyMask: false, hasPrevPass: false }));

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

    // 5sexies) passes de PRESENTATION (T0, 2026-07-28). Deux sources
    // distinctes — le CHOIX du fond est du code WGSL (seule la taille de case
    // du damier est un uniforme, depuis 2026-07-29) — et c'est
    // la SEULE chose qui ecrit le canvas ou la cible d'export. Une regression
    // WGSL ici ne casse pas un effet : elle casse tout affichage ET tout
    // export d'un coup.
    const present = await import("/src/render/presentPass.ts");
    for (const bg of ["checker", "white"])
      await compile("presentation:" + bg, present.buildPresentWgsl(bg));
  } catch (e) {
    out.fatal = String(e && e.stack ? e.stack : e);
  }
  return JSON.stringify(out);
})()`;

const r = await send("Runtime.evaluate", {
  expression: script,
  awaitPromise: true,
  returnByValue: true,
  ...(contextId === undefined ? {} : { contextId }),
});
const val = r.result?.result?.value ?? JSON.stringify(r.result?.exceptionDetails ?? r, null, 2);
const d = typeof val === "string" ? JSON.parse(val) : val;

console.log(`GPU: ${d.device} | ${d.nbEffets} effets, ${d.nbBlend} modes de fusion`);
console.log(`${d.cas.length} shaders composes compiles, ${d.echecs.length} en echec\n`);
for (const c of d.cas) console.log(`${c.ok ? "OK  " : "FAIL"}  ${c.nom}${c.ok ? "" : "\n      " + (c.errs.join("\n      ") || c.scope)}`);
if (d.fatal) console.log("\nFATAL: " + d.fatal);
ws.close();
