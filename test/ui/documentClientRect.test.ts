import { describe, expect, it } from "vitest";
import { documentClientRect } from "../../src/ui/transform";

const DOC = { width: 400, height: 300 };

describe("documentClientRect", () => {
  // Sans cadre, AUCUN changement : les overlays se calent sur le canvas comme
  // avant le recadrage. C'est ce qui garde le comportement et les stories
  // intacts tant qu'aucun cadre n'est posé.
  it("rend le rect du canvas inchangé sans cadre", () => {
    const canvasRect = { left: 10, top: 20, width: 800, height: 600 };
    expect(documentClientRect(canvasRect, null, DOC)).toEqual(canvasRect);
  });

  // Le canvas ne couvre que le sous-rectangle du cadre ; la fonction rend le
  // rectangle VIRTUEL où la toile ENTIÈRE apparaîtrait, pour que les overlays
  // placent leurs repères en coordonnées d'origine.
  it("étend le rect au document entier sous un cadre", () => {
    // Cadre = quart central 100x75 à (100,75). Le canvas fait 200x150 à l'écran.
    const canvasRect = { left: 50, top: 30, width: 200, height: 150 };
    const cadre = { x: 100, y: 75, width: 100, height: 75 };
    const out = documentClientRect(canvasRect, cadre, DOC);
    // Échelle écran/doc : 200/100 = 2.
    expect(out.width).toBe(800); // 400 * 2
    expect(out.height).toBe(600); // 300 * 2  (150/75 = 2)
    // L'origine du document est décalée de -cadre * échelle.
    expect(out.left).toBe(50 - 100 * 2);
    expect(out.top).toBe(30 - 75 * 2);
  });

  it("un cadre dégénéré retombe sur le rect du canvas", () => {
    const canvasRect = { left: 0, top: 0, width: 100, height: 100 };
    expect(documentClientRect(canvasRect, { x: 0, y: 0, width: 0, height: 0 }, DOC)).toEqual(canvasRect);
  });
});
