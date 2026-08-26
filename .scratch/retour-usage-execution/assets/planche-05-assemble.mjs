// Assemble la planche HTML de decision (ticket 05) avec les vignettes inline.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const b64 = (nom) => readFileSync(path.join(OUT, nom)).toString("base64");
const img = (source, nom, alt) =>
  `<img width="240" height="160" src="data:image/png;base64,${b64(`planche05-${source}-${nom}.png`)}" alt="${alt}">`;

const EFFETS = [
  ["dither", "Dither", "pas de trame en pixels (size)", true],
  ["halftone", "Halftone", "taille de point en pixels (dotSize)", true],
  ["glass", "Verre", "taille de pave en pixels natifs (blockSize)", true],
  ["grain", "Grain", "reference independante de la resolution (GRAIN_REFERENCE_EDGE)", false],
  ["glow", "Glow", "etalement en fraction de pyramide (spread)", false],
  ["lensFlare", "Lens flare", "source posee en fractions du cadre", false],
];

const lignes = EFFETS.map(([id, nom, note, px]) => `
      <tr>
        <th scope="row">
          <span class="effet">${nom}</span>
          <span class="note${px ? " note--px" : ""}">${px ? "param en px — " : ""}${note}</span>
        </th>
        <td>${img("reduit", id, `${nom} sur composite reduit`)}</td>
        <td>${img("crop", id, `${nom} sur crop 1:1`)}</td>
      </tr>`).join("\n");

const html = `<title>Fidélité des vignettes</title>
<style>
  :root {
    --fond: #17181c; --carte: #1f2126; --filet: #2c2e35;
    --texte: #e8e6e1; --sourd: #9a9891; --accent: #d9a441; --ok: #8fae7a;
  }
  * { box-sizing: border-box; }
  body {
    background: var(--fond); color: var(--texte); margin: 0;
    font-family: "Source Sans 3", "Segoe UI", sans-serif; font-size: 16px; line-height: 1.55;
  }
  main { max-width: 860px; margin: 0 auto; padding: 40px 24px 72px; }
  h1, h2 { font-family: "Archivo", "Segoe UI", sans-serif; text-wrap: balance; }
  h1 { font-size: 30px; font-weight: 700; margin: 0 0 6px; }
  h2 { font-size: 19px; font-weight: 600; margin: 40px 0 10px; }
  .chapeau { color: var(--sourd); max-width: 62ch; margin: 0 0 8px; }
  .question {
    border-left: 3px solid var(--accent); padding: 10px 16px; margin: 20px 0 32px;
    background: var(--carte); max-width: 68ch;
  }
  table { border-collapse: collapse; width: 100%; }
  thead th {
    font-family: "JetBrains Mono", Consolas, monospace; font-size: 12px; font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--sourd);
    text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--filet);
  }
  tbody th {
    text-align: left; vertical-align: top; padding: 18px 14px 18px 0; width: 200px; font-weight: 400;
  }
  tbody td { padding: 12px 10px; vertical-align: top; }
  tbody tr { border-bottom: 1px solid var(--filet); }
  .effet { display: block; font-family: "Archivo", sans-serif; font-weight: 600; font-size: 16px; }
  .note { display: block; color: var(--sourd); font-size: 13px; margin-top: 4px; max-width: 24ch; }
  .note--px { color: var(--accent); }
  img { display: block; border-radius: 3px; background: #000; }
  .verdict { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px; }
  .verdict section { background: var(--carte); border-radius: 6px; padding: 16px 18px; }
  .verdict h3 { margin: 0 0 8px; font-family: "Archivo", sans-serif; font-size: 15px; }
  .verdict ul { margin: 0; padding-left: 18px; color: var(--sourd); font-size: 14px; }
  .verdict li { margin: 4px 0; }
  .verdict li strong { color: var(--texte); font-weight: 600; }
  .reco { margin-top: 28px; border-left: 3px solid var(--ok); background: var(--carte); padding: 12px 16px; max-width: 68ch; }
  .reco strong { color: var(--ok); }
  p.piednote { color: var(--sourd); font-size: 13px; margin-top: 36px; max-width: 68ch; }
  @media (max-width: 720px) {
    table, thead, tbody, tr, th, td { display: block; }
    tbody th { width: auto; padding: 14px 0 4px; }
    thead { display: none; }
  }
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Source+Sans+3:wght@400;600&family=JetBrains+Mono:wght@500&display=swap">
<main>
  <h1>Fidélité des vignettes</h1>
  <p class="chapeau">Ticket 05 — la galerie « Ajouter un effet » montrera un aperçu au survol.
  Deux façons de fabriquer la petite image sous l'effet, rendues ici par le <em>vrai</em> pipeline
  (240 × 160, effets aux réglages par défaut, photo-1.jpg) :</p>
  <div class="question">
    <strong>À trancher :</strong> la vignette part-elle du composite <strong>réduit</strong>
    (l'image entière, rétrécie — les paramètres en pixels paraissent ~26× trop gros)
    ou d'un <strong>crop 1:1</strong> (240 × 160 découpés au centre — paramètres exacts,
    mais on ne reconnaît plus sa photo et le bruit natif du JPEG domine à 100 %) ?
  </div>
  <table>
    <thead>
      <tr><th scope="col"></th><th scope="col">A — composite réduit</th><th scope="col">B — crop 1:1</th></tr>
    </thead>
    <tbody>
      <tr>
        <th scope="row"><span class="effet">Témoin</span><span class="note">la source nue, sans effet</span></th>
        <td>${img("reduit", "temoin", "source reduite sans effet")}</td>
        <td>${img("crop", "temoin", "crop 1:1 sans effet")}</td>
      </tr>
${lignes}
    </tbody>
  </table>
  <h2>Ce que la planche montre</h2>
  <div class="verdict">
    <section>
      <h3>A — composite réduit</h3>
      <ul>
        <li><strong>La photo se reconnaît</strong> sur chaque vignette : on juge l'effet sur SON image.</li>
        <li>Les effets placés (flare, leak) restent dans le cadre.</li>
        <li>Les paramètres en pixels (ambre ci-contre) rendent des marques relativement énormes — l'aperçu montre l'<strong>identité</strong> de l'effet, pas son échelle finale.</li>
      </ul>
    </section>
    <section>
      <h3>B — crop 1:1</h3>
      <ul>
        <li>Échelle des marques <strong>exacte</strong> (1 px = 1 px du document).</li>
        <li>Mais l'image devient méconnaissable (un coin de branche), et le <strong>bruit natif du JPEG à 100 %</strong> écrase les effets doux — voir Lens flare.</li>
        <li>Un effet placé peut tomber entièrement hors du crop.</li>
      </ul>
    </section>
  </div>
  <p class="reco"><strong>Reco :</strong> le composite réduit (A) — c'est la convention des galeries
  de filtres (Photoshop réduit aussi), et une vignette sert à reconnaître l'effet, pas à mesurer
  une trame. L'échelle exacte se juge sur la toile, une fois l'effet posé.</p>
  <p class="piednote">Fabriqué le 2026-08-26 par le pipeline réel (iframe Vite + Renderer offscreen,
  même technique que le harnais de rendu). Script : .scratch/retour-usage-execution/assets/planche-05-fidelite.mjs —
  relançable tant que l'app tourne avec le port CDP.</p>
</main>
`;

writeFileSync(path.join(OUT, "planche-05-fidelite.html"), html);
console.log("ecrit planche-05-fidelite.html (" + html.length + " octets)");
