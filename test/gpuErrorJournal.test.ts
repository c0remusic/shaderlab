import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { logGpuError, readGpuErrorJournal } from "../src/launch";

/**
 * LE JOURNAL D'ERREURS GPU, ET POURQUOI IL MÉRITE DES TESTS À LUI.
 *
 * C'est le SEUL canal qui survive à un rechargement : `console.error` part avec
 * la page et `logDiagnostic` ne s'écrit qu'en build de développement. Quand une
 * erreur WebGPU récupérable précède un crash, ce journal est ce qui reste pour
 * l'expliquer — et il n'était éprouvé par rien.
 *
 * Ce qui est éprouvé ici : la BORNE de l'anneau (l'écriture part d'un gestionnaire
 * qui peut tirer par frame, et `localStorage` a un quota dur), la tenue face à une
 * entrée corrompue (le journal existe pour expliquer un crash, donc il ne doit pas
 * en causer un), et le fait qu'aucun de ces chemins ne remonte d'exception dans
 * l'appelant — qui est, lui, un chemin chaud.
 *
 * Le faux `localStorage` est posé sur `globalThis` : le projet `unit` tourne en
 * environnement Node, où il n'existe pas. C'est aussi ce que le code gère
 * explicitement, et le dernier test l'éprouve tel quel.
 */

interface FauxStockage {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
}

const poserStockage = (stockage: FauxStockage | undefined): void => {
  if (stockage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
  else (globalThis as { localStorage?: unknown }).localStorage = stockage;
};

const stockageMemoire = (): FauxStockage & { valeurs: Map<string, string> } => {
  const valeurs = new Map<string, string>();
  return {
    valeurs,
    getItem: (cle) => valeurs.get(cle) ?? null,
    setItem: (cle, valeur) => { valeurs.set(cle, valeur); },
  };
};

const CLE = "shaderlab.gpu-errors";

describe("journal d'erreurs GPU", () => {
  beforeEach(() => {
    // `logGpuError` écrit aussi sur la console : on la fait taire pour que la
    // sortie des tests reste lisible, sans masquer ce qu'on mesure (le contenu
    // du journal, pas la console).
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    poserStockage(undefined);
    vi.restoreAllMocks();
  });

  it("écrit puis relit une erreur, horodatée", () => {
    poserStockage(stockageMemoire());
    const avant = Date.now();
    logGpuError("device lost: allocation failed");
    const entrees = readGpuErrorJournal();
    expect(entrees).toHaveLength(1);
    expect(entrees[0].message).toBe("device lost: allocation failed");
    expect(entrees[0].at).toBeGreaterThanOrEqual(avant);
  });

  it("l'anneau est borné à 50 entrées, et ce sont les PLUS RÉCENTES qui restent", () => {
    poserStockage(stockageMemoire());
    for (let i = 0; i < 60; i++) logGpuError(`erreur ${i}`);
    const entrees = readGpuErrorJournal();
    // La borne existe parce que l'écriture part d'un gestionnaire qui peut tirer
    // à chaque frame : sans elle, le quota de `localStorage` finit par refuser
    // l'écriture, et c'est la DERNIÈRE erreur — celle qui précède le crash —
    // qu'on perdrait.
    expect(entrees).toHaveLength(50);
    expect(entrees[0].message).toBe("erreur 10");
    expect(entrees[49].message).toBe("erreur 59");
  });

  it("une entrée corrompue rend un journal vide au lieu de jeter", () => {
    const stockage = stockageMemoire();
    stockage.valeurs.set(CLE, "{ceci n'est pas du JSON");
    poserStockage(stockage);
    expect(readGpuErrorJournal()).toEqual([]);
  });

  it("les entrées mal formées sont écartées, les bonnes gardées", () => {
    const stockage = stockageMemoire();
    stockage.valeurs.set(CLE, JSON.stringify([
      { at: 1, message: "bonne" },
      { at: "hier", message: "at pas un nombre" },
      { message: "sans at" },
      null,
      42,
      { at: 2, message: "bonne aussi" },
    ]));
    poserStockage(stockage);
    expect(readGpuErrorJournal().map((e) => e.message)).toEqual(["bonne", "bonne aussi"]);
  });

  it("un JSON valide qui n'est pas un tableau rend un journal vide", () => {
    const stockage = stockageMemoire();
    stockage.valeurs.set(CLE, JSON.stringify({ at: 1, message: "objet nu" }));
    poserStockage(stockage);
    expect(readGpuErrorJournal()).toEqual([]);
  });

  it("un stockage qui REFUSE l'écriture ne fait pas remonter d'exception", () => {
    // Quota dépassé, ou stockage désactivé. La ligne de console est déjà partie :
    // seule la persistance est perdue, et l'appelant est un chemin chaud.
    poserStockage({
      getItem: () => null,
      setItem: () => { throw new Error("QuotaExceededError"); },
    });
    expect(() => logGpuError("erreur pendant un quota plein")).not.toThrow();
  });

  it("un stockage qui refuse la LECTURE rend un journal vide sans jeter", () => {
    poserStockage({
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => {},
    });
    expect(readGpuErrorJournal()).toEqual([]);
  });

  it("sans stockage du tout (Node), la lecture rend [] et l'écriture ne jette pas", () => {
    poserStockage(undefined);
    expect(readGpuErrorJournal()).toEqual([]);
    expect(() => logGpuError("aucun stockage ici")).not.toThrow();
  });
});
