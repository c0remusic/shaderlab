import { describe, it, expect } from "vitest";
import {
  cloneDevelopSettings,
  DEVELOP_ENABLED_KEY,
  isDevelopModuleEnabled,
  setDevelopModuleEnabled,
  type DevelopSettings,
} from "../../src/layers/developSettings";

describe("activation des modules de l'étage (l'œil, ticket 07)", () => {
  it("un module absent de la clé d'activation est ACTIF (défaut)", () => {
    expect(isDevelopModuleEnabled({}, "reglagesDeBase")).toBe(true);
    expect(isDevelopModuleEnabled({ reglagesDeBase: { vibrance: 40 } }, "reglagesDeBase")).toBe(true);
  });

  it("désactiver pose la clé réservée à 0 et se lit inactif", () => {
    const next = setDevelopModuleEnabled({ reglagesDeBase: { vibrance: 40 } }, "reglagesDeBase", false);
    expect(isDevelopModuleEnabled(next, "reglagesDeBase")).toBe(false);
    expect(next[DEVELOP_ENABLED_KEY]).toEqual({ reglagesDeBase: 0 });
    // Les valeurs du module sont CONSERVÉES (l'œil ne les efface pas).
    expect(next.reglagesDeBase).toEqual({ vibrance: 40 });
  });

  it("réactiver RETIRE la clé — l'état revient byte-identique au cas sans clé", () => {
    const off = setDevelopModuleEnabled({ hsl: { mode: 1 } }, "hsl", false);
    const on = setDevelopModuleEnabled(off, "hsl", true);
    expect(DEVELOP_ENABLED_KEY in on).toBe(false);
    expect(on).toEqual({ hsl: { mode: 1 } });
  });

  it("ne mute pas l'entrée (copie fraîche)", () => {
    const base: DevelopSettings = { reglagesDeBase: { vibrance: 40 } };
    const next = setDevelopModuleEnabled(base, "reglagesDeBase", false);
    expect(next).not.toBe(base);
    expect(DEVELOP_ENABLED_KEY in base).toBe(false);
  });

  it("cloneDevelopSettings copie EN PROFONDEUR la clé d'activation", () => {
    const src = setDevelopModuleEnabled({ hsl: { mode: 1 } }, "hsl", false);
    const copy = cloneDevelopSettings(src);
    expect(copy).toEqual(src);
    expect(copy[DEVELOP_ENABLED_KEY]).not.toBe(src[DEVELOP_ENABLED_KEY]);
  });
});
