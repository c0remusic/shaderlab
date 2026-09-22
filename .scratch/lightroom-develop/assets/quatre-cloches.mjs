// LES QUATRE POIDS SONT-ILS QUATRE CLOCHES ? Et le resultat tient-il si on change
// les constantes qui servent a l'extraire ?
//
// CE QUI EST ACQUIS. hautes-lumieres-plafond.mjs a refute l'hypothese que la
// retombee du poids des hautes lumieres serait un ECRETAGE : la sortie mesuree
// n'atteint jamais 255 avant le niveau 255 lui-meme, et l'ecart a la diagonale
// redescend en douceur (13,01 au niveau 205, puis 11,00 · 8,34 · 4,60 · 2,47 ·
// 1,00 · 0,00). Un plafond garderait l'ecart maximal puis le raboterait.
//
// CE QUE CE SCRIPT EPROUVE. Le profil extrait des HAUTES LUMIERES culmine au
// niveau 200 puis retombe a zero au blanc : ce n'est pas une rampe montante, c'est
// une CLOCHE — la meme famille que le poids des medians, decalee. Notre modele,
// lui, les traite en miroir des ombres (`alpha^g * cov`), donc en rampe qui monte
// jusqu'au blanc. Deux controles :
//
//   1. ROBUSTESSE. L'extraction utilise les constantes (g, b) de research/18,
//      ajustees sur le BAS de la rampe des OMBRES. Si le sommet se deplace quand
//      on prend d'autres constantes, la cloche est un artefact de ce choix. On
//      refait donc l'extraction sous trois jeux, dont celui ajuste sur toute la
//      rampe, et on regarde si le sommet bouge.
//   2. FORME. Une gaussienne est ajustee sur chaque profil — centre et
//      demi-largeur, dans les memes unites que `midCenter` / `midSigma` de la
//      table, qui sont en L d'OKLab. Le residu dit si « cloche » est une
//      description ou une facon de parler.
import { readFileSync } from "node:fs";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const Lde = (lin) => Math.cbrt(Math.max(0, lin));

const RAMPES = {
  ombres: "cg-ombres-lum-p50",
  moyens: "cg-moyens-lum-p50",
  hautes: "cg-hl-lum-p50",
  global: "grading-global-lum-p50",
};
const JEUX = [
  ["research/18, bas des ombres", 1.690, 4.73e-3],
  ["ajuste sur toute la rampe", 1.405, 6.98e-3],
  ["gain seul, sans point noir", 1.500, 0.0],
];

function extraire(nom, g, b) {
  const ramp = JSON.parse(readFileSync(`${M}/${nom}.json`, "utf8")).rampe;
  const w = new Array(256).fill(null);
  for (let n = 0; n <= 255; n++) {
    const lin = s2l(n / 255);
    const denom = lin * (g - 1) + b;
    if (denom <= 1e-9) continue;
    w[n] = (s2l(ramp[n] / 255) - lin) / denom;
  }
  return w;
}
function sommet(w) {
  let m = -Infinity, ou = 0;
  for (let n = 0; n <= 255; n++) if (w[n] !== null && w[n] > m) { m = w[n]; ou = n; }
  return { valeur: m, niveau: ou };
}

console.log("CONTROLE 1 — le sommet bouge-t-il avec les constantes d'extraction ?");
console.log("");
console.log("jeu de constantes                 ombres      moyens      hautes      global");
console.log("".padEnd(80, "-"));
for (const [nomJeu, g, b] of JEUX) {
  const cells = Object.values(RAMPES).map((nom) => {
    const s = sommet(extraire(nom, g, b));
    return ("n=" + s.niveau).padStart(12);
  });
  console.log("%s%s", nomJeu.padEnd(32), cells.join(""));
}
console.log("");
console.log("  Un sommet stable sous trois jeux n'est pas un artefact du jeu choisi.");

// ── CONTROLE 2 : une gaussienne sur L, comme midCenter / midSigma ────────────
console.log("");
console.log("CONTROLE 2 — chaque profil vu comme une cloche sur L d'OKLab.");
console.log("");
console.log("roue       centre L   demi-largeur   hauteur   residu moyen   (midCenter=0,61 midSigma=0,144)");
console.log("".padEnd(96, "-"));
for (const [roue, nom] of Object.entries(RAMPES)) {
  const w = extraire(nom, 1.690, 4.73e-3);
  const pts = [];
  for (let n = 0; n <= 255; n++) if (w[n] !== null) pts.push([Lde(s2l(n / 255)), w[n]]);

  let best = null;
  for (let ic = 0; ic <= 120; ic++) {
    const c = ic / 100;
    for (let is = 2; is <= 80; is++) {
      const s = is / 200;
      for (let ih = 1; ih <= 140; ih++) {
        const h = ih / 100;
        let e = 0;
        for (const [L, v] of pts) e += Math.abs(h * Math.exp(-((L - c) ** 2) / (2 * s * s)) - v);
        e /= pts.length;
        if (!best || e < best[3]) best = [c, s, h, e];
      }
    }
  }
  console.log("%s %s %s %s %s",
    roue.padEnd(10),
    best[0].toFixed(3).padStart(9),
    best[1].toFixed(3).padStart(14),
    best[2].toFixed(3).padStart(9),
    best[3].toFixed(4).padStart(14));
}
console.log("");
console.log("  Un residu tres inferieur a la hauteur dit que « cloche » decrit le profil.");
console.log("  ⚠️ Les OMBRES ajustent une DEMI-cloche — leur poids est maximal tout en bas —");
console.log("  donc leur centre est le moins contraint des quatre. Etendue sous les trois");
console.log("  jeux de constantes : voir cloches-robustesse.mjs, qui borne chaque parametre.");
