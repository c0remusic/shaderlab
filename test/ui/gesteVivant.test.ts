import { describe, expect, it } from "vitest";
import { gesteEtageVivant, gestePileVivante, type PortsGesteVivant } from "../../src/ui/gesteVivant";
import type { LayerState } from "../../src/layers/types";
import type { DevelopSettings } from "../../src/layers/developSettings";

/**
 * La SÉQUENCE d'un geste vivant, éprouvée sans monter React.
 *
 * Ce qu'aucun test ne pouvait voir avant : un `requestRender` manquant. Il ne
 * change aucun pixel COMPARABLE — il n'y a pas de frame à comparer, seulement
 * une frame absente — et les sondes du dépôt mesurent un proxy : `frameSignature`
 * re-rend la pile lui-même, donc il voit la mutation du modèle et ne peut rien
 * dire du canvas. Le défaut a été livré le 2026-08-21 (aperçu de mode de fusion
 * au survol) et relevé par Antoine devant l'app.
 *
 * Quatorze sites récitaient la séquence à la main. Ces cas la tiennent une fois.
 */

/** Journal d'appels : c'est l'ORDRE autant que la présence qui compte. */
function portsEspions(pile: LayerState[] = []) {
  const journal: string[] = [];
  const ports: PortsGesteVivant = {
    poserPile: (layers, geometrie) => journal.push(`poserPile(${layers.length}${geometrie ? ",geom" : ""})`),
    poserEtage: () => journal.push("poserEtage"),
    pileComplete: () => pile,
    planifierSynchro: () => journal.push("planifierSynchro"),
    projeterEtage: () => journal.push("projeterEtage"),
    renduEtage: () => journal.push("renduEtage"),
    redemanderRendu: (layers) => journal.push(`redemanderRendu(${layers.length})`),
    salir: () => journal.push("salir"),
  };
  return { ports, journal };
}

const couches = [{ id: "a" }, { id: "b" }] as unknown as LayerState[];

describe("gestePileVivante", () => {
  it("pose l'état, synchronise et REDEMANDE UN RENDU — les trois, dans cet ordre", () => {
    const { ports, journal } = portsEspions();
    gestePileVivante(ports, couches);
    expect(journal).toEqual(["poserPile(2)", "planifierSynchro", "redemanderRendu(2)"]);
  });

  it("rend sur la pile QU'ON LUI PASSE, pas sur celle de la session", () => {
    // La session n'a pas encore vu le nouvel état au moment où le rendu part sur
    // le chemin brut ; rendre `pileComplete()` retarderait l'écran d'une frame.
    const { ports, journal } = portsEspions([] as LayerState[]);
    gestePileVivante(ports, couches);
    expect(journal).toContain("redemanderRendu(2)");
  });

  it("ne salit RIEN par défaut : un geste qui ne change pas de valeur ne doit pas commiter", () => {
    const { ports, journal } = portsEspions();
    gestePileVivante(ports, couches);
    expect(journal).not.toContain("salir");
  });

  it("salit AVANT de poser, quand l'appelant dit que quelque chose a bougé", () => {
    const { ports, journal } = portsEspions();
    gestePileVivante(ports, couches, { salit: true });
    expect(journal[0]).toBe("salir");
  });

  it("transmet la carte de géométrie, qui gèle les params d'un calque verrouillé en position", () => {
    const { ports, journal } = portsEspions();
    gestePileVivante(ports, couches, { geometrie: new Map([["a", ["x"]]]) });
    expect(journal[0]).toBe("poserPile(2,geom)");
  });

  it("REPEINT TOUJOURS, même quand la projection React se tait", () => {
    // C'est la règle qui ne se négocie pas : `synchroniseReact: false` est une
    // exception déclarée (l'aperçu au survol), et elle ne touche jamais au rendu.
    const { ports, journal } = portsEspions();
    gestePileVivante(ports, couches, { synchroniseReact: false });
    expect(journal).toEqual(["poserPile(2)", "redemanderRendu(2)"]);
  });
});

describe("gesteEtageVivant", () => {
  const reglages: DevelopSettings = { reglagesDeBase: { exposition: 0.4 } };

  it("pose l'étage, le projette, le donne au renderer, puis redemande un rendu", () => {
    const { ports, journal } = portsEspions(couches);
    gesteEtageVivant(ports, reglages);
    expect(journal).toEqual(["poserEtage", "projeterEtage", "renduEtage", "redemanderRendu(2)"]);
  });

  it("rend sur la pile COMPLÈTE de la session — l'étage s'applique au composite", () => {
    const { ports, journal } = portsEspions(couches);
    gesteEtageVivant(ports, reglages);
    expect(journal.at(-1)).toBe("redemanderRendu(2)");
  });

  it("ne planifie PAS la synchronisation générale — l'étage a son propre état React", () => {
    const { ports, journal } = portsEspions(couches);
    gesteEtageVivant(ports, reglages);
    expect(journal).not.toContain("planifierSynchro");
  });

  it("pose l'étage sur le renderer AVANT de redemander le rendu", () => {
    // L'inverse rendrait une frame avec l'étage précédent.
    const { ports, journal } = portsEspions(couches);
    gesteEtageVivant(ports, reglages);
    expect(journal.indexOf("renduEtage")).toBeLessThan(journal.findIndex((e) => e.startsWith("redemanderRendu")));
  });
});
