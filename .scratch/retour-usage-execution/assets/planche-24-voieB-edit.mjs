// Planche 24 — VOIE B : edition TEMPORAIRE et ANCREE de shaderCompose.ts.
// Enveloppe l'appel a fs_main de la passe finale composee pour lire le CHAMP a
// un UV deforme (INV_SX/INV_SY = inverses des facteurs de scale, ecrits en dur).
// effectInput reste echantillonne a in.uv (le fond ne bouge pas).
// Remplacement ANCRE (str.replace(a,b,1) precede d'un assert a in s) — jamais un
// splice par indices (piege paye, CLAUDE.md). Restauration : git checkout.
// Usage : node planche-24-voieB-edit.mjs <invSX> <invSY>
import { readFileSync, writeFileSync } from "node:fs";

const invSX = process.argv[2], invSY = process.argv[3];
if (invSX === undefined || invSY === undefined) throw new Error("usage: node planche-24-voieB-edit.mjs <invSX> <invSY>");
const wgslFloat = (s) => {
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error("valeur non finie: " + s);
  const t = String(n);
  return t.includes(".") ? t : t + ".0";
};
const SX = wgslFloat(invSX), SY = wgslFloat(invSY);

const FILE = "C:\\dev\\shaderlab\\src\\render\\shaderCompose.ts";
const ANCRE = "  let effected = fs_main(in.uv, effectInput);";
const REMPLACE =
  "  let uvT = (in.uv - vec2<f32>(0.5)) * vec2<f32>(" + SX + ", " + SY + ") + vec2<f32>(0.5);\n" +
  "  let effected = fs_main(uvT, effectInput);";

const src = readFileSync(FILE, "utf8");
if (!src.includes(ANCRE)) throw new Error("ANCRE introuvable — refus d'editer (premisse fausse)");
if (src.includes("let uvT =")) throw new Error("uvT deja present — l'arbre n'est pas propre, faire git checkout d'abord");
const out = src.replace(ANCRE, REMPLACE);
if (out === src) throw new Error("remplacement inerte");
writeFileSync(FILE, out, "utf8");
console.log(`voie B : champ deforme par INV(${SX}, ${SY}) — shaderCompose.ts edite`);
