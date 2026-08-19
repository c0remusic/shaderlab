import { describe, expect, it } from "vitest";
import { DocumentSession } from "../../src/application/documentSession";
import { LayerStack } from "../../src/layers/layerStack";

/**
 * LE VERROU TENAIT DANS LE MODÈLE ET PAS DANS LES DOIGTS.
 *
 * `LayerStack` refuse quatorze opérations sur un calque verrouillé, chacune
 * derrière `isLocked`, et un test les couvre une par une. Le verrou était
 * pourtant contournable **en le manipulant simplement à l'écran** : glisser une
 * poignée déplaçait la forme, tirer un curseur changeait ses paramètres.
 *
 * ⚠️ LA RAISON EST STRUCTURELLE, ET ELLE NE SE VOIT PAS EN LISANT `LayerStack`.
 * Aucun geste vivant ne passe par ses mutateurs. Pendant un glissement,
 * `App.tsx` construit le tableau de calques à la main et appelle
 * `replaceLiveLayers` — délibérément, et pour une raison mesurée : `clone()`
 * fabrique un objet frais pour CHAQUE calque, ce qui re-rend la liste entière à
 * chaque frame (34,2 ms de CPU par `pointermove` mesurés le 2026-07-30).
 *
 * Cette porte est donc la SEULE que les quatorze gardes ne couvrent pas, et
 * c'est celle par laquelle passe tout ce qu'un utilisateur fait à la souris. Le
 * verrou doit s'y poser aussi, sinon il ne protège que ce que personne ne fait.
 *
 * Le commit n'y changeait rien : `handleParamCommit` commite `currentStack()`,
 * c'est-à-dire l'état VIVANT déjà modifié. Le garde de `commit` ne pouvait pas
 * rattraper une mutation qui avait eu lieu avant lui.
 */

const documentVerrouille = () => {
  const stack = new LayerStack();
  const photo = stack.addPhotoLayer("src-1", { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0 }, "photo");
  const effet = stack.addLayer("aplat", photo);
  stack.updateParams(effet, { centreX: 0.5, largeur: 0.4 });
  stack.setLayerLock(effet, "all", true);
  stack.setLayerLock(photo, "all", true);
  return { session: new DocumentSession(stack), photo, effet };
};

describe("verrou — le chemin vivant", () => {
  it("refuse une modification de paramètre poussée en direct", () => {
    const { session, effet } = documentVerrouille();
    const avant = session.layers().find((l) => l.id === effet)!.params.largeur;
    session.replaceLiveLayers(
      session.layers().map((l) => (l.id === effet ? { ...l, params: { ...l.params, largeur: 0.9 } } : l)),
    );
    expect(session.layers().find((l) => l.id === effet)!.params.largeur).toBe(avant);
  });

  it("refuse un déplacement poussé en direct", () => {
    const { session, photo } = documentVerrouille();
    session.replaceLiveLayers(
      session.layers().map((l) => (l.id === photo ? { ...l, transform: { x: 900, y: 900, scaleX: 3, scaleY: 3, rotation: 1 } } : l)),
    );
    expect(session.layers().find((l) => l.id === photo)!.transform).toEqual({
      x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0,
    });
  });

  it("laisse passer les calques NON verrouillés du même envoi", () => {
    // Le tableau vivant porte TOUS les calques à chaque frame. Refuser l'envoi
    // entier parce qu'un calque est verrouillé figerait le document dès qu'un
    // seul calque l'est — le verrou deviendrait hostile, ce que son propre
    // en-tête refuse pour la visibilité.
    const stack = new LayerStack();
    const a = stack.addLayer("glow");
    const b = stack.addLayer("grain");
    stack.setLayerLock(a, "all", true);
    const session = new DocumentSession(stack);
    session.replaceLiveLayers(
      session.layers().map((l) => ({ ...l, params: { ...l.params, intensity: 0.42 } })),
    );
    expect(session.layers().find((l) => l.id === a)!.params.intensity).toBeUndefined();
    expect(session.layers().find((l) => l.id === b)!.params.intensity).toBe(0.42);
  });

  it("laisse le DÉVERROUILLAGE passer, sinon le verrou serait irréversible", () => {
    const { session, effet } = documentVerrouille();
    session.replaceLiveLayers(session.layers().map((l) => (l.id === effet ? { ...l, locks: {} } : l)));
    expect(session.layers().find((l) => l.id === effet)!.locks?.all ?? false).toBe(false);
  });

  it("laisse la VISIBILITÉ passer — masquer n'est pas modifier", () => {
    // Même arbitrage que dans `LayerStack` : `toggleLayer` est autorisé sur un
    // calque verrouillé, c'est un confort de lecture de la pile.
    const { session, effet } = documentVerrouille();
    session.replaceLiveLayers(session.layers().map((l) => (l.id === effet ? { ...l, enabled: false } : l)));
    expect(session.layers().find((l) => l.id === effet)!.enabled).toBe(false);
  });

  it("laisse un calque ARRIVER et PARTIR : le verrou porte sur le contenu, pas sur la pile", () => {
    const { session, effet } = documentVerrouille();
    const sans = session.layers().filter((l) => l.id !== effet);
    session.replaceLiveLayers(sans);
    expect(session.layers().some((l) => l.id === effet)).toBe(false);
  });
});
