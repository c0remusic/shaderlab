#!/usr/bin/env node
// Compare deux CAPTURES de la meme scene et designe ou elles different.
//
// POURQUOI CE FICHIER EXISTE. Trois harnais de comparaison d'images ont deja ete
// ecrits dans le scratchpad d'une session et n'y ont pas survecu (verdict des
// mipmaps le 2026-08-17, paires avant/apres du verre le meme jour, vignette le
// lendemain). C'est la meme raison qui a fait versionner `perf-probe.mjs`, et
// elle est ecrite dans son en-tete : un instrument jetable se rate deux fois
// avant qu'on se decide a le garder.
//
// CE QU'IL REND, et pourquoi ces trois nombres :
//   - `max`      : le plus grand ecart sur un canal. Dit s'il s'est passe
//                  quelque chose, jamais ou.
//   - `moyenne`  : l'ecart moyen. Separe un changement DIFFUS (moyenne haute)
//                  d'un defaut PONCTUEL (max haut, moyenne au ras de zero).
//   - `chaudes`  : les tuiles de 64 px ou l'ecart se concentre. C'est le seul
//                  des trois qui designe un ENDROIT, donc le seul qui permette
//                  d'aller regarder.
// Plus deux crops agrandis x4 sans lissage de la tuile la plus chaude, un par
// image : c'est la sortie qu'on lit a l'oeil, les nombres ne servent qu'a
// choisir OU regarder.
//
// ⚠️ LE DECODAGE PNG SE FAIT DANS LA PAGE (`createImageBitmap`), par CDP. Node
// n'a pas de decodeur d'image en bibliotheque standard, et ajouter une
// dependance pour un outil de diagnostic en ferait une dependance permanente du
// produit. L'app doit donc tourner avec son port de debug — voir
// `.claude/skills/run-shaderlab/`.
//
// usage : node scripts/compare-captures.mjs <a.png> <b.png> <prefixe-de-sortie>
//         [--toile <px>]   largeur a comparer, pour ignorer un dock a droite

import { readFileSync, writeFileSync } from "node:fs";

const CDP = process.env.SHADERLAB_CDP ?? "http://localhost:9222";

async function connect() {
  let cibles;
  try {
    cibles = await (await fetch(`${CDP}/json/list`)).json();
  } catch {
    throw new Error(
      `CDP injoignable sur ${CDP}. L'app tourne-t-elle avec le port de debug ?\n` +
        `  Lancer : voir la section « Run (agent path) » de .claude/skills/run-shaderlab/SKILL.md`,
    );
  }
  const page = cibles.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error(`Aucune page CDP parmi ${cibles.length} cible(s).`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket CDP refusee")), { once: true });
  });
  let id = 0;
  const attente = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && attente.has(m.id)) { attente.get(m.id)(m); attente.delete(m.id); }
  });
  const envoyer = (method, params = {}) =>
    new Promise((resolve) => { const n = ++id; attente.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluer = async (expression) => {
    const r = await envoyer("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    const d = r.result?.exceptionDetails;
    if (d) throw new Error(`Exception dans la page : ${d.exception?.description ?? d.text ?? "inconnue"}`);
    return r.result?.result?.value;
  };
  return { evaluer, fermer: () => ws.close() };
}

async function main() {
  const argv = process.argv.slice(2);
  const iToile = argv.indexOf("--toile");
  const toileArg = iToile === -1 ? null : Number(argv[iToile + 1]);
  // Les positionnels sont ce qui reste une fois l'option ET sa valeur retirees.
  // Un filtre plus malin (« ce qui ne ressemble pas a un nombre ») casserait sur
  // un fichier nomme `12.png`.
  //
  // ⚠️ La garde `iToile === -1` n'est pas defensive, elle est NECESSAIRE : sans
  // elle, `i !== iToile + 1` vaut `i !== 0` quand l'option est absente, et le
  // PREMIER fichier disparait des positionnels. Attrape a la premiere execution.
  const positionnels = iToile === -1 ? argv : argv.filter((_, i) => i !== iToile && i !== iToile + 1);
  const [fa, fb, prefixe] = positionnels;
  if (!fa || !fb || !prefixe) {
    throw new Error("usage : compare-captures.mjs <a.png> <b.png> <prefixe> [--toile <px>]");
  }

  const a64 = readFileSync(fa).toString("base64");
  const b64 = readFileSync(fb).toString("base64");
  const page = await connect();

  const res = JSON.parse(await page.evaluer(`
    (async function(){
      function charge(b64) {
        var bin = atob(b64);
        var u8 = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return createImageBitmap(new Blob([u8], { type: 'image/png' }));
      }
      function pixels(bmp, w, h) {
        var c = new OffscreenCanvas(w, h);
        var x = c.getContext('2d');
        x.drawImage(bmp, 0, 0);
        return x.getImageData(0, 0, w, h).data;
      }
      var A = await charge(${JSON.stringify(a64)});
      var B = await charge(${JSON.stringify(b64)});
      if (A.width !== B.width || A.height !== B.height) {
        return JSON.stringify({ erreur: 'dimensions differentes : ' + A.width + 'x' + A.height + ' vs ' + B.width + 'x' + B.height });
      }
      var W = A.width, H = A.height;
      // Sans --toile, on compare TOUTE la largeur. Un dock identique des deux
      // cotes ne fausse pas le max ni les tuiles chaudes, mais il DILUE la
      // moyenne — d'ou l'option, et non un defaut cable en dur.
      var TOILE = Math.min(${toileArg === null ? "W" : toileArg}, W);
      var da = pixels(A, W, H), db = pixels(B, W, H);
      A.close(); B.close();

      var max = 0, somme = 0, n = 0, differents = 0;
      var T = 64, tuiles = [];
      for (var ty = 0; ty < Math.floor(H / T); ty++) {
        for (var tx = 0; tx < Math.floor(TOILE / T); tx++) {
          var s = 0;
          for (var y = ty * T; y < (ty + 1) * T; y += 2) {
            for (var x = tx * T; x < (tx + 1) * T; x += 2) {
              var i = (y * W + x) * 4;
              s += Math.abs(da[i] - db[i]) + Math.abs(da[i+1] - db[i+1]) + Math.abs(da[i+2] - db[i+2]);
            }
          }
          tuiles.push({ x: tx * T, y: ty * T, s: s });
        }
      }
      for (var y2 = 0; y2 < H; y2++) {
        for (var x2 = 0; x2 < TOILE; x2++) {
          var j = (y2 * W + x2) * 4;
          var d0 = Math.abs(da[j] - db[j]), d1 = Math.abs(da[j+1] - db[j+1]), d2 = Math.abs(da[j+2] - db[j+2]);
          var m = Math.max(d0, d1, d2);
          if (m > max) max = m;
          if (m > 0) differents++;
          somme += (d0 + d1 + d2) / 3;
          n++;
        }
      }
      tuiles.sort(function(p, q){ return q.s - p.s; });
      return JSON.stringify({
        w: W, h: H, toile: TOILE,
        max: max,
        moyenne: +(somme / n).toFixed(3),
        pourcentDifferents: +(100 * differents / n).toFixed(2),
        chaudes: tuiles.slice(0, 3),
      });
    })()
  `));

  console.log(JSON.stringify(res, null, 1));
  if (res.erreur) { page.fermer(); return; }

  const z = res.chaudes[0];
  const cx = Math.max(0, z.x - 96), cy = Math.max(0, z.y - 96);
  for (const [nom, b] of [["a", a64], ["b", b64]]) {
    const png = await page.evaluer(`
      (async function(){
        var bin = atob(${JSON.stringify(b)});
        var u8 = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        var bmp = await createImageBitmap(new Blob([u8], { type: 'image/png' }));
        var T = 256, Z = 4;
        var c = new OffscreenCanvas(T * Z, T * Z);
        var x = c.getContext('2d');
        // SANS LISSAGE : on agrandit pour VOIR les pixels, pas pour en fabriquer
        // d'autres. Un agrandissement interpole masquerait exactement le
        // crenelage qu'on vient chercher.
        x.imageSmoothingEnabled = false;
        x.drawImage(bmp, ${cx}, ${cy}, T, T, 0, 0, T * Z, T * Z);
        bmp.close();
        var blob = await c.convertToBlob({ type: 'image/png' });
        var buf = new Uint8Array(await blob.arrayBuffer());
        var s = '';
        for (var k = 0; k < buf.length; k++) s += String.fromCharCode(buf[k]);
        return btoa(s);
      })()
    `);
    writeFileSync(`${prefixe}-${nom}.png`, Buffer.from(png, "base64"));
  }
  console.log(`crops x4 ecrits : ${prefixe}-a.png / ${prefixe}-b.png  (zone ${cx},${cy} 256x256)`);
  page.fermer();
}

main().catch((e) => { console.error("ECHEC :", e.message); process.exit(1); });
