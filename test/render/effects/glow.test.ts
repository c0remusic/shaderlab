import { describe, it, expect } from "vitest";
import { glow } from "../../../src/render/effects/glow";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer";

const brightPass = glow.passes?.[0];

describe("glow — seuil de bright-pass décodé vers le linéaire", () => {
  it("décode params[0] avant de le comparer à la luminance", () => {
    expect(brightPass).toBeDefined();
    expect(brightPass!.wgsl).toContain("let threshold = srgb_to_linear(params[0]);");
    expect(brightPass!.wgsl).toMatch(/fn srgb_to_linear\(c: f32\)/);
  });

  it("ne convertit pas l'échantillon d'image (pas de double gamma)", () => {
    // brightness sort de color.rgb, déjà linéaire via le format -srgb.
    expect(brightPass!.wgsl).toContain(
      "let brightness = max(color.r, max(color.g, color.b));",
    );
    expect(brightPass!.wgsl).not.toMatch(/srgb_to_linear\(\s*(color|brightness)/);
  });

  it("place le milieu de course du slider à ~0.214 linéaire, pas 0.5", () => {
    // Avant correction : 0.5 était comparé tel quel à une luminance linéaire,
    // soit ~0.735 en perceptuel — le bloom ne mordait que sur le cramé.
    expect(srgbToLinear(0.5)).toBeCloseTo(0.2140, 4);
    expect(srgbToLinear(0.5)).toBeLessThan(0.5);
  });

  it("ramène le seuil par défaut sous la moitié de l'échelle linéaire", () => {
    const threshold = glow.params.find((p) => p.name === "threshold");
    // Défaut redescendu de 0.7 à 0.55 : à 0.7 le bright-pass ne laissait
    // entrer qu'une fraction du pixel (26 % à sRGB 0.80), et le halo par
    // défaut était invisible sur une photo qui n'a pas de zone cramée.
    expect(threshold?.default).toBe(0.55);
    // Le seuil reste décodé vers le LINÉAIRE : l'ancien comportement plaçait
    // la bascule à la valeur perceptuelle prise telle quelle, soit ~0.87
    // perceptuel, inerte sur 85 % de la course.
    expect(srgbToLinear(0.55)).toBeLessThan(0.5);
    expect(srgbToLinear(0.7)).toBeCloseTo(0.4480, 4);
  });
});

describe("glow — bloom NEUTRE depuis le retrait de la teinte (2026-08-01)", () => {
  it("n'expose plus aucun paramètre de teinte", () => {
    const noms = glow.params.map((p) => p.name);
    expect(noms).toEqual(["threshold", "knee", "intensity", "spread"]);
    // Aucun groupe de couleur : la pastille du panneau disparaît avec la teinte.
    expect(glow.params.some((p) => p.colorGroup)).toBe(false);
  });

  it("compose le halo SANS le recolorer", () => {
    // Un bloom étale la lumière présente, il ne la teinte pas. Une recoloration
    // relève de la halation, qui est un autre effet depuis le 2026-08-01.
    expect(glow.wgsl).toContain("return vec4<f32>(color.rgb + bloom * intensity, color.a);");
    expect(glow.wgsl).not.toMatch(/hsl2rgb|tint|gain/);
  });
});

describe("glow — moyenne de Karis sur le PREMIER downsample seulement", () => {
  const passes = glow.passes ?? [];

  it("pondère exactement un niveau", () => {
    // L'invariant qui compte. La pondération de Karis n'est PAS conservatrice en
    // énergie : elle sous-pondère délibérément les hautes lumières pour écraser
    // les fireflies. Posée à tous les niveaux, elle assombrirait tout le halo.
    const pondérés = passes.filter((p) => p.wgsl.includes("karisWeight"));
    expect(pondérés).toHaveLength(1);
  });

  it("le pose sur le premier downsample, pas sur le bright-pass", () => {
    // Le bright-pass (passe 0) n'échantillonne qu'un point : il n'a rien à
    // moyenner, donc rien à pondérer. Le premier VRAI downsample est la passe 1.
    expect(passes[0]?.wgsl).not.toContain("karisWeight");
    expect(passes[1]?.wgsl).toContain("karisWeight");
    expect(passes[1]?.scale).toBe(0.25);
  });

  it("divise par la somme des poids appliqués, pas par la constante du noyau", () => {
    // Diviser par 8 (la somme du noyau non pondéré) ferait fuir l'énergie
    // proportionnellement à la luminosité locale : une zone claire
    // s'assombrirait deux fois.
    expect(passes[1]?.wgsl).toContain("w0 + w1 + w2 + w3 + w4");
    expect(passes[1]?.wgsl).not.toMatch(/sum\s*\/\s*8\.0/);
  });
});

describe("glow — l'index de portée passé au noyau partagé pointe le bon curseur", () => {
  it("lit params[3], qui est bien `spread`", () => {
    // Panne SILENCIEUSE possible : `upsampleWgsl(n)` reçoit un index en dur. Le
    // shader compile quel que soit `n` — il lirait simplement le mauvais
    // curseur. Un réordonnancement des paramètres passerait donc inaperçu sans
    // cette garde.
    const index = glow.params.findIndex((p) => p.name === "spread");
    expect(index).toBe(3);
    const remontées = (glow.passes ?? []).filter((p) => p.wgsl.includes("sum / 16.0"));
    expect(remontées.length).toBeGreaterThan(0);
    for (const passe of remontées) {
      expect(passe.wgsl).toContain(`max(params[${index}], 0.05)`);
    }
  });
});
