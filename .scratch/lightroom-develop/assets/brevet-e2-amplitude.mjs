// E2 — LA LOI D'AMPLITUDE. Parties 1 et 2.
//
// Partie 1 : a sat 60, le RAPPORT des amplitudes entre teintes (st-h*) est-il celui
//   que predit le brevet (pentes s = m + d p, invariance Y ProPhoto) ? On verifie
//   d'ABORD que le profil de deviation le long de la rampe est COMMUN aux teintes
//   (une seule forme, ajustee une fois) avant de comparer des amplitudes.
// Partie 2 : quelle loi S(sat) relie le curseur a la saturation-limite ? On extrait
//   S = (max-min)/(max+min) des pentes ajustees sur st-ombres-sat20 (sat20),
//   st-h220 (sat60), st-ombres-sat100 (sat100), toutes ombres 220 Balance -100.
//
// Copie locale de ce dont j'ai besoin depuis brevet-commun (interdit de le modifier),
// mais je REUTILISE ses exports purs.
import {
  s2l, l2s, SRGB_VERS_PP, ap, PP_XYZ, pentes, teinteHSL, motif, hermite,
  charge, lisible,
} from "./brevet-commun.mjs";

// ── Codages testes de l'espace de travail ProPhoto ────────────────────────────
const CODAGES = {
  "PP lineaire": { code: (v) => v, dcode: () => 1 },
  "PP gamma 1,8": { code: (v) => Math.sign(v) * Math.pow(Math.abs(v), 1 / 1.8), dcode: () => 1 },
  "PP TRC sRGB": { code: (v) => Math.sign(v) * l2s(Math.abs(v)), dcode: () => 1 },
};
const W = PP_XYZ[1]; // poids Y ProPhoto

// sRGB niveau 0..255 -> ProPhoto lineaire (vecteur 3 canaux)
function ppLinDeNiveauRGB(rgb255) {
  const lin = rgb255.map((v) => s2l(v / 255));
  return ap(SRGB_VERS_PP, lin);
}
// entree grise niveau i -> ProPhoto lineaire (neutre, egal sur 3 canaux)
function ppLinEntree(i) {
  const g = s2l(i / 255);
  return ap(SRGB_VERS_PP, [g, g, g]);
}

// ── Ajustement Hermite par canal, s1 fixe a 1 (ombres seules) ou s0,s1 libres ──
// out-x = (s0-1) u + (s1-1) v, u = x(1-x)^2, v = -x^2(1-x). Moindres carres.
function ajusteHermite(xs, ys, s1libre) {
  // ys, xs deja en espace code. Regression lineaire.
  let Suu = 0, Suv = 0, Svv = 0, Suy = 0, Svy = 0;
  for (let k = 0; k < xs.length; k++) {
    const x = xs[k], d = ys[k] - x;
    const u = x * (1 - x) * (1 - x), v = -x * x * (1 - x);
    Suu += u * u; Suv += u * v; Svv += v * v; Suy += u * d; Svy += v * d;
  }
  if (!s1libre) {
    const a = Suy / Suu; // s0-1
    return { s0: 1 + a, s1: 1 };
  }
  const det = Suu * Svv - Suv * Suv;
  const a = (Suy * Svv - Svy * Suv) / det; // s0-1
  const b = (Svy * Suu - Suy * Suv) / det; // s1-1
  return { s0: 1 + a, s1: 1 + b };
}

// Residu RMS en niveaux sRGB entre rampe mesuree et rampe reconstruite par Hermite.
function residuNiveaux(mesure, temoin, codage, s0v, s1v) {
  const { code } = codage;
  // reconstruit en code PP, decode en lineaire PP, -> sRGB niveau
  // pour decoder le code il faut l'inverse ; on garde le code monotone impair.
  const decode = codage === CODAGES["PP lineaire"] ? (v) => v
    : codage === CODAGES["PP gamma 1,8"] ? (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.8)
    : (v) => Math.sign(v) * s2l(Math.abs(v));
  // matrice PP lineaire -> sRGB lineaire
  const PP_VERS_SRGB = inverse3(SRGB_VERS_PP);
  let se = 0, n = 0, mx = 0;
  for (let i = 1; i < 255; i++) {
    if (!lisible(mesure[i])) continue;
    const x = code(ppLinEntree(i)[0]); // scalaire code (neutre)
    const outCode = [0, 1, 2].map((c) => hermite(x, s0v[c], s1v[c]));
    const ppLin = outCode.map(decode);
    const srgbLin = ap(PP_VERS_SRGB, ppLin);
    const rec = srgbLin.map((v) => 255 * l2s(Math.max(0, Math.min(1, v))));
    for (let c = 0; c < 3; c++) {
      const e = rec[c] - mesure[i][c];
      se += e * e; n++; if (Math.abs(e) > mx) mx = Math.abs(e);
    }
  }
  return { rms: Math.sqrt(se / n), max: mx, n };
}

function inverse3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

// ── CONTROLE de l'instrument : rampe synthetique de mecanisme connu ───────────
// Fabrique une rampe brevet pure (Hermite s0 connu, s1=1) en PP gamma 1,8, exporte
// en sRGB niveaux, et verifie que l'ajustement RETROUVE s0 et REJETTE la mauvaise
// hypothese (une loi de puissance out = x^p).
function controle() {
  const cod = CODAGES["PP gamma 1,8"];
  const s0vrai = pentes(220, 0.6, W); // ombres 220 sat-limite 0,6
  const PP_VERS_SRGB = inverse3(SRGB_VERS_PP);
  const decode = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.8);
  const rampe = [];
  for (let i = 0; i < 256; i++) {
    const x = cod.code(ppLinEntree(i)[0]);
    const outCode = [0, 1, 2].map((c) => hermite(x, s0vrai[c], 1));
    const ppLin = outCode.map(decode);
    const srgb = ap(PP_VERS_SRGB, ppLin).map((v) => 255 * l2s(Math.max(0, Math.min(1, v))));
    rampe.push(srgb);
  }
  // ajuste
  const xs = [], yy = [[], [], []];
  for (let i = 1; i < 255; i++) {
    if (!lisible(rampe[i])) continue;
    xs.push(cod.code(ppLinEntree(i)[0]));
    const ppLin = ppLinDeNiveauRGB(rampe[i]);
    for (let c = 0; c < 3; c++) yy[c].push(cod.code(ppLin[c]));
  }
  const s0est = [0, 1, 2].map((c) => ajusteHermite(xs, yy[c], false).s0);
  const errBon = Math.max(...s0est.map((s, c) => Math.abs(s - s0vrai[c])));
  // mauvaise hypothese : loi de puissance globale (pas de teinte par canal)
  // on l'eprouve en mesurant le residu d'un Hermite NEUTRE (s0=s1=1) : doit etre grand.
  const rNeutre = residuNiveaux(rampe, null, cod, [1, 1, 1], [1, 1, 1]).rms;
  const rBon = residuNiveaux(rampe, null, cod, s0est, [1, 1, 1]).rms;
  console.log("CONTROLE (rampe brevet synthetique, PP gamma 1,8, s0 connu) :");
  console.log("  s0 vrai   ", s0vrai.map((v) => v.toFixed(3)).join(" "));
  console.log("  s0 estime ", s0est.map((v) => v.toFixed(3)).join(" "), " err max", errBon.toFixed(4));
  console.log("  residu Hermite ajuste", rBon.toFixed(3), "niv  vs  neutre (mauvaise hyp)", rNeutre.toFixed(2), "niv");
  console.log("  -> l'instrument retrouve s0 et distingue la mauvaise hypothese :",
    errBon < 0.02 && rNeutre > 20 ? "OUI" : "NON");
  console.log("");
}

// ── PARTIE 1 : rapport des amplitudes entre teintes a sat 60 ──────────────────
const HUES = [
  { n: "st-h000", h: 0 }, { n: "st-h220", h: 220 }, { n: "st-h270", h: 270 },
  { n: "st-h300", h: 300 }, { n: "st-h330", h: 330 },
  { n: "st-h140", h: 140 }, { n: "st-h150", h: 150 }, { n: "st-h180", h: 180 },
  // jaunes 40-90 exclus de la preuve (h040,h060,h090)
];

function partie1() {
  const temoin = charge("temoin").rampe_rgb;
  console.log("== PARTIE 1 : amplitudes entre teintes a sat 60, Balance -100 ==\n");
  for (const codeName of Object.keys(CODAGES)) {
    const cod = CODAGES[codeName];
    console.log(`--- codage ${codeName} ---`);
    const lignes = [];
    for (const { n, h } of HUES) {
      const m = charge(n);
      if (!m) { console.log("  ABSENT", n); continue; }
      const rampe = m.rampe_rgb;
      // ajuste Hermite s0 libre, s1=1
      const xs = [], yy = [[], [], []];
      for (let i = 1; i < 255; i++) {
        if (!lisible(rampe[i])) continue;
        xs.push(cod.code(ppLinEntree(i)[0]));
        const ppLin = ppLinDeNiveauRGB(rampe[i]);
        for (let c = 0; c < 3; c++) yy[c].push(cod.code(ppLin[c]));
      }
      const s0 = [0, 1, 2].map((c) => ajusteHermite(xs, yy[c], false).s0);
      const res = residuNiveaux(rampe, temoin, cod, s0, [1, 1, 1]);
      // saturation-limite et teinte mesurees
      const M = Math.max(...s0), mm = Math.min(...s0);
      const Smes = (M - mm) / (M + mm);
      const htMes = teinteHSL(s0); // teinte des pentes = teinte de la roue (h, pas h+180 : ombres)
      // amplitude = norme de (s0-1)
      const amp = Math.hypot(...s0.map((v) => v - 1));
      // prediction brevet a S=0,6
      const sPred = pentes(h, 0.6, W);
      const ampPred = Math.hypot(...sPred.map((v) => v - 1));
      lignes.push({ n, h, s0, Smes, htMes, amp, ampPred, res });
    }
    // reference = st-h220
    const ref = lignes.find((l) => l.h === 220);
    console.log("  teinte  s0(R,G,B) mesure          Smes  teinteP  |amp|   ampPred  rapport_mes rapport_pred  residu(niv)");
    for (const l of lignes) {
      const rm = (l.amp / ref.amp).toFixed(3);
      const rp = (l.ampPred / ref.ampPred).toFixed(3);
      console.log(`  h${String(l.h).padStart(3, "0")}  ` +
        `${l.s0.map((v) => v.toFixed(3).padStart(6)).join(" ")}  ` +
        `${l.Smes.toFixed(3)}  ${l.htMes.toFixed(0).padStart(3)}    ` +
        `${l.amp.toFixed(3)}  ${l.ampPred.toFixed(3)}   ${rm.padStart(6)}     ${rp.padStart(6)}     ` +
        `${l.res.rms.toFixed(2)} (max ${l.res.max.toFixed(0)})`);
    }
    console.log("");
  }
}

// ── PARTIE 2 : loi S(sat) ─────────────────────────────────────────────────────
function partie2() {
  console.log("== PARTIE 2 : loi S(sat), ombres 220, Balance -100 ==\n");
  const scenes = [
    { n: "st-ombres-sat20", sat: 20 },
    { n: "st-h220", sat: 60 },
    { n: "st-ombres-sat100", sat: 100 },
  ];
  for (const codeName of Object.keys(CODAGES)) {
    const cod = CODAGES[codeName];
    console.log(`--- codage ${codeName} ---`);
    for (const { n, sat } of scenes) {
      const m = charge(n);
      const rampe = m.rampe_rgb;
      const xs = [], yy = [[], [], []];
      let clampes = 0, tot = 0;
      for (let i = 1; i < 255; i++) {
        tot++;
        if (!lisible(rampe[i])) { clampes++; continue; }
        xs.push(cod.code(ppLinEntree(i)[0]));
        const ppLin = ppLinDeNiveauRGB(rampe[i]);
        for (let c = 0; c < 3; c++) yy[c].push(cod.code(ppLin[c]));
      }
      const s0 = [0, 1, 2].map((c) => ajusteHermite(xs, yy[c], false).s0);
      const M = Math.max(...s0), mm = Math.min(...s0);
      const Smes = (M - mm) / (M + mm);
      console.log(`  ${n.padEnd(20)} sat=${String(sat).padStart(3)}  ` +
        `s0=(${s0.map((v) => v.toFixed(3)).join(",")})  min=${mm.toFixed(3)}  ` +
        `S_limite=${Smes.toFixed(3)}  (niv lisibles ${xs.length}/${tot}, ecretes ${clampes})`);
    }
    console.log("");
  }
  // lois candidates : S=sat/100 ; reduction 100->70 ; borne de pente
  console.log("  Lois candidates de S(sat) a confronter aux S_limite mesures :");
  console.log("   (a) S = sat/100          -> 0,20 / 0,60 / 1,00");
  console.log("   (b) reduction 100->70%   -> 0,20 / 0,60 / 0,70 (plafond de S)");
  console.log("   (c) borne de pente [.,5] -> S plafonne quand min->0 (S->1 des que m=0)");
}

controle();
partie1();
partie2();
