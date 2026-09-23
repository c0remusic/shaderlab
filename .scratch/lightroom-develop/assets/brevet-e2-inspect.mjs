// E2 — inspection: structure des mesures et reglages des scenes.
import { readFileSync } from "node:fs";
import { MESURES } from "./brevet-commun.mjs";
import path from "node:path";

const noms = ["temoin", "temoin3", "temoin4", "st-h220", "st-h000", "st-h300",
  "st-ombres-bleu", "st-ombres-sat20", "st-ombres-sat100",
  "st-h060", "st-h090", "st-h140", "st-h180", "st-h270", "st-h330", "st-h150"];

for (const n of noms) {
  const d = JSON.parse(readFileSync(path.join(MESURES, `${n}.json`), "utf8"));
  console.log("===", n, "=== keys:", Object.keys(d).join(","));
  if (d.reglages) console.log("  reglages:", JSON.stringify(d.reglages));
  if (d.settings) console.log("  settings:", JSON.stringify(d.settings));
  if (d.rampe_rgb) {
    const ex = [0, 8, 16, 32, 64, 128, 200, 255].map((i) => {
      const v = d.rampe_rgb[i];
      return `${i}:[${v.map((x) => x.toFixed(1)).join(",")}]`;
    });
    console.log("  rampe_rgb len", d.rampe_rgb.length, ex.join(" "));
  }
}
