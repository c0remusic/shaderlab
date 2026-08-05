#!/usr/bin/env node
// Pilote CDP de shaderlab — la façon dont un agent conduit l'application.
//
// POURQUOI CE FICHIER EXISTE. shaderlab est une app Tauri v2 : une fenêtre
// WebView2 native sur Windows. Aucun `npm start` ne rend la main, aucun
// Playwright ne peut l'ouvrir, et `computer-use` ne sait pas la cibler (ce
// n'est pas une app enregistrée au menu Démarrer). Le seul handle programmatique
// est le DevTools Protocol de la WebView2, activé par une variable
// d'environnement au lancement. Ce script est ce handle.
//
// Usage : node .claude/skills/run-shaderlab/driver.mjs <commande> [args]
//   status                    état app / CDP / ports / document
//   open <chemin.jpg>         ouvre une photo (pont de debug dev-only)
//   shot <sortie.png>         capture la fenêtre, ET mesure son contenu
//   signature                 statistiques des pixels RÉELLEMENT composés
//   layers                    pile de calques
//   add-effect <Nom>          ajoute un calque d'effet par son nom affiché
//   param <n> <valeur>        pose la valeur du n-ième curseur du panneau
//   textures                  état de la bibliothèque de textures
//   eval <expression>         évalue du JS dans la page
//   reload                    recharge et attend le pont de debug
//
// Toutes les commandes rendent un code de sortie non nul en cas d'échec.

import { writeFileSync } from "node:fs";

const CDP = process.env.SHADERLAB_CDP ?? "http://localhost:9222";

/* ── Transport ───────────────────────────────────────────────────────────── */

async function connect() {
  let cibles;
  try {
    cibles = await (await fetch(`${CDP}/json/list`)).json();
  } catch {
    throw new Error(
      `CDP injoignable sur ${CDP}. L'app tourne-t-elle avec le port de debug ?\n` +
        `  Lancer : voir la section « Run (agent path) » du SKILL.md`,
    );
  }
  const page = cibles.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error(`Aucune page CDP parmi ${cibles.length} cible(s).`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket CDP refusée")), { once: true });
  });

  let id = 0;
  const attente = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && attente.has(m.id)) {
      attente.get(m.id)(m);
      attente.delete(m.id);
    }
  });

  const envoyer = (method, params = {}) =>
    new Promise((resolve) => {
      const n = ++id;
      attente.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  /** Évalue une expression et rend sa valeur. LÈVE sur exception dans la page :
   *  une sonde qui avale les erreurs rapporte « rien trouvé » aussi bien quand
   *  la cible manque que quand le code est faux. */
  const evaluer = async (expression, attendrePromesse = true) => {
    const r = await envoyer("Runtime.evaluate", {
      expression,
      awaitPromise: attendrePromesse,
      returnByValue: true,
    });
    const details = r.result?.exceptionDetails;
    if (details) {
      throw new Error(
        `Exception dans la page : ${details.exception?.description ?? details.text ?? "inconnue"}`,
      );
    }
    return r.result?.result?.value;
  };

  return { envoyer, evaluer, fermer: () => ws.close() };
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Le pont de debug n'existe qu'APRÈS le montage de React, et il est
 *  `import.meta.env.DEV` seulement — absent d'un build de production. */
async function attendrePont(page, tours = 40) {
  for (let i = 0; i < tours; i += 1) {
    if (await page.evaluer("!!window.__shaderlabDebug", false)) return true;
    await dormir(300);
  }
  throw new Error(
    "window.__shaderlabDebug absent. L'app tourne-t-elle en DEV (`npm run tauri dev`) ?\n" +
      "Un build de production ne l'expose pas (App.tsx, garde import.meta.env.DEV).",
  );
}

/* ── Commandes ───────────────────────────────────────────────────────────── */

const commandes = {
  async status(page) {
    const url = await page.evaluer("location.href", false);
    const pont = await page.evaluer("!!window.__shaderlabDebug", false);
    // ⚠️ LA PRÉSENCE DU DOCK NE DIT RIEN du document. Les cartes Presets / Pile
    // / Textures s'affichent même sur l'écran d'accueil « Ouvrir une photo » —
    // vérifié à la capture. Le seul témoin fiable est la PILE DE CALQUES : un
    // document ouvert porte au moins son calque photo de fond.
    const calques = pont
      ? await page.evaluer("window.__shaderlabDebug.state().layers.length")
      : 0;
    const cartes = await page.evaluer(
      "JSON.stringify(Array.prototype.map.call(document.querySelectorAll('.docked-panel-card__title'), function(s){return s.textContent.trim();}))",
      false,
    );
    console.log(`url        : ${url}`);
    console.log(`pont debug : ${pont ? "présent" : "ABSENT (build prod ?)"}`);
    console.log(`document   : ${calques > 0 ? `ouvert, ${calques} calque(s)` : "AUCUN — ouvrir une photo avant d'ajouter un effet"}`);
    console.log(`cartes     : ${cartes}`);
  },

  async open(page, chemin) {
    if (!chemin) throw new Error("usage : open <chemin absolu vers un .jpg>");
    await attendrePont(page);
    const r = await page.evaluer(
      `window.__shaderlabDebug.openByPath(${JSON.stringify(chemin)})` +
        `.then(function(){return "ok";}).catch(function(e){return "ECHEC " + e;})`,
    );
    if (String(r).startsWith("ECHEC")) throw new Error(r);
    await dormir(2500);
    console.log(`ouvert : ${chemin}`);
  },

  async shot(page, sortie = "shaderlab.png") {
    const r = await page.envoyer("Page.captureScreenshot", { format: "png" });
    const b64 = r.result?.data;
    if (!b64) throw new Error("Page.captureScreenshot n'a rien rendu.");
    writeFileSync(sortie, Buffer.from(b64, "base64"));

    // MESURER le contenu, pas seulement écrire le fichier. Un PNG de 300 Ko
    // entièrement noir a l'air d'une réussite jusqu'à ce qu'on l'ouvre.
    const stats = await page.evaluer(`
      (async () => {
        const bin = atob(${JSON.stringify(b64)});
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const bmp = await createImageBitmap(new Blob([u8], { type: 'image/png' }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const x = c.getContext('2d');
        x.drawImage(bmp, 0, 0);
        const d = x.getImageData(0, 0, bmp.width, bmp.height).data;
        let s = 0; const v = [];
        for (let i = 0; i < d.length; i += 4) { const l = (d[i]+d[i+1]+d[i+2])/3; s += l; v.push(l); }
        const m = s / v.length;
        const e = Math.sqrt(v.reduce((a,y)=>a+(y-m)**2,0)/v.length);
        // Dimensions relevees AVANT close() : un ImageBitmap ferme rend 0x0, et
        // le rapport aurait l'air d'une capture vide alors qu'il mesure bien.
        const dims = { w: bmp.width, h: bmp.height };
        bmp.close();
        return JSON.stringify({ ...dims, moyenne: +m.toFixed(1), ecart: +e.toFixed(1) });
      })()
    `);
    const s = JSON.parse(stats);
    console.log(`écrit ${sortie} — ${s.w}x${s.h}, moyenne ${s.moyenne}, écart-type ${s.ecart}`);
    if (s.ecart < 1) {
      console.log("⚠️  écart-type quasi nul : l'image est un aplat. Fenêtre minimisée, ou rien de rendu.");
    }
  },

  async signature(page) {
    await attendrePont(page);
    // ⚠️ `frameSignature` lit `Renderer.exportFrame()`, PAS le canvas. Un
    // `drawImage` de la surface de présentation WebGPU rend du NOIR hors de sa
    // frame — une sonde qui la lit rapporte « aucun changement » aussi bien
    // quand l'effet est mort que quand il marche.
    const r = await page.evaluer(
      "window.__shaderlabDebug.frameSignature().then(function(s){return JSON.stringify(s);})",
    );
    console.log(r ?? "null (aucun renderer)");
  },

  async layers(page) {
    await attendrePont(page);
    const r = await page.evaluer("JSON.stringify(window.__shaderlabDebug.state().layers, null, 1)");
    console.log(r);
  },

  async "add-effect"(page, nom) {
    if (!nom) throw new Error("usage : add-effect <Nom affiché>  (ex. Texture, Grain, Halftone)");
    const ouvert = await page.evaluer(
      `(function(){var b=Array.prototype.slice.call(document.querySelectorAll('button')).find(function(x){return x.textContent.trim()==='Ajouter un effet';}); if(!b) return 'absent'; b.click(); return 'ok';})()`,
      false,
    );
    if (ouvert === "absent") {
      throw new Error("Bouton « Ajouter un effet » introuvable — aucun document ouvert ? (voir `status`)");
    }
    await dormir(900);
    const choisi = await page.evaluer(
      `(function(){var c=Array.prototype.slice.call(document.querySelectorAll('button,li,[role=option]')).filter(function(e){return e.textContent.trim()===${JSON.stringify(nom)};}); if(!c.length) return 'absent'; c[c.length-1].click(); return 'ok';})()`,
      false,
    );
    if (choisi === "absent") throw new Error(`Effet « ${nom} » introuvable dans le sélecteur.`);
    await dormir(2500);
    console.log(`calque d'effet ajouté : ${nom}`);
  },

  async param(page, index, valeur) {
    if (index === undefined || valeur === undefined) {
      throw new Error("usage : param <index du curseur, 0-based> <valeur>");
    }
    // ⚠️ Les curseurs n'ont NI aria-label NI texte adjacent : on les désigne par
    // leur rang ou par leurs bornes (`eval` + `.max`), jamais par un libellé.
    const r = await page.evaluer(`
      (function(){
        var all = Array.prototype.slice.call(document.querySelectorAll('input[type=range]'));
        var inp = all[${Number(index)}];
        if (!inp) return 'introuvable (' + all.length + ' curseurs)';
        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, String(${JSON.stringify(String(valeur))}));
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return 'posé à ' + inp.value + ' (bornes ' + inp.min + '..' + inp.max + ')';
      })()
    `, false);
    if (String(r).startsWith("introuvable")) throw new Error(r);
    await dormir(1200);
    console.log(r);
  },

  async textures(page) {
    await attendrePont(page);
    const diag = await page.evaluer(
      "JSON.stringify(window.__shaderlabDebug.textureLibraryDiagnostics())",
    );
    const dossier = await page.evaluer(
      "window.__TAURI_INTERNALS__.invoke('default_texture_dir')",
    );
    console.log(`dossier : ${dossier ?? "aucun"}`);
    console.log(`store   : ${diag}`);
  },

  async eval(page, ...morceaux) {
    const expression = morceaux.join(" ");
    if (!expression) throw new Error("usage : eval <expression JS>");
    const r = await page.evaluer(expression);
    console.log(typeof r === "string" ? r : JSON.stringify(r, null, 1));
  },

  async reload(page) {
    await page.evaluer("location.reload()", false);
    await dormir(4000);
    await attendrePont(page);
    console.log("rechargé, pont de debug présent");
  },
};

/* ── Entrée ──────────────────────────────────────────────────────────────── */

const [, , nom, ...args] = process.argv;
if (!nom || nom === "--help" || !commandes[nom]) {
  console.log("commandes :", Object.keys(commandes).join(", "));
  process.exit(nom && nom !== "--help" ? 1 : 0);
}

let page;
try {
  page = await connect();
  await commandes[nom](page, ...args);
} catch (e) {
  console.error(`ECHEC : ${e.message}`);
  process.exitCode = 1;
} finally {
  page?.fermer();
}
