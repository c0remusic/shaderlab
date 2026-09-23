// E1 DIAGNOSTIC — le patent Y-ProPhoto, converti en sRGB puis ecrete au gamut,
// reproduit-il le canal par canal des jaunes ? Ou R et G montent-ils au-dela de
// ce que la matrice ProPhoto->sRGB + ecretage donnent ?
//
// Pour chaque teinte : sortie mesuree vs sortie predite (patent Y-ProPhoto,
// cubique d'Hermite en ProPhoto lineaire, s1 = 1 puisque ombres seules Balance
// -100), a plusieurs niveaux. On imprime aussi le bleu sRGB NON ecrete (signe)
// pour montrer l'excursion hors gamut, et l'ecart de luminance Y ProPhoto.
import { s2l, l2s, ap, SRGB_VERS_PP, PP_VERS_SRGB, PP_XYZ, pentes, hermite, charge, lisible } from "./brevet-commun.mjs";

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const niv = (lin) => 255 * l2s(clamp01(lin));
const nivBrut = (lin) => 255 * l2s(Math.max(1e-6, lin)); // sans ecretage du haut, pour lire le signe
const dot = (w, v) => w[0] * v[0] + w[1] * v[1] + w[2] * v[2];
const Ypp = (linSrgb) => dot(PP_XYZ[1], ap(SRGB_VERS_PP, linSrgb));

// Sensibilite de Y ProPhoto a chaque canal sRGB LINEAIRE : u = PP_XYZ[1] . SRGB_VERS_PP
const u = [0, 1, 2].map((c) => dot(PP_XYZ[1], [SRGB_VERS_PP[0][c], SRGB_VERS_PP[1][c], SRGB_VERS_PP[2][c]]));
console.log("Sensibilite de Y ProPhoto aux canaux sRGB lineaires u = [%s]  (somme %s)",
  u.map((x) => x.toFixed(4)).join(", "), (u[0] + u[1] + u[2]).toFixed(4));
console.log("  -> ecreter le bleu sRGB de +delta releve Y ProPhoto de u_B*delta = %s*delta", u[2].toFixed(4));
console.log("");

function patentRamp(h, S) {
  const s0 = pentes(h, S, PP_XYZ[1]); // invariance Y ProPhoto (defaut)
  return Array.from({ length: 256 }, (_, i) => {
    const x = s2l(i / 255);
    const pp = [0, 1, 2].map((c) => hermite(x, s0[c], 1));
    return ap(PP_VERS_SRGB, pp); // sRGB LINEAIRE non ecrete
  });
}

const TEINTES = [0, 40, 60, 90, 140, 220, 300];
const NIV = [16, 32, 64, 128, 192];
for (const t of TEINTES) {
  const nom = `st-h${String(t).padStart(3, "0")}`;
  const mes = charge(nom).rampe_rgb;
  const pat = patentRamp(t, 0.6);
  console.log("=== %s (S=0,6, ombres seules) ===", nom);
  const s0 = pentes(t, 0.6, PP_XYZ[1]);
  console.log("  pentes ProPhoto au noir (Y-ProPhoto) = [%s]", s0.map((x) => x.toFixed(3)).join(", "));
  for (const n of NIV) {
    const m = mes[n];
    const p = pat[n];
    const pClip = p.map(niv);
    const pBrut = p.map((v) => (v < 0 ? -nivBrut(-v) : nivBrut(v))); // niveau signe (negatif = hors gamut bas)
    const mLin = m.map((c) => s2l(c / 255));
    const xLin = s2l(n / 255);
    const dYmes = (Ypp(mLin) - xLin) / xLin; // ecart relatif de Y ProPhoto (mesure)
    const dYpat = (Ypp(p.map(clamp01)) - xLin) / xLin; // idem, patent ecrete
    console.log("  n%s  mes[%s]  patClip[%s]  bleuBrut %s  | dY/Y mes %s pat %s",
      String(n).padStart(3),
      m.map((v) => v.toFixed(1).padStart(6)).join(""),
      pClip.map((v) => v.toFixed(1).padStart(6)).join(""),
      pBrut[2].toFixed(1).padStart(7),
      (dYmes * 100).toFixed(1).padStart(6), (dYpat * 100).toFixed(1).padStart(6));
  }
  console.log("");
}
