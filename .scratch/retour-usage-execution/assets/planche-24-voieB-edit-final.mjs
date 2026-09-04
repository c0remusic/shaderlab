// Planche 24 — VOIE B "passe finale seule" (telle que le cadrage l'a PENSEE).
// Le cadrage promet que les passes internes de pyramide restent en repere
// identite et que SEULE la passe de compositing finale lit a l'UV deforme.
// L'edition simple (voieB-edit.mjs) ne fait PAS ca : composeShader enveloppe
// AUSSI chaque passe interne (effectPassRunner.ts:259 -> runEffectPass ->
// composeShader), donc l'UV est deforme partout. Ce variant gate la deformation
// sur opts.applyMask (vrai seulement pour la passe finale composee).
// DEUX remplacements ANCRES, sans backtick injecte. Restauration : git checkout.
// Usage : node planche-24-voieB-edit-final.mjs <invSX> <invSY>
import { readFileSync, writeFileSync } from "node:fs";

const invSX = process.argv[2], invSY = process.argv[3];
if (invSX === undefined || invSY === undefined) throw new Error("usage: node planche-24-voieB-edit-final.mjs <invSX> <invSY>");
const wgslFloat = (s) => {
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error("valeur non finie: " + s);
  const t = String(n);
  return t.includes(".") ? t : t + ".0";
};
const SX = wgslFloat(invSX), SY = wgslFloat(invSY);

const FILE = "C:\\dev\\shaderlab\\src\\render\\shaderCompose.ts";
let src = readFileSync(FILE, "utf8");
if (src.includes("let uvT") || src.includes("uvTDecl")) throw new Error("arbre non propre — git checkout d'abord");

// Hunk 1 : injecter deux const avant le `return`, gatees sur opts.applyMask.
// Ancre SANS saut de ligne (le fichier est en CRLF) — les fins de ligne du
// contenu injecte n'ont pas besoin de correspondre.
const A1 = "  return `";
if (!src.includes(A1)) throw new Error("ANCRE 1 introuvable");
const R1 =
  "const uvArg = opts.applyMask ? \"uvT\" : \"in.uv\";\n" +
  "  const uvTDecl = opts.applyMask ? \"  let uvT = (in.uv - vec2<f32>(0.5)) * vec2<f32>(" + SX + ", " + SY + ") + vec2<f32>(0.5);\\n\" : \"\";\n" +
  "  return `";
src = src.replace(A1, R1);

// Hunk 2 : utiliser uvArg/uvTDecl dans l'appel a fs_main (interpolations du template).
const A2 = "  let effected = fs_main(in.uv, effectInput);";
if (!src.includes(A2)) throw new Error("ANCRE 2 introuvable");
const R2 = "${uvTDecl}  let effected = fs_main(${uvArg}, effectInput);";
src = src.replace(A2, R2);

writeFileSync(FILE, src, "utf8");
console.log(`voie B passe-finale : INV(${SX}, ${SY}) gate sur applyMask — shaderCompose.ts edite`);
