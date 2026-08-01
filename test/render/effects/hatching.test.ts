import { describe, it, expect } from "vitest";
import { hatching } from "../../../src/render/effects/hatching";
import { effectRegistry, getEffect } from "../../../src/render/effects/registry";
import { linearToSrgb } from "../../../src/render/effects/srgbTransfer";

/** Retire les lignes de commentaire d'un source WGSL.
 *
 *  Nécessaire pour toute assertion NÉGATIVE : les shaders de ce dossier
 *  documentent l'écriture qu'ils écartent, en la citant. Trois assertions de ce
 *  dépôt s'étaient déjà déclenchées sur leur propre mise en garde — un test
 *  rouge pour la bonne raison apparente et la mauvaise raison réelle. */
function codeSeul(wgsl: string): string {
  return wgsl
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

/** Jumeau TS de `hatch_stripe` — la couverture d'une taille, écrite comme
 *  DIFFÉRENCE DE DEUX BORDS. Recopié ici plutôt qu'exporté du module : c'est
 *  une formule de quatre lignes dont l'unique enjeu est une propriété limite,
 *  et le test qui la vérifie est juste en dessous. */
function stripe(dist: number, h: number, aa: number): number {
  const dedans = Math.min(1, Math.max(0, (h + aa - dist) / (2 * aa)));
  const dehors = Math.min(1, Math.max(0, (aa - h - dist) / (2 * aa)));
  return dedans - dehors;
}

describe("hatching — la couverture d'une taille", () => {
  const aa = 1 / 9; // un pixel, pour un espacement de 9 px

  it("s'annule EXACTEMENT à largeur nulle, y compris au centre du trait", () => {
    // C'est la raison d'être de l'écriture en différence de deux bords. Un
    // `smoothstep(h + aa, h - aa, dist)` rendrait 0,5 ici — donc un voile gris
    // sur toute l'image là où la trame ne doit rien tracer.
    for (const dist of [0, 0.01, 0.1, 0.25, 0.5]) {
      expect(stripe(dist, 0, aa)).toBe(0);
    }
  });

  it("vaut 1 au centre d'un trait large et 0 loin de lui", () => {
    expect(stripe(0, 0.3, aa)).toBeCloseTo(1, 6);
    expect(stripe(0.5, 0.3, aa)).toBe(0);
  });

  it("passe par 0,5 exactement sur le bord du trait", () => {
    // Propriété d'une couverture de bord : à la frontière géométrique, un pixel
    // est couvert à moitié. C'est ce qui rend le trait antialiasé sans réglage.
    expect(stripe(0.3, 0.3, aa)).toBeCloseTo(0.5, 6);
  });

  it("croît de façon monotone quand le trait s'élargit", () => {
    let precedent = -1;
    for (const h of [0, 0.05, 0.1, 0.2, 0.3, 0.5]) {
      const c = stripe(0.05, h, aa);
      expect(c).toBeGreaterThanOrEqual(precedent);
      precedent = c;
    }
  });

  it("porte la même formule côté WGSL", () => {
    expect(hatching.wgsl).toContain("let dedans = clamp((h + aa - dist) / (2.0 * aa), 0.0, 1.0);");
    expect(hatching.wgsl).toContain("let dehors = clamp((aa - h - dist) / (2.0 * aa), 0.0, 1.0);");
    expect(hatching.wgsl).toContain("return dedans - dehors;");
    // L'écriture écartée ne doit pas revenir par une « simplification ». Portée
    // sur le CODE seul : les commentaires de ce dossier nomment ce qu'ils
    // refusent, et le shader cite justement `smoothstep(h + aa, h - aa, dist)`
    // pour dire pourquoi il ne l'emploie pas. Une recherche sur le texte brut
    // se déclencherait sur sa propre mise en garde.
    expect(codeSeul(hatching.wgsl)).not.toMatch(/smoothstep\([^)]*dist\)/);
  });
});

describe("hatching — la progression tonale", () => {
  /** Charge de la couche `k` sur `n`, au ton `t` (1 = clair). Jumeau de la
   *  boucle du shader. */
  const charge = (t: number, k: number, n: number, weight: number) => {
    const hi = (n - k) / n;
    const lo = (n - k - 1) / n;
    return Math.min(1, Math.max(0, (hi - t) / (hi - lo))) * weight;
  };

  it("n'encre RIEN sur le blanc", () => {
    for (let k = 0; k < 3; k++) expect(charge(1, k, 3, 0.62)).toBe(0);
  });

  it("sature TOUTES les couches sur le noir", () => {
    for (let k = 0; k < 3; k++) expect(charge(0, k, 3, 0.62)).toBeCloseTo(0.62, 6);
  });

  it("fait se RELAYER les couches au lieu de les charger ensemble", () => {
    // À mi-ton, la première couche doit être saturée et la dernière encore
    // vierge : c'est le geste du graveur, et c'est ce qui donne une gamme
    // continue avec une encre unique. Si les trois montaient ensemble, l'effet
    // n'aurait qu'un seul degré de liberté et le croisement ne servirait à rien.
    const t = 0.5;
    expect(charge(t, 0, 3, 1)).toBe(1);
    expect(charge(t, 1, 3, 1)).toBeGreaterThan(0);
    expect(charge(t, 1, 3, 1)).toBeLessThan(1);
    expect(charge(t, 2, 3, 1)).toBe(0);
  });

  it("lit le ton sur l'axe PERCEPTUEL, pas sur la luminance linéaire", () => {
    // Sur l'axe linéaire, un gris perçu comme moyen vaut ~0,21 : les quatre
    // cinquièmes de l'image tomberaient dans la première couche.
    expect(hatching.wgsl).toContain("let tone = linear_to_srgb(dot(color.rgb, HATCH_LUMA));");
    expect(linearToSrgb(0.5)).toBeGreaterThan(0.7);
  });

  it("borne le point blanc au-dessus du point noir", () => {
    // Sans cette garde, un point blanc sous le point noir inverserait la
    // réponse en silence, avec un dénominateur négatif.
    expect(hatching.wgsl).toContain("let whitePoint = max(params[6], blackPoint + 0.001);");
  });
});

describe("hatching — écriture et registre", () => {
  it("unit les couches par produit des complémentaires, jamais par somme", () => {
    // Une somme dépasserait 1 aux croisements et écrêterait ; l'union superpose
    // deux passages d'encre opaque, ce qu'EST une taille croisée.
    expect(hatching.wgsl).toContain("clair = clair * (1.0 - hatch_stripe(dist, 0.5 * charge, aa));");
    expect(hatching.wgsl).toContain("let encre = 1.0 - clair;");
  });

  it("calcule l'antialiasing ANALYTIQUEMENT, sans fwidth", () => {
    // La phase vaut p/espacement et p est une distance en pixels : un pixel de
    // déplacement change la phase de 1/espacement, exactement. `fwidth`
    // n'apporterait rien — et l'interdirait, puisque les dérivées implicites
    // exigent un flux de contrôle uniforme que la boucle ne garantit pas.
    expect(hatching.wgsl).toContain("let aa = 1.0 / spacing;");
    expect(hatching.wgsl).not.toContain("fwidth");
  });

  it("travaille en espace PIXEL, pas en UV", () => {
    expect(hatching.wgsl).toContain("let px = uv * vec2<f32>(textureDimensions(srcTexture));");
  });

  it("est enregistré et lit ses paramètres dans l'ordre déclaré", () => {
    expect(getEffect("hatching")).toBe(hatching);
    expect(effectRegistry).toContain(hatching);
    expect(hatching.params.map((p) => p.name)).toEqual([
      "angle", "spacing", "weight", "crossAngle", "layers",
      "blackPoint", "whitePoint", "inkHue", "inkSaturation", "inkLightness", "wash",
    ]);
    expect(hatching.wgsl).toContain("let layers = clamp(i32(params[4] + 0.5), 1, 4);");
    expect(hatching.wgsl).toContain("let wash = clamp(params[10], 0.0, 1.0);");
  });

  it("décode l'encre du picker vers le linéaire avant de mélanger", () => {
    expect(hatching.wgsl).toContain("srgb_to_linear3(hsl2rgb(params[7] / 360.0, params[8], params[9]))");
  });
});
