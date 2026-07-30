import { describe, expect, it } from "vitest";
import { openDocument, type OpeningRenderer } from "../../src/layers/openedDocument";
import { resetTransform } from "../../src/ui/transform";

/** Double structurel : `openDocument` ne lit que deux champs, donc il se teste
 *  en Node sans GPU ni React. C'est la raison pour laquelle son paramètre est
 *  une interface et non la classe `Renderer`. */
function fakeRenderer(
  canvasSize: { width: number; height: number },
  backgroundSourceId: string | null = "src-0",
): OpeningRenderer {
  return { canvasSize, backgroundSourceId };
}

describe("openDocument — les dimensions du calque de fond viennent du RENDERER", () => {
  it("pose un unique calque photo, portant la source et le nom d'ouverture", () => {
    const { stack } = openDocument(fakeRenderer({ width: 256, height: 256 }), "photo.jpg");
    expect(stack.layers).toHaveLength(1);
    expect(stack.layers[0].imageSource?.sourceId).toBe("src-0");
    expect(stack.layers[0].name).toBe("photo.jpg");
  });

  it("la transform d'ouverture est celle de la TOILE, pas une valeur inventée ici", () => {
    // `resetTransform` centre sur la toile (x = W/2, y = H/2) à l'échelle 1.
    // Le test tire la même fonction que le produit plutôt que de recopier des
    // nombres : ce qui est sous test, c'est QUELLE dimension y entre.
    const canvasSize = { width: 320, height: 240 };
    const { stack } = openDocument(fakeRenderer(canvasSize), "p");
    expect(stack.layers[0].transform).toEqual(resetTransform(canvasSize));
    expect(stack.layers[0].transform).toEqual({ x: 160, y: 120, scale: 1, rotation: 0 });
  });

  it("rend les dimensions de la toile, telles que le renderer les porte", () => {
    // R4 : l'appelant PREND la dimension ici plutôt que de la relire lui-même,
    // pour qu'il n'existe pas deux lectures indépendantes du même fait dans le
    // même geste.
    const { size } = openDocument(fakeRenderer({ width: 4961, height: 3508 }), "p");
    expect(size).toEqual({ width: 4961, height: 3508 });
  });

  it("une toile 320×320 centre le fond en 160,160 — pas en 128,128 (dimensions de la mire)", () => {
    // Le cas exact du scénario de harnais `toile-plus-grande-que-la-photo` :
    // c'est la SEULE configuration où lire la photo au lieu de la toile donne
    // un résultat différent, et donc la seule qui puisse attraper la
    // divergence que R4 nommait.
    const { stack, size } = openDocument(fakeRenderer({ width: 320, height: 320 }), "p");
    expect(size).toEqual({ width: 320, height: 320 });
    expect(stack.layers[0].transform).toEqual({ x: 160, y: 160, scale: 1, rotation: 0 });
    expect(stack.layers[0].transform).not.toEqual(resetTransform({ width: 256, height: 256 }));
  });

  it("lève si la photo d'ouverture n'a pas de source enregistrée — invariant, pas cas à absorber", () => {
    expect(() => openDocument(fakeRenderer({ width: 10, height: 10 }, null), "p")).toThrow(
      /invariant rompu/,
    );
  });
});
