// Assemble la planche des leviers du ticket 18 (crops 1:1, pleine resolution).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const b64 = (nom) => readFileSync(path.join(OUT, nom)).toString("base64");
const img = (suffixe, matiere, alt) =>
  `<img src="data:image/png;base64,${b64(`planche17b-${suffixe}-${matiere}.png`)}" alt="${alt}">`;

const VARIANTES = [
  ["c-temoin", "Témoin — l'état actuel", "le micro-relief entre dans la NORMALE de réfraction : un déplacement d'un pixel par pixel, le « givre » plaqué partout"],
  ["c-L1", "L1 — micro-relief reporté dans l'étalement", "la normale ne garde que l'ondulation ; la rugosité devient un léger flou (report dosé à l'équivalent de son amplitude)"],
  ["c-L2", "L2 — diffusion portée par la pente", "le terme constant de la diffusion (98,8 % du rayon au défaut) s'éteint là où la pente est nulle ; le micro-relief reste dans la normale"],
  ["c-L3", "L3 — vitrine pure : micro coupé + diffusion par la pente", "les deux corrections, sans report d'étalement : l'ondulation par masses seule, l'image nette qui ondule"],
  ["c-L12", "L1+L2 — les deux, avec report", "micro dans l'étalement ET diffusion par la pente"],
];

const MATIERES = [
  ["poli", "Poli", "LE sujet : une vitrine ondule, elle ne givre pas"],
  ["cannele", "Cannelé simple", "contrôle : les stries doivent garder leur matière"],
  ["depoli", "Dépoli", "contrôle : il VIT du micro-relief et de la diffusion constante — les protos l'excluent des deux corrections, il doit être identique partout"],
];

const blocs = MATIERES.map(([mid, mnom, mnote]) => `
    <section class="matiere">
      <h2>${mnom}</h2>
      <p>${mnote}</p>
      ${VARIANTES.map(([vid, vnom, vnote]) => `
      <figure>
        <figcaption><strong>${vnom}</strong> — ${vnote}</figcaption>
        ${img(vid, mid, `${mnom} / ${vnom}`)}
      </figure>`).join("\n")}
    </section>`).join("\n");

const html = `<title>Leviers du Poli</title>
<style>
  :root { --fond: #17181c; --carte: #1f2126; --filet: #2c2e35;
    --texte: #e8e6e1; --sourd: #9a9891; --accent: #d9a441; --ok: #8fae7a; }
  * { box-sizing: border-box; }
  body { background: var(--fond); color: var(--texte); margin: 0;
    font-family: "Source Sans 3", "Segoe UI", sans-serif; font-size: 16px; line-height: 1.55; }
  main { max-width: 800px; margin: 0 auto; padding: 40px 24px 72px; }
  h1, h2 { font-family: "Archivo", "Segoe UI", sans-serif; text-wrap: balance; }
  h1 { font-size: 30px; margin: 0 0 6px; }
  .chapeau { color: var(--sourd); max-width: 68ch; }
  .question { border-left: 3px solid var(--accent); padding: 10px 16px; margin: 20px 0 8px;
    background: var(--carte); max-width: 72ch; }
  .matiere { margin-top: 40px; border-top: 1px solid var(--filet); padding-top: 18px; }
  .matiere h2 { font-size: 20px; margin: 0 0 4px; }
  .matiere > p { color: var(--sourd); margin: 0 0 14px; }
  figure { margin: 0 0 22px; }
  figcaption { color: var(--sourd); font-size: 14px; margin-bottom: 6px; max-width: 72ch; }
  figcaption strong { color: var(--texte); }
  img { display: block; width: 100%; max-width: 720px; height: auto; border-radius: 3px; background: #000; }
  .reco { margin-top: 30px; border-left: 3px solid var(--ok); background: var(--carte);
    padding: 12px 16px; max-width: 72ch; }
  .reco strong { color: var(--ok); }
  p.piednote { color: var(--sourd); font-size: 13px; margin-top: 26px; max-width: 72ch; }
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Source+Sans+3:wght@400;600&family=JetBrains+Mono:wght@500&display=swap">
<main>
  <h1>Leviers du Poli</h1>
  <p class="chapeau">Ticket 18, requalifié : la réfraction est déjà portée par la pente (mesuré) —
  ce qui brouille le centre du Poli, ce sont le micro-relief entré dans la normale (un pixel de
  déplacement par pixel) et le terme constant de la diffusion (126 px partout au défaut). Crops
  <strong>1:1 à pleine résolution</strong> (une planche réduite moyenne le micro-relief et ment) ;
  réglages : creux 1 · épaisseur 1,6 pour le Poli.</p>
  <div class="question"><strong>À trancher :</strong> quelle variante devient la tranche codée ?
  (Elle sera livrée proprement — les 13 références régénérées, gates complètes, dosages affinés
  sur captures si besoin.)</div>
${blocs}
  <p class="reco"><strong>Reco : L3 (vitrine pure).</strong> C'est la définition du Poli écrite
  dans le fichier même (« l'image reste NETTE et se déplace seulement, par larges masses ») —
  enfin rendue. L1 en diffère peu (son report ajoute un léger flou constant) ; L2 seul garde le
  givre. Le Dépoli est identique partout, par construction.</p>
  <p class="piednote">Prototypes du 2026-08-27, rendus par le vrai pipeline à pleine résolution,
  glass.ts restauré après chaque capture — rien de commité. Détail des mesures : ticket 18.</p>
</main>
`;
writeFileSync(path.join(OUT, "planche-18-leviers.html"), html);
console.log("ecrit planche-18-leviers.html (" + html.length + " octets)");
