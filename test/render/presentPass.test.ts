import { describe, expect, it } from "vitest";
import {
  buildPresentWgsl,
  presentBackgroundFor,
  maskOverlayFor,
  checkerCellPx,
  CHECKER_CELL_SCREEN_PX,
} from "../../src/render/presentPass";

// Tranche T0 (design 2026-07-28 « le fond devient un calque »). Ce qui est
// verrouillé ici est la SÉPARATION écran/export, pas le rendu : le damier est
// un rendu d'écran, il ne doit jamais atteindre un fichier exporté.
describe("presentBackgroundFor", () => {
  it("le canvas reçoit le damier", () => {
    expect(presentBackgroundFor({ kind: "canvas", displayScale: 1 })).toEqual({
      kind: "checker",
      cellPx: CHECKER_CELL_SCREEN_PX,
    });
  });

  it("l'export reçoit du BLANC opaque, JAMAIS le damier", () => {
    // Arbitrage d'Antoine du 2026-07-30, tranché avec un rendu en face
    // (ADR-0006) : « lecture planche contact, le blanc cadre les images au lieu
    // de les avaler ». Le fond d'export était noir jusque-là.
    expect(presentBackgroundFor({ kind: "export" })).toEqual({ kind: "white" });
  });

  it("aucune destination ne peut demander autre chose que ces deux fonds", () => {
    // Le fond n'est pas un paramètre d'appel : il est dérivé de la destination,
    // et `PresentDestination` est un type fermé à deux cas. C'est ce qui rend
    // « le damier dans le JPEG » inexprimable, pas une convention d'appel.
    const kinds = [
      presentBackgroundFor({ kind: "canvas", displayScale: 0.25 }).kind,
      presentBackgroundFor({ kind: "export" }).kind,
    ];
    expect(new Set(kinds)).toEqual(new Set(["checker", "white"]));
  });

  it("le fond d'export ne porte AUCUNE taille de case — le champ n'existe pas", () => {
    // La garde n'est pas « on ne la lit pas » mais « il n'y a rien à lire » :
    // la taille de case vit dans le cas `checker` du type, que l'export ne peut
    // pas obtenir.
    const background = presentBackgroundFor({ kind: "export" });
    expect(Object.keys(background)).toEqual(["kind"]);
  });

  it("la taille de case suit le facteur de réduction du canvas", () => {
    // C'est tout l'objet du correctif : un canvas réduit à un quart rend des
    // cases quatre fois plus grandes en pixels de destination, donc de taille
    // CONSTANTE à l'écran.
    const reduit = presentBackgroundFor({ kind: "canvas", displayScale: 0.25 });
    expect(reduit).toEqual({ kind: "checker", cellPx: CHECKER_CELL_SCREEN_PX * 4 });
  });
});

describe("checkerCellPx", () => {
  it("à l'échelle 1, la case vaut exactement la taille d'écran visée", () => {
    expect(checkerCellPx(1)).toBe(CHECKER_CELL_SCREEN_PX);
  });

  it("compense la réduction CSS : taille à l'écran constante", () => {
    // Le défaut constaté après T1 : 8 px de destination sur une photo de
    // 6240 px réduite pour tenir dans la fenêtre faisaient moins d'un pixel à
    // l'écran. À ce facteur-là, la case doit maintenant se compter en dizaines
    // de pixels de destination.
    const scale = 1200 / 6240;
    expect(checkerCellPx(scale)).toBe(Math.round(CHECKER_CELL_SCREEN_PX / scale));
    expect(checkerCellPx(scale)).toBeGreaterThan(50);
  });

  it("rend un entier — les bords de case tombent sur des pixels", () => {
    expect(Number.isInteger(checkerCellPx(0.37))).toBe(true);
  });

  it("ne descend jamais sous 1 px de destination", () => {
    // Un canvas AGRANDI par la mise en page ne doit pas produire une case de
    // taille nulle (division par zéro visuelle : le damier disparaîtrait).
    expect(checkerCellPx(1000)).toBe(1);
  });

  it("refuse un facteur non mesuré plutôt que de replier sur une valeur", () => {
    for (const invalide of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => checkerCellPx(invalide)).toThrow(/échelle d'affichage invalide/);
    }
  });
});

// Même séparation, autre aide de visée : l'overlay safelight du masque.
// Défaut mesuré le 2026-07-29 (`render-check --diagnostic`) : le voile rouge
// atteignait le JPEG exporté, sur 19,6 % des canaux.
describe("maskOverlayFor", () => {
  it("le canvas garde l'overlay actif", () => {
    expect(maskOverlayFor({ kind: "canvas", displayScale: 1 }, "L0")).toBe("L0");
  });

  it("l'export n'a JAMAIS d'overlay, même quand l'aperçu est actif à l'écran", () => {
    expect(maskOverlayFor({ kind: "export" }, "L0")).toBeNull();
  });

  it("overlay éteint : rien à porter, quelle que soit la destination", () => {
    expect(maskOverlayFor({ kind: "canvas", displayScale: 1 }, null)).toBeNull();
    expect(maskOverlayFor({ kind: "export" }, null)).toBeNull();
  });

  it("aucune destination ne peut demander l'overlay dans un fichier", () => {
    // Comme pour le damier : ce n'est pas une convention d'appel mais le seul
    // chemin qui existe — un appelant ne fournit qu'un `PresentDestination`.
    expect(maskOverlayFor({ kind: "canvas", displayScale: 1 }, "L0")).not.toBeNull();
    expect(maskOverlayFor({ kind: "export" }, "L0")).toBeNull();
  });
});

describe("buildPresentWgsl", () => {
  it("sort toujours un alpha de 1 — la surface finale est opaque par construction", () => {
    for (const bg of ["checker", "white"] as const) {
      expect(buildPresentWgsl(bg)).toContain(
        "return vec4<f32>(src.rgb * src.a + bg * (1.0 - src.a), 1.0);",
      );
    }
  });

  it("le fond d'export est du blanc pur (donc identité quand src.a = 1)", () => {
    const code = buildPresentWgsl("white");
    // 1.0 est la MÊME valeur en sRGB et en linéaire : aucune conversion de gamma
    // ici, contrairement aux deux gris du damier. La cible reste une texture
    // `-srgb` et la règle projet « jamais de gamma manuel » est respectée parce
    // qu'il n'y a rien à convertir, pas parce qu'on l'a omis.
    expect(code).toContain("let bg = vec3<f32>(1.0);");
    // Aucune trace de damier dans la source destinée au fichier — ni la grille,
    // ni l'uniforme qui en porte la taille.
    expect(code).not.toContain("fract");
    expect(code).not.toContain("in.position");
    expect(code).not.toContain("checkerParams");
    expect(code).not.toContain("binding(2)");
  });

  it("le damier est posé en pixels de la DESTINATION, pas en UV d'image", () => {
    const code = buildPresentWgsl("checker");
    expect(code).toContain("let cell = floor(in.position.xy / max(checkerParams.x, 1.0));");
    expect(code).toContain("let odd = step(0.5, fract((cell.x + cell.y) * 0.5));");
  });

  it("la taille de case est un UNIFORME : un seul pipeline pour toutes les échelles", () => {
    // Compilée dans la source, elle recréerait un pipeline par largeur de
    // fenêtre traversée pendant un redimensionnement.
    expect(buildPresentWgsl("checker")).toContain(
      "@group(0) @binding(2) var<uniform> checkerParams: vec4<f32>;",
    );
  });

  it("les gris du damier sont décodés depuis sRGB (cible -srgb, sortie linéaire)", () => {
    // Paire CLAIRE depuis le 2026-08-01 : #ffffff / #cccccc, la grille
    // « moyenne » de Photoshop (décision Antoine sur référence visuelle). Elle
    // était sombre (#323232 / #1b1b1b) et ne se lisait pas comme un damier de
    // transparence — voir le commentaire de `buildPresentWgsl`.
    const code = buildPresentWgsl("checker");
    expect(code).toContain("srgb2lin(mix(vec3<f32>(1.0), vec3<f32>(0.8), odd))");
    expect(code).toContain("fn srgb2lin");
  });

  it("le damier ne franchit jamais la frontière de l'export", () => {
    // Le blanc d'export est le POINT FIXE de la conversion sRGB↔linéaire, donc
    // il ne passe pas par `srgb2lin` — et les gris du damier, eux, n'ont
    // aucune raison d'apparaître dans la source blanche. Éclaircir le damier
    // rapproche ses valeurs de celles de l'export : ce témoin vérifie que les
    // deux sources restent bien distinctes malgré ce rapprochement.
    const blanc = buildPresentWgsl("white");
    expect(blanc).toContain("let bg = vec3<f32>(1.0);");
    expect(blanc).not.toContain("srgb2lin(mix(");
    expect(blanc).not.toContain("checkerParams");
  });

  it("embarque le vertex plein écran et un point d'entrée fragment unique", () => {
    const code = buildPresentWgsl("white");
    expect(code).toContain("fn vs_main");
    expect(code).toContain("fn fs_present");
  });

  it("produit deux sources distinctes (le choix du fond reste du code, pas un uniforme)", () => {
    expect(buildPresentWgsl("checker")).not.toBe(buildPresentWgsl("white"));
  });
});
