// Assemble planche-q2-verre.html (autonome, images en dataURL) depuis les PNG
// q2-*.png produits par planche-q2-verre-render.mjs (tags current/avant) et
// planche-q2-cannele-render.mjs, plus les diffs de planche-q2-mesure-dispersion.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const b = (f) => { const p = path.join(DIR, f); return existsSync(p) ? "data:image/png;base64," + readFileSync(p).toString("base64") : null; };
const jr = (f) => { const p = path.join(DIR, f); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {}; };
const mCur = jr("q2-manifest-current.json"), mAv = jr("q2-manifest-avant.json"), mCan = jr("q2-manifest-cannele.json");
const leg = (st) => st ? `moyenne ${st.moyenne} &middot; écart-type ${st.ecartType}` : "&mdash;";

// Diffs mesures (planche-q2-mesure-dispersion.mjs, dispersion 0,25 vs 0, current).
const DISP_MESURE = {
  poli: "RGB 0,01 % pixels, max 2 LSB &middot; chroma 0,07 %",
  depoli: "RGB 0,12 % pixels, max 4 LSB &middot; chroma 0,62 %",
};

const MAT = [{ id: "poli", label: "Poli" }, { id: "depoli", label: "Dépoli" }];

// ── Section 1 : matcap (current) vs avant-matcap, masses + bord ────────────
const rowMatcap = (m) => `<tr><th>${m.label}</th>
  <td><img class="vig" src="${b(`q2-current-${m.id}-d25.png`)}"><div class="leg">${leg(mCur[m.id + "-d25"])}</div></td>
  <td><img class="vig" src="${b(`q2-avant-${m.id}-d25.png`)}"><div class="leg">${leg(mAv[m.id + "-d25"])}</div></td>
  <td><img class="crop" src="${b(`q2-current-${m.id}-d25-crop-droite.png`)}"><div class="croplbl">current, bord silhouette/ciel</div></td>
  <td><img class="crop" src="${b(`q2-avant-${m.id}-d25-crop-droite.png`)}"><div class="croplbl">avant, même bord</div></td></tr>`;

// ── Section 2 : dispersion 0,25 vs 0, crops de bord ────────────────────────
const rowDisp = (id, label, mes, extra) => `<tr><th>${label}</th>
  <td><img class="crop" src="${b(`q2-current-${id}-d25-crop-droite.png`)}"><div class="croplbl">dispersion 0,25</div></td>
  <td><img class="crop" src="${b(`q2-current-${id}-d0-crop-droite.png`)}"><div class="croplbl">dispersion 0</div></td>
  <td><img class="crop" src="${b(`q2-current-${id}-d25-crop-auto.png`)}"><div class="croplbl">0,25 &mdash; bord rayons verts</div></td>
  <td class="mes">${mes || "&mdash;"}${extra ? `<br><span class="sub">${extra}</span>` : ""}</td></tr>`;

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Planche Q2 &mdash; verre : dispersion et matcap</title>
<style>
  body { font-family: system-ui, sans-serif; background:#14161a; color:#e8eaed; margin:0; padding:24px; }
  h1 { font-size:20px; } h2 { font-size:15px; border-bottom:1px solid #333; padding-bottom:6px; margin-top:30px; }
  .intro, .note { max-width:1100px; line-height:1.55; font-size:13px; color:#c8ccd2; }
  .intro b, .note b { color:#fff; } .warn { color:#ffcf6b; }
  .note { margin:8px 0 0; padding:10px 12px; background:#1b1e24; border-left:3px solid #3a4250; font-size:12px; }
  .note.warn { border-left-color:#ffcf6b; }
  table { border-collapse:collapse; margin-top:10px; }
  th { font-size:12px; font-weight:600; text-align:left; padding:6px 10px; color:#c2c7ce; vertical-align:middle; }
  thead th { text-align:center; color:#e8eaed; }
  td { padding:8px; text-align:center; vertical-align:top; border:1px solid #23262c; }
  td.mes { font-size:12px; color:#c8ccd2; text-align:left; max-width:200px; vertical-align:middle; }
  .sub { color:#8a9099; font-size:11px; }
  img.vig { display:block; width:300px; height:auto; background:#000; }
  img.crop { display:block; width:200px; height:200px; image-rendering:pixelated; background:#000; outline:1px solid #3a3f47; }
  .leg { font-size:11px; color:#9aa0a8; margin-top:3px; }
  .croplbl { font-size:10px; color:#7b818a; margin-top:4px; }
</style></head><body>
<h1>Planche Q2 &mdash; verre : dispersion et matcap</h1>
<div class="intro">
<p>Prototype jetable, aucun commit (Renderer offscreen via l'iframe du harnais ; modules servis depuis le disque). Photo
réelle du dépôt (<code>vram-test/photo-1.jpg</code>, coucher de soleil &mdash; contenu varié pour juger la couleur, pas la
mire achromatique). Le rendu &laquo; avant &raquo; est obtenu en swappant <code>glass.ts</code> sur le parent du commit du
matcap (<code>30dfd5b^</code>), rendu, puis restauré (<code>git status</code> propre vérifié). Le matcap
n'expose <b>aucun curseur</b> (le commit 30dfd5b n'ajoute aucun paramètre) : l'image est la seule voie de comparaison.
Crops à l'échelle 1:1 (pixels natifs agrandis sans interpolation).</p>
<p class="note warn"><b>Constat sur pièce, à voir avant de juger.</b> Mesuré : la <b>dispersion est quasi inerte sur Poli et
Dépoli</b> &mdash; ce sont des surfaces presque planes, et &laquo; la dispersion est nulle sur les parties planes &raquo; par
construction (commentaire du shader). Passer la dispersion de 0,25 à 0 sur Poli ne change que 0,01 % des pixels, au plus
2 niveaux sur 255. Le grief &laquo; distortion de la couleur un peu moche &raquo; ne peut donc pas venir de la dispersion sur
ces deux matières. La couleur qui bouge vraiment, c'est le <b>matcap</b> (section 1). La dispersion, elle, ne mord qu'au bord
d'une matière à pente &mdash; d'où la ligne Cannelé, hors des deux matières demandées, ajoutée pour la montrer où elle existe.</p>
</div>

<section><h2>1. Le matcap procédural (grief : &laquo; on dirait une texture posée, je préférais avant &raquo;)</h2>
<div class="note">À regarder sur les vignettes (le voile se juge par masses) : en <b>current</b> le reflet suit la normale de la
surface &mdash; une brillance <b>structurée</b> apparaît dans les ombres et les zones denses (nettement sur le Dépoli, dans
l'immeuble sombre à droite et les basses lumières), ce qui peut lire comme une texture posée. En <b>avant</b>, le reflet est
une couleur fixe : un voile plus clair mais <b>uniforme</b> (moyenne globale plus haute, +6 environ), sans structure. Les deux
sont des voiles ; ce qui les sépare est structure contre platitude. Dispersion au défaut (0,25) dans les quatre images.</div>
<table><thead><tr><th></th><th>current (matcap, HEAD)</th><th>avant (30dfd5b^)</th><th>crop current</th><th>crop avant</th></tr></thead>
<tbody>${MAT.map(rowMatcap).join("")}</tbody></table></section>

<section><h2>2. La dispersion (grief : &laquo; distortion de la couleur un peu moche &raquo;)</h2>
<div class="note">Dispersion 0,25 (défaut) contre 0, tout le reste au défaut, version current. La <b>moyenne / écart-type global
est identique</b> à la deuxième décimale entre 0,25 et 0 sur les trois matières (Poli 64,44 ; Dépoli 64,45 ; Cannelé 64,60) :
la dispersion ne déplace <b>aucune masse</b>, elle ne vit qu'au bord. Le crop de bord silhouette/ciel montre le liseré coloré ;
le crop &laquo; bord rayons verts &raquo; est là où le contenu déjà chromatique la rend la plus lisible. La colonne de droite
donne le poids mesuré (0,25 vs 0, dans la fenêtre de crop).</div>
<table><thead><tr><th></th><th>dispersion 0,25</th><th>dispersion 0</th><th>0,25 (bord chromatique)</th><th>Δ mesuré (crop)</th></tr></thead>
<tbody>
${rowDisp("poli", "Poli", DISP_MESURE.poli)}
${rowDisp("depoli", "Dépoli", DISP_MESURE.depoli)}
${rowDisp("cannele", "Cannelé <span class=\"sub\">(hors brief, matière à pente)</span>", "stat globale identique (64,60) ; liseré visible au bord des stries", "la dispersion mord ici, pas sur Poli/Dépoli")}
</tbody></table>
<div class="note">Rappel de méthode : un effet par bord/par pixel (dispersion) se juge en crop 1:1 ; un voile par masses (matcap)
se juge sur la vignette réduite. Les deux échelles sont présentes exprès.</div>
</section>
</body></html>`;
const outFile = path.join(DIR, "planche-q2-verre.html");
writeFileSync(outFile, html, "utf8");
console.log("écrit " + outFile + " (" + (html.length / 1024).toFixed(0) + " Ko)");
