// Assemble la planche HTML du ticket 17 (reflet d'environnement du verre).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const b64 = (nom) => readFileSync(path.join(OUT, nom)).toString("base64");
const img = (suffixe, matiere, alt) =>
  `<img src="data:image/png;base64,${b64(`planche17-${suffixe}-${matiere}.png`)}" alt="${alt}">`;

const VOIES = [
  ["temoin", "Témoin — l'état actuel", "mélange vers une couleur FIXE (glass.ts:890) : le voile gris uniforme, surtout lisible dans les noirs du Poli"],
  ["studio", "A — gradient de studio", "environnement synthétique mappé par la direction réfléchie : ciel clair en haut, sol sombre, une bande de fenêtre"],
  ["matcap", "B — matcap procédural", "une sphère éclairée lue par la normale : lobe principal + contre-jour sur gris moyen"],
  ["autoreflet", "C — auto-réflexion", "l'image elle-même, lue dans la direction réfléchie et adoucie par cinq taps : le reflet suit la photo, les noirs restent denses"],
];

const blocs = VOIES.map(([suffixe, titre, note]) => `
    <section class="voie">
      <h2>${titre}</h2>
      <p>${note}</p>
      <div class="paire">
        <figure>${img(suffixe, "poli", `${titre} — Poli`)}<figcaption>Poli (feuille lisse)</figcaption></figure>
        <figure>${img(suffixe, "pave", `${titre} — Pavé nuage`)}<figcaption>Pavé nuage</figcaption></figure>
      </div>
    </section>`).join("\n");

const html = `<title>Reflet du verre</title>
<style>
  :root {
    --fond: #17181c; --carte: #1f2126; --filet: #2c2e35;
    --texte: #e8e6e1; --sourd: #9a9891; --accent: #d9a441; --ok: #8fae7a;
  }
  * { box-sizing: border-box; }
  body { background: var(--fond); color: var(--texte); margin: 0;
    font-family: "Source Sans 3", "Segoe UI", sans-serif; font-size: 16px; line-height: 1.55; }
  main { max-width: 1520px; margin: 0 auto; padding: 40px 24px 72px; }
  h1, h2 { font-family: "Archivo", "Segoe UI", sans-serif; text-wrap: balance; }
  h1 { font-size: 30px; margin: 0 0 6px; }
  .chapeau { color: var(--sourd); max-width: 68ch; }
  .question { border-left: 3px solid var(--accent); padding: 10px 16px; margin: 20px 0 8px;
    background: var(--carte); max-width: 72ch; }
  .voie { margin-top: 36px; border-top: 1px solid var(--filet); padding-top: 18px; }
  .voie h2 { font-size: 19px; margin: 0 0 4px; }
  .voie p { color: var(--sourd); margin: 0 0 12px; max-width: 72ch; }
  .paire { display: flex; gap: 16px; flex-wrap: wrap; }
  figure { margin: 0; }
  img { display: block; max-width: 720px; width: 100%; height: auto; border-radius: 3px; background: #000; }
  figcaption { color: var(--sourd); font-size: 13px; margin-top: 6px;
    font-family: "JetBrains Mono", Consolas, monospace; }
  .reco { margin-top: 32px; border-left: 3px solid var(--ok); background: var(--carte);
    padding: 12px 16px; max-width: 72ch; }
  .reco strong { color: var(--ok); }
  p.piednote { color: var(--sourd); font-size: 13px; margin-top: 28px; max-width: 72ch; }
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Source+Sans+3:wght@400;600&family=JetBrains+Mono:wght@500&display=swap">
<main>
  <h1>Reflet du verre</h1>
  <p class="chapeau">Ticket 17 — le voile plat du verre ne vient pas du Fresnel (la rampe de Schlick
  est dans l'arbre depuis le premier commit, constat du ticket 16) : il vient de la couleur FIXE vers
  laquelle le reflet se mélange. Trois façons de la remplacer par un environnement fabriqué,
  prototypées au même site du shader (glass.ts:890), tout le reste inchangé — la rampe F,
  le facteur 0,55, la matière.</p>
  <div class="question"><strong>À trancher :</strong> quelle voie d'environnement — ou quelle
  combinaison — mérite la vraie tranche ? (Elles se composent : un studio modulé par
  l'auto-réflexion est possible en second temps.)</div>
${blocs}
  <p class="reco"><strong>Reco :</strong> l'auto-réflexion (C) — le reflet suit la photo, les noirs
  restent denses (le voile disparaît vraiment, comparer les blocs sombres du Poli au témoin), les
  pavés éteints portent des remontées de la lumière de la scène, et il n'y a aucun asset ni couleur
  arbitraire. Réserve honnête : c'est un reflet screen-space local — il ne fabrique pas de « fenêtre
  de studio » ; si le verre doit lire comme éclairé en studio, A s'y combine.</p>
  <p class="piednote">Prototypes du 2026-08-26, rendus par le vrai pipeline (720 px, réglages :
  Poli = material 6 / depth 1 / thickness 1,6 ; Pavé nuage = material 9, table d'applicabilité).
  glass.ts restauré après capture — aucun de ces trois codes n'est commité. Scripts :
  .scratch/retour-usage-execution/assets/planche-17-*.mjs.</p>
</main>
`;
writeFileSync(path.join(OUT, "planche-17-reflet.html"), html);
console.log("ecrit planche-17-reflet.html (" + html.length + " octets)");
