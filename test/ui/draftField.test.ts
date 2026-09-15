import { describe, expect, it } from "vitest";
import { draftKeyAction, draftOutcome } from "../../src/ui/draftField";

/**
 * Le protocole du champ à brouillon, éprouvé sans navigateur.
 *
 * Ce que ces cas verrouillent, et que rien ne verrouillait : `Échap` ABANDONNE.
 * Il était écrit dans `NumberField` et absent de `LabeledSlider`, dont le champ
 * de valeur est pourtant celui de chaque curseur de paramètre d'effet — donc le
 * contrôle le plus utilisé de l'application commitait la saisie malgré `Échap`,
 * avec une entrée d'historique. Un commit de trop ne change aucun pixel, et les
 * seize stories du curseur ne tapent jamais dans son champ : il n'existait
 * aucun moyen de s'en apercevoir.
 */

/** Lecture standard d'un champ borné : refuse ce qui ne se lit pas. */
const lit = (brut: string): number | null => {
  const n = Number(brut);
  return Number.isFinite(n) ? n : null;
};

describe("draftKeyAction", () => {
  it("fait d'Entrée un commit et d'Échap un abandon", () => {
    expect(draftKeyAction("Enter")).toBe("commit");
    expect(draftKeyAction("Escape")).toBe("abandon");
  });

  it("laisse passer toute autre frappe", () => {
    for (const touche of ["a", "1", "Backspace", "ArrowUp", "Tab", "."]) {
      expect(draftKeyAction(touche)).toBeNull();
    }
  });
});

describe("draftOutcome", () => {
  it("ABANDONNE sans même lire le brouillon", () => {
    // La lecture ne doit pas avoir lieu : un abandon ne juge pas la saisie.
    const jamais = () => {
      throw new Error("le brouillon ne doit pas être lu sur un abandon");
    };
    expect(draftOutcome("999", 10, true, jamais)).toEqual({ kind: "abandon" });
  });

  it("commite une valeur lisible et différente", () => {
    expect(draftOutcome("42", 10, false, lit)).toEqual({ kind: "commit", value: 42 });
  });

  it("distingue « lu, égal » de « illisible » — les deux restaurent, pas pour la même raison", () => {
    expect(draftOutcome("10", 10, false, lit)).toEqual({ kind: "unchanged", value: 10 });
    expect(draftOutcome("abc", 10, false, lit)).toEqual({ kind: "invalid" });
  });

  it("rend la valeur LUE et non le texte : un champ affiche, le modèle porte un nombre", () => {
    // « 1.50 » et « 1.5 » sont la même valeur ; c'est ce qui permet au champ de
    // renormaliser son affichage sans commiter.
    const issue = draftOutcome("1.50", 1.5, false, lit);
    expect(issue).toEqual({ kind: "unchanged", value: 1.5 });
  });

  it("l'abandon prime sur tout le reste, y compris une saisie parfaitement valide", () => {
    expect(draftOutcome("42", 10, true, lit)).toEqual({ kind: "abandon" });
  });
});
