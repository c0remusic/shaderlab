// E3 — LES LOIS CHIFFREES : balanceMapAlpha, la convexite de la fusion, et le rejet
// du GAIN (forme A) pour la chroma.
import { s2l, l2s, oklab, charge, lisible } from "./brevet-commun.mjs";
const chroma = (rgbNiv) => { const l = oklab(rgbNiv.map((c) => s2l(c / 255))); return Math.hypot(l[1], l[2]); };

console.log("=== balanceMapAlpha : b -> croisement (mesure) -> a = (255-c)/c ===");
console.log("La divMap f(x,a)=a x/(a x+1-x) croise a x=0.5 donc au niveau 255/(1+a).");
console.log("balance   croisement   balanceMapAlpha a   1/a");
for (const [c, b] of [[229, -100], [179, -50], [128, 0], [77, 50], [25, 100]]) {
  const a = (255 - c) / c; console.log(String(b).padStart(5) + String(c).padStart(12) + a.toFixed(3).padStart(18) + (1 / a).toFixed(3).padStart(9));
}
console.log("croisement lineaire en balance : c = 127.6 - 1.02 b (R2 1.0000). a non geometrique :");
console.log("  a = (128 + 1.02 b)/(127.6 - 1.02 b) — Mobius de b, pas une exponentielle (log2 a s'ecarte aux bouts).");

console.log("");
console.log("=== Fusion (blending) : convexe, extremes INCHANGES, elargit vers les medians ===");
const FUS = [["cg-fusion-0", 0], ["cg-fusion-25", 25], ["st-duo", 50], ["cg-fusion-75", 75], ["cg-fusion-100", 100]];
const c160 = FUS.map(([nom]) => chroma(charge(nom).rampe_rgb[160]));
console.log("dose      :   0     25     50     75    100");
console.log("chroma@160: " + c160.map((v) => v.toFixed(4)).join(" "));
console.log("increments: " + c160.slice(1).map((v, i) => ((v - c160[i]) * 1e4).toFixed(1)).join("  ") + "  (x1e-4) -> croissants = convexe");
console.log("ratio/fus0: " + c160.map((v) => (v / c160[0]).toFixed(3)).join("  "));

console.log("");
console.log("=== Forme A (gain multiplicatif, cloue au NOIR seul) rejetee pour la chroma ===");
console.log("Un gain pp = x(1 + w(x) dir) a une chroma = x w(x) |dir|. Cloue au blanc -> chroma(1)=0 => w(1)=0.");
console.log("Or la chroma MESUREE tend vers 0 aux DEUX bouts (bell), donc w doit s'annuler aux deux => c'est une");
console.log("cloche (forme B/C), pas un gain. Les chroma aux extremes, par roue :");
for (const [roue, scene] of [["ombres", "st-ombres-bleu"], ["hautes", "st-hl-orange"], ["globale", "cg-glob-h040"], ["moyens", "grading-moyens-vert"]]) {
  const r = charge(scene).rampe_rgb;
  // premiers/derniers niveaux lisibles
  let lo = 3; while (lo <= 252 && !lisible(r[lo])) lo++;
  let hi = 252; while (hi >= 3 && !lisible(r[hi])) hi--;
  console.log("  " + roue.padEnd(8) + " chroma(niv " + lo + ")=" + chroma(r[lo]).toFixed(4) + "   chroma(niv " + hi + ")=" + chroma(r[hi]).toFixed(4) + "   (proche de 0 aux deux bords)");
}

console.log("");
console.log("=== Amplitude ~ saturation : proportionnelle en bas, sature en haut (confirme research/22) ===");
// rapport de chroma integree ombres 220 a sat 20 / 60 / 100
const integ = (scene) => { const r = charge(scene).rampe_rgb; let s = 0; for (let i = 3; i <= 252; i++) if (lisible(r[i])) s += chroma(r[i]); return s; };
const s20 = integ("st-ombres-sat20"), s60 = integ("st-ombres-bleu"), s100 = integ("st-ombres-sat100");
console.log("  chroma integree  sat20/sat60 = %s (prop. 0.333)   sat100/sat60 = %s (prop. 1.667 -> sature)", (s20 / s60).toFixed(3), (s100 / s60).toFixed(3));
