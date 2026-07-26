import { describe, expect, it } from "vitest";
import { basename } from "../../src/hooks/usePhotoLayer";

/** Logique PURE seulement — aucun rendu de composant/hook (env Node, cf.
 *  convention du projet). Le basename alimente `LayerState.name` à l'import :
 *  un nom vide rendrait la ligne de calque invisible, d'où le contrat `null`
 *  sur chemin dégénéré plutôt que chaîne vide. */
describe("basename", () => {
  it("extrait le nom de fichier d'un chemin Windows", () => {
    expect(basename("C:\\photos\\IMG_1234.jpg")).toBe("IMG_1234.jpg");
  });

  it("extrait le nom de fichier d'un chemin POSIX", () => {
    expect(basename("/home/a/b.jpg")).toBe("b.jpg");
  });

  it("rend le nom tel quel quand il n'y a aucun séparateur", () => {
    expect(basename("IMG.jpg")).toBe("IMG.jpg");
  });

  it("rend null sur un chemin qui se termine par un séparateur", () => {
    expect(basename("C:\\photos\\")).toBeNull();
  });

  it("rend null sur une chaîne vide", () => {
    expect(basename("")).toBeNull();
  });
});
