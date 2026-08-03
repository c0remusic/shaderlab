import { describe, it, expect } from "vitest";
import { lensDistortion } from "../../../src/render/effects/lensDistortion";
import { glow } from "../../../src/render/effects/glow";
import { halation } from "../../../src/render/effects/halation";
import { effectRegistry, getEffect } from "../../../src/render/effects/registry";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer";

const bright = lensDistortion.passes?.[0];
const etalement = lensDistortion.passes?.[1];

describe("lensDistortion — la teinte vient de l'OBJECTIF, pas de la source", () => {
  it("jette la couleur au bright-pass", () => {
    // Une lampe verte donne une traînée bleue : la teinte vient du traitement
    // anti-reflet, pas de la lumière. Garder la couleur source produirait une
    // traînée arc-en-ciel, ce qu'aucun objectif ne fait. Même raison, et même
    // écriture, que le bright-pass de `halation`.
    expect(bright?.wgsl).toContain("return vec4<f32>(vec3<f32>(e * e), 1.0);");
  });

  it("décode le seuil vers le linéaire", () => {
    expect(bright?.wgsl).toContain("let seuil = srgb_to_linear(clamp(params[7], 0.0, 1.0));");
    expect(srgbToLinear(0.62)).toBeLessThan(0.4);
  });

  it("applique un genou doux et non une bascule", () => {
    // Une coupure franche fait clignoter la traînée quand une haute lumière
    // traverse le seuil d'un cran d'exposition.
    expect(bright?.wgsl).toContain("let e = max(l - seuil, 0.0) / max(1.0 - seuil, 0.0001);");
  });
});

describe("lensDistortion — le nombre de taps est LIÉ à la croissance du pas", () => {
  it("échantillonne jusqu'à ±4 pas", () => {
    // Une passe dont les taps vont jusqu'à ±N pas étale sur ±N pas. Si la
    // suivante multiplie le pas par plus de N, elle échantillonne au-delà de ce
    // qui est couvert et laisse un trou. La première version avait ±2 taps pour
    // un facteur 4 : elle perlait en chapelet de billes, et le témoin de rendu
    // l'a montré immédiatement.
    expect(etalement?.wgsl).toContain("for (var i = 1; i <= 4; i = i + 1) {");
  });

  it("fait croître le pas d'un facteur exactement égal à cette portée", () => {
    // 1, 4, 16 : chaque passe multiplie par 4, ce que ±4 taps couvrent
    // exactement. Les deux nombres ne se changent pas l'un sans l'autre.
    const pas = (lensDistortion.passes ?? []).slice(1).map((p) => {
      const m = p.wgsl.match(/\* ([\d.]+)\.0\) \/ dims;/);
      return m ? Number(m[1]) : null;
    });
    expect(pas).toEqual([1, 4, 16]);
    for (let i = 1; i < pas.length; i++) {
      expect(pas[i]! / pas[i - 1]!).toBeLessThanOrEqual(4);
    }
  });

  it("pondère par 1/(1+i), sans constante magique par rang", () => {
    expect(etalement?.wgsl).toContain("let poids = 1.0 / (1.0 + f32(i));");
    expect(etalement?.wgsl).toContain("return vec4<f32>(sum / w, 1.0);");
  });

  it("corrige l'aspect, sinon l'angle mentirait", () => {
    expect(etalement?.wgsl).toContain("let dir = vec2<f32>(cos(angle), sin(angle)) / ar;");
  });
});

describe("lensDistortion — il ne double ni glow ni halation", () => {
  it("est ADDITIF, comme une lumière parasite", () => {
    expect(lensDistortion.wgsl).toContain("sortie = sortie + tint * energie * streakIntensity;");
  });

  it("est le seul des trois à porter une ORIENTATION", () => {
    // C'est ce qui le distingue : un objectif anamorphique porte un élément
    // CYLINDRIQUE, donc l'étalement se fait sur un seul axe. glow et halation
    // étalent en disque.
    expect(lensDistortion.params.some((p) => p.name === "streakAngle")).toBe(true);
    expect(glow.params.some((p) => p.name === "angle")).toBe(false);
    expect(halation.params.some((p) => p.name === "angle")).toBe(false);
  });

  it("dérive sa dispersion de l'ÉNERGIE et non d'une distance", () => {
    // Même construction que le dégradé de halation, et pour la même raison :
    // une distance géométrique demanderait un second champ et serait fausse dès
    // que deux sources voisines se rejoignent.
    expect(lensDistortion.wgsl).toContain("let vire = (1.0 - clamp(energie * 4.0, 0.0, 1.0)) * clamp(params[14], 0.0, 1.0);");
  });

  it("ouvre le bloc d'OPTIQUE, juste après la famille des halos", () => {
    // Il suivait `halation` directement jusqu'au 2026-08-03, où `lensFlare` s'est
    // intercalé : un flare est de la lumière AJOUTÉE par l'objectif, donc il
    // appartient aux halos et pas à ce bloc-ci, qui traite ce que la FORME du
    // verre déforme. L'assertion porte donc sur la frontière entre les deux
    // familles, et non plus sur un voisin nommé — un voisin, ça se remplace.
    expect(getEffect("lensDistortion")).toBe(lensDistortion);
    const i = effectRegistry.indexOf(lensDistortion);
    const halos = ["glow", "halation", "lensFlare"];
    expect(halos).toContain(effectRegistry[i - 1].id);
    // Tout ce qui précède est un halo, rien de ce qui suit ne l'est.
    expect(effectRegistry.slice(0, i).map((e) => e.id)).toEqual(halos);
    expect(effectRegistry.indexOf(halation)).toBeLessThan(i);
  });
});

describe("lensDistortion — la géométrie", () => {
  it("est l'IDENTITÉ EXACTE à distorsion nulle, pas une approximation", () => {
    // `1 + k·r²` vaut exactement 1 quand k vaut 0, donc l'UV rendue est l'UV
    // reçue. C'est ce que la référence de rendu vérifie contre la photo nue :
    // un effet neutre à son défaut ne doit pas bouger un canal.
    expect(lensDistortion.wgsl).toContain("let geom = (1.0 + distortion * r2) / zoom;");
    const d = lensDistortion.params.find((p) => p.name === "distortion");
    expect(d?.default).toBe(0);
    expect(d?.min).toBeLessThan(0); // signé : coussinet ET barillet
  });

  it("calcule le rayon dans l'espace CORRIGÉ DE L'ASPECT", () => {
    // Sans ça, la même valeur déformerait plus en hauteur qu'en largeur sur une
    // photo 3:2 : le fisheye serait ovale et la distorsion cesserait d'être
    // radiale. Même garde-fou qu'`uvSpace.ts` pose partout ailleurs.
    expect(lensDistortion.wgsl).toContain("let p = (uv - vec2<f32>(0.5)) * ar;");
    expect(lensDistortion.wgsl).toContain("let r2 = dot(p, p);");
  });
});

describe("lensDistortion — trois aberrations, trois géométries distinctes", () => {
  it("la LATÉRALE est radiale et croît vers les coins", () => {
    // Elle se COMPOSE avec l'échelle de la géométrie au lieu de s'y ajouter :
    // c'est un grandissement qui dépend de la longueur d'onde, donc une échelle.
    expect(lensDistortion.wgsl).toContain("uvR = lensUv(p, ar, geom * (1.0 + courseR * profil));");
    expect(lensDistortion.wgsl).toContain("uvB = lensUv(p, ar, geom * (1.0 - courseB * profil));");
  });

  it("la LONGITUDINALE ne déplace RIEN — elle défocalise", () => {
    // C'est ce qui la distingue vraiment : elle se voit au CENTRE, là où la
    // latérale est nulle par construction. Le vert reste net et sert de
    // référence de mise au point.
    expect(lensDistortion.wgsl).toContain("flouR = courseR * 0.5;");
    expect(lensDistortion.wgsl).toContain("flouB = courseB * 0.5;");
    // Aucun déplacement dans cette branche : uvR et uvB gardent la géométrie nue.
    const branche = lensDistortion.wgsl.slice(
      lensDistortion.wgsl.indexOf("} else if (mode == 1)"),
      lensDistortion.wgsl.indexOf("} else {"),
    );
    expect(branche).not.toContain("uvR = lensUv");
    expect(branche).not.toContain("uvB = lensUv");
  });

  it("l'ANAMORPHIQUE est horizontale et INDÉPENDANTE du rayon", () => {
    // Un verre cylindrique ne disperse que sur l'axe qu'il comprime : le profil
    // radial n'a rien à y faire, et c'est ça qui la sépare de la latérale — pas
    // une question de force.
    expect(lensDistortion.wgsl).toContain("let ecart = vec2<f32>(aberration, 0.0);");
    const branche = lensDistortion.wgsl.slice(lensDistortion.wgsl.indexOf("let ecart = vec2<f32>(aberration, 0.0);"));
    expect(branche.slice(0, 400)).not.toContain("profil");
  });

  it("expose les trois modes dans l'ordre, et l'index est un contrat", () => {
    const m = lensDistortion.params.find((p) => p.name === "aberrationMode");
    expect(m?.choices).toEqual(["Latérale", "Longitudinale", "Anamorphique"]);
    expect(m?.default).toBe(0);
    // Neutre à son défaut : `aberration` vaut 0, donc le mode est sans objet.
    expect(lensDistortion.params.find((p) => p.name === "aberration")?.default).toBe(0);
  });
});

describe("lensDistortion — la traînée ne coûte rien quand elle est éteinte", () => {
  it("conditionne ses QUATRE passes à la même expression", () => {
    // Les quatre, et pas seulement l'étalement : le bright-pass aussi alloue.
    expect(lensDistortion.passes).toHaveLength(4);
    for (const passe of lensDistortion.passes ?? []) {
      expect(passe.enabled).toBeDefined();
      expect(passe.enabled?.({ streakIntensity: 0 })).toBe(false);
      expect(passe.enabled?.({ streakIntensity: 1.1 })).toBe(true);
    }
  });

  it("a pour défaut une intensité NULLE, donc zéro passe", () => {
    // Poser cet effet pour un simple fisheye ne doit rien coûter de plus. C'est
    // la condition qui rend l'absorption d'`anamorphicStreak` acceptable.
    const i = lensDistortion.params.find((p) => p.name === "streakIntensity");
    expect(i?.default).toBe(0);
    expect(lensDistortion.passes?.[0].enabled?.(
      Object.fromEntries(lensDistortion.params.map((p) => [p.name, p.default])),
    )).toBe(false);
  });

  it("neutralise `prevPass` par la MÊME expression que le prédicat", () => {
    // ⚠️ Quand les passes sautent, `prevPass` porte la texture SOURCE (voir
    // `EffectPass.enabled`). Ici le produit par `streakIntensity` vaut alors
    // zéro : rien de cette source ne fuit. Le lien entre les deux conditions est
    // ce que ce test fige — les découpler ferait apparaître la photo, en double
    // et additivement, sans aucune erreur de compilation.
    expect(lensDistortion.wgsl).toContain("let streakIntensity = max(params[10], 0.0);");
    expect(lensDistortion.wgsl).toContain("sortie = sortie + tint * energie * streakIntensity;");
  });

  it("lit la traînée à l'UV DÉFORMÉE, pas à l'UV du cadre", () => {
    // Elle appartient à l'image, donc elle subit la même géométrie. La lire à
    // `uv` la laisserait droite sur un fisheye, ce qui trahirait qu'elle est
    // ajoutée après coup.
    expect(lensDistortion.wgsl).toContain("let energie = textureSample(prevPass, srcSampler, uvG).r;");
  });
});

describe("lensDistortion — ce que l'absorption a retiré du registre", () => {
  it("`anamorphicStreak` n'est plus un effet", () => {
    expect(effectRegistry.some((e) => e.id === "anamorphicStreak")).toBe(false);
    expect(() => getEffect("anamorphicStreak")).toThrow();
  });

  it("`chromaticBleed` n'est plus un effet non plus", () => {
    // Le doublon était DÉCLARÉ depuis ADR-0014 et ce test le gardait visible.
    // Il a été MESURÉ le 2026-08-03 avant d'être conclu (ADR-0016) : 0,005 % de
    // canaux d'écart entre les deux effets sur le cas radial, même mire et
    // mêmes réglages. Le test change de sens sans changer de rôle — il empêche
    // toujours l'oubli, mais dans l'autre direction.
    expect(effectRegistry.some((e) => e.id === "chromaticBleed")).toBe(false);
    expect(() => getEffect("chromaticBleed")).toThrow();
    expect(lensDistortion.wgsl).toContain("let profil = mix(pow(clamp(r2 * 2.0, 0.0, 1.0), falloff * 0.5), 1.0, centerPresence);");
  });

  it("a porté l'ORIENTATION du décalage, la seule chose que l'absorbé savait faire de plus", () => {
    // C'EST LA MOITIÉ DE LA MESURE QU'ON OUBLIERAIT. Le mode Latérale est un
    // grandissement dépendant de la longueur d'onde : il ne produit QUE du
    // radial, par construction, et aucun réglage des quatre autres curseurs n'y
    // change rien. Or les deux orientations de l'effet absorbé s'écartaient de
    // 23,1 % des canaux — c'était une capacité, pas une nuance.
    const angle = lensDistortion.params.find((p) => p.name === "aberrationAngle");
    expect(angle?.default).toBe(0);
    expect([angle?.min, angle?.max]).toEqual([-45, 45]);
    // Le défaut prend la branche d'ÉCHELLE, celle que la référence a figée :
    // `p·geom·(1+k)` n'est pas bit pour bit `p·geom + p·geom·k`.
    expect(lensDistortion.wgsl).toContain("if (angleAberration != 0.0) {");
  });
});
