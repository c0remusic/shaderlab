import { describe, expect, it } from "vitest";
import { documentDisplayName, documentFileName, UNTITLED_DOCUMENT_NAME } from "../../src/layers/documentName";

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

describe("documentDisplayName", () => {
  it("préfère le chemin disque quand il existe (lancement Lightroom, dialogue Ouvrir)", () => {
    expect(documentDisplayName("C:\\Users\\a\\DSC_0042.jpg", "autre.jpg")).toBe("DSC_0042.jpg");
  });

  it("retombe sur le nom du fichier déposé — le glisser-déposer ne donne pas de chemin", () => {
    expect(documentDisplayName(null, "DSC_0042.jpg")).toBe("DSC_0042.jpg");
  });

  it("réduit un nom de fichier préfixé d'un chemin à son dernier segment", () => {
    expect(documentDisplayName(null, "dossier/DSC_0042.jpg")).toBe("DSC_0042.jpg");
  });

  it("rend TOUJOURS une chaîne : sans chemin ni nom, le libellé de repli", () => {
    expect(documentDisplayName(null, null)).toBe(UNTITLED_DOCUMENT_NAME);
    expect(documentDisplayName(undefined, undefined)).toBe(UNTITLED_DOCUMENT_NAME);
    expect(documentDisplayName("", "")).toBe(UNTITLED_DOCUMENT_NAME);
    expect(documentDisplayName("//", "//")).toBe(UNTITLED_DOCUMENT_NAME);
  });
});
