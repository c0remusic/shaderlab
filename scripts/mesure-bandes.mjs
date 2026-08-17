#!/usr/bin/env node
// Mesure le BANDING d'un degrade, le long d'une ligne horizontale.
//
// POURQUOI CE FICHIER EXISTE. « Est-ce que ca bande ? » est une question qu'on
// se pose a l'oeil et qu'on tranche mal : un degrade bande se voit sur un ecran
// et pas sur un autre, et il disparait sous le grain d'une photo. Elle est
// revenue le 2026-08-17 sur la vignette (effect.app annonce un `dither` sur la
// sienne, ce qui suggerait le defaut chez nous aussi) et l'instrument a du etre
// ecrit dans le scratchpad. Meme raison que `perf-probe.mjs` : on le garde pour
// que la prochaine fois soit une commande et pas une reecriture.
//
// CE QU'IL MESURE, et pourquoi c'est le bon nombre. Le long d'une ligne, il
// compte les PALIERS — les suites de pixels de valeur identique. Un degrade
// lisse sur 8 bits change de valeur tous les un ou deux pixels ; un degrade
// bande garde la meme valeur sur des dizaines de pixels puis saute. **Le plus
// long palier est donc la mesure directe du defaut**, et elle ne demande de
// juger aucune image.
//
// ⚠️ IL FAUT UNE ABLATION, PAS UNE LECTURE ISOLEE. Un palier de 7 px ne veut
// rien dire seul : mesure la MEME ligne avec et sans l'effet suspect. Sur la
// vignette du 2026-08-17 : 3 px sans, 7 px avec — le palier double mais reste
// loin des dizaines qu'il faut pour qu'une bande se voie, et la chute du nombre
// de valeurs distinctes (102 vers 76) etait de la COMPRESSION DE PLAGE (max 169
// vers 114) et non du banding. Sans les deux mesures, la seconde se lisait comme
// un defaut.
//
// ⚠️ ET LE GRAIN D'UNE PHOTO DITHERE TOUT SEUL. Un resultat propre sur une vraie
// photo ne prouve rien pour un aplat ou un ciel synthetique. Le dire quand on
// conclut.
//
// Le decodage PNG se fait dans la page par CDP — meme raison que
// `compare-captures.mjs` : pas de dependance de decodeur pour du diagnostic.
//
// usage : node scripts/mesure-bandes.mjs <image.png> [y] [x0] [x1]

import { readFileSync } from "node:fs";

const CDP = process.env.SHADERLAB_CDP ?? "http://localhost:9222";

async function connect() {
  let cibles;
  try {
    cibles = await (await fetch(`${CDP}/json/list`)).json();
  } catch {
    throw new Error(`CDP injoignable sur ${CDP}. L'app tourne-t-elle avec le port de debug ?`);
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
  const [fichier, ys, x0s, x1s] = process.argv.slice(2);
  if (!fichier) throw new Error("usage : mesure-bandes.mjs <image.png> [y] [x0] [x1]");
  const b64 = readFileSync(fichier).toString("base64");
  const page = await connect();

  const res = JSON.parse(await page.evaluer(`
    (async function(){
      var bin = atob(${JSON.stringify(b64)});
      var u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      var bmp = await createImageBitmap(new Blob([u8], { type: 'image/png' }));
      var W = bmp.width, H = bmp.height;
      var y  = ${ys  === undefined ? "Math.round(H / 2)" : Number(ys)};
      var x0 = ${x0s === undefined ? "0" : Number(x0s)};
      var x1 = ${x1s === undefined ? "W" : Number(x1s)};
      var c = new OffscreenCanvas(W, H);
      var g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      var d = g.getImageData(0, y, W, 1).data;
      bmp.close();

      var vals = [];
      for (var x = x0; x < x1; x++) {
        var i2 = x * 4;
        // Luminance Rec.709 : la meme que le reste du depot, pour qu'un chiffre
        // se compare a un autre.
        vals.push(Math.round(0.2126*d[i2] + 0.7152*d[i2+1] + 0.0722*d[i2+2]));
      }
      var paliers = [], courant = 1;
      for (var k = 1; k < vals.length; k++) {
        if (vals[k] === vals[k-1]) courant++;
        else { paliers.push(courant); courant = 1; }
      }
      paliers.push(courant);
      paliers.sort(function(a,b){ return b-a; });
      return JSON.stringify({
        image: W + 'x' + H, ligne: y, de: x0, a: x1, n: vals.length,
        valeursDistinctes: new Set(vals).size,
        plusLongPalier: paliers[0],
        top5Paliers: paliers.slice(0, 5),
        palierMoyen: +(vals.length / paliers.length).toFixed(2),
        min: Math.min.apply(null, vals), max: Math.max.apply(null, vals),
      });
    })()
  `));

  console.log(JSON.stringify(res, null, 1));
  page.fermer();
}

main().catch((e) => { console.error("ECHEC :", e.message); process.exit(1); });
