// Assemble planche-verre-chronologie.html (autonome, images en dataURL) depuis
// les PNG chrono-*.png produits par planche-verre-chronologie-render.mjs.
// Grille : jalon (colonnes, chronologique) x matiere (lignes). Vignette reduite
// (voile par masses) + crop 1:1 fixe (micro-relief par pixel). En-tete par
// colonne : sha, date, ce que le commit a change. Aucune conclusion : Antoine
// pointe la colonne preferee.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const b = (f) => { const p = path.join(DIR, f); return existsSync(p) ? "data:image/png;base64," + readFileSync(p).toString("base64") : null; };
const jr = (f) => { const p = path.join(DIR, f); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {}; };

// Colonnes chronologiques. j5 (30dfd5b) et j6 (HEAD) rendent des pixels
// BIT-IDENTIQUES (md5 egaux) : le diff glass.ts 30dfd5b->HEAD est un renommage
// pur (rim -> appoint) + commentaires, zero pixel. Colonnes fusionnees.
const JALONS = [
  { tag: "j1-3c259b3", sha: "3c259b3", date: "2026-08-03", chg: "Naissance du verre : neuf matieres, une seule optique. Le reflet est une COULEUR FIXE." },
  { tag: "j2-da86f3d", sha: "da86f3d", date: "2026-08-13", chg: "Diffusion rendue ISOTROPE (correction du Depoli refuse « 3D annees 90 »), variation par pave, mortier en creux." },
  { tag: "j3-4c7754f", sha: "4c7754f", date: "2026-08-17", chg: "Perf : MIPMAP de diffusion — l'echantillonnage de la diffusion change." },
  { tag: "j4-aebc10a", sha: "aebc10a", date: "2026-08-17", chg: "Perf : plafond de niveau de mip 1 -> 2 — la diffusion change encore." },
  { tag: "j5-30dfd5b", sha: "30dfd5b -> HEAD", date: "2026-09-02", chg: "Le reflet fixe devient un MATCAP PROCEDURAL, lu par la normale (ticket 17). HEAD = renommage rim->appoint, zero pixel." },
];
const MAN = Object.fromEntries(JALONS.map((j) => [j.tag, jr(`chrono-manifest-${j.tag}.json`)]));

const MAT = [{ id: "poli", label: "Poli" }, { id: "depoli", label: "Depoli" }];
const leg = (m, id) => { const s = MAN[m] && MAN[m][id]; return s ? `moy ${s.moyenne} &middot; ecart ${s.ecartType}` : "&mdash;"; };
const md5 = (m, id) => { const s = MAN[m] && MAN[m][id]; return s ? s.md5.slice(0, 8) : ""; };

const headCells = JALONS.map((j) => `<th><div class="sha">${j.sha}</div><div class="date">${j.date}</div><div class="chg">${j.chg}</div></th>`).join("");

const bodyRows = MAT.map((mt) => {
  const vig = JALONS.map((j) => `<td>
    <img class="vig" src="${b(`chrono-${j.tag}-${mt.id}.png`)}">
    <div class="crop-wrap"><img class="crop" src="${b(`chrono-${j.tag}-${mt.id}-crop.png`)}"></div>
    <div class="leg">${leg(j.tag, mt.id)}</div><div class="md5">md5 ${md5(j.tag, mt.id)}</div>
  </td>`).join("");
  return `<tr><th class="rowlab">${mt.label}</th>${vig}</tr>`;
}).join("");

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Verre &mdash; chronologie des versions</title>
<style>
  body { font-family: system-ui, sans-serif; background:#14161a; color:#e8eaed; margin:0; padding:24px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .intro, .note { max-width:1200px; line-height:1.55; font-size:13px; color:#c8ccd2; }
  .intro b { color:#fff; }
  .ask { display:inline-block; margin:10px 0 4px; padding:8px 14px; background:#2a3550; color:#dbe6ff; font-size:15px; font-weight:600; border-radius:6px; border:1px solid #3d4d70; }
  .note { margin:10px 0 0; padding:10px 12px; background:#1b1e24; border-left:3px solid #3a4250; font-size:12px; }
  table { border-collapse:collapse; margin-top:16px; }
  th { font-size:12px; font-weight:600; text-align:left; padding:6px 8px; color:#c2c7ce; vertical-align:top; }
  thead th { text-align:center; color:#e8eaed; border-bottom:1px solid #333; max-width:220px; }
  thead th .sha { font-family:ui-monospace,monospace; font-size:13px; color:#8fd3ff; }
  thead th .date { font-size:11px; color:#9aa0a8; margin:2px 0 5px; }
  thead th .chg { font-size:11px; color:#c8ccd2; font-weight:400; line-height:1.4; text-align:left; }
  th.rowlab { font-size:14px; color:#e8eaed; vertical-align:middle; }
  td { padding:8px; text-align:center; vertical-align:top; border:1px solid #23262c; }
  img.vig { display:block; width:220px; height:auto; background:#000; }
  .crop-wrap { margin-top:6px; }
  img.crop { display:block; width:128px; height:128px; image-rendering:pixelated; background:#000; outline:1px solid #3a3f47; margin:0 auto; }
  .leg { font-size:11px; color:#9aa0a8; margin-top:5px; }
  .md5 { font-family:ui-monospace,monospace; font-size:10px; color:#6b727c; }
</style></head><body>
<h1>Verre &mdash; chronologie des versions</h1>
<div class="ask">Pointez la colonne pr&eacute;f&eacute;r&eacute;e.</div>
<div class="intro">
<p>Prototype jetable, <b>aucun commit</b> (Renderer offscreen via l'iframe du harnais ; <code>glass.ts</code> swapp&eacute; par
<code>git show &lt;sha&gt;:</code> puis restaur&eacute;, <code>git status</code> propre v&eacute;rifi&eacute; apr&egrave;s chaque passe). M&ecirc;me photo que la
planche q2 (<code>vram-test/photo-1.jpg</code>), m&ecirc;mes param&egrave;tres explicites d'un jalon &agrave; l'autre (les d&eacute;fauts n'ont pas boug&eacute; sur
la p&eacute;riode : seul l'algorithme change). Vignette r&eacute;duite pour le voile (par masses) ; crop 1:1 fixe au bord le plus
contrast&eacute; (293, 230) pour le micro-relief (par pixel). L&eacute;gende : moyenne / &eacute;cart-type de luminance, et md5 du rendu.</p>
<p class="note"><b>Lecture factuelle, pas un verdict.</b> Les colonnes 3 et 4 sont des commits de PERF (mipmap de diffusion) :
la moyenne bouge &agrave; peine (70,3 &rarr; 70,5) mais le md5 change &mdash; l'&eacute;chantillonnage de la diffusion a &eacute;t&eacute; modifi&eacute;. Le grand
saut est la colonne 5, le <b>matcap</b> : moyenne 70,5 &rarr; 64,4 et &eacute;cart-type 45,8 &rarr; 48,8. Les jalons 30dfd5b et HEAD sont
BIT-identiques (renommage pur), colonnes fusionn&eacute;es.</p>
</div>
<table>
<thead><tr><th></th>${headCells}</tr></thead>
<tbody>${bodyRows}</tbody>
</table>
</body></html>`;
const outFile = path.join(DIR, "planche-verre-chronologie.html");
writeFileSync(outFile, html, "utf8");
console.log("ecrit " + outFile + " (" + (html.length / 1024).toFixed(0) + " Ko)");
