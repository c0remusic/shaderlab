import { describe, it, expect } from "vitest";
import {
  wheelTickValue,
  registerControl,
  unregisterControl,
  markControlActive,
  getActiveControl,
} from "../../src/ui/activeControl";

describe("wheelTickValue", () => {
  it("molette vers le haut (deltaY négatif) augmente la valeur", () => {
    const next = wheelTickValue({ value: 50, min: 0, max: 100 }, -1);
    expect(next).toBeGreaterThan(50);
  });

  it("molette vers le bas (deltaY positif) diminue la valeur", () => {
    const next = wheelTickValue({ value: 50, min: 0, max: 100 }, 1);
    expect(next).toBeLessThan(50);
  });

  it("un cran = 1% de la plage (max-min), indépendant du step déclaré", () => {
    const next = wheelTickValue({ value: 50, min: 0, max: 100 }, -1);
    expect(next).toBeCloseTo(51, 6); // 1% de 100 = 1
  });

  it("s'adapte à la plage : 1% de 2..200 ≈ 2 par cran", () => {
    const next = wheelTickValue({ value: 30, min: 2, max: 200 }, -1);
    expect(next).toBeCloseTo(31.98, 2);
  });

  it("clampe au maximum", () => {
    const next = wheelTickValue({ value: 99.8, min: 0, max: 100 }, -1);
    expect(next).toBe(100);
  });

  it("clampe au minimum", () => {
    const next = wheelTickValue({ value: 0.5, min: 0, max: 100 }, 1);
    expect(next).toBe(0);
  });

  it("ne produit pas d'artefact flottant (arrondi propre)", () => {
    const next = wheelTickValue({ value: 0.5, min: 0, max: 1 }, -1);
    // 1% de (1-0) = 0.01 -> 0.51 exact, pas 0.51000000000000001
    expect(next.toString().length).toBeLessThanOrEqual(4);
  });

  it("un scroll plus fort (deltaY plus grand) avance proportionnellement plus vite", () => {
    const notch = wheelTickValue({ value: 50, min: 0, max: 100 }, -100); // ~1 cran physique
    const strong = wheelTickValue({ value: 50, min: 0, max: 100 }, -300); // scroll fort
    expect(strong - 50).toBeGreaterThan(notch - 50);
  });

  it("plafonne à 5% de la plage par évènement, même pour un deltaY très grand", () => {
    const next = wheelTickValue({ value: 50, min: 0, max: 100 }, -5000);
    expect(next).toBeCloseTo(55, 6); // 5% de 100 = 5, jamais plus en un seul évènement
  });

  it("un tout petit deltaY (trackpad) reste au minimum 1% (pas de micro-pas inutiles)", () => {
    const next = wheelTickValue({ value: 50, min: 0, max: 100 }, -5);
    expect(next).toBeCloseTo(51, 6);
  });
});

describe("registre du contrôle actif (register/mark/unregister)", () => {
  const handle = { value: 10, min: 0, max: 100, step: 1, onChange: () => {} };

  it("aucun contrôle actif au départ (id jamais marqué)", () => {
    expect(getActiveControl()).toBeNull();
  });

  it("markControlActive rend le handle récupérable par getActiveControl", () => {
    registerControl("ctrl-1", handle);
    markControlActive("ctrl-1");
    expect(getActiveControl()).toBe(handle);
    unregisterControl("ctrl-1");
  });

  it("unregisterControl retire le handle : Ctrl+molette après démontage ne trouve plus rien", () => {
    registerControl("ctrl-2", handle);
    markControlActive("ctrl-2");
    expect(getActiveControl()).toBe(handle);
    unregisterControl("ctrl-2"); // simule le démontage du Slider (cleanup useEffect)
    expect(getActiveControl()).toBeNull();
  });

  it("registerControl réécrit le handle d'un id déjà actif avec les valeurs fraîches (re-render)", () => {
    registerControl("ctrl-3", handle);
    markControlActive("ctrl-3");
    const updated = { ...handle, value: 42 };
    registerControl("ctrl-3", updated); // ré-enregistrement au rendu suivant
    expect(getActiveControl()).toBe(updated);
    unregisterControl("ctrl-3");
  });
});
