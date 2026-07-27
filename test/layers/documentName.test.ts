import { describe, expect, it } from "vitest";
import { documentFileName } from "../../src/layers/documentName";

describe("documentFileName", () => {
  it("rend le nom de fichier d'un chemin Windows", () => {
    expect(documentFileName("C:\\Users\\a\\Pictures\\DSC_0042.jpg")).toBe("DSC_0042.jpg");
  });

  it("rend le nom de fichier d'un chemin POSIX", () => {
    expect(documentFileName("/home/a/pictures/DSC_0042.jpg")).toBe("DSC_0042.jpg");
  });

  it("rend le nom tel quel quand le chemin n'a pas de séparateur", () => {
    expect(documentFileName("DSC_0042.jpg")).toBe("DSC_0042.jpg");
  });

  it("ignore un séparateur final au lieu de rendre un nom vide", () => {
    expect(documentFileName("C:\\Users\\a\\Pictures\\")).toBe("Pictures");
  });

  it("rend null sans document ouvert", () => {
    expect(documentFileName(null)).toBeNull();
    expect(documentFileName(undefined)).toBeNull();
    expect(documentFileName("")).toBeNull();
  });

  it("rend null quand le chemin n'est fait que de séparateurs", () => {
    expect(documentFileName("//")).toBeNull();
  });
});
