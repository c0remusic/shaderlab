// Jetable. Mesure la COUVERTURE des sections et de l'applicabilite sur les
// modules REELS (le grep ment : les params de `curves` sortent d'un flatMap).
import { effectRegistry } from "../../../src/render/effects/registry";

type Row = {
  id: string;
  params: number;
  citesParSection: number;
  orphelins: number;
  sections: number;
  appliesWhen: number;
  sansCategorie: boolean;
};

const rows: Row[] = [];

for (const eff of effectRegistry as any[]) {
  const params: any[] = eff.params ?? [];
  const sections: any[] = eff.sections ?? [];

  // noms cites par une section, quel que soit le gabarit
  const cites = new Set<string>();
  const walk = (s: any) => {
    for (const k of ["items", "params", "rows", "cells", "children"]) {
      const v = s?.[k];
      if (Array.isArray(v)) {
        for (const it of v) {
          if (typeof it === "string") cites.add(it);
          else if (it && typeof it === "object") {
            if (typeof it.name === "string") cites.add(it.name);
            if (typeof it.param === "string") cites.add(it.param);
            walk(it);
          }
        }
      }
    }
  };
  for (const s of sections) walk(s);

  const noms = params.map((p) => p.name);
  const orphelins = noms.filter((n) => !cites.has(n));

  rows.push({
    id: eff.id,
    params: params.length,
    citesParSection: noms.length - orphelins.length,
    orphelins: orphelins.length,
    sections: sections.length,
    appliesWhen: params.filter((p) => p.appliesWhen).length,
    sansCategorie: sections.length === 0,
  });
}

rows.sort((a, b) => b.params - a.params);

const tot = (k: keyof Row) => rows.reduce((s, r) => s + (r[k] as number), 0);

console.log("id                params  cites  ORPHELINS  sections  appliesWhen");
for (const r of rows) {
  console.log(
    r.id.padEnd(17) +
      String(r.params).padStart(6) +
      String(r.citesParSection).padStart(7) +
      String(r.orphelins).padStart(11) +
      String(r.sections).padStart(10) +
      String(r.appliesWhen).padStart(13) +
      (r.sansCategorie ? "   << AUCUNE SECTION" : ""),
  );
}
console.log("");
console.log("effets              : " + rows.length);
console.log("parametres TOTAUX   : " + tot("params"));
console.log("cites par une section: " + tot("citesParSection"));
console.log("ORPHELINS           : " + tot("orphelins") + "  (" + Math.round((100 * tot("orphelins")) / tot("params")) + " %)");
console.log("appliesWhen         : " + tot("appliesWhen") + "  (" + Math.round((100 * tot("appliesWhen")) / tot("params")) + " % des params)");
console.log("effets SANS section : " + rows.filter((r) => r.sansCategorie).length);

const eff = effectRegistry as any[];

console.log("=== OUTILS SUR LA TOILE (CanvasControl) ===");
let avec = 0;
const kinds: Record<string, number> = {};
for (const e of eff) {
  const cc: any[] = e.canvasControls ?? e.canvasControl ?? [];
  const arr = Array.isArray(cc) ? cc : [cc];
  const real = arr.filter(Boolean);
  if (real.length) {
    avec++;
    console.log(
      "  " + e.id.padEnd(16) + real.length + " controle(s) : " +
        real.map((c: any) => c.kind ?? "?").join(", ") +
        "   (params: " + (e.params?.length ?? 0) + ")",
    );
    for (const c of real) kinds[c.kind ?? "?"] = (kinds[c.kind ?? "?"] || 0) + 1;
  }
}
console.log("  --> " + avec + " effets sur " + eff.length + " ont un outil sur la toile");
console.log("  --> par genre : " + JSON.stringify(kinds));

console.log("");
console.log("=== EFFETS SANS AUCUNE CONDITION D'APPLICABILITE ===");
const sansCond = eff.filter((e) => (e.params ?? []).every((p: any) => !p.appliesWhen));
console.log("  " + sansCond.length + " sur " + eff.length + " :");
for (const e of sansCond.sort((a, b) => (b.params?.length ?? 0) - (a.params?.length ?? 0))) {
  console.log("    " + e.id.padEnd(16) + (e.params?.length ?? 0) + " params");
}

console.log("");
console.log("=== DENSITE : params par section ===");
const dens = eff
  .map((e) => ({
    id: e.id,
    p: e.params?.length ?? 0,
    s: e.sections?.length ?? 0,
    r: (e.params?.length ?? 0) / Math.max(1, e.sections?.length ?? 0),
  }))
  .sort((a, b) => b.r - a.r);
for (const d of dens.slice(0, 10)) {
  console.log("  " + d.id.padEnd(16) + d.p + " params / " + d.s + " sections = " + d.r.toFixed(1) + " par section");
}

console.log("");
console.log("=== GABARITS DE SECTION UTILISES ===");
const lay: Record<string, number> = {};
for (const e of eff) for (const s of e.sections ?? []) lay[s.layout ?? "(sans layout)"] = (lay[s.layout ?? "(sans layout)"] || 0) + 1;
console.log("  " + JSON.stringify(lay));
