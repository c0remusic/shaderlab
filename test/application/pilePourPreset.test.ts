import { describe, expect, it } from "vitest";
import { DocumentSession } from "../../src/application/documentSession";
import { LayerStack } from "../../src/layers/layerStack";
import { capture as capturePreset, apply as applyPreset } from "../../src/presets/presetDocument";

/**
 * Appliquer un preset remplace la pile ENTIÈRE, et `LayerStack` porte TROIS
 * emplacements de niveau document — `layers`, `cadre`, `develop`.
 *
 * Le site qui fabriquait cette pile à la main (`App.tsx`) n'en reposait que
 * DEUX : jamais `cadre`. Comme `commit` fait `this.current = stack.clone()`,
 * appliquer un preset ramenait le recadrage à `null` dans le modèle pendant que
 * l'état React gardait l'ancien et que l'export lisait `cadreToile()` — la
 * toile repartait entière, sans erreur ni avertissement. Aucun test du dépôt ne
 * croisait preset et cadre : c'est ce que ce fichier répare.
 */

/** Un document représentatif : une photo, un effet, un recadrage, un étage. */
function documentRecadre(): DocumentSession {
  const stack = new LayerStack();
  const photo = stack.addPhotoLayer("src-1", { x: 128, y: 128, scaleX: 1, scaleY: 1, rotation: 0 }, "photo");
  stack.addLayer("glow", photo);
  const session = new DocumentSession(stack);
  session.recadrerToile({ x: 10, y: 20, width: 100, height: 80 });
  session.reglerDeveloppement("reglagesDeBase", { exposition: 0.5 });
  // Ni le recadrage ni l'étage ne poussent d'entrée d'historique : ce sont des
  // chemins ENGAGÉS dont l'appelant commite la pile ensuite (voir les docblocs
  // de `recadrerToile` et `reglerDeveloppement`). Sans ce commit, l'annulation
  // ci-dessous reviendrait au document NEUF, pas à l'état recadré.
  session.commit(session.currentStack());
  return session;
}

/** Ce qu'un preset restitue : des calques d'effet neufs et un étage à lui. */
function effetsDuPreset(): LayerStack {
  const pile = new LayerStack();
  pile.addLayer("grain");
  return pile;
}

describe("DocumentSession.pilePourPreset", () => {
  it("préserve le recadrage de la toile", () => {
    const session = documentRecadre();
    const avant = session.cadreToile();
    expect(avant).toEqual({ x: 10, y: 20, width: 100, height: 80 });

    session.commit(session.pilePourPreset(effetsDuPreset().layers, {}));

    expect(session.cadreToile()).toEqual({ x: 10, y: 20, width: 100, height: 80 });
  });

  it("rend un cadre FRAIS, pour qu'un recadrage ultérieur ne déplace pas l'entrée d'historique", () => {
    const session = documentRecadre();
    const pile = session.pilePourPreset(effetsDuPreset().layers, {});
    expect(pile.cadre).not.toBe(session.cadreToile());
    expect(pile.cadre).toEqual(session.cadreToile());
  });

  it("laisse `null` un document jamais recadré", () => {
    const stack = new LayerStack();
    stack.addPhotoLayer("src-1", { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, "photo");
    const session = new DocumentSession(stack);
    session.commit(session.pilePourPreset(effetsDuPreset().layers, {}));
    expect(session.cadreToile()).toBeNull();
  });

  it("préserve les calques photo et pose les calques du preset au-dessus", () => {
    const session = documentRecadre();
    session.commit(session.pilePourPreset(effetsDuPreset().layers, {}));
    const pile = session.layers();
    expect(pile.filter((l) => l.imageSource !== undefined)).toHaveLength(1);
    expect(pile[0].imageSource).toBeDefined();
    expect(pile[pile.length - 1].effectId).toBe("grain");
  });

  it("remplace l'ÉTAGE par celui du preset, dans le MÊME commit que la pile", () => {
    const session = documentRecadre();
    expect(session.developpement()).toHaveProperty("reglagesDeBase");

    session.commit(session.pilePourPreset(effetsDuPreset().layers, { hsl: { teinteRouge: 0.3 } }));
    expect(session.developpement()).toEqual({ hsl: { teinteRouge: 0.3 } });

    // Un SEUL pas d'annulation rend la pile ET l'étage ET le cadre.
    session.undo();
    expect(session.developpement()).toHaveProperty("reglagesDeBase");
    expect(session.cadreToile()).toEqual({ x: 10, y: 20, width: 100, height: 80 });
  });
});

describe("DocumentSession.pilePourPreset — calques verrouillés", () => {
  it("préserve un calque d'effet verrouillé « Tout », comme une photo", () => {
    const stack = new LayerStack();
    const photo = stack.addPhotoLayer("src-1", { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, "photo");
    const protege = stack.addLayer("glow", photo);
    stack.addLayer("grain", photo);
    stack.setLayerLock(protege, "all", true);
    const session = new DocumentSession(stack);

    session.commit(session.pilePourPreset(effetsDuPreset().layers, {}));

    const pile = session.layers();
    // Le verrouillé survit, le calque d'effet NON verrouillé part.
    expect(pile.map((l) => l.id)).toContain(protege);
    expect(pile.filter((l) => l.effectId === "grain" && l.id !== protege)).toHaveLength(1);
    expect(pile.some((l) => l.effectId === "glow" && l.id !== protege)).toBe(false);
  });

  it("garde l'ordre RELATIF des calques préservés, verrou et photo mêlés", () => {
    const stack = new LayerStack();
    const photoBasse = stack.addPhotoLayer("src-1", { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, "fond");
    const verrouille = stack.addLayer("glow", photoBasse);
    stack.setLayerLock(verrouille, "all", true);
    const photoHaute = stack.addPhotoLayer("src-2", { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, "sujet");
    const session = new DocumentSession(stack);

    session.commit(session.pilePourPreset(effetsDuPreset().layers, {}));

    const ids = session.layers().map((l) => l.id);
    // Les regrouper par genre réordonnerait un calque que le verrou fige.
    expect(ids.slice(0, 3)).toEqual([photoBasse, verrouille, photoHaute]);
  });

  it("laisse partir un calque seulement verrouillé en position ou en masque", () => {
    const stack = new LayerStack();
    const photo = stack.addPhotoLayer("src-1", { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, "photo");
    const partiel = stack.addLayer("glow", photo);
    stack.setLayerLock(partiel, "position", true);
    const session = new DocumentSession(stack);

    session.commit(session.pilePourPreset(effetsDuPreset().layers, {}));

    // Seul « Tout » refuse la suppression (`isStructureLocked`) : un verrou
    // partiel porte sur le CONTENU, pas sur la présence du calque.
    expect(session.layers().map((l) => l.id)).not.toContain(partiel);
  });
});

describe("preset capture sur le document courant, puis reapplique", () => {
  // DEFAUT INTRODUIT LE 2026-09-15 par le commit qui fait preserver les calques
  // verrouilles : `pilePourPreset` les garde, mais `presetDocument.capture`
  // n'excluait que `imageSource`, donc le meme calque partait AUSSI dans le
  // preset. Reappliquer un preset capture sur SON PROPRE document le dupliquait.
  it("ne duplique pas un calque verrouille", () => {
    const stack = new LayerStack();
    const photo = stack.addPhotoLayer("src-1", { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, "photo");
    const protege = stack.addLayer("glow", photo);
    stack.addLayer("grain", photo);
    stack.setLayerLock(protege, "all", true);
    const session = new DocumentSession(stack);

    // Capture sur CE document, puis reapplication a l'identique.
    const { preset } = capturePreset(session.layers(), "Essai");
    let n = 0;
    const restaure = applyPreset(preset, () => true, () => [], () => `frais-${++n}`);
    session.commit(session.pilePourPreset(restaure.layers, restaure.develop));

    const glows = session.layers().filter((l) => l.effectId === "glow");
    expect(glows).toHaveLength(1);
    expect(glows[0].id).toBe(protege);
  });

  it("previent que le calque verrouille n'entre pas dans le preset", () => {
    const stack = new LayerStack();
    const photo = stack.addPhotoLayer("src-1", { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, "photo");
    const protege = stack.addLayer("glow", photo);
    stack.setLayerLock(protege, "all", true);

    const { skipped } = capturePreset(stack.layers, "Essai");
    expect(skipped.some((s) => s.reason === "locked-layer")).toBe(true);
  });
});
