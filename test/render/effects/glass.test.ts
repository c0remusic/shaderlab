import { describe, it, expect } from "vitest";
import { glass } from "../../../src/render/effects/glass";
import { getEffect, effectRegistry } from "../../../src/render/effects/registry";

/**
 * GLASS — feuille et pavés.
 *
 * Ce que ces tests gardent n'est PAS le rendu : six références de pixels s'en
 * chargent, toutes posées sur `mireVerre`. Ils gardent ce que le fichier
 * AFFIRME et qu'aucune image ne dirait — les applicabilités, les facteurs repris
 * de la source, et les deux corrections payées à la première exécution.
 */

const wgsl = glass.wgsl;

describe("glass — la surface de contrôle", () => {
  it("déclare vingt-deux paramètres, pavés ajoutés à la fin pour préserver les presets", () => {
    // Les cinq matières de PAVÉ de la tranche 2 s'ajouteront à la fin de la
    // liste de CHOIX, et leurs huit paramètres à la fin de celle-ci : l'index
    // est persisté dans les presets.
    expect(glass.params.map((p) => p.name)).toEqual([
      "material", "density", "depth", "profile", "flat", "fillet",
      "orientation", "irregularity", "grain", "thickness",
      "specular", "dispersion", "diffusion", "relief",
      "blockSize", "mortar", "mortarHue", "mortarLightness",
      "edgeDepth", "edgeWidth", "bevel", "inner",
    ]);
  });

  it("propose les neuf feuilles puis les cinq pavés, sans déplacer les anciens indices", () => {
    // Dix branches dans la source, moins `beton` que son auteur a retiré. Le
    // compte de la note (« 8 matières ») venait d'un souvenir, pas du code, et
    // il aurait fait livrer une matière de moins sans que rien ne le signale.
    const mat = glass.params.find((p) => p.name === "material");
    expect(mat?.choices).toHaveLength(14);
    expect(mat?.choices?.[0]).toBe("Cannelé simple");
    expect(mat?.choices?.[8]).toBe("Cathédrale");
    expect(mat?.choices?.slice(9)).toEqual([
      "Pavé · Nuage", "Pavé · Ondulé", "Pavé · Quadrillé", "Pavé · Alvéolaire", "Pavé · Lisse",
    ]);
    expect(mat?.choices).not.toContain("Béton");
  });

  it("propose cinq profils de section, et non six", () => {
    // Même erreur, même cause : `pente()` a quatre `if` et un `else`.
    const prof = glass.params.find((p) => p.name === "profile");
    expect(prof?.choices).toEqual(["Arc doux", "Arc plein", "Prisme", "Fond plat", "Bourrelet"]);
  });

  it("dit dans quel cas chaque réglage restreint est SANS OBJET", () => {
    // Un curseur inerte est l'échec silencieux que ce dépôt proscrit. L'infobulle
    // dit POURQUOI, l'`appliesWhen` ci-dessous ne dit que QUE : porter la
    // déclaration vers le contrat de masquage n'autorise pas à retirer le texte,
    // et ce test garde les deux ensemble.
    for (const nom of ["profile", "fillet"]) {
      expect(glass.params.find((p) => p.name === nom)?.hint).toMatch(/Sans objet/);
    }
    // Le dépoli n'a aucun galbe : son creux ne fait rien, sa diffusion tout.
    expect(glass.params.find((p) => p.name === "depth")?.hint).toMatch(/Sans objet en Dépoli/);
  });

  it("masque chaque réglage restreint sur EXACTEMENT les matières mesurées", () => {
    // Les quatorze déclarations éprouvées le 2026-08-05 (74 rendus,
    // `scripts/applicabilite-table.mjs`). On assère la LISTE COMPLÈTE des index
    // et non « contient » : ce qui se perd en masquant trop ne se voit nulle
    // part, donc un test qui n'attrape que l'oubli ne garde que la moitié du
    // risque.
    const applicabilite = (nom: string) => {
      const condition = glass.params.find((p) => p.name === nom)?.appliesWhen;
      expect(condition?.param, `${nom} doit être commandé par la matière`).toBe("material");
      return condition?.equals;
    };
    const CANNELURES = [0, 1, 2];
    const PAVES = [9, 10, 11, 12, 13];
    const SAUF = (...exclues: number[]) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].filter((i) => !exclues.includes(i));

    expect(applicabilite("density")).toEqual(SAUF(6, 7));       // ni Poli ni Dépoli
    expect(applicabilite("depth")).toEqual(SAUF(7));            // pas de galbe au Dépoli
    expect(applicabilite("profile")).toEqual(CANNELURES);       // lus par pente()/bosse() seules
    expect(applicabilite("fillet")).toEqual(CANNELURES);
    expect(applicabilite("orientation")).toEqual(SAUF(1, 2, 3, 5, 6, 7));
    expect(applicabilite("irregularity")).toEqual(SAUF(6, 7));
    for (const nom of ["blockSize", "mortar", "mortarHue", "mortarLightness", "edgeDepth", "edgeWidth", "bevel", "inner"]) {
      expect(applicabilite(nom), `${nom} n'existe que sur un pavé`).toEqual(PAVES);
    }
  });

  it("laisse `flat` VISIBLE partout — c'est le seul des trente-neuf qui mentait", () => {
    // LA RAISON D'ÊTRE DE LA CAMPAGNE DE MESURE. `flat` disait « Sans objet
    // ailleurs » et déplace 47,1 % des canaux en Martelé, 49,0 % en Écorce, où
    // il règle la largeur de la rainure entre cellules. Le masquer sur la foi de
    // cette phrase l'aurait effacé SANS RIEN FAIRE ROUGIR : un curseur masqué ne
    // bouge plus aucun pixel, donc aucune référence de rendu ne l'aurait vu.
    const flat = glass.params.find((p) => p.name === "flat");
    expect(flat?.appliesWhen, "flat n'est masqué nulle part").toBeUndefined();
    // Et son infobulle ne redit plus le mensonge : elle nomme ses trois sens.
    expect(flat?.hint).not.toMatch(/Sans objet ailleurs/);
    expect(flat?.hint).toMatch(/RAINURE/);
    expect(flat?.hint).toMatch(/BROSSAGE/);
    // Le shader, lui, le lit bien dans la branche Martelé/Écorce : c'est la
    // largeur de rainure, et c'est cette ligne que la mesure a désignée.
    expect(wgsl).toContain("let rainure = mix(0.06, 0.40, 1.0 - plat);");
  });

  it("range ses vingt-deux réglages en trois sections, sans toucher à params[]", () => {
    // Les sections sont une donnée d'AFFICHAGE : l'index d'un paramètre est
    // persisté dans les presets. Ce qui se vérifie ici est que les trois
    // sections sont trois blocs CONTIGUS de `params[]` dans son ordre d'origine
    // — la condition posée par `groupEffectParams`, qui s'appuie sur cet ordre
    // en deux endroits et ne survivrait pas à une section qui en traverse une
    // autre.
    const noms = glass.params.map((p) => p.name);
    const sections = glass.sections!;
    expect(sections.map((s) => s.id)).toEqual(["matiere", "optique", "pave"]);
    expect(sections.flatMap((s) => s.params)).toEqual(noms);

    // Seule la troisième a une condition : les quatorze matières ont toutes une
    // matière et une optique, cinq seulement ont un pavé.
    expect(sections[0].appliesWhen).toBeUndefined();
    expect(sections[1].appliesWhen).toBeUndefined();
    expect(sections[2].appliesWhen).toEqual({ param: "material", equals: [9, 10, 11, 12, 13] });
    // GRILLE pour les huit réglages courts du pavé, liste pour les deux étages
    // du shader (fabriquer la pente, puis ce qui est commun aux quatorze).
    expect(sections.map((s) => s.layout)).toEqual(["liste", "liste", "grille"]);
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
    expect(wgsl).toContain("let dens = 0.35;");       // poli, échelle fixe
  });

  it("rend le Poli réellement indépendant de Densité", () => {
    const poli = wgsl.slice(wgsl.indexOf("if (mat == 6)"), wgsl.indexOf("if (mat == 8)"));
    expect(poli).not.toMatch(/\bn\b/);
  });

  it("porte le biseau, l'arête et le mortier des pavés", () => {
    expect(wgsl).toContain("fn verre_hauteurPave");
    expect(wgsl).toContain("distanceBord");
    expect(wgsl).toContain("masqueMortier");
    expect(wgsl).toContain("params[21]");
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

  it("étale la traversée EN DEUX DIMENSIONS, sinon ce n'est pas un flou", () => {
    // L'intention est inchangee depuis le premier jour : des taps alignes font
    // des copies decalees, et la striure sur l'axe du decalage trahit le procede
    // a l'oeil nu. Ce qui a change le 2026-08-13, c'est la façon de l'obtenir.
    //
    // AVANT : neuf taps sur un SEGMENT, plus un decalage lateral sinusoidal
    // ajoute apres coup pour rompre l'alignement. Ce test assertait ce terme
    // correctif MOT POUR MOT (`sin(t * 9.42) * f * 0.38`), donc il verrouillait
    // une IMPLEMENTATION et non la propriete — il rougissait pour une methode
    // qui tient l'intention strictement mieux.
    //
    // APRES : une spirale d'or, isotrope PAR CONSTRUCTION (rayon en racine de
    // la fraction, angle par multiples de l'angle d'or), ponderee en gaussienne
    // — ce que decrivent les references sur un verre sable, dont la diffusion
    // est gaussienne et sans direction privilegiee.
    //
    // On asserte donc les deux proprietes, pas les constantes : l'offset porte
    // sur DEUX axes a la fois, et le poids decroit avec le rayon.
    expect(wgsl).toMatch(/vec2<f32>\(cos\(a\), sin\(a\)\) \* rayon \* f/);
    expect(wgsl).toContain("let rayon = sqrt(fraction);");
    expect(wgsl).toContain("let poids = exp(-2.0 * fraction);");
    // Et le contre-exemple : plus aucun etalement sur un seul axe.
    expect(wgsl).not.toContain("vec2<f32>(t * f, lat)");
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
