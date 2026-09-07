import { describe, it, expect } from "vitest";
import { hitTestAutoSelect } from "../../src/ui/autoSelect";
import type { LayerState, LayerTransform } from "../../src/layers/types";
import type { LayerMask, MaskSource } from "../../src/mask/types";
import { defaultLayerMask } from "../../src/mask/types";

const BG = { width: 1000, height: 1000 };
const PHOTO = { width: 200, height: 100 };
const sizeOf = () => PHOTO;

function photoLayer(id: string, transform: Partial<LayerTransform> = {}, extra: Partial<LayerState> = {}): LayerState {
  return {
    id,
    effectId: "photo",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
    imageSource: { sourceId: `src-${id}` },
    transform: { x: 500, y: 500, scaleX: 1, scaleY: 1, rotation: 0, ...transform },
    ...extra,
  };
}

function effectLayer(id: string, mask: LayerMask = defaultLayerMask(), extra: Partial<LayerState> = {}): LayerState {
  return {
    id,
    effectId: "glow",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask,
    ...extra,
  };
}

/** Raster PINCEAU plein-fond, non nul seulement dans le disque de rayon `r`
 *  autour de `(cx, cy)` — l'espace est celui de la photo de fond (BG). */
function brushRasterDisk(cx: number, cy: number, r: number, value = 255): Uint8Array {
  const raster = new Uint8Array(BG.width * BG.height);
  for (let y = Math.max(0, cy - r); y <= Math.min(BG.height - 1, cy + r); y += 1) {
    for (let x = Math.max(0, cx - r); x <= Math.min(BG.width - 1, cx + r); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) raster[y * BG.width + x] = value;
    }
  }
  return raster;
}

function brushSource(id: string, raster: Uint8Array, combineMode: MaskSource["combineMode"] = "add"): MaskSource {
  return { id, type: "brush", combineMode, enabled: true, params: null, raster };
}

function parametricSource(id: string): MaskSource {
  return { id, type: "gradient", combineMode: "add", enabled: true, params: {}, raster: null };
}

function maskOf(sources: MaskSource[], extra: Partial<LayerMask> = {}): LayerMask {
  return { ...defaultLayerMask(), sources, ...extra };
}

describe("hitTestAutoSelect — genres de couverture", () => {
  it("désigne un calque d'effet SANS masque : il couvre partout", () => {
    const layers = [effectLayer("glow")];
    expect(hitTestAutoSelect(layers, { x: 10, y: 10 }, BG, sizeOf)).toBe("glow");
    expect(hitTestAutoSelect(layers, { x: 990, y: 990 }, BG, sizeOf)).toBe("glow");
  });

  it("désigne un calque photo par sa COUVERTURE (bornes du transform), pas ailleurs", () => {
    const layers = [photoLayer("a")];
    expect(hitTestAutoSelect(layers, { x: 500, y: 500 }, BG, sizeOf)).toBe("a");
    expect(hitTestAutoSelect(layers, { x: 100, y: 100 }, BG, sizeOf)).toBeNull();
  });

  it("un calque d'effet à masque PINCEAU n'est couvert que là où le masque est non nul", () => {
    const layers = [effectLayer("brosse", maskOf([brushSource("b", brushRasterDisk(500, 500, 40))]))];
    expect(hitTestAutoSelect(layers, { x: 500, y: 500 }, BG, sizeOf)).toBe("brosse");
    expect(hitTestAutoSelect(layers, { x: 800, y: 800 }, BG, sizeOf)).toBeNull();
  });

  it("un masque DÉSACTIVÉ fait couvrir partout (l'effet s'applique plein)", () => {
    const mask = maskOf([brushSource("b", brushRasterDisk(500, 500, 40))], { enabled: false });
    const layers = [effectLayer("brosse", mask)];
    expect(hitTestAutoSelect(layers, { x: 800, y: 800 }, BG, sizeOf)).toBe("brosse");
  });

  it("respecte l'INVERSION du masque : couvert HORS du disque peint, pas dedans", () => {
    const mask = maskOf([brushSource("b", brushRasterDisk(500, 500, 40))], { invert: true });
    const layers = [effectLayer("brosse", mask)];
    expect(hitTestAutoSelect(layers, { x: 500, y: 500 }, BG, sizeOf)).toBeNull();
    expect(hitTestAutoSelect(layers, { x: 800, y: 800 }, BG, sizeOf)).toBe("brosse");
  });

  it("combine SUBTRACT : un second trait retire de la couverture du seed", () => {
    const mask = maskOf([
      brushSource("seed", brushRasterDisk(500, 500, 60)),
      brushSource("trou", brushRasterDisk(500, 500, 20), "subtract"),
    ]);
    const layers = [effectLayer("brosse", mask)];
    // Dans le seed mais hors du trou : couvert.
    expect(hitTestAutoSelect(layers, { x: 540, y: 500 }, BG, sizeOf)).toBe("brosse");
    // Au centre, le trou soustrait tout : non couvert.
    expect(hitTestAutoSelect(layers, { x: 500, y: 500 }, BG, sizeOf)).toBeNull();
  });

  it("traite une source PARAMÉTRIQUE (non lisible au CPU) comme couvrant partout", () => {
    const layers = [effectLayer("degrade", maskOf([parametricSource("g")]))];
    expect(hitTestAutoSelect(layers, { x: 10, y: 10 }, BG, sizeOf)).toBe("degrade");
  });
});

describe("hitTestAutoSelect — ordre de pile (haut vers bas)", () => {
  it("rend le calque du HAUT quand deux couvrent le point", () => {
    const layers = [effectLayer("bas"), photoLayer("haut")];
    expect(hitTestAutoSelect(layers, { x: 500, y: 500 }, BG, sizeOf)).toBe("haut");
  });

  it("descend au calque du dessous quand le calque du dessus ne couvre pas ce pixel", () => {
    // Effet en haut, masqué à un disque au centre ; photo en bas couvrant 400..600.
    const haut = effectLayer("haut", maskOf([brushSource("b", brushRasterDisk(500, 500, 20))]));
    const layers = [photoLayer("bas"), haut];
    expect(hitTestAutoSelect(layers, { x: 500, y: 500 }, BG, sizeOf)).toBe("haut");
    // Hors du disque du masque mais dans la photo : c'est le bas qui gagne.
    expect(hitTestAutoSelect(layers, { x: 560, y: 500 }, BG, sizeOf)).toBe("bas");
  });
});

describe("hitTestAutoSelect — verrous et visibilité", () => {
  it("un calque `locks.all` RESTE sélectionnable (photo)", () => {
    const layers = [photoLayer("verrouille", {}, { locks: { all: true } })];
    expect(hitTestAutoSelect(layers, { x: 500, y: 500 }, BG, sizeOf)).toBe("verrouille");
  });

  it("un calque d'effet `locks.all` RESTE sélectionnable", () => {
    const layers = [effectLayer("glow", defaultLayerMask(), { locks: { all: true } })];
    expect(hitTestAutoSelect(layers, { x: 500, y: 500 }, BG, sizeOf)).toBe("glow");
  });

  it("un calque à l'œil ÉTEINT n'est pas sélectionnable et laisse passer au dessous", () => {
    const layers = [effectLayer("visible"), photoLayer("eteint", {}, { enabled: false })];
    expect(hitTestAutoSelect(layers, { x: 500, y: 500 }, BG, sizeOf)).toBe("visible");
  });
});

describe("hitTestAutoSelect — cas dégénérés", () => {
  it("rend null sur une pile vide", () => {
    expect(hitTestAutoSelect([], { x: 500, y: 500 }, BG, sizeOf)).toBeNull();
  });

  it("rend null quand la toile est de taille nulle", () => {
    expect(hitTestAutoSelect([effectLayer("glow")], { x: 0, y: 0 }, { width: 0, height: 0 }, sizeOf)).toBeNull();
  });

  it("rend null pour un point non fini", () => {
    expect(hitTestAutoSelect([effectLayer("glow")], { x: NaN, y: 500 }, BG, sizeOf)).toBeNull();
  });

  it("un clic HORS de la toile ne saisit aucun effet couvrant-partout", () => {
    expect(hitTestAutoSelect([effectLayer("glow")], { x: -5, y: 500 }, BG, sizeOf)).toBeNull();
    expect(hitTestAutoSelect([effectLayer("glow")], { x: 1000, y: 500 }, BG, sizeOf)).toBeNull();
  });

  it("ignore un raster pinceau vidé (projection d'affichage) : compté comme 0", () => {
    // La projection d'affichage remplace les rasters par un Uint8Array(0). Un tel
    // masque non nul déclaré mais vidé ne doit RIEN couvrir — c'est le signal de
    // « ne lis pas la couverture ici », pas un faux hit.
    const mask = maskOf([brushSource("b", new Uint8Array(0))]);
    expect(hitTestAutoSelect([effectLayer("brosse", mask)], { x: 500, y: 500 }, BG, sizeOf)).toBeNull();
  });
});
