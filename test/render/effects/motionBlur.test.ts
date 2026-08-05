import { describe, it, expect } from "vitest";
import { motionBlur } from "../../../src/render/effects/motionBlur";
import { lensBlur } from "../../../src/render/effects/lensBlur";
import { effectRegistry, getEffect } from "../../../src/render/effects/registry";
import { groupEffectParams } from "../../../src/components/ParamPanel";

const gather = motionBlur.passes?.[0];
const stitch = motionBlur.passes?.[1];

describe("motionBlur — la trajectoire", () => {
  it("déclare un contrôle honnête pour chaque trajectoire", () => {
    expect(motionBlur.canvasControls).toEqual([
      { id: "trajectory", kind: "axis", angle: "angle", length: "amount", label: "Trajectoire", visibleWhen: { param: "trajectory", equals: 0 } },
      { id: "center", kind: "point", x: "centerX", y: "centerY", label: "Centre", visibleWhen: { param: "trajectory", equals: [1, 2] } },
    ]);
  });

  it("expose trois trajectoires, directionnelle par défaut", () => {
    const traj = motionBlur.params.find((p) => p.name === "trajectory");
    expect(traj?.choices).toEqual(["Directionnel", "Rotation", "Zoom"]);
    expect(traj?.default).toBe(0);
  });

  it("fait croître la traînée avec le RAYON en rotation et en zoom", () => {
    // C'est la propriété qui laisse le centre net sans qu'aucun réglage ne le
    // demande, et c'est elle que le témoin de rendu vérifie à l'œil : la
    // longueur est proportionnelle à `d`, l'écart au centre.
    //
    // ⚠️ Test RÉÉCRIT le 2026-08-02, et pour la raison même qu'il illustrait.
    // Il citait la formule `d + perp(d) * θ`, qui était une approximation au
    // PREMIER ORDRE de la rotation — donc il verrouillait le MÉCANISME, pas
    // l'intention, et il est mort au premier changement de mécanisme. Il cite
    // maintenant la propriété : la longueur croît avec le rayon.
    expect(gather?.wgsl).toContain("return length(d) * abs(amount) * 0.017453292519943295 * refPx;");
    expect(gather?.wgsl).toContain("return length(d) * abs(amount) * refPx;");
  });

  it("tourne VRAIMENT en rotation, au lieu de filer le long de la tangente", () => {
    // L'approximation d'origine faisait croître le rayon en `sqrt(1 + θ²)` :
    // invisible à 18°, elle multipliait le rayon par 3,3 à un demi-tour et le
    // « flou de rotation » filait droit. Mesuré sur la référence à 360°, où
    // l'intégration d'un tour complet doit donner des anneaux CONSTANTS :
    // 16 à 20 % d'écart-type angulaire avant, 0,3 % après.
    expect(gather?.wgsl).toContain("let c = cos(th);");
    expect(gather?.wgsl).toContain("let s = sin(th);");
    expect(gather?.wgsl).toContain("return center + vec2<f32>(d.x * c - d.y * s, d.x * s + d.y * c) / ar;");
    // Le zoom, lui, était DÉJÀ exact : l'ancien décalage radial additif se
    // récrit en homothétie. Il n'a pas changé de nature, seulement d'écriture.
    expect(gather?.wgsl).toContain("return center + d * (1.0 + t * amount) / ar;");
  });

  it("corrige l'aspect sur les deux trajectoires centrées", () => {
    // Sans `aspectScale`, un « flou de rotation » sur une photo 3:2 décrirait
    // une ellipse et le curseur d'amplitude mentirait selon l'orientation.
    expect(gather?.wgsl).toContain("let d = (uv - center) * ar;");
  });

  it("partage UNE seule définition de trajectoire entre les TROIS passes", () => {
    // Chacune s'en sert pour autre chose : l'étage 1 pour dimensionner son
    // segment, l'étage 2 pour espacer les siens, la passe finale pour savoir où
    // reprendre le net. Trois définitions divergentes rouvriraient exactement le
    // trou que le découpage en segments ferme.
    for (const corps of [gather?.wgsl, stitch?.wgsl, motionBlur.wgsl]) {
      expect(corps).toContain("fn motion_at(uv: vec2<f32>, t: f32, dims: vec2<f32>) -> vec2<f32> {");
      expect(corps).toContain("fn motion_len_px(uv: vec2<f32>, dims: vec2<f32>) -> f32 {");
    }
    // Et le NOMBRE DE SEGMENTS aussi : les deux étages doivent en calculer le
    // même, sinon l'étage 2 espace ses échantillons autrement que l'étage 1 ne
    // les a étalés.
    expect(gather?.wgsl).toContain("fn motion_segments(lenTexels: f32) -> f32 {");
    expect(stitch?.wgsl).toContain("fn motion_segments(lenTexels: f32) -> f32 {");
  });

  it("recoud en DEUX étages, à la même résolution", () => {
    // Même échelle des deux côtés : à un seul segment, l'étage 2 se réduit à un
    // échantillon qui retombe au centre du texel, donc à une copie exacte. Un
    // palier plus bas aurait ramolli tous les réglages courants — et la
    // référence de pixels d'avant les deux étages ne serait plus valable.
    expect(motionBlur.passes).toHaveLength(2);
    expect(motionBlur.passes?.[0].scale).toBe(0.5);
    expect(motionBlur.passes?.[1].scale).toBe(0.5);
  });

  it("va jusqu'à 2000 px, comme le flou directionnel de Photoshop", () => {
    // Retour d'Antoine du 2026-08-02 : « ses paramètres ne sont pas assez
    // extrêmes ». Le plafond était à 120.
    const amount = motionBlur.params.find((p) => p.name === "amount");
    expect(amount?.max).toBe(2000);
    expect(amount?.default).toBe(30);
  });
});

describe("motionBlur — ce qui empêche les copies fantômes", () => {
  it("fait suivre le nombre d'échantillons à la LONGUEUR de la traînée", () => {
    // À nombre fixe, une traînée longue se décompose en copies espacées — le
    // défaut le plus reconnaissable d'un motion blur raté, et exactement celui
    // que `lensBlur` a montré avant correction.
    // Le nombre suit la longueur du SEGMENT, pas de la traînée entière : depuis
    // le 2026-08-02 la collecte est en deux étages, et c'est ce qui permet à la
    // plage d'aller à 2000 px sans que le plafond ne morde. Le produit des deux
    // étages borne la longueur utile à `2 * 192²` px, très au-delà du curseur.
    expect(gather?.wgsl).toContain("let n = clamp(i32(lenTexels / segments), 4, 192);");
    expect(gather?.wgsl).toContain("for (var i = 0; i < n; i = i + 1) {");
    expect(gather?.wgsl).toContain("return max(1.0, ceil(lenTexels / 192.0));");
  });

  it("espace les segments d'EXACTEMENT la largeur que l'étage 1 a étalée", () => {
    // La règle « le pas et les taps » du journal, satisfaite à égalité : une
    // passe dont les taps vont jusqu'à ±N pas n'étale que sur ±N pas, donc la
    // suivante ne peut pas multiplier le pas par plus de N sans laisser un trou
    // périodique. Les centres de `m` segments jointifs couvrent [-0.5, 0.5].
    expect(stitch?.wgsl).toContain("let t = (f32(k) + 0.5) / mf - 0.5 + bias * 0.5;");
  });

  it("tire le départ de l'échantillonnage PAR PIXEL", () => {
    expect(gather?.wgsl).toContain("let jitter = hash(uv * dims);");
    expect(gather?.wgsl).toContain("let t = (f32(i) + jitter) / nf - 0.5 + bias * 0.5;");
  });

  it("échantillonne en textureSampleLevel, pas en textureSample", () => {
    // Le court-circuit de traînée courte rend le flux de contrôle NON UNIFORME,
    // et `textureSample` calcule des dérivées implicites. Une régression ici ne
    // casserait AUCUN test Node — seulement la compilation sur GPU réel.
    expect(gather?.wgsl).toContain("textureSampleLevel(srcTexture, srcSampler, mirrorUv(motion_at(uv, tLocal, dims)), 0.0)");
    expect(gather?.wgsl).not.toMatch(/textureSample\(srcTexture/);
    // Même exigence sur l'étage 2, qui a le même court-circuit.
    expect(stitch?.wgsl).toContain("textureSampleLevel(srcTexture, srcSampler, mirrorUv(motion_at(uv, t, fullDims)), 0.0)");
    expect(stitch?.wgsl).not.toMatch(/textureSample\(srcTexture/);
  });

  it("divise par la somme des poids APPLIQUÉS, jamais par le nombre d'échantillons", () => {
    // Avec une pondération en cloche, diviser par `n` assombrirait toute la
    // traînée — même piège que la moyenne de Karis du glow.
    expect(gather?.wgsl).toContain("return sum / max(wsum, 0.0001);");
    expect(gather?.wgsl).not.toMatch(/sum\s*\/\s*nf/);
  });
});

describe("motionBlur — l'obturateur", () => {
  it("est centré par défaut et décentrable des deux côtés", () => {
    const bias = motionBlur.params.find((p) => p.name === "bias");
    expect(bias).toMatchObject({ min: -1, max: 1, default: 0 });
  });

  it("pondère plat à extinction nulle, en cloche à un", () => {
    // La cloche n'est pas « plus correcte » — un obturateur mécanique EST franc
    // — mais elle donne la traînée qui s'éteint, qu'on attend d'un filé.
    expect(gather?.wgsl).toContain("let w = mix(1.0, 1.0 - abs(t) * 2.0, falloff);");
  });
});

describe("motionBlur — le raccord net/flou", () => {
  it("reprend la couleur PLEINE DÉFINITION sous le pixel", () => {
    // Visible au CENTRE d'une rotation ou d'un zoom, précisément l'endroit que
    // ces trajectoires sont censées laisser intact.
    expect(motionBlur.passes?.[0].scale).toBe(0.5);
    expect(motionBlur.wgsl).toContain("let sharpness = smoothstep(1.0, 2.0, lenPx);");
    expect(motionBlur.wgsl).toContain("mix(color.rgb, blurred.rgb, sharpness)");
  });

  it("fait coïncider ce seuil avec le court-circuit de la collecte", () => {
    // 0.5 texel de demi-résolution = 1 px pleine définition : les deux chemins
    // coïncident, donc le raccord est invisible par construction.
    expect(gather?.wgsl).toContain("if (lenTexels < 0.5) {");
  });
});

describe("motionBlur — les sections du panneau", () => {
  it("range ses sept réglages en trois sections, sans toucher à params[]", () => {
    // Les sections sont une donnée d'AFFICHAGE : l'index d'un paramètre est
    // persisté dans les presets. Ce qui se vérifie ici est que les trois sont
    // trois blocs CONTIGUS de `params[]` dans son ordre d'origine — la condition
    // posée par `groupEffectParams`, qui s'appuie sur cet ordre en deux endroits
    // — et qu'aucun réglage ne tombe en dehors : `validateEffect` interdit
    // qu'un paramètre soit cité deux fois, il n'exige pas qu'il soit cité.
    const sections = motionBlur.sections!;
    expect(sections.map((s) => s.id)).toEqual(["mouvement", "centre", "obturateur"]);
    expect(sections.flatMap((s) => s.params)).toEqual(motionBlur.params.map((p) => p.name));
    // `pose` sur le seul groupe dont les deux réglages SONT le point qu'on
    // déplace sur l'image ; liste pour les deux autres.
    expect(sections.map((s) => s.layout)).toEqual(["liste", "pose", "liste"]);
  });

  it("ne conditionne que le centre, sur la déclaration MÊME du point posé", () => {
    // Le mouvement sert les trois trajectoires (`amount` change d'unité, pas de
    // sens) et l'obturateur aussi : les conditionner masquerait des réglages
    // vivants. Seul le centre n'existe pas en Directionnel — et sa condition
    // n'est pas une copie de celle du point posé, c'est le MÊME objet. Deux
    // copies ne divergeraient pas bruyamment : un point manipulable sur la toile
    // sans ses coordonnées dans le panneau ne déplace aucun pixel.
    const sections = motionBlur.sections!;
    const point = motionBlur.canvasControls!.find((control) => control.id === "center")!;
    expect(sections[0].appliesWhen).toBeUndefined();
    expect(sections[2].appliesWhen).toBeUndefined();
    expect(sections[1].appliesWhen).toBe(point.visibleWhen);
    expect(sections[1].appliesWhen).toEqual({ param: "trajectory", equals: [1, 2] });
  });

  it("montre à chaque trajectoire exactement ce qui peut agir", () => {
    // LA MESURE QUI COMPTE : ce que le panneau RENDRA, par l'assembleur qu'il
    // utilise lui-même, et non une relecture des déclarations. Elle prouve du
    // même geste que les deux blocs ATOMIQUES ne sont pas coupés entre deux
    // sections — l'axe posé (direction + amplitude) et le point posé (les deux
    // coordonnées) — puisque `groupEffectParams` lève dans ce cas.
    const rendu = (trajectory: number) =>
      groupEffectParams(motionBlur.params, motionBlur.canvasControls, new Set(), {
        sections: motionBlur.sections,
        values: { trajectory },
      }).map((bloc) => [bloc.label, bloc.items.map((item) => item.reactKey)]);

    // Directionnel : pas de centre du tout, et l'axe posé annonce ses deux
    // réglages. L'en-tête « sur la toile » se place au PREMIER paramètre du
    // contrôle dans `params[]`, donc à l'amplitude et non à la direction.
    expect(rendu(0)).toEqual([
      ["Mouvement", ["param:trajectory", "spatial:trajectory", "param:amount", "param:angle"]],
      ["Obturateur", ["param:bias", "param:falloff"]],
    ]);

    // Rotation et Zoom : la direction s'en va avec son axe, le centre arrive
    // avec son point. ⚠️ « Centre Y » part avec « Centre X » alors qu'il ne
    // porte aucune condition à lui — c'est la section qui l'emporte, et c'est
    // la seule chose que ce chantier change au comportement de cet effet.
    for (const trajectory of [1, 2]) {
      expect(rendu(trajectory), `trajectoire ${trajectory}`).toEqual([
        ["Mouvement", ["param:trajectory", "param:amount"]],
        ["Centre", ["spatial:center", "param:centerX", "param:centerY"]],
        ["Obturateur", ["param:bias", "param:falloff"]],
      ]);
    }
  });

  it("lit les DEUX coordonnées du centre dans une seule expression", () => {
    // C'EST L'ARGUMENT QUI AUTORISE LA SECTION À EMPORTER `centerY`, dont
    // l'inertie en Directionnel n'a jamais été mesurée pour lui-même : les deux
    // coordonnées entrent par une ligne unique, et les deux seules sorties de la
    // branche Directionnelle ne la citent pas. La mesure de `centerX` ne peut
    // donc pas être vraie sans l'être de sa jumelle.
    //
    // ⚠️ C'est un argument de SYMÉTRIE DE LA SOURCE, pas une seconde mesure. Ce
    // test existe pour qu'il cesse d'être vrai bruyamment : le jour où le centre
    // se lirait ailleurs, ou où la branche Directionnelle s'en servirait, la
    // question du masquage de `centerY` redevient ouverte.
    for (const corps of [gather?.wgsl, stitch?.wgsl, motionBlur.wgsl]) {
      expect(corps).toContain("let center = vec2<f32>(params[3], params[4]);");
    }
    expect(gather?.wgsl).toContain("return uv + vec2<f32>(cos(angle), sin(angle)) * amount * t / dims;");
    expect(gather?.wgsl).toContain("    return abs(amount);");

    // Et masquer ne borne rien : la valeur reste dans le calque, part telle
    // quelle dans les presets, et le shader continue de la lire — un preset
    // écrit à la main ou un `updateParams` ne passent pas par le panneau.
    expect(motionBlur.wgsl).toContain("let mode = i32(params[0] + 0.5);");
  });
});

describe("motionBlur — registre", () => {
  it("est enregistré juste après lensBlur, sans partager son noyau", () => {
    expect(getEffect("motionBlur")).toBe(motionBlur);
    const i = effectRegistry.indexOf(motionBlur);
    expect(effectRegistry[i - 1]).toBe(lensBlur);
    // Une intégration sur une SURFACE et une intégration le long d'une COURBE :
    // un disque de bokeh n'a rien à faire dans une traînée.
    expect(motionBlur.wgsl).not.toContain("aperture_radius");
    expect(gather?.wgsl).not.toContain("aperture_radius");
  });

  it("lit ses paramètres dans l'ordre exact où il les déclare", () => {
    expect(motionBlur.params.map((p) => p.name)).toEqual([
      "trajectory", "amount", "angle", "centerX", "centerY", "bias", "falloff",
    ]);
    expect(gather?.wgsl).toContain("let mode = i32(params[0] + 0.5);");
    expect(gather?.wgsl).toContain("let falloff = clamp(params[6], 0.0, 1.0);");
  });
});
