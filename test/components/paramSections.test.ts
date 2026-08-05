import { describe, it, expect } from "vitest";
import { groupEffectParams } from "../../src/components/ParamPanel";
import type { CanvasControl, EffectParam, EffectSection } from "../../src/render/effects/types";

/**
 * CE QUE `ParamPanel` FAIT DU CONTRAT — `EffectParam.appliesWhen`,
 * `EffectModule.sections`, `SectionLayout`.
 *
 * Ces trois champs sont validés au chargement du registre (`validateEffect`),
 * mais la validation ne dit que « la déclaration est cohérente ». Ce qui se
 * teste ici est l'autre moitié : ce qui est réellement MASQUÉ, ce qui est
 * DÉPLACÉ, et ce qui ne l'est surtout pas.
 *
 * ⚠️ Aucun de ces défauts n'a de signature ailleurs. Un paramètre masqué à tort
 * ne bouge aucun pixel — `npm run test:render` reste vert — et un bloc atomique
 * coupé en deux compile parfaitement. Sur des effets SYNTHÉTIQUES et non sur le
 * registre : aucun effet ne déclare encore de section, et une garde adossée au
 * registre ne dirait rien tant que la première n'est pas écrite.
 */

function param(name: string, extra: Partial<EffectParam> = {}): EffectParam {
  return { name, label: name, min: 0, max: 1, default: 0.5, step: 0.01, ...extra };
}

/** Un paramètre à `choices` — le seul type que `DisplayCondition` peut viser. */
function mode(name: string, choices: string[], defaut = 0): EffectParam {
  return { name, label: name, min: 0, max: choices.length - 1, default: defaut, step: 1, choices };
}

function couleur(name: string, key: string, role: "hue" | "saturation" | "lightness", extra: Partial<EffectParam> = {}): EffectParam {
  return { ...param(name, extra), colorGroup: { key, role, label: `Couleur ${key}` } };
}

function nomsRendus(blocs: ReturnType<typeof groupEffectParams>): string[] {
  return blocs.flatMap((bloc) => bloc.items.flatMap((item) => (item.kind === "single" ? [item.param.name] : [])));
}

describe("blocs de rendu du panneau de paramètres", () => {
  it("sans section : un unique bloc libre, dans l'ordre de params[]", () => {
    const params = [param("a"), param("b"), param("c")];
    const blocs = groupEffectParams(params);
    expect(blocs).toHaveLength(1);
    expect(blocs[0].label).toBeNull();
    expect(blocs[0].layout).toBe("liste");
    expect(nomsRendus(blocs)).toEqual(["a", "b", "c"]);
  });

  describe("appliesWhen — le paramètre", () => {
    const params = [mode("type", ["Radial", "Latérale"]), param("angle", { appliesWhen: { param: "type", equals: 1 } })];

    it("masque le paramètre hors de son mode", () => {
      expect(nomsRendus(groupEffectParams(params, [], new Set(), { values: { type: 0 } }))).toEqual(["type"]);
    });

    it("le rend dans son mode", () => {
      expect(nomsRendus(groupEffectParams(params, [], new Set(), { values: { type: 1 } }))).toEqual(["type", "angle"]);
    });

    it("accepte une liste d'index", () => {
      const trois = [mode("type", ["A", "B", "C"]), param("x", { appliesWhen: { param: "type", equals: [0, 2] } })];
      expect(nomsRendus(groupEffectParams(trois, [], new Set(), { values: { type: 1 } }))).toEqual(["type"]);
      expect(nomsRendus(groupEffectParams(trois, [], new Set(), { values: { type: 2 } }))).toEqual(["type", "x"]);
    });

    it("sans valeurs fournies, lit les DÉFAUTS déclarés et non un jeu vide", () => {
      // Le piège que ce test ferme : si l'absence de `values` faisait évaluer
      // les conditions contre `{}`, elles seraient TOUTES fausses et le panneau
      // se viderait — un appelant qui ne passe rien décrit la configuration par
      // défaut de l'effet, pas une configuration sans valeurs.
      const surDefaut = [mode("type", ["Radial", "Latérale"], 1), param("angle", { appliesWhen: { param: "type", equals: 1 } })];
      expect(nomsRendus(groupEffectParams(surDefaut))).toEqual(["type", "angle"]);
    });
  });

  describe("sections", () => {
    const params = [param("a"), param("b"), param("c"), param("d")];
    const sections: EffectSection[] = [
      { id: "s1", label: "Première", params: ["a", "c"], layout: "grille" },
    ];

    it("déplace un bloc ENTIER et garde l'ordre de params[] à l'intérieur", () => {
      const blocs = groupEffectParams(params, [], new Set(), { sections });
      expect(blocs.map((bloc) => bloc.label)).toEqual(["Première", null]);
      expect(blocs[0].layout).toBe("grille");
      expect(blocs[0].items.map((item) => item.reactKey)).toEqual(["param:a", "param:c"]);
      expect(blocs[1].items.map((item) => item.reactKey)).toEqual(["param:b", "param:d"]);
    });

    it("un paramètre qu'aucune section ne cite reste À SA PLACE", () => {
      // `b` précède `c` dans params[] ; il ne doit pas être renvoyé derrière la
      // section, ni aspiré dans le bloc libre qui suit.
      const blocs = groupEffectParams(
        [param("a"), param("b"), param("c")], [], new Set(),
        { sections: [{ id: "s", label: "S", params: ["a", "c"], layout: "liste" }] },
      );
      expect(blocs.map((bloc) => bloc.items.map((item) => item.reactKey))).toEqual([["param:a", "param:c"], ["param:b"]]);
    });

    it("masque la section dont la condition est fausse", () => {
      const avecMode = [mode("type", ["A", "B"]), param("x"), param("y")];
      const conditionnelle: EffectSection[] = [
        { id: "s", label: "S", params: ["x", "y"], layout: "liste", appliesWhen: { param: "type", equals: 1 } },
      ];
      expect(nomsRendus(groupEffectParams(avecMode, [], new Set(), { sections: conditionnelle, values: { type: 0 } }))).toEqual(["type"]);
      expect(nomsRendus(groupEffectParams(avecMode, [], new Set(), { sections: conditionnelle, values: { type: 1 } }))).toEqual(["type", "x", "y"]);
    });

    it("masque la section dont TOUS les paramètres sont masqués, en-tête compris", () => {
      // L'arbitrage du plan (2026-08-05) : ADR-0001 prime sur la stabilité
      // visuelle — une carte qui garderait ses en-têtes vides reprendrait la
      // hauteur que le chantier cherche à rendre.
      const avecMode = [mode("type", ["A", "B"]), param("x", { appliesWhen: { param: "type", equals: 1 } })];
      const blocs = groupEffectParams(avecMode, [], new Set(), {
        sections: [{ id: "s", label: "S", params: ["x"], layout: "liste" }],
        values: { type: 0 },
      });
      expect(blocs.map((bloc) => bloc.label)).toEqual([null]);
      expect(nomsRendus(blocs)).toEqual(["type"]);
    });

    it("garde la section partiellement masquée, avec ses survivants", () => {
      const avecMode = [mode("type", ["A", "B"]), param("x", { appliesWhen: { param: "type", equals: 1 } }), param("y")];
      const blocs = groupEffectParams(avecMode, [], new Set(), {
        sections: [{ id: "s", label: "S", params: ["x", "y"], layout: "liste" }],
        values: { type: 0 },
      });
      expect(blocs.map((bloc) => bloc.label)).toEqual([null, "S"]);
      expect(nomsRendus(blocs)).toEqual(["type", "y"]);
    });
  });

  describe("blocs atomiques — une section ne les traverse pas", () => {
    it("refuse un contrôle de toile coupé entre deux sections", () => {
      const params = [param("cx", { unit: "percent" }), param("cy", { unit: "percent" }), param("r")];
      const controls: CanvasControl[] = [{ id: "centre", kind: "disk", x: "cx", y: "cy", radius: "r", label: "Centre" }];
      expect(() => groupEffectParams(params, controls, new Set(), {
        sections: [{ id: "s", label: "S", params: ["cx", "cy"], layout: "liste" }],
      })).toThrow(/Contrôle de toile "centre"/);
    });

    it("refuse un groupe de couleur coupé entre deux sections", () => {
      const params = [couleur("h", "encre", "hue"), couleur("s", "encre", "saturation"), couleur("l", "encre", "lightness")];
      expect(() => groupEffectParams(params, [], new Set(), {
        sections: [{ id: "s", label: "S", params: ["h"], layout: "liste" }],
      })).toThrow(/Groupe de couleur "encre"/);
    });

    it("accepte un bloc atomique déplacé EN ENTIER", () => {
      const params = [param("autre"), param("cx", { unit: "percent" }), param("cy", { unit: "percent" })];
      const controls: CanvasControl[] = [{ id: "centre", kind: "point", x: "cx", y: "cy", label: "Centre" }];
      const blocs = groupEffectParams(params, controls, new Set(), {
        sections: [{ id: "s", label: "Position", params: ["cx", "cy"], layout: "pose" }],
      });
      expect(blocs.map((bloc) => bloc.items.map((item) => item.reactKey))).toEqual([
        ["param:autre"],
        ["spatial:centre", "param:cx", "param:cy"],
      ]);
    });
  });

  describe("cas de bord du masquage", () => {
    it("un groupe de couleur ne part que si ses TROIS rôles sont sans objet", () => {
      // `ColorGroupControl` a besoin de ses trois rôles : un masquage partiel
      // n'est pas exprimable, il ne se devine donc pas.
      const base = (condition: EffectParam["appliesWhen"]) => [
        mode("type", ["A", "B"]),
        couleur("h", "encre", "hue", { appliesWhen: { param: "type", equals: 1 } }),
        couleur("s", "encre", "saturation", { appliesWhen: condition }),
        couleur("l", "encre", "lightness", { appliesWhen: { param: "type", equals: 1 } }),
      ];
      const cles = (params: EffectParam[]) =>
        groupEffectParams(params, [], new Set(), { values: { type: 0 } }).flatMap((bloc) => bloc.items.map((item) => item.reactKey));

      expect(cles(base({ param: "type", equals: 1 }))).toEqual(["param:type"]);
      expect(cles(base(undefined))).toEqual(["param:type", "groupe:encre"]);
    });

    it("retire l'en-tête spatial quand tous les paramètres de son contrôle sont masqués", () => {
      // Un titre « sur la toile » au-dessus de rien annoncerait un réglage qui
      // n'est plus là.
      const params = [
        mode("type", ["A", "B"]),
        param("cx", { unit: "percent", appliesWhen: { param: "type", equals: 1 } }),
        param("cy", { unit: "percent", appliesWhen: { param: "type", equals: 1 } }),
      ];
      const controls: CanvasControl[] = [{ id: "centre", kind: "point", x: "cx", y: "cy", label: "Centre" }];
      const cles = (type: number) =>
        groupEffectParams(params, controls, new Set(), { values: { type } }).flatMap((bloc) => bloc.items.map((item) => item.reactKey));
      expect(cles(0)).toEqual(["param:type"]);
      expect(cles(1)).toEqual(["param:type", "spatial:centre", "param:cx", "param:cy"]);
    });

    it("`visibleWhen` du contrôle masque l'en-tête sans masquer ses curseurs", () => {
      // Comportement ANTÉRIEUR au chantier, conservé tel quel : `visibleWhen`
      // dit que le manipulateur n'est pas sur la toile, pas que le réglage n'a
      // plus d'objet — c'est `appliesWhen` qui dit ça.
      const params = [mode("type", ["A", "B"]), param("cx", { unit: "percent" }), param("cy", { unit: "percent" })];
      const controls: CanvasControl[] = [
        { id: "centre", kind: "point", x: "cx", y: "cy", label: "Centre", visibleWhen: { param: "type", equals: 1 } },
      ];
      const cles = groupEffectParams(params, controls, new Set(), { values: { type: 0 } })
        .flatMap((bloc) => bloc.items.map((item) => item.reactKey));
      expect(cles).toEqual(["param:type", "param:cx", "param:cy"]);
    });
  });
});
