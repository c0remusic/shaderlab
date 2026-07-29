import { describe, expect, it } from "vitest";
import { applyPresetImpactMessage } from "../../src/presets/applyPresetImpact";

// Troisième situation, trouvée en relisant le chemin d'application (T5) : la
// phrase du dialogue « Remplacer la pile de calques ? » annonçait la perte des
// calques photo. Depuis que T1 les préserve (`withPhotoLayersPreserved`), elle
// annonce une destruction qui n'a pas lieu — le miroir exact du défaut de
// l'avis de capture, et dans la direction la plus coûteuse : elle dissuade
// d'une action sûre.
describe("applyPresetImpactMessage", () => {
  it("ne promet PAS la perte des calques photo — ils sont préservés", () => {
    expect(applyPresetImpactMessage(2)).not.toMatch(/photo[^.]*perdu/i);
  });

  it("dit explicitement que les calques photo sont conservés quand il y en a", () => {
    expect(applyPresetImpactMessage(2)).toMatch(/photo/i);
    expect(applyPresetImpactMessage(2)).toMatch(/conserv/i);
  });

  it("ne parle pas de photos quand le document n'en a aucune", () => {
    expect(applyPresetImpactMessage(0)).not.toMatch(/photo/i);
  });

  it("annonce dans tous les cas la perte des masques peints et l'annulation possible", () => {
    for (const count of [0, 1, 5]) {
      expect(applyPresetImpactMessage(count)).toMatch(/masque/i);
      expect(applyPresetImpactMessage(count)).toMatch(/Ctrl\+Z/);
    }
  });
});
