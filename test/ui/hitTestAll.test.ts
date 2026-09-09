import { describe, it, expect } from "vitest";
import { hitTestAll } from "../../src/ui/autoSelect";
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
 *  autour de `(cx, cy)` — espace de la photo de fond (BG). */
function brushRasterDisk(cx: number, cy: number, r: number, value = 255): Uint8Array {
  const raster = new Uint8Array(BG.width * BG.height);
  for (let y = Math.max(0, cy - r); y <= Math.min(BG.height - 1, cy + r); y += 1) {
    for (let x = Math.max(0, cx - r); x <= Math.min(BG.width - 1, cx + r); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) raster[y * BG.width + x] = value;
    }
  }
  return raster;
}

function brushSource(id: string, raster: Uint8Array): MaskSource {
  return { id, type: "brush", combineMode: "add", enabled: true, params: null, raster };
}

function maskOf(sources: MaskSource[], extra: Partial<LayerMask> = {}): LayerMask {
  return { ...defaultLayerMask(), sources, ...extra };
}

describe("hitTestAll — liste des couvrants du haut vers le bas", () => {
  it("rend une liste VIDE sur une pile vide", () => {
    expect(hitTestAll([], { x: 500, y: 500 }, BG, sizeOf)).toEqual([]);
  });

  it("une seule photo couvrante : liste à un id ; hors couverture : vide", () => {
    const layers = [photoLayer("a")];
    expect(hitTestAll(layers, { x: 500, y: 500 }, BG, sizeOf)).toEqual(["a"]);
    expect(hitTestAll(layers, { x: 100, y: 100 }, BG, sizeOf)).toEqual([]);
  });

  it("TOUS les couvrants, du plus haut au plus bas", () => {
    // Ordre du MODÈLE : index 0 = bas. Photo en bas, effet plein cadre au-dessus,
    // second effet plein cadre tout en haut → attendu haut→bas.
    const layers = [photoLayer("photo"), effectLayer("effetBas"), effectLayer("effetHaut")];
    expect(hitTestAll(layers, { x: 500, y: 500 }, BG, sizeOf)).toEqual(["effetHaut", "effetBas", "photo"]);
  });

  it("un effet PLACÉ (masque pinceau) n'est listé que SUR son point, pas hors de lui", () => {
    const place = effectLayer("place", maskOf([brushSource("b", brushRasterDisk(500, 500, 40))]));
    const layers = [photoLayer("photo"), place];
    // Sur le disque peint : l'effet placé ET la photo sont sous le point.
    expect(hitTestAll(layers, { x: 500, y: 500 }, BG, sizeOf)).toEqual(["place", "photo"]);
    // Hors du disque, mais dans la photo : seule la photo reste.
    expect(hitTestAll(layers, { x: 560, y: 500 }, BG, sizeOf)).toEqual(["photo"]);
  });

  it("un effet PLEIN CADRE (sans masque) est TOUJOURS listé, où qu'on clique dans la toile", () => {
    const layers = [effectLayer("pleinCadre")];
    expect(hitTestAll(layers, { x: 10, y: 10 }, BG, sizeOf)).toEqual(["pleinCadre"]);
    expect(hitTestAll(layers, { x: 990, y: 990 }, BG, sizeOf)).toEqual(["pleinCadre"]);
  });

  it("un calque DÉSACTIVÉ (œil éteint) est exclu de la liste", () => {
    const layers = [effectLayer("visible"), photoLayer("eteint", {}, { enabled: false })];
    expect(hitTestAll(layers, { x: 500, y: 500 }, BG, sizeOf)).toEqual(["visible"]);
  });

  it("un masque pinceau VIDÉ (projection d'affichage) ne couvre RIEN — compté 0", () => {
    const mask = maskOf([brushSource("b", new Uint8Array(0))]);
    expect(hitTestAll([effectLayer("brosse", mask)], { x: 500, y: 500 }, BG, sizeOf)).toEqual([]);
  });

  it("un masque pinceau PLEIN (disque) couvre là où il est peint", () => {
    const mask = maskOf([brushSource("b", brushRasterDisk(500, 500, 40))]);
    const layers = [effectLayer("brosse", mask)];
    expect(hitTestAll(layers, { x: 500, y: 500 }, BG, sizeOf)).toEqual(["brosse"]);
    expect(hitTestAll(layers, { x: 800, y: 800 }, BG, sizeOf)).toEqual([]);
  });

  it("un calque verrouillé RESTE dans la liste (les verrous ne sont pas consultés)", () => {
    const layers = [photoLayer("verrouille", {}, { locks: { all: true } })];
    expect(hitTestAll(layers, { x: 500, y: 500 }, BG, sizeOf)).toEqual(["verrouille"]);
  });

  it("rend vide pour une toile de taille nulle ou un point non fini", () => {
    expect(hitTestAll([effectLayer("glow")], { x: 0, y: 0 }, { width: 0, height: 0 }, sizeOf)).toEqual([]);
    expect(hitTestAll([effectLayer("glow")], { x: NaN, y: 500 }, BG, sizeOf)).toEqual([]);
  });

  it("un clic HORS de la toile ne saisit aucun effet couvrant-partout", () => {
    expect(hitTestAll([effectLayer("glow")], { x: -5, y: 500 }, BG, sizeOf)).toEqual([]);
    expect(hitTestAll([effectLayer("glow")], { x: 1000, y: 500 }, BG, sizeOf)).toEqual([]);
  });
});
