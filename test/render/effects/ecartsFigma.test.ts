import { describe, it, expect } from "vitest";
import { pixelStretch } from "../../../src/render/effects/pixelStretch";
import { gooeyMerge } from "../../../src/render/effects/gooeyMerge";

/**
 * Les écarts du §6bis du cahier de références, refermés le 2026-08-01, et les
 * deux qui sont REFUSÉS avec raison.
 *
 * Ce fichier verrouille surtout la NEUTRALITÉ des ajouts : les deux paramètres
 * ont un défaut qui laisse le rendu strictement inchangé, et c'est ce qui
 * permet de les poser sur des effets déjà utilisés dans des presets.
 */

describe("pixelStretch — l'Offset signé de la référence", () => {
  const offset = pixelStretch.params.find((p) => p.name === "offset");

  it("est signé et neutre à zéro", () => {
    expect(offset).toMatchObject({ min: -1, max: 1, default: 0 });
  });

  it("est le HUITIÈME paramètre — le shader lit params[7]", () => {
    // Le shader lit par INDEX : réordonner la liste sans réécrire les index
    // serait une panne silencieuse (il compile quel que soit l'index, il lit
    // juste le mauvais curseur).
    expect(pixelStretch.params.map((p) => p.name)).toEqual([
      "angle", "position", "reach", "strength", "wobble", "wobbleScale", "smooth", "offset",
      "regionRadius", "regionX", "regionY", "regionFeather",
    ]);
    expect(pixelStretch.wgsl).toContain("let offset = clamp(params[7], -1.0, 1.0);");
  });

  it("rend la portée dépendante du CÔTÉ, et l'identité à zéro", () => {
    // `reach * (1 + offset * sign(d))` : à offset=0 le facteur vaut 1 des deux
    // côtés, donc `reachSide == reach` et tout ce qui suit est inchangé.
    expect(pixelStretch.wgsl).toContain("let reachSide = reach * max(1.0 + offset * sign(d), 0.0);");
  });

  it("traite la portée nulle par saturation, sans cas particulier", () => {
    // Un côté à portée nulle sature le quotient : ease=1, compress=1, image
    // intacte. Le plancher n'est là que contre la division par zéro — s'il
    // devenait une vraie borne (0.01 par exemple), le côté « éteint » se
    // remettrait à étirer sur une portée minuscule mais non nulle.
    expect(pixelStretch.wgsl).toContain("clamp(abs(d) / max(reachSide, 0.00001), 0.0, 1.0)");
  });

  it("borne l'étirement à une RÉGION, et laisse l'image intacte dehors", () => {
    // L'écart le plus visible avec la référence, releve par Antoine sur leur
    // apercu : leur pixel stretch se place sur la toile, le notre s appliquait
    // a TOUTE l image. Mesure avant/apres sur la mire commune : 43,1 % des
    // canaux touches sans region, 6,4 % avec.
    //
    // Le masque agit sur la FORCE et non sur la couleur : hors du disque la
    // force tombe a 0, donc la compression vaut 1, donc l image est
    // rigoureusement intacte — aucun melange en sortie, aucune frontiere a
    // tester. Meme propriete que le bout de la portee.
    expect(pixelStretch.wgsl).toContain("let region = 1.0 - smoothstep(regionRadius * (1.0 - regionFeather), regionRadius, regionDist);");
    expect(pixelStretch.wgsl).toContain("let localStrength = strength * region;");
    expect(pixelStretch.wgsl).toContain("let compress = mix(1.0 - localStrength, 1.0, ease);");
  });

  it("a un rayon de région NEUTRE par défaut", () => {
    // 1.5 depasse la demi-diagonale de n importe quel cadre : le masque vaut 1
    // partout et l effet reste global, comme avant ce parametre. C est la
    // condition pour le poser sur un effet deja present dans des presets.
    const rayon = pixelStretch.params.find((p) => p.name === "regionRadius");
    expect(rayon).toMatchObject({ max: 1.5, default: 1.5 });
  });

  it("mesure la région dans l'espace ISOTROPE", () => {
    // Sans quoi le disque serait une ellipse sur un panoramique — meme piege,
    // et meme correctif, que l angle de la ligne source juste au-dessus.
    expect(pixelStretch.wgsl).toContain("let regionDist = length(q - (regionCenter - vec2<f32>(0.5)) * ar);");
  });

  it("garde une traînée symétrique par défaut", () => {
    // La formule ci-dessus, évaluée à la main : les deux côtés valent `reach`.
    const portee = (offsetValue: number, signe: number) => Math.max(1 + offsetValue * signe, 0);
    expect(portee(0, 1)).toBe(1);
    expect(portee(0, -1)).toBe(1);
    // À +1, le côté positif porte le double et le négatif s'éteint.
    expect(portee(1, 1)).toBe(2);
    expect(portee(1, -1)).toBe(0);
    expect(portee(-1, 1)).toBe(0);
  });
});

describe("gooeyMerge — la couleur de premier plan", () => {
  it("expose une couleur de gouttes en groupe, et une colorisation neutre à zéro", () => {
    const tint = gooeyMerge.params.find((p) => p.name === "tint");
    expect(tint).toMatchObject({ min: 0, max: 1, default: 0 });
    const groupe = gooeyMerge.params.filter((p) => p.colorGroup?.key === "tint");
    expect(groupe.map((p) => p.colorGroup?.role)).toEqual(["hue", "saturation", "lightness"]);
  });

  it("borne la teinte par la COUVERTURE — le fond n'est jamais touché", () => {
    // C'est la propriété qui distingue cet ajout d'un cast global, et c'est la
    // raison écrite pour laquelle la couleur de FOND de la référence est
    // refusée : hors des gouttes, `coverage` vaut 0 et le mélange est inerte.
    expect(gooeyMerge.wgsl).toContain("result = mix(result, relit, tint * coverage);");
  });

  it("remet la teinte à l'échelle de la luminance au lieu de la poser à plat", () => {
    // Une goutte peinte en aplat perdrait le modelé que la réfraction et le
    // spéculaire viennent de construire — les deux tiers de l'argument qualité
    // de cet effet.
    expect(gooeyMerge.wgsl).toContain("let relit = tintLin * clamp(dot(result, GOOEY_LUMA) / tintLuma, 0.0, 4.0);");
    // Borne à 4, même garde que gradientMap : sans elle, une teinte presque
    // noire sous une haute lumière donne une division par presque zéro.
    expect(gooeyMerge.wgsl).toContain("0.0, 4.0)");
  });

  it("décode la couleur du picker vers le linéaire avant de mélanger", () => {
    expect(gooeyMerge.wgsl).toContain("srgb_to_linear3(hsl2rgb(params[7] / 360.0, params[8], params[9]))");
  });

  it("n'expose AUCUNE couleur de fond — refus documenté, pas oubli", () => {
    // §6bis listait « couleur de premier plan ET de fond ». La seconde est un
    // cast global, que duotone/gradientMap/channelMixer font déjà mieux. Ce
    // test existe pour qu'un futur passage « parité Figma » relise la raison
    // avant de l'ajouter.
    const groupes = new Set(gooeyMerge.params.map((p) => p.colorGroup?.key).filter(Boolean));
    expect([...groupes]).toEqual(["tint"]);
  });

  it("n'expose AUCUN Source Mix — refus par décision de projet", () => {
    // « Pas de curseur mélange avec l'original : le calque porte déjà son
    // opacity, son blendMode et son masque » (gradientMap.ts, et le même
    // paragraphe dans pixelStretch.ts).
    const noms = gooeyMerge.params.map((p) => p.name);
    expect(noms).not.toContain("sourceMix");
    expect(noms).not.toContain("mix");
    expect(noms).not.toContain("amount");
  });
});
