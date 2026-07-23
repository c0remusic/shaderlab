import { describe, it, expect } from "vitest";
import { messageFromUnknown } from "../../src/lib/errors";

describe("messageFromUnknown", () => {
  it("returns the message of a real Error", () => {
    expect(messageFromUnknown(new Error("x"))).toBe("x");
  });

  it("returns a string rejection value as-is", () => {
    expect(messageFromUnknown("disque plein")).toBe("disque plein");
  });

  it("falls back to a generic message for an unknown rejection shape", () => {
    expect(messageFromUnknown({ weird: true })).toBe("Erreur inconnue.");
    expect(messageFromUnknown(undefined)).toBe("Erreur inconnue.");
    expect(messageFromUnknown(null)).toBe("Erreur inconnue.");
    expect(messageFromUnknown(42)).toBe("Erreur inconnue.");
  });
});
