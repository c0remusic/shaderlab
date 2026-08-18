import { describe, expect, it } from "vitest";
import {
  optionsInitiales,
  optionsDe,
  reglerOption,
  paramsPourNouveauCalque,
  type ToolOptions,
} from "../../src/ui/toolOptionsModel";
import type { ToolId } from "../../src/ui/tools";

/**
 * LA BARRE D'OPTIONS RÈGLE L'OUTIL — arbitré par Antoine le 2026-08-18
 * (ticket 27). « Le prochain rectangle sera bleu. »
 *
 * C'est la réponse de Photoshop, et elle résout le défaut d'origine : aujourd'hui
 * on trace un rectangle NOIR, puis on va chercher sa couleur dans le dock. Régler
 * avant de tracer est impossible.
 *
 * ⚠️ ELLE A UN COÛT, NOMMÉ DANS LE TICKET ET NON RÉSOLU PAR CE MODÈLE : deux
 * surfaces pour une même valeur — la barre règle le PROCHAIN tracé, le dock règle
 * le calque DÉJÀ POSÉ. C'est ce qu'ADR-0001 refuse. Ce que le modèle peut faire,
 * et fait, c'est rendre la frontière INEXPRIMABLE autrement : il ne connaît aucun
 * calque, et son seul canal vers un calque est `paramsPourNouveauCalque`. Un
 * réglage de barre ne PEUT pas atteindre un calque existant, par construction.
 */

describe("options d'outil — ce que la barre retient", () => {
  it("retient un réglage pour l'outil qui l'a reçu, et pour lui seul", () => {
    const apres = reglerOption(optionsInitiales(), "shape", "teinte", 210);
    expect(optionsDe(apres, "shape").teinte).toBe(210);
    expect(optionsDe(apres, "brush").teinte).toBeUndefined();
  });

  // C'EST CE QUI FAIT « LE PROCHAIN RECTANGLE SERA BLEU ». Sans persistance à
  // travers un changement d'outil, le réglage ne survit pas au premier
  // aller-retour vers le pinceau : la barre redeviendrait un doublon du dock
  // placé plus près de la main, c'est-à-dire l'autre réponse du ticket.
  it("survit à un aller-retour par un autre outil", () => {
    let o = reglerOption(optionsInitiales(), "shape", "teinte", 210);
    o = reglerOption(o, "brush", "rayon", 42);
    expect(optionsDe(o, "shape").teinte).toBe(210);
    expect(optionsDe(o, "brush").rayon).toBe(42);
  });

  it("ne mute jamais son entrée", () => {
    const avant = reglerOption(optionsInitiales(), "shape", "teinte", 210);
    reglerOption(avant, "shape", "teinte", 20);
    expect(optionsDe(avant, "shape").teinte).toBe(210);
  });
});

describe("options d'outil — le seul canal vers un calque", () => {
  // LE TEST DISCRIMINANT ENTRE LES DEUX RÉPONSES DU TICKET. Si la valeur
  // appartenait au CALQUE, éditer le calque posé changerait ce que le prochain
  // tracé reçoit. Ici le calque part avec une COPIE : il vit sa vie dans le dock,
  // et l'outil garde la sienne.
  it("un calque créé part avec une copie : l'éditer ne déplace pas les réglages de l'outil", () => {
    const o = reglerOption(optionsInitiales(), "shape", "teinte", 210);

    const premier = paramsPourNouveauCalque(o, "shape");
    premier.teinte = 20; // l'utilisateur retouche ce calque-là dans le dock

    const second = paramsPourNouveauCalque(o, "shape");
    expect(second.teinte).toBe(210);
    expect(optionsDe(o, "shape").teinte).toBe(210);
  });

  it("deux calques créés ne partagent aucun objet", () => {
    const o = reglerOption(optionsInitiales(), "shape", "teinte", 210);
    expect(paramsPourNouveauCalque(o, "shape")).not.toBe(paramsPourNouveauCalque(o, "shape"));
  });

  // Le modèle ne PEUT pas atteindre un calque existant : sa signature ne reçoit
  // ni pile, ni sélection, ni identifiant. Ce test le dit en TypeScript plutôt
  // qu'en prose — il ne compilerait pas si la signature s'élargissait.
  it("n'accepte que l'état de la barre et un outil", () => {
    const appel: (o: ToolOptions, t: ToolId) => Record<string, number> = paramsPourNouveauCalque;
    expect(appel(optionsInitiales(), "shape")).toEqual({});
  });
});
