import { describe, it, expect } from "vitest";
import { glass } from "../../../src/render/effects/glass";
import { getEffect, effectRegistry } from "../../../src/render/effects/registry";

/**
 * GLASS — la feuille, et rien d'autre depuis ADR-0021.
 *
 * Ce que ces tests gardent n'est PAS le rendu : treize références de pixels s'en
 * chargent, toutes posées sur `mireVerre`. Ils gardent ce que le fichier
 * AFFIRME et qu'aucune image ne dirait — les applicabilités, les facteurs repris
 * de la source, et les deux corrections payées à la première exécution.
 *
 * ⚠️ LES CINQ MATIÈRES DE PAVÉ SONT SORTIES LE 2026-08-27, sur verdict d'usage
 * après quatre refus datés. Ce fichier en portait le contrat à SIX endroits, et
 * c'est la mesure de ce qu'une tranche coûte à retirer.
 */

const wgsl = glass.wgsl;

describe("glass — la surface de contrôle", () => {
  it("déclare quatorze paramètres, les huit de pavé retirés PAR LA FIN", () => {
    // LE POINT QUI REND LE RETRAIT NEUTRE. Les huit réglages de pavé occupaient
    // les index 14 à 21, les huit DERNIERS : les retirer ne déplace donc aucun
    // des quatorze qui restent, ni dans les presets, ni dans le tableau
    // `params` du shader, ni dans les treize références de pixels.
    expect(glass.params.map((p) => p.name)).toEqual([
      "material", "density", "depth", "profile", "flat", "fillet",
      "orientation", "irregularity", "grain", "thickness",
      "specular", "dispersion", "diffusion", "relief",
    ]);
  });

  it("ne propose plus AUCUNE matière de pavé, et garde les neuf feuilles à leur index", () => {
    // GARDE DE RETRAIT, même rôle que celui de `surfaceBlur` et d'`emboss` dans
    // `registry.test.ts` : il rend le retrait CONSCIENT. Réintroduire un pavé
    // oblige à supprimer ces lignes, donc à relire ADR-0021 — qui dit pourquoi
    // quatre refus datés n'ont pas été rattrapés par trois corrections.
    //
    // Les neuf feuilles viennent de dix branches de la source, moins `beton` que
    // son auteur a retiré. Le compte de la note (« 8 matières ») venait d'un
    // souvenir, pas du code, et il aurait fait livrer une matière de moins sans
    // que rien ne le signale.
    const mat = glass.params.find((p) => p.name === "material");
    expect(mat?.choices).toHaveLength(9);
    expect(mat?.choices?.[0]).toBe("Cannelé simple");
    expect(mat?.choices?.[8]).toBe("Cathédrale");
    expect(mat?.choices?.some((c) => /Pav/.test(c)), "aucun pavé au registre (ADR-0021)").toBe(false);
    expect(mat?.choices).not.toContain("Béton");
    // Et le shader ne porte plus une ligne de leur mécanisme : ni la grille de
    // blocs, ni le mortier, ni le moulage interne.
    for (const mort of ["verre_hauteurPave", "verre_mosaiquePave", "masqueMortier", "distanceBord"]) {
      expect(wgsl, `${mort} est parti avec les pavés`).not.toContain(mort);
    }
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
    // Les déclarations éprouvées le 2026-08-05 (`scripts/applicabilite-table.mjs`).
    // On assère la LISTE COMPLÈTE des index et non « contient » : ce qui se perd
    // en masquant trop ne se voit nulle part, donc un test qui n'attrape que
    // l'oubli ne garde que la moitié du risque.
    //
    // ⚠️ ELLES ÉTAIENT QUATORZE ; il en reste SIX. Les huit qui manquent sont
    // les réglages de pavé, tous conditionnés aux cinq matières retirées par
    // ADR-0021 — une condition dont la liste positive serait devenue vide.
    const applicabilite = (nom: string) => {
      const condition = glass.params.find((p) => p.name === nom)?.appliesWhen;
      expect(condition?.param, `${nom} doit être commandé par la matière`).toBe("material");
      return condition?.equals;
    };
    const CANNELURES = [0, 1, 2];
    const SAUF = (...exclues: number[]) => [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => !exclues.includes(i));

    expect(applicabilite("density")).toEqual(SAUF(6, 7));       // ni Poli ni Dépoli
    expect(applicabilite("depth")).toEqual(SAUF(7));            // pas de galbe au Dépoli
    expect(applicabilite("profile")).toEqual(CANNELURES);       // lus par pente()/bosse() seules
    expect(applicabilite("fillet")).toEqual(CANNELURES);
    expect(applicabilite("orientation")).toEqual(SAUF(1, 2, 3, 5, 6, 7));
    expect(applicabilite("irregularity")).toEqual(SAUF(6, 7));
    // Et aucun réglage de pavé ne subsiste pour en porter une.
    for (const mort of ["blockSize", "mortar", "mortarHue", "mortarLightness", "edgeDepth", "edgeWidth", "bevel", "inner"]) {
      expect(glass.params.find((p) => p.name === mort), `${mort} est parti avec les pavés`).toBeUndefined();
    }
  });

  it("masque `flat` sur les huit matières MESURÉES inertes, et pas une de plus", () => {
    // LA RAISON D'ÊTRE DE LA CAMPAGNE DE MESURE, et son aboutissement.
    //
    // `flat` disait « Sans objet ailleurs » et déplace 47,1 % des canaux en
    // Martelé, 49,0 % en Écorce, où il règle la largeur de la rainure entre
    // cellules. Le masquer sur la foi de cette phrase l'aurait effacé SANS RIEN
    // FAIRE ROUGIR : un curseur masqué ne bouge plus aucun pixel, donc aucune
    // référence de rendu ne l'aurait vu. Ce test a donc gardé `flat` VISIBLE
    // PARTOUT du 2026-08-04 au 2026-08-18 — la seule position tenable tant que
    // personne ne savait où il agissait vraiment.
    //
    // Il est masqué aujourd'hui parce que la question a été MESURÉE, pas parce
    // qu'on a fini par croire l'infobulle : `node scripts/render-check.mjs
    // --applicabilite --declaration glass.flat` a éprouvé les HUIT matières
    // exclues une par une — Poli, Dépoli, Cathédrale et les cinq pavés — et rendu
    // « inerte » sur les huit. La couverture était complète par construction,
    // aucune n'était masquée sur une déduction.
    //
    // ⚠️ ADR-0021 a emporté cinq des huit. Il en reste TROIS à masquer (6, 7, 8),
    // et ce sont trois de celles que la mesure a vues : le retrait n'a donc pas
    // laissé une seule exclusion non mesurée derrière lui. La liste positive,
    // elle, est INCHANGÉE — `flat` est lu par les matières 0 à 5, qui restent
    // toutes.
    const flat = glass.params.find((p) => p.name === "flat");
    expect(flat?.appliesWhen?.param).toBe("material");
    expect(flat?.appliesWhen?.equals, "les six matières qui LISENT flat").toEqual([0, 1, 2, 3, 4, 5]);
    // Et son infobulle ne redit plus le mensonge : elle nomme ses trois sens.
    expect(flat?.hint).not.toMatch(/Sans objet ailleurs/);
    expect(flat?.hint).toMatch(/RAINURE/);
    expect(flat?.hint).toMatch(/BROSSAGE/);
    // Le shader, lui, le lit bien dans la branche Martelé/Écorce : c'est la
    // largeur de rainure, et c'est cette ligne que la mesure a désignée.
    expect(wgsl).toContain("let rainure = mix(0.06, 0.40, 1.0 - plat);");
  });

  it("range ses quatorze réglages en deux sections, sans toucher à params[]", () => {
    // Les sections sont une donnée d'AFFICHAGE : l'index d'un paramètre est
    // persisté dans les presets. Ce qui se vérifie ici est que les deux
    // sections sont deux blocs CONTIGUS de `params[]` dans son ordre d'origine
    // — la condition posée par `groupEffectParams`, qui s'appuie sur cet ordre
    // en deux endroits et ne survivrait pas à une section qui en traverse une
    // autre.
    const noms = glass.params.map((p) => p.name);
    const sections = glass.sections!;
    expect(sections.map((s) => s.id)).toEqual(["matiere", "optique"]);
    expect(sections.flatMap((s) => s.params)).toEqual(noms);

    // ⚠️ PLUS AUCUNE CONDITION DE SECTION. La troisième, « Pavé », était la
    // seule à en porter une, et elle est partie avec les cinq matières qui la
    // rendaient vraie (ADR-0021) : les neuf qui restent ont toutes une matière
    // et une optique, donc les deux sections s'appliquent toujours.
    expect(sections.every((s) => s.appliesWhen === undefined)).toBe(true);
    // GRILLE pour la matière, liste pour l'optique.
    //
    // ⚠️ « Matière » est passée de `liste` à `grille` le 2026-08-18 (ticket 16) :
    // ses neuf rangées en une colonne en faisaient la deuxième section la plus
    // haute du parc, et le levier du front s'est révélé être le GABARIT et non le
    // découpage — deux colonnes rendent les mêmes réglages en cinq lignes.
    //
    // « Optique » reste en liste : cinq lignes, sous le plafond, et rien à gagner
    // à la resserrer.
    expect(sections.map((s) => s.layout)).toEqual(["grille", "liste"]);
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

  it("ne lit plus AUCUN index au-delà du quatorzième paramètre", () => {
    // CE TEST REMPLACE « porte le biseau, l'arête et le mortier des pavés ».
    // Ce qu'il garde est ce que la garde de câblage ne dit pas : elle vérifie
    // que chaque paramètre DÉCLARÉ est lu à son index, jamais qu'aucun index
    // ORPHELIN ne survit. Un `params[18]` resté dans le shader après le retrait
    // lirait un uniform que plus personne n'écrit — donc la valeur du calque
    // précédent, ou zéro, sans qu'aucun gate ne bronche.
    const index = [...wgsl.matchAll(/params\[(\d+)\]/g)].map((m) => Number(m[1]));
    expect(index.length, "le shader lit toujours ses paramètres").toBeGreaterThan(0);
    expect(Math.max(...index)).toBeLessThan(glass.params.length);
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
    // ⚠️ ON ASSERTE L'INVARIANT, PAS LA LIGNE. Cette assertion citait l'appel
    // entier (`let refVert = verre_lire(uv + d);`) et a rougi le 2026-08-17 pour
    // une raison sans rapport avec ce qu'elle protège : `verre_lire` a pris un
    // second argument (le niveau de mipmap, ticket 19). Un test qui casse quand
    // le code change POUR UNE AUTRE RAISON coûte une enquête à chaque fois et
    // finit par être neutralisé sans qu'on regarde ce qu'il disait.
    //
    // Ce qui compte est double, et se dit sans citer la ligne : la variable
    // existe sous son nom non réservé, et `ref` nu n'apparaît nulle part.
    expect(wgsl).toMatch(/\blet refVert\b/);
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
    //
    // ⚠️ LE NIVEAU N'EST PLUS UNE CONSTANTE, et l'assertion ne doit donc plus en
    // citer une. Elle exigeait `..., mirrorUv(uv), 0.0)` jusqu'au 2026-08-17 ;
    // depuis le ticket 19 le niveau est DÉRIVÉ de l'étalement, et geler `0.0`
    // ici aurait interdit précisément le changement qui divise le coût par
    // ~3,9. Ce que ce test protège est l'ABSENCE de dérivée d'écran, pas la
    // valeur du niveau.
    expect(wgsl).toMatch(/textureSampleLevel\(srcTexture, srcSampler, mirrorUv\(uv\), \w+\)/);
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
    // Mono-passe : l'optique n'a besoin d'aucune texture intermédiaire — la
    // tranche 2 des pavés n'en avait pas demandé non plus, et elle est partie
    // sans rien laisser derrière elle (ADR-0021).
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
