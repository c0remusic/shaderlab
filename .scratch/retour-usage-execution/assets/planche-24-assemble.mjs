// Assemble la planche 24 en un HTML autonome (images en dataURL).
// Lit les PNG planche24-*.png et les stats planche24-stats-*.json produits par
// planche-24-render.mjs / planche-24-voieA.mjs. Ecrit planche-24-transform.html.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const b = (f) => {
  const p = path.join(DIR, f);
  return existsSync(p) ? "data:image/png;base64," + readFileSync(p).toString("base64") : null;
};
const j = (f) => {
  const p = path.join(DIR, f);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
};

const sT = j("planche24-stats-temoin.json") || {};
const sA = j("planche24-stats-A.json") || {};
const sB = {
  identite: j("planche24-stats-B-identite.json") || {},
  scaleX2: j("planche24-stats-B-scaleX2.json") || {},
  scaleY04: j("planche24-stats-B-scaleY04.json") || {},
};
const sB2 = {
  identite: j("planche24-stats-B2-identite.json") || {},
  scaleX2: j("planche24-stats-B2-scaleX2.json") || {},
  scaleY04: j("planche24-stats-B2-scaleY04.json") || {},
};

const ETATS = ["identite", "scaleX2", "scaleY04"];
const ETAT_LABEL = { identite: "Identite (1, 1)", scaleX2: "scaleX 2", scaleY04: "scaleY 0.4" };

const legende = (st) => st ? `moyenne ${st.moyenne} &middot; ecart-type ${st.ecartType}` : "&mdash;";

// Une cellule image + legende. crop optionnel dessous.
const cell = (img, st, crop) => {
  if (!img) return `<td class="vide">&mdash;</td>`;
  let h = `<td><img src="${img}"><div class="leg">${legende(st)}</div>`;
  if (crop) h += `<div class="croplbl">crop 1:1 sur le raccord</div><img class="crop" src="${crop}">`;
  return h + `</td>`;
};

// Bloc d'un effet : lignes = voies, colonnes = etats.
const blocEffet = (nom, titre, avecCrop, avecB2) => {
  const cropSuffixe = avecCrop ? "-crop" : "";
  let rows = "";

  // Ligne Temoin (identite seule, moteur propre).
  rows += `<tr><th>Temoin (moteur propre)</th>`;
  rows += cell(b(`planche24-temoin-${nom}.png`), sT[nom], avecCrop ? b(`planche24-temoin-${nom}-crop.png`) : null);
  rows += `<td class="vide">&mdash;</td><td class="vide">&mdash;</td></tr>`;

  // Voie A.
  rows += `<tr><th>Voie A &mdash; deformer la SORTIE</th>`;
  for (const e of ETATS) {
    rows += cell(b(`planche24-A-${e}-${nom}.png`), (sA[nom] || {})[e], avecCrop ? b(`planche24-A-${e}-${nom}-crop.png`) : null);
  }
  rows += `</tr>`;

  // Voie B (edition du brief : deforme TOUTES les passes).
  rows += `<tr><th>Voie B &mdash; deformer le CHAMP<br><span class="sub">(edition du brief, toutes passes)</span></th>`;
  for (const e of ETATS) {
    rows += cell(b(`planche24-B-${e}-${nom}.png`), (sB[e] || {})[nom], avecCrop ? b(`planche24-B-${e}-${nom}-crop.png`) : null);
  }
  rows += `</tr>`;

  // Voie B passe finale seule (variant fidele au cadrage) — glow seulement.
  if (avecB2) {
    rows += `<tr><th>Voie B &mdash; passe finale seule<br><span class="sub">(variant gate sur applyMask)</span></th>`;
    for (const e of ETATS) {
      rows += cell(b(`planche24-B2-${e}-${nom}.png`), (sB2[e] || {})[nom], avecCrop ? b(`planche24-B2-${e}-${nom}-crop.png`) : null);
    }
    rows += `</tr>`;
  }

  return `<section><h2>${titre}</h2>
  <table><thead><tr><th></th><th>${ETAT_LABEL.identite}</th><th>${ETAT_LABEL.scaleX2}</th><th>${ETAT_LABEL.scaleY04}</th></tr></thead>
  <tbody>${rows}</tbody></table></section>`;
};

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Planche 24 &mdash; transform d'un effet place</title>
<style>
  body { font-family: system-ui, sans-serif; background:#14161a; color:#e8eaed; margin:0; padding:24px; }
  h1 { font-size:20px; } h2 { font-size:16px; border-bottom:1px solid #333; padding-bottom:6px; margin-top:34px; }
  .intro { max-width:1100px; line-height:1.5; font-size:13px; color:#c8ccd2; }
  .intro b { color:#fff; } .intro .warn { color:#ffcf6b; }
  table { border-collapse:collapse; margin-top:12px; }
  th { font-size:12px; font-weight:600; text-align:left; padding:6px 10px; color:#aeb3ba; vertical-align:top; }
  thead th { text-align:center; color:#e8eaed; }
  td { padding:8px; text-align:center; vertical-align:top; border:1px solid #23262c; }
  td.vide { color:#4a4f57; }
  img { display:block; width:300px; height:auto; image-rendering:auto; background:#000; }
  img.crop { width:512px; margin-top:4px; image-rendering:pixelated; outline:1px solid #3a3f47; }
  .croplbl { max-width:512px; }
  .leg { font-size:11px; color:#9aa0a8; margin-top:3px; }
  .croplbl { font-size:10px; color:#7b818a; margin-top:6px; }
  .sub { font-weight:400; color:#8a9099; font-size:11px; }
  .note { max-width:1100px; font-size:12px; color:#c8ccd2; line-height:1.5; margin:10px 0 0; padding:10px 12px; background:#1b1e24; border-left:3px solid #3a4250; }
  .note.warn { border-left-color:#ffcf6b; }
</style></head><body>
<h1>Planche 24 &mdash; deux voies de transform d'un effet place</h1>
<div class="intro">
<p>Prototype JETABLE (aucun commit moteur ; shaderCompose.ts restaure par git checkout). Trois effets, trois etats
(identite, scaleX 2, scaleY 0.4), ancre = centre de toile. Chaque vignette porte moyenne / ecart-type de luminance
(ecart-type &gt; 1 = capture non-aplat).</p>
<p><b>Voie A</b> &mdash; deformer la SORTIE : on rasterise le composite (effet + fond) puis on l'etire. La ou le quad
transforme ne couvre plus le cadre, on affiche le composite SANS effet.
<b>Voie B</b> &mdash; deformer le CHAMP : on transforme l'UV d'entree de fs_main, le fond reste echantillonne a l'UV identite.</p>
<p class="warn"><b>Constat sur piece (ecart au cadrage).</b> Le cadrage promettait qu'en voie B &laquo; les passes internes de pyramide
restent en repere identite, seule la passe finale lit a l'UV deforme &raquo;. C'est FAUX pour l'edition telle que le brief la
specifie : <b>composeShader enveloppe CHAQUE passe</b> (effectPassRunner.ts:259 rappelle runEffectPass avec pass.wgsl, qui
rappelle composeShader:356). L'edition simple deforme donc TOUS les niveaux de pyramide &mdash; sur glow le bloom
S'EFFONDRE (les deux etats non-identite sont byte-identiques, halo disparu). Le variant &laquo; passe finale seule &raquo;
(gate sur opts.applyMask) reproduit le comportement que le cadrage decrivait &mdash; c'est ce qu'un implementeur ecrirait
reellement, et la comparaison decisionnelle honnete pour glow.</p>
</div>

${blocEffet("lightLeak", "1. lightLeak sur photo reelle &mdash; classe CHAMP PUR (&laquo; aplatir le light leak &raquo;)", false, false)}
<div class="note">Voie B : la photo reste INTACTE, seul le champ du leak se deforme &mdash; scaleY 0.4 aplatit le leak, exactement la demande.
Aucun dedoublement. Voie A : le composite entier est etire, donc a scaleY 0.4 la PHOTO est dupliquee a deux echelles
(pleine en haut/bas, compressee dans la bande) avec couture franche &mdash; le fond bouge avec l'effet, c'est le dedoublement structurel.</div>

${blocEffet("texture", "2. texture (scan de bibliotheque) &mdash; champ pur a image de bibliotheque", false, false)}
<div class="note">Voie B : la trame s'etire PROPREMENT (scaleX 2 elargit les cellules ; scaleY 0.4 les aplatit), la texture couvrant
le cadre il n'y a pas de dedoublement visible. Voie A : la trame est confinee a la bande couverte et la photo pleine
taille reapparait autour &mdash; meme dedoublement que lightLeak.</div>

${blocEffet("glow", "3. glow sur mireBokeh &mdash; PIRE CAS lecteur d'image (multi-passe pyramidal)", true, true)}
<div class="note warn">Voie B (edition du brief, toutes passes) : le bloom S'EFFONDRE &mdash; a scaleX 2 comme a scaleY 0.4 les halos
disparaissent et les deux images sont byte-identiques (0.34 / 8.00), parce que les 9 passes de pyramide sont, elles aussi,
deformees et l'energie sort du cadre. Voie B passe finale seule : le halo est PRESERVE mais etire/decale &mdash; il se detache
des points de base (le &laquo; fantome &raquo; predit ; le halo emporte une copie deplacee de l'image). Voie A : le composite
squeeze les points+halos dans la bande tandis que les points pleine taille restent visibles hors bande &mdash; dedoublement.
Le crop 1:1 sur le raccord montre le detail au pixel.</div>

<div class="note">Verifications de gate : voie B identite (INV 1,1) est byte-identique au temoin sur les trois effets (chemin identite
inchange au bit pres, y compris le variant passe-finale) ; voie A identite reconstruit le temoin au chiffre pres.</div>
</body></html>`;

const outFile = path.join(DIR, "planche-24-transform.html");
writeFileSync(outFile, html, "utf8");
console.log("ecrit " + outFile + " (" + (html.length / 1024).toFixed(0) + " Ko de HTML, images incluses)");
