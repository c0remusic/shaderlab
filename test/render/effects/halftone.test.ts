import { describe, it, expect } from "vitest";
import { halftone } from "../../../src/render/effects/halftone";
import { effectRegistry, getEffect } from "../../../src/render/effects/registry";

describe("halftone — les angles d'écran font la rosette", () => {
  it("trame les quatre encres à 15, 75, 0 et 45 degrés", () => {
    // Ce ne sont pas des angles décoratifs. Deux trames superposées au MÊME
    // angle produisent un moiré grossier ; ces écarts-là font la rosette, la
    // signature de l'offset. Les changer casse la seule propriété qui
    // distingue cet effet d'une grille de points.
    expect(halftone.wgsl).toContain("rot + 15.0 * deg");
    expect(halftone.wgsl).toContain("rot + 75.0 * deg");
    expect(halftone.wgsl).toContain("rot + 0.0 * deg");
    expect(halftone.wgsl).toContain("rot + 45.0 * deg");
  });

  it("fait pivoter les quatre écrans ENSEMBLE", () => {
    // La rotation s'ajoute à chaque angle : les écarts sont conservés, donc la
    // rosette survit. Une rotation appliquée à un seul écran la détruirait.
    const angles = [...halftone.wgsl.matchAll(/rot \+ ([\d.]+) \* deg/g)].map((m) => m[1]);
    expect(new Set(angles)).toEqual(new Set(["15.0", "75.0", "0.0", "45.0"]));
  });

  it("trame l'encre unique à 45 degrés — l'angle du noir", () => {
    expect(halftone.wgsl).toContain("let dK = halftone_dot(px, centerPx, rot + 45.0 * deg");
  });
});

describe("halftone — ce que la version naïve rate", () => {
  it("porte la densité par l'AIRE du point, pas par son rayon", () => {
    // L'œil intègre la surface couverte, qui va comme le carré du rayon. Sans
    // ce sqrt les demi-tons sortent deux fois trop clairs, sur toute la gamme.
    // ⚠️ `rayonNet` et non `rayon` depuis l'adoption de l'encre réelle
    // (2026-08-05) : `rayon` est désormais ce même rayon UNE FOIS froissé par
    // la bavure. C'est le rayon NET qui porte la propriété testée ici — la
    // bavure est un décalage additif qui ne touche pas la loi en racine.
    expect(halftone.wgsl).toContain("let rayonNet = size * 0.5 * scale * sqrt(clamp(ink, 0.0, 1.0));");
  });

  it("lit la densité au CENTRE DE LA CELLULE, pas sous le pixel", () => {
    // Sous le pixel, le diamètre varierait à l'intérieur d'un même point, qui
    // cesserait d'être un disque pour devenir une tache épousant l'image —
    // c'est-à-dire l'image elle-même, légèrement piquée.
    expect(halftone.wgsl).toContain("let cell = floor(g / size) + vec2<f32>(0.5);");
    expect(halftone.wgsl).toContain("let inks = halftone_inks(back / dims, blackPoint, whitePoint);");
  });

  it("compose les encres en MULTIPLIANT des transmittances", () => {
    // L'encre est soustractive : le cyan absorbe le rouge, le magenta le vert,
    // le jaune le bleu. Additionner rendrait une superposition plus CLAIRE que
    // ses composants, ce qu'aucune encre ne fait.
    expect(halftone.wgsl).toContain("papier = papier * mix(vec3<f32>(1.0), vec3<f32>(0.0, 1.0, 1.0), dC);");
    expect(halftone.wgsl).toContain("papier = papier * mix(vec3<f32>(1.0), vec3<f32>(1.0, 0.0, 1.0), dM);");
    expect(halftone.wgsl).toContain("papier = papier * mix(vec3<f32>(1.0), vec3<f32>(1.0, 1.0, 0.0), dY);");
    expect(halftone.wgsl).toContain("papier = papier * mix(vec3<f32>(1.0), vec3<f32>(0.0), dK);");
  });

  it("extrait le noir du minimum des trois encres (UCR)", () => {
    // Sans retrait de sous-couleur, un noir profond demanderait 300 % d'encre,
    // les trois trames se superposeraient en magma et la rosette disparaîtrait
    // là où elle est la plus visible.
    expect(halftone.wgsl).toContain("let k = min(cmy.x, min(cmy.y, cmy.z));");
    expect(halftone.wgsl).toContain("return vec4<f32>((cmy - vec3<f32>(k)) / reste, k);");
  });

  it("dose l'encre sur l'axe PERCEPTUEL", () => {
    // Une presse dose d'après un ton, pas d'après une énergie lumineuse.
    expect(halftone.wgsl).toContain("let tone = linear_to_srgb3(lin);");
  });

  it("garde une transition d'au moins un pixel", () => {
    // Le point est antialiasé par construction, quelle que soit la valeur du
    // fondu — un point de trame crénelé se voit immédiatement.
    expect(halftone.wgsl).toContain("let aa = max(softness * size * 0.5, 1.0);");
  });
});

describe("halftone — registre", () => {
  it("est enregistré et lit ses paramètres dans l'ordre déclaré", () => {
    expect(getEffect("halftone")).toBe(halftone);
    expect(effectRegistry).toContain(halftone);
    expect(halftone.params.map((p) => p.name)).toEqual([
      "dotSize", "dotScale", "colorMode", "rotation",
      "centerX", "centerY", "softness", "blackPoint", "whitePoint",
      // Encre réelle (`inkTexture.ts`), ajoutée À LA FIN le 2026-08-05 —
      // l'index d'un paramètre est persisté dans les presets, donc cet ordre
      // est un contrat et non une commodité.
      "encreRang", "encreForce", "encreEchelle",
    ]);
  });

  it("n'ajoute AUCUNE bavure par défaut — l'adoption de l'encre est invisible", () => {
    // La condition de non-régression, et elle se lit sur le DÉFAUT : à
    // `encreForce` nul, `ink_froisse` rend sa valeur inchangée, donc le rendu
    // de cet effet est identique au bit près à ce qu'il était avant l'encre.
    // C'est ce que le verrou de pixels vérifie, et ce test dit pourquoi.
    expect(halftone.params.find((p) => p.name === "encreForce")?.default).toBe(0);
    expect(halftone.wgsl).toContain("if (force <= 0.0) {");
  });

  it("déclare la texture d'encre par le paramètre qui porte son rang", () => {
    expect(halftone.libraryTexture).toEqual({ indexParam: "encreRang" });
    // Le rang doit exister dans `params` — `validateEffect` le vérifie aussi,
    // mais un échec ici nomme l'effet fautif au lieu de faire tomber tout le
    // chargement du registre.
    expect(halftone.params.some((p) => p.name === "encreRang")).toBe(true);
    // Et l'effet doit rester MONO-PASSE : le binding 7 n'est résolu que pour la
    // passe finale.
    expect(halftone.passes ?? []).toHaveLength(0);
  });

  it("propose le CMJN en défaut — c'est le mode qui porte la rosette", () => {
    const mode = halftone.params.find((p) => p.name === "colorMode");
    expect(mode?.choices).toEqual(["CMJN", "RVB", "Noir sur blanc", "Blanc sur noir"]);
    expect(mode?.default).toBe(0);
  });

  it("expose un fondu CONTINU là où la référence a deux états", () => {
    // Figma a un `Pattern` Dot/Blended. Les états intermédiaires modélisent
    // quelque chose — une trame plus ou moins mordante — donc ils doivent être
    // atteignables. Même précédent que le `monochrome` de channelMixer.
    const s = halftone.params.find((p) => p.name === "softness");
    expect(s?.choices).toBeUndefined();
    expect(s).toMatchObject({ min: 0, max: 1 });
  });
});
