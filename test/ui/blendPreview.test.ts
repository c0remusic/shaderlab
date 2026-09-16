import { describe, it, expect } from "vitest";
import { restaurationAvantEngagement, apercuApresEngagement } from "../../src/ui/blendPreview";

/**
 * Les deux décisions de l'aperçu de mode de fusion. Elles vivaient dans
 * `App.tsx`, donc hors de portée des tests (convention du dépôt) — et c'est là
 * qu'une revue adverse a trouvé le défaut que le premier test ci-dessous fige.
 */
describe("aperçu de fusion — ce qu'il faut défaire avant d'engager", () => {
  it("l'aperçu d'un AUTRE calque se défait aussi : c'est la fuite qui gravait une valeur jamais engagée", () => {
    // Le handler testait « si l'aperçu vise CE calque ». Survoler A puis engager
    // sur B sautait donc la restauration, et le commit emportait l'aperçu de A
    // dans le document — une valeur que personne n'avait choisie, et que la fin
    // de survol ne pouvait plus rattraper puisque le handler vidait la référence.
    const apercu = { layerId: "calque-A", committed: "normal" };
    expect(restaurationAvantEngagement(apercu)).toEqual(apercu);
  });

  it("l'aperçu du calque qu'on engage se défait, pour que le mutateur voie la vraie valeur de départ", () => {
    // Sans ça, réengager la valeur survolée ressemble à un no-op : le calque
    // vivant la porte déjà, posée par l'aperçu et jamais engagée.
    const apercu = { layerId: "calque-A", committed: "screen" };
    expect(restaurationAvantEngagement(apercu)).toEqual(apercu);
  });

  it("sans aperçu (clavier, appel direct), il n'y a rien à défaire", () => {
    expect(restaurationAvantEngagement(null)).toBeNull();
  });
});

describe("aperçu de fusion — ce qu'il en reste après l'engagement", () => {
  it("engagement APPLIQUÉ : l'aperçu est éteint, sinon sa fin déferait la valeur engagée", () => {
    expect(apercuApresEngagement({ layerId: "calque-A", committed: "normal" }, true)).toBeNull();
  });

  it("engagement REFUSÉ ou SANS EFFET : l'aperçu reste, parce que le modèle vivant le porte encore", () => {
    // La pile modifiée est jetée quand rien n'est appliqué (calque verrouillé, ou
    // valeur déjà en place) : c'est la fin de survol qui rétablit l'état et
    // repeint, et elle ne peut le faire que si la référence a survécu.
    const apercu = { layerId: "calque-A", committed: "normal" };
    expect(apercuApresEngagement(apercu, false)).toEqual(apercu);
  });

  it("pas d'aperçu : rien à garder, quel que soit le sort de l'engagement", () => {
    expect(apercuApresEngagement(null, true)).toBeNull();
    expect(apercuApresEngagement(null, false)).toBeNull();
  });
});
