import { describe, it, expect } from "vitest";
import { halation } from "../../../src/render/effects/halation";
import { glow } from "../../../src/render/effects/glow";
import { linearToSrgb } from "../../../src/render/effects/srgbTransfer";

const brightPass = halation.passes?.[0];

describe("halation — ce qui la sépare d'un bloom teinté", () => {
  // Ces trois propriétés sont la raison d'être de l'effet. Sans elles, il ne
  // reste qu'un glow avec un gain rouge — exactement ce qui a été retiré de
  // `glow.ts` le même jour parce que ça ne tenait pas ce que ça promettait.

  it("jette la couleur de la source dès le bright-pass", () => {
    // Physique : la couche rouge est RÉ-EXPOSÉE par de la lumière réfléchie ;
    // elle ne sait pas de quelle couleur était ce qui l'a exposée. Garder la
    // teinte de la source ferait transparaître un ciel bleu dans son propre
    // halo, ce qui est le comportement d'un bloom.
    expect(brightPass).toBeDefined();
    expect(brightPass!.wgsl).toContain("return vec4<f32>(vec3<f32>(energy), 1.0);");
  });

  it("bascule FRANC au seuil, sans genou — contrairement à glow", () => {
    // Le genou de glow existe pour prendre les demi-tons clairs sans marquer de
    // frontière. Ici la frontière EST le sujet : la halation trace le contour de
    // ce qui a brûlé. L'adoucir reviendrait à teinter en rouge tout ce qui est
    // simplement lumineux.
    expect(brightPass!.wgsl).toContain("let energy = max(brightness - threshold, 0.0);");
    expect(brightPass!.wgsl).not.toContain("knee");
    expect(glow.passes?.[0].wgsl).toContain("knee");
  });

  it("ajoute la couleur du HALO, jamais celle de la source", () => {
    expect(halation.wgsl).toContain("color.rgb + teinte * magnitude * intensity * poidsFond");
  });

  it("déclenche plus haut que glow — une halation naît d'une surexposition", () => {
    const seuilHalation = halation.params.find((p) => p.name === "threshold")!.default;
    const seuilGlow = glow.params.find((p) => p.name === "threshold")!.default;
    expect(seuilHalation).toBeGreaterThan(seuilGlow);
  });
});

/** Teinte du halo, transcrite du composite : rouge pur au loin, orange au cœur.
 *  `orange` est le curseur, `magnitude` l'énergie locale du halo. */
function hueDeg(magnitude: number, orange: number, transition: number): number {
  const coreness = 1 - Math.exp(-magnitude * transition);
  return 0 + (30 - 0) * orange * coreness;
}

describe("halation — dégradé orange au cœur, rouge au loin", () => {
  // La signature du phénomène. La lumière réfléchie est filtrée de ses
  // composantes bleues et vertes par les couches qu'elle retraverse : elle
  // ré-expose surtout la couche ROUGE. Là où le retour est très énergétique —
  // au bord de la zone brûlée — il atteint ENCORE la couche verte, d'où l'orange.
  const ORANGE = 1;
  const TRANSITION = 8;

  it("tend vers le rouge pur quand le halo s'éteint", () => {
    expect(hueDeg(0, ORANGE, TRANSITION)).toBeCloseTo(0, 12);
    expect(hueDeg(0.001, ORANGE, TRANSITION)).toBeLessThan(1);
  });

  it("tend vers l'orange au cœur du halo", () => {
    expect(hueDeg(2, ORANGE, TRANSITION)).toBeGreaterThan(29.9);
  });

  it("est monotone croissante — pas d'inversion de teinte en chemin", () => {
    let précédent = -1;
    for (let i = 0; i <= 200; i++) {
      const h = hueDeg(i / 100, ORANGE, TRANSITION);
      expect(h).toBeGreaterThanOrEqual(précédent);
      précédent = h;
    }
  });

  it("le curseur à 0 donne un halo rouge sur TOUTE sa largeur", () => {
    // Pas « rouge au loin et rouge au cœur par hasard » : à orange=0 la teinte
    // est constante, quelle que soit l'énergie.
    for (const m of [0, 0.1, 0.5, 2]) {
      expect(hueDeg(m, 0, TRANSITION)).toBeCloseTo(0, 12);
    }
  });

  it("`transition` resserre l'orange sans en changer les bornes", () => {
    // À énergie égale, une transition plus raide met plus d'orange près du cœur.
    expect(hueDeg(0.2, ORANGE, 40)).toBeGreaterThan(hueDeg(0.2, ORANGE, 4));
    // Les bornes ne bougent pas : toujours rouge à énergie nulle.
    expect(hueDeg(0, ORANGE, 40)).toBeCloseTo(0, 12);
  });
});

/** Poids d'effacement sur fond clair, transcrit du composite. */
function poidsFond(luminanceLineaire: number, background: number): number {
  const ton = linearToSrgb(luminanceLineaire);
  return 1 * (1 - background) + (1 - ton) * background;
}

describe("halation — s'efface sur fond clair (Background Gain)", () => {
  // Sans ce terme, l'effet teinte les ciels blancs en rose, ce qu'aucun film ne
  // fait : sur un vrai négatif le halo rouge posé sur une zone déjà dense y est
  // noyé.
  it("disparaît sur un fond blanc quand le réglage est à fond", () => {
    expect(poidsFond(1, 1)).toBeCloseTo(0, 6);
  });

  it("reste entier sur un fond noir", () => {
    expect(poidsFond(0, 1)).toBeCloseTo(1, 12);
  });

  it("à 0, se pose partout — le réglage est bien neutralisable", () => {
    for (const luma of [0, 0.25, 0.5, 1]) {
      expect(poidsFond(luma, 0)).toBeCloseTo(1, 12);
    }
  });

  it("mesure la clarté en PERCEPTUEL, pas en luminance linéaire", () => {
    // Une bascule posée en linéaire tomberait bien trop haut : le gris moyen
    // perceptuel (0.5 sRGB) vaut 0.214 linéaire. Évaluée en linéaire, la moitié
    // de l'échelle visible serait traitée comme « sombre ».
    const grisMoyen = 0.2140;
    expect(poidsFond(grisMoyen, 1)).toBeCloseTo(0.5, 2);
    // Le même calcul SANS conversion perceptuelle donnerait ~0.79 — le halo
    // resterait à ~80 % de sa force sur un gris moyen.
    expect(1 - grisMoyen).toBeGreaterThan(0.78);
  });

  it("le WGSL prend bien le ton perceptuel du fond", () => {
    expect(halation.wgsl).toContain("let fond = linear_to_srgb(dot(color.rgb");
  });
});

describe("halation — chaîne de flou", () => {
  const passes = halation.passes ?? [];

  it("pondère par Karis exactement un niveau, le premier downsample", () => {
    expect(passes.filter((p) => p.wgsl.includes("karisWeight"))).toHaveLength(1);
    expect(passes[0]?.wgsl).not.toContain("karisWeight");
    expect(passes[1]?.wgsl).toContain("karisWeight");
  });

  it("reste plus serrée que celle de glow — une frange, pas un voile", () => {
    const plusPetite = (m: typeof halation) =>
      Math.min(...(m.passes ?? []).map((p) => p.scale));
    expect(plusPetite(halation)).toBeGreaterThan(plusPetite(glow));
  });

  it("l'index de portée passé au noyau partagé pointe le bon curseur", () => {
    // Même panne silencieuse que pour glow : `upsampleWgsl(n)` reçoit un index
    // en dur, et le shader compile quel que soit `n`.
    const index = halation.params.findIndex((p) => p.name === "spread");
    expect(index).toBe(1);
    const remontées = passes.filter((p) => p.wgsl.includes("sum / 16.0"));
    expect(remontées.length).toBeGreaterThan(0);
    for (const passe of remontées) {
      expect(passe.wgsl).toContain(`max(params[${index}], 0.05)`);
    }
  });
});
