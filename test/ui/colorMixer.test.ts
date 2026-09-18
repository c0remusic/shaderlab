import { describe, expect, it } from "vitest";
import { hsl } from "../../src/render/effects/hslDevelop";
import { HSL_BANDES } from "../../src/render/effects/hslBandes";
import { groupEffectParams } from "../../src/components/ParamPanel";
import { NOM_DE_BANDE, rendreMixer } from "../../src/ui/colorMixer";

/**
 * LE MÉLANGEUR EN DEUX VUES (ticket 07, item 5).
 *
 * ⚠️ CES TESTS PASSENT PAR `groupEffectParams`, JAMAIS PAR LES SECTIONS SEULES.
 * `rendreMixer` ne fait que DEMANDER un regroupement ; ce qui compte est ce qui
 * est RENDU, et les deux peuvent diverger pour deux raisons que ce fichier
 * existe pour attraper :
 *
 *  1. `section.params` ASSIGNE un paramètre à un bloc, il ne l'ORDONNE pas —
 *     l'ordre dans un bloc reste celui de `params[]` (CLAUDE.md, corollaire
 *     (a)). Les vues tombent juste parce que `hslDevelop.ts` déclare les huit
 *     Teinte, puis les huit Saturation, puis les huit Luminance. Si cet ordre de
 *     déclaration changeait, les vues se réordonneraient en silence.
 *  2. `EffectParam.appliesWhen` garde le dernier mot : demander une section
 *     n'oblige aucun paramètre à s'afficher.
 */

const valeursParDefaut = (): Record<string, number> => {
  const v: Record<string, number> = {};
  for (const p of hsl.params) v[p.name] = p.default;
  return v;
};

const blocs = (
  opts: Parameters<typeof rendreMixer>[0],
  values: Record<string, number> = valeursParDefaut(),
) => {
  const { sections, labels, hidden } = rendreMixer(opts);
  const rendus = groupEffectParams(hsl.params, hsl.canvasControls, new Set(hidden), { sections, values });
  return { rendus, labels: labels ?? new Map() };
};

/** Les noms de paramètres d'un bloc, dans l'ordre RENDU. */
const noms = (bloc: { items: { kind: string }[] }): string[] =>
  bloc.items.filter((i) => i.kind === "single").map((i) => (i as { param: { name: string } }).param.name);

/** Le bloc qui porte un paramètre donné, quel que soit son titre. */
const blocDe = (rendus: { label: string | null; items: { kind: string }[] }[], nom: string) =>
  rendus.find((b) => noms(b).includes(nom));

describe("mélangeur — vue COULEUR (une bande, ses trois curseurs)", () => {
  it("rend Teinte, Saturation, Luminance de la bande choisie, dans cet ordre", () => {
    const { rendus, labels } = blocs({ vue: "couleur", canal: "tout", bande: "red", noirEtBlanc: false });
    const bande = blocDe(rendus, "redHue");
    expect(bande).toBeDefined();
    // L'ORDRE est le point : il vient de `params[]`, pas de notre liste.
    expect(noms(bande!)).toEqual(["redHue", "redSat", "redLum"]);
    expect(labels.get("redHue")).toBe("Teinte");
    expect(labels.get("redSat")).toBe("Saturation");
    expect(labels.get("redLum")).toBe("Luminance");
  });

  it("change de bande sans changer de forme", () => {
    for (const b of HSL_BANDES) {
      const { rendus } = blocs({ vue: "couleur", canal: "tout", bande: b.id, noirEtBlanc: false });
      expect(noms(blocDe(rendus, `${b.id}Hue`)!)).toEqual([`${b.id}Hue`, `${b.id}Sat`, `${b.id}Lum`]);
    }
  });

  it("ne rend QUE la bande choisie — les vingt et un autres curseurs sont absents", () => {
    const { rendus } = blocs({ vue: "couleur", canal: "tout", bande: "green", noirEtBlanc: false });
    const tous = rendus.flatMap(noms);
    const couleurs = tous.filter((n) => /Hue$|Sat$|Lum$/.test(n));
    expect(couleurs).toEqual(["greenHue", "greenSat", "greenLum"]);
  });
});

describe("mélangeur — vue MÉLANGE (un canal, ses huit bandes)", () => {
  it.each([
    ["hue", "Hue", "Teinte"],
    ["sat", "Sat", "Saturation"],
    ["lum", "Lum", "Luminance"],
  ] as const)("le canal %s rend les huit bandes, de Rouge à Magenta", (canal, suffixe) => {
    const { rendus, labels } = blocs({ vue: "melange", canal, bande: "red", noirEtBlanc: false });
    const bloc = blocDe(rendus, `red${suffixe}`);
    expect(bloc).toBeDefined();
    expect(noms(bloc!)).toEqual(HSL_BANDES.map((b) => `${b.id}${suffixe}`));
    // Le libellé COURT remplace le fragment grammatical du module : sous un bloc
    // « Teinte », « Variation de la teinte rouge » répéterait son propre titre.
    expect(labels.get(`red${suffixe}`)).toBe("Rouge");
    expect(labels.get(`aqua${suffixe}`)).toBe("Turquoise");
  });

  it("« Tout » rend les trois canaux, dans l'ordre de Lightroom", () => {
    const { rendus } = blocs({ vue: "melange", canal: "tout", bande: "red", noirEtBlanc: false });
    const titres = rendus.map((b) => b.label).filter(Boolean);
    expect(titres).toEqual(["Teinte", "Saturation", "Luminance"]);
  });

  it("« Tout » rend EXACTEMENT les vingt-quatre curseurs de couleur", () => {
    const { rendus } = blocs({ vue: "melange", canal: "tout", bande: "red", noirEtBlanc: false });
    const rendu = rendus.flatMap(noms).filter((n) => /Hue$|Sat$|Lum$/.test(n));
    const attendus = ["Hue", "Sat", "Lum"].flatMap((s) => HSL_BANDES.map((b) => `${b.id}${s}`));
    expect(rendu).toEqual(attendus);
  });
});

describe("mélangeur — Noir et blanc", () => {
  const nb = { ...valeursParDefaut(), mode: 1 };

  it("rend les huit curseurs de mélange, et aucun curseur de couleur", () => {
    const { rendus, labels } = blocs({ vue: "couleur", canal: "tout", bande: "red", noirEtBlanc: true }, nb);
    const bloc = rendus.find((b) => b.label === "Mélange noir et blanc");
    expect(noms(bloc!)).toEqual(HSL_BANDES.map((b) => `${b.id}Gray`));
    expect(rendus.flatMap(noms).some((n) => /Hue$|Sat$|Lum$/.test(n))).toBe(false);
    expect(labels.get("redGray")).toBe("Rouge");
  });

  it("la VUE demandée n'y change rien — il n'y a plus deux vues à choisir", () => {
    const a = blocs({ vue: "couleur", canal: "tout", bande: "red", noirEtBlanc: true }, nb);
    const b = blocs({ vue: "melange", canal: "hue", bande: "blue", noirEtBlanc: true }, nb);
    expect(a.rendus.flatMap(noms)).toEqual(b.rendus.flatMap(noms));
  });
});

describe("un bloc seul ne répète pas son sélecteur", () => {
  // ADR-0001, et le précédent est daté : les trois sections d'encre de `duotone`
  // ont été retirées le 2026-08-05 parce qu'elles répétaient le libellé de leur
  // propre pastille. Une pastille « Rouge » suivie d'un en-tête « Rouge » est le
  // même défaut. Le doublon n'est d'ailleurs pas que visuel — deux boutons de
  // même nom accessible, ce que le test de story a refusé avant l'œil.
  it("la vue Couleur ne titre pas le bloc de la bande", () => {
    const { rendus } = blocs({ vue: "couleur", canal: "tout", bande: "red", noirEtBlanc: false });
    expect(rendus.map((b) => b.label).filter(Boolean)).toEqual([]);
  });

  it("un canal SEUL n'est pas titré, les trois de « Tout » le sont", () => {
    const seul = blocs({ vue: "melange", canal: "sat", bande: "red", noirEtBlanc: false });
    expect(seul.rendus.map((b) => b.label).filter(Boolean)).toEqual([]);
    const tout = blocs({ vue: "melange", canal: "tout", bande: "red", noirEtBlanc: false });
    expect(tout.rendus.map((b) => b.label).filter(Boolean)).toHaveLength(3);
  });

  it("le Noir et blanc GARDE son titre — aucun sélecteur ne le nomme", () => {
    const { rendus } = blocs(
      { vue: "couleur", canal: "tout", bande: "red", noirEtBlanc: true },
      { ...valeursParDefaut(), mode: 1 },
    );
    expect(rendus.map((b) => b.label).filter(Boolean)).toEqual(["Mélange noir et blanc"]);
  });
});

describe("aucun curseur perdu par le regroupement", () => {
  // LE TEST DISCRIMINANT. Un regroupement qui LAISSE TOMBER un paramètre rend un
  // panneau parfaitement crédible : il manque une ligne, et rien ne rougit. On
  // vérifie donc que l'UNION des vues couvre les trente-deux curseurs du module,
  // chacun exactement une fois dans la vue qui le porte.
  it("les huit vues Couleur couvrent les vingt-quatre curseurs, sans doublon", () => {
    const vus = HSL_BANDES.flatMap((b) =>
      blocs({ vue: "couleur", canal: "tout", bande: b.id, noirEtBlanc: false }).rendus.flatMap(noms),
    ).filter((n) => /Hue$|Sat$|Lum$/.test(n));
    expect(new Set(vus).size).toBe(24);
    expect(vus).toHaveLength(24);
  });

  it("« Tout » et les huit vues Couleur montrent le MÊME ensemble", () => {
    const parBande = new Set(
      HSL_BANDES.flatMap((b) =>
        blocs({ vue: "couleur", canal: "tout", bande: b.id, noirEtBlanc: false }).rendus.flatMap(noms),
      ).filter((n) => /Hue$|Sat$|Lum$/.test(n)),
    );
    const parCanal = new Set(
      blocs({ vue: "melange", canal: "tout", bande: "red", noirEtBlanc: false }).rendus.flatMap(noms)
        .filter((n) => /Hue$|Sat$|Lum$/.test(n)),
    );
    expect([...parBande].sort()).toEqual([...parCanal].sort());
  });

  it("les huit curseurs de mélange N&B ne manquent à personne", () => {
    const gris = blocs({ vue: "couleur", canal: "tout", bande: "red", noirEtBlanc: true }, { ...valeursParDefaut(), mode: 1 })
      .rendus.flatMap(noms).filter((n) => n.endsWith("Gray"));
    expect(gris).toHaveLength(8);
    // 24 curseurs de couleur + 8 de mélange = les 32 du module, `mode` en plus.
    expect(hsl.params).toHaveLength(33);
  });
});
