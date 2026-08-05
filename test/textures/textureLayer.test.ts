import { describe, it, expect } from "vitest";
import { DEFAULT_TEXTURE_BLEND_MODE } from "../../src/textures/textureLayer";
import { blendRegistry, getBlendMode } from "../../src/render/blend/registry";

describe("DEFAULT_TEXTURE_BLEND_MODE", () => {
  it("désigne un mode RÉEL du registre", () => {
    // `getBlendMode` lève sur un id inconnu — mais elle lèverait au RENDU, sur
    // le premier calque texture posé, devant l'utilisateur. Ce test avance la
    // levée au banc. Un renommage d'id dans `blend/modes.ts` rougit ici.
    expect(() => getBlendMode(DEFAULT_TEXTURE_BLEND_MODE)).not.toThrow();
    expect(blendRegistry.map((mode) => mode.id)).toContain(DEFAULT_TEXTURE_BLEND_MODE);
  });

  it("n'est PAS `normal` — c'est toute la raison d'être de la constante", () => {
    // `addPhotoLayer` crée en `normal`, donc opaque : une texture posée en
    // normal CACHE la photo. Si ce test rougit parce que la valeur est revenue
    // à `normal`, le défaut n'est pas dans le test.
    expect(DEFAULT_TEXTURE_BLEND_MODE).not.toBe("normal");
  });
});
