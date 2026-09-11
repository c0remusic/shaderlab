// Comparaison côte à côte (ticket 07) SANS l'app live (WebView2 wedged) : rend la
// carte Développement via Storybook (mêmes composants, vrais tokens de design) et
// la composite avec le crop 1:1 de Lightroom. Sert `storybook-static`, capture la
// story DevelopPanel « RegleValeursSignees » (valeurs signées visibles), replie
// HSL et Étalonnage pour ne montrer que Réglages de base.
//   node .scratch/lightroom-develop/assets/reference-ui/_capture-07-storybook.mjs
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const ROOT = "storybook-static";
const DIR = ".scratch/lightroom-develop/assets/reference-ui";
const REF = "lightroom-14.5-reglages-de-base-1x.png";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".map": "application/json", ".ico": "image/x-icon" };

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(normalize(ROOT)) || !existsSync(file)) { res.writeHead(404); res.end("404"); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
console.log("storybook servi sur", port);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 340, height: 1400 }, deviceScaleFactor: 2 });
const url = `http://localhost:${port}/iframe.html?id=components-developpanel--regle-valeurs-signees&viewMode=story`;
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.waitForFunction(() => !!document.querySelector(".develop-panel"), { timeout: 15000 });

// Replier HSL et Étalonnage (cliquer le déclencheur d'accordéon dont le titre
// n'est pas « Réglages de base ») pour ne montrer que Réglages de base.
await page.evaluate(() => {
  const trigs = [...document.querySelectorAll('.develop-panel [role="button"], .develop-panel button')];
  for (const t of trigs) {
    const txt = (t.textContent || "").trim();
    if ((txt.includes("Noir et blanc") || txt.includes("Étalonnage")) && t.getAttribute("aria-expanded") === "true") t.click();
  }
});
await page.waitForTimeout(400);

const panel = page.locator(".develop-panel");
const buf = await panel.screenshot();
writeFileSync(`${DIR}/notre-07-reglages-de-base.png`, buf);
const our = PNG.sync.read(buf);
console.log("notre carte", our.width, "x", our.height);

// Échelle de notre carte à la largeur du crop Lightroom (voisin le plus proche).
const ref = PNG.sync.read(readFileSync(`${DIR}/${REF}`));
const targetW = ref.width;
const scale = targetW / our.width;
const scaledH = Math.round(our.height * scale);
const scaled = new PNG({ width: targetW, height: scaledH });
for (let y = 0; y < scaledH; y++) for (let x = 0; x < targetW; x++) {
  const sx = Math.min(our.width - 1, Math.floor(x / scale)), sy = Math.min(our.height - 1, Math.floor(y / scale));
  our.data.copy(scaled.data, (y * targetW + x) * 4, (sy * our.width + sx) * 4, (sy * our.width + sx) * 4 + 4);
}

const gap = 12;
const outW = targetW * 2 + gap, outH = Math.max(scaledH, ref.height);
const out = new PNG({ width: outW, height: outH });
for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 0x1e; out.data[i + 1] = 0x1e; out.data[i + 2] = 0x1e; out.data[i + 3] = 255; }
const blit = (src, ox) => { for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) src.data.copy(out.data, (y * outW + ox + x) * 4, (y * src.width + x) * 4, (y * src.width + x) * 4 + 4); };
blit(scaled, 0);
blit(ref, targetW + gap);
writeFileSync(`${DIR}/comparaison-07-reglages-de-base.png`, PNG.sync.write(out));
console.log("écrit comparaison-07-reglages-de-base.png", outW, "x", outH, "(gauche: nous, droite: Lightroom)");

await browser.close();
server.close();
process.exit(0);
