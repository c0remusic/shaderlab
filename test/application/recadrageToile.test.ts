import { describe, expect, it } from "vitest";
import { DocumentSession } from "../../src/application/documentSession";
import { LayerStack } from "../../src/layers/layerStack";

/**
 * RECADRAGE DE LA TOILE — arbitré NON DESTRUCTIF par Antoine le 2026-08-18
 * (ticket 28).
 *
 * Le design montage de 2026-07-29 §9 posait trois issues pour les masques déjà
 * peints — invalider / recadrer / rééchantillonner — et la mesure du ticket en a
 * écarté une (rééchantillonner n'a de sens que pour un REDIMENSIONNEMENT, pas
 * pour un recadrage, où les pixels conservés n'ont pas bougé d'un texel).
 *
 * L'arbitrage en écarte une seconde, et par le haut : **si le recadrage ne
 * détruit rien, il ne faut découper AUCUN raster.** On change le CADRE, pas les
 * données. C'est cohérent avec le reste du projet — un calque photo garde déjà
 * ce qui dépasse — et ça fait tomber à zéro l'empreinte d'historique que la
 * découpe aurait coûtée (mesurée dans le ticket : 104 Mo -> 156 Mo sur 512 à
 * 26 Mpx, et huit rasters suffisant à saturer le budget au plafond de 64 Mpx).
 *
 * ⚠️ CE QUI N'EST PAS ENCORE CÂBLÉ, dit plutôt que découvert : le cadre est
 * porté par le document et rendu observable ici, mais le RENDU ne le lit pas
 * encore (`Renderer.allocateDocument` alloue toujours la toile entière). C'est
 * la tranche suivante, et elle passe par les gates GPU — pas par ce fichier.
 */

const rasterPeint = (n: number): Uint8Array => {
  const r = new Uint8Array(n);
  r.fill(200);
  return r;
};

/** Un document représentatif : une photo, un effet, et un masque peint dessus. */
const documentPeint = (): { session: DocumentSession; calque: string } => {
  const stack = new LayerStack();
  const photo = stack.addPhotoLayer("src-1", { x: 128, y: 128, scaleX: 1, scaleY: 1, rotation: 0 }, "photo");
  const calque = stack.addLayer("glow", photo);
  stack.updateBrushMask(calque, rasterPeint(256 * 256));
  return { session: new DocumentSession(stack), calque };
};

describe("recadrer la toile", () => {
  it("pose le cadre demandé", () => {
    const { session } = documentPeint();
    session.recadrerToile({ x: 32, y: 16, width: 128, height: 96 });
    expect(session.cadreToile()).toEqual({ x: 32, y: 16, width: 128, height: 96 });
  });

  // UN RECADRAGE D'UN RECADRAGE PART DE CE QU'ON VOIT. C'est le seul point de
  // vue que l'utilisateur ait : il trace un rectangle sur l'image affichée, pas
  // sur une toile d'origine qu'il ne voit plus. Le cadre stocké, lui, est
  // toujours absolu — sinon rien ne saurait plus où sont les pixels.
  it("compose : un second recadrage est relatif au cadre courant", () => {
    const { session } = documentPeint();
    session.recadrerToile({ x: 10, y: 10, width: 100, height: 100 });
    session.recadrerToile({ x: 5, y: 5, width: 50, height: 50 });
    expect(session.cadreToile()).toEqual({ x: 15, y: 15, width: 50, height: 50 });
  });

  // ON NE RECADRE PAS VERS L'EXTÉRIEUR. Un recadrage RETIRE ; agrandir le cadre
  // au-delà de ce qu'il contient ferait apparaître des pixels que l'utilisateur
  // ne voyait plus, ce qui n'est pas le même geste et n'a pas le même nom. Le
  // rectangle est donc borné au cadre courant, sur les quatre côtés.
  it("borne au cadre courant : un rectangle qui déborde est rogné, pas honoré", () => {
    const { session } = documentPeint();
    session.recadrerToile({ x: 10, y: 10, width: 100, height: 100 });
    session.recadrerToile({ x: 80, y: 80, width: 60, height: 60 });
    // Le cadre courant s'arrête à 110 ; il reste 20 px à droite et en bas.
    expect(session.cadreToile()).toEqual({ x: 90, y: 90, width: 20, height: 20 });
  });

  it("borne aussi vers le haut et la gauche : un décalage négatif ne sort pas du cadre", () => {
    const { session } = documentPeint();
    session.recadrerToile({ x: 10, y: 10, width: 100, height: 100 });
    session.recadrerToile({ x: -30, y: -30, width: 50, height: 50 });
    expect(session.cadreToile()).toEqual({ x: 10, y: 10, width: 50, height: 50 });
  });

  // LA PROMESSE DU NON-DESTRUCTIF, et elle se vérifie ici ou nulle part : après
  // deux recadrages successifs, tout revient d'un geste. Rien n'a été découpé,
  // donc il n'y a rien à reconstruire — reposer `null` suffit.
  it("s'annule d'un geste, quel que soit le nombre de recadrages empilés", () => {
    const { session } = documentPeint();
    session.recadrerToile({ x: 10, y: 10, width: 100, height: 100 });
    session.recadrerToile({ x: 5, y: 5, width: 50, height: 50 });
    session.annulerRecadrage();
    expect(session.cadreToile()).toBeNull();
  });
});

describe("recadrer la toile — les deux gardes", () => {
  // GARDE 1, ET C'EST L'ARBITRAGE LUI-MÊME. « Non destructif » ne veut pas dire
  // « réversible » : il veut dire qu'aucun octet n'est touché. On l'asserte donc
  // sur les RÉFÉRENCES, pas sur les valeurs — un raster recopié à l'identique
  // passerait un `toEqual` tout en coûtant 26 Mo par entrée d'historique, ce qui
  // est exactement ce que l'arbitrage écarte.
  it("ne touche AUCUNE donnée : les rasters sont les mêmes objets après recadrage", () => {
    const { session, calque } = documentPeint();
    const avant = session.layers().find((l) => l.id === calque)!;
    const rasterAvant = avant.mask.sources[0].raster;
    const transformAvant = session.layers()[0].imageSource?.transform;

    session.recadrerToile({ x: 32, y: 16, width: 128, height: 96 });

    const apres = session.layers().find((l) => l.id === calque)!;
    expect(apres.mask.sources[0].raster).toBe(rasterAvant);
    expect(session.layers()[0].imageSource?.transform).toBe(transformAvant);
    expect(rasterAvant!.length).toBe(256 * 256);
  });

  // GARDE 2 : le cadre vit sur `LayerStack`, donc `History` le prend en
  // instantané comme le reste — un recadrage s'annule par le même Ctrl+Z que
  // tout le monde, sans second canal d'undo. C'est la raison pour laquelle il
  // n'est ni dans le renderer ni dans `OpenedDocument`.
  it("voyage dans l'historique : l'undo rend le cadre précédent", () => {
    const { session } = documentPeint();
    session.recadrerToile({ x: 10, y: 10, width: 100, height: 100 });
    session.commit(session.currentStack());
    session.recadrerToile({ x: 5, y: 5, width: 50, height: 50 });
    session.commit(session.currentStack());

    expect(session.undo()).toBe(true);
    expect(session.cadreToile()).toEqual({ x: 10, y: 10, width: 100, height: 100 });
    expect(session.redo()).toBe(true);
    expect(session.cadreToile()).toEqual({ x: 15, y: 15, width: 50, height: 50 });
  });
});
