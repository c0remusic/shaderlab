import { describe, it, expect } from "vitest";
import { glass } from "../../../src/render/effects/glass";
import { getEffect, effectRegistry } from "../../../src/render/effects/registry";

/**
 * GLASS, TRANCHE 1 — la feuille.
 *
 * Ce que ces tests gardent n'est PAS le rendu : six références de pixels s'en
 * chargent, toutes posées sur `mireVerre`. Ils gardent ce que le fichier
 * AFFIRME et qu'aucune image ne dirait — les applicabilités, les facteurs repris
 * de la source, et les deux corrections payées à la première exécution.
 */

const wgsl = glass.wgsl;

describe("glass — la surface de contrôle", () => {
  it("déclare quatorze paramètres, dans l'ordre où le shader les lit", () => {
    // Les cinq matières de PAVÉ de la tranche 2 s'ajouteront à la fin de la
    // liste de CHOIX, et leurs huit paramètres à la fin de celle-ci : l'index
    // est persisté dans les presets.
    expect(glass.params.map((p) => p.name)).toEqual([
      "material", "density", "depth", "profile", "flat", "fillet",
      "orientation", "irregularity", "grain", "thickness",
      "specular", "dispersion", "diffusion", "relief",
    ]);
  });

  it("propose neuf matières, et non huit — la note de reprise se trompait", () => {
    // Dix branches dans la source, moins `beton` que son auteur a retiré. Le
    // compte de la note (« 8 matières ») venait d'un souvenir, pas du code, et
    // il aurait fait livrer une matière de moins sans que rien ne le signale.
    const mat = glass.params.find((p) => p.name === "material");
    expect(mat?.choices).toHaveLength(9);
    expect(mat?.choices?.[0]).toBe("Cannelé simple");
    expect(mat?.choices?.[8]).toBe("Cathédrale");
    expect(mat?.choices).not.toContain("Béton");
  });

  it("propose cinq profils de section, et non six", () => {
    // Même erreur, même cause : `pente()` a quatre `if` et un `else`.
    const prof = glass.params.find((p) => p.name === "profile");
    expect(prof?.choices).toEqual(["Arc doux", "Arc plein", "Prisme", "Fond plat", "Bourrelet"]);
  });

  it("dit dans quel cas chaque réglage restreint est SANS OBJET", () => {
    // Un curseur inerte est l'échec silencieux que ce dépôt proscrit, et c'est
    // le seul garde-fou disponible tant que `ParamPanel` ne sait pas masquer un
    // contrôle. Trois réglages ne sont lus que par `pente()`/`bosse()`, donc ne
    // concernent que les trois premières matières.
    for (const nom of ["profile", "fillet"]) {
      expect(glass.params.find((p) => p.name === nom)?.hint).toMatch(/Sans objet/);
    }
    // Le dépoli n'a aucun galbe : son creux ne fait rien, sa diffusion tout.
    expect(glass.params.find((p) => p.name === "depth")?.hint).toMatch(/Sans objet en Dépoli/);
  });
});

describe("glass — les deux corrections payées à la première exécution", () => {
  it("reprend les facteurs de densité de la SOURCE, sans les réajuster", () => {
    // PREMIÈRE CORRECTION. Les avoir « adaptés » au portage a rendu le martelé
    // à 2,7 cellules pour ~27 attendues, et la cathédrale quarante fois trop
    // grossière — les deux compilaient, les deux rendaient quelque chose de
    // plausible, et aucun test unitaire n'aurait pu le dire. Ils sont calés par
    // mesure sur des produits réels ; ce test les fige.
    expect(wgsl).toContain("max(n * 1.6, 0.05)");   // cathédrale
    expect(wgsl).toContain("max(n * 0.30, 1.0)");   // martelé / écorce
    expect(wgsl).toContain("max(n * 0.16, 1.0)");   // aluminium
    expect(wgsl).toContain("max(n * 0.022, 0.05)"); // poli
  });

  it("laisse à l'épaisseur la course qu'exigent les matières à FACETTES", () => {
    // SECONDE CORRECTION. Le plafond posé à 0,5 rendait l'aluminium et le
    // martelé quasi inertes : une facette incline de ~0,09, soit UN pixel de
    // déplacement — deux niveaux de ton sur une rampe. Les cannelures, elles,
    // s'en sortaient, parce qu'un profil en arc a une pente qui DIVERGE au bord
    // de la cellule. Le même curseur doit couvrir les deux régimes.
    const ep = glass.params.find((p) => p.name === "thickness");
    expect(ep?.max).toBe(2);
    // Et l'absorption qui lui est couplée reste lisible sur toute la course :
    // au facteur 6 du premier jet, une épaisseur de 1,6 rendait un vert
    // bouteille sur l'image entière.
    expect(wgsl).toContain("epaisseur * 1.2 * (1.0 + (1.0 - cosi) * 2.2)");
  });

  it("n'utilise aucun mot réservé de WGSL comme nom de variable", () => {
    // Quatrième occurrence du piège dans ce dossier après `trait`, `active` et
    // `smooth` : `ref` est réservé, et le compilateur le refuse. Attrapé par
    // `npm run test:gpu-shaders`, jamais par tsc, qui ne voit qu'une chaîne.
    expect(wgsl).toContain("let refVert = verre_lire(uv + d);");
    expect(wgsl).not.toMatch(/\blet ref\b/);
  });
});

describe("glass — l'optique, et ce qui la sépare d'un portage naïf", () => {
  it("réfracte avec le ratio air->verre, jamais son inverse", () => {
    // Avec eta > 1 la réflexion totale devient possible, et elle survenait : des
    // plaques entières de l'image basculaient en blanc sur les flancs raides.
    expect(wgsl).toContain("let eta = 1.0 / 1.52;");
    expect(wgsl).toContain("refract(I, N, eta)");
  });

  it("disperse par l'INDICE et non par le déplacement, et dans le bon sens", () => {
    // `d * (1 ± disp)` multiplie le déplacement TOTAL, qui croît avec
    // l'épaisseur : les trois canaux vont alors lire trois endroits éloignés et
    // leur moyenne rend un barbouillage — un verre qui paraît flou alors que sa
    // surface est nette. Ici seul l'indice varie, donc la séparation suit
    // l'ANGLE de réfraction : nulle sur les plats, visible sur les flancs.
    expect(wgsl).toContain("refract(I, N, 1.0 / (1.52 - demi))");
    expect(wgsl).toContain("refract(I, N, 1.0 / (1.52 + demi))");
    // L'indice DÉCROÎT avec la longueur d'onde : le rouge prend l'indice le plus
    // bas et dévie le moins. La première version de la source faisait l'inverse.
    expect(wgsl).toMatch(/let Tr = refract\(I, N, 1\.0 \/ \(1\.52 - demi\)\)/);
  });

  it("étale la traversée LATÉRALEMENT, sinon ce n'est pas un flou", () => {
    // Neuf taps alignés font neuf copies décalées, et la striure sur l'axe du
    // décalage trahit le procédé à l'œil nu. Le terme coûte zéro.
    expect(wgsl).toContain("let lat = sin(t * 9.42) * f * 0.38;");
  });

  it("échantillonne SANS dérivée d'écran — c'est une condition de compilation", () => {
    // La traversée vit sous des grandeurs qui dépendent du pixel, donc un flux
    // de contrôle non uniforme où `textureSample` serait illégal. Rien ici n'a
    // besoin de dérivée : `textureSampleLevel` partout.
    expect(wgsl).toContain("textureSampleLevel(srcTexture, srcSampler, mirrorUv(uv), 0.0)");
    expect(wgsl).not.toMatch(/textureSample\(/);
  });

  it("traite l'absorption en LINÉAIRE et la couleur du reflet en PERCEPTUEL", () => {
    // Deux termes, deux natures. Beer-Lambert est une loi physique : elle
    // multiplie du linéaire tel quel. La couleur du reflet de Fresnel est un ton
    // choisi à l'œil : décodée avant mélange, comme l'encre de duotone.
    expect(wgsl).toContain("exp(-trajet * vec3<f32>(0.055, 0.018, 0.042))");
    expect(wgsl).toContain("srgb_to_linear3(vec3<f32>(0.86, 0.89, 0.95))");
  });

  it("n'atténue que la DÉVIATION quand la présence du relief baisse", () => {
    // À zéro, une dalle plane qui brille encore — ce qu'on ne peut pas obtenir
    // en baissant le creux, qui éteint la matière en même temps que la
    // déformation. Le facteur est sur le déplacement, pas sur la normale.
    expect(wgsl).toContain("* epaisseur * relief;");
    expect(wgsl).toContain("let N = normalize(vec3<f32>(-dh.x, -dh.y, 1.0));");
  });
});

describe("glass — sa place au registre", () => {
  it("est enregistré, et sans passe interne", () => {
    expect(getEffect("glass")).toBe(glass);
    expect(effectRegistry).toContain(glass);
    // Mono-passe : l'optique n'a besoin d'aucune texture intermédiaire, et la
    // tranche 2 n'en demandera pas non plus.
    expect(glass.passes).toBeUndefined();
  });

  it("suit les trois autres effets d'optique, avant les effets de dessin", () => {
    // Un lecteur qui vient de poser `lensDistortion` cherche celui-ci juste à
    // côté : les quatre répondent à « que fait ce verre à l'image ? », par
    // quatre bouts différents.
    const ids = effectRegistry.map((e) => e.id);
    expect(ids.indexOf("lensDistortion")).toBeLessThan(ids.indexOf("glass"));
    expect(ids.indexOf("glass")).toBeLessThan(ids.indexOf("warp"));
  });
});
