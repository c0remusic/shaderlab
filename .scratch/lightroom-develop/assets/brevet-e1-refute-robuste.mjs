// E1 REFUTATION (3) — le recit du jaune repose sur des pentes fittees [1,405 ; 1,395
// ; 0,029]. Combien de points lisibles nourrissent ce fit, et le jaune brille-t-il
// AUSSI aux niveaux ou LES TROIS CANAUX sont lisibles (sans fit, dY/Y brut) ? Si oui,
// l'eclaircissement du jaune ne peut pas etre un artefact du fit ni du clip du bleu.
import { s2l, ap, SRGB_VERS_PP, PP_XYZ, charge, lisible } from "./brevet-commun.mjs";
const dot = (w, v) => w[0] * v[0] + w[1] * v[1] + w[2] * v[2];
const Ypp = (lin) => dot(PP_XYZ[1], ap(SRGB_VERS_PP, lin));

// combien de points 4..96 lisibles ET canal dans (0.6,254) pour le fit de CE canal
function comptePts(rampe, canal, nmax = 96) {
  let n = 0;
  for (let i = 4; i <= nmax; i++) { if (!lisible(rampe[i])) continue; if (rampe[i][canal] < 0.6 || rampe[i][canal] > 254) continue; n++; }
  return n;
}

console.log("Points lisibles nourrissant le fit de pente (4..96), par canal, par teinte");
console.log("teinte".padEnd(8) + "R".padStart(4) + "G".padStart(4) + "B".padStart(4));
for (const t of [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330]) {
  const r = charge(`st-h${String(t).padStart(3, "0")}`).rampe_rgb;
  console.log(("h" + String(t).padStart(3, "0")).padEnd(8) + [0, 1, 2].map((c) => String(comptePts(r, c)).padStart(4)).join(""));
}

console.log("\nJAUNE h060 SANS FIT : dY/Y brut A CHAQUE NIVEAU, avec lisibilite des 3 canaux");
console.log("(seuls les niveaux lisibles=oui echappent au clip du bleu ; s'ils brillent, c'est reel)");
const r = charge("st-h060").rampe_rgb;
for (let n = 8; n <= 248; n += 8) {
  const x = s2l(n / 255);
  const y = Ypp(r[n].map((c) => s2l(c / 255)));
  const dyy = (y / x - 1) * 100;
  const flag = lisible(r[n]) ? "OUI" : "non";
  if (n % 24 === 8 || lisible(r[n])) console.log("  n" + String(n).padStart(3) + "  rgb[" + r[n].map((v) => v.toFixed(0).padStart(4)).join("") + "]  dY/Y " + dyy.toFixed(1).padStart(6) + "%  lisible=" + flag);
}

console.log("\nCONTROLE — meme mesure sur une scene NEUTRE (temoin) : dY/Y doit rester ~0");
const t = charge("st-h220").rampe_rgb; // bleu : w.s mesure 1.000, doit donner dY/Y~0 aux niveaux lisibles
let s = 0, m = 0;
for (let n = 40; n <= 200; n += 8) { if (!lisible(t[n])) continue; const x = s2l(n / 255); s += (Ypp(t[n].map((c) => s2l(c / 255))) / x - 1) * 100; m++; }
console.log("  h220 (bleu) dY/Y moyen sur niveaux lisibles = " + (s / m).toFixed(2) + "%  (attendu ~0 : bleu conserve Y)");
