import { describe, it, expect } from "vitest";
import { hitTestPhotoLayer } from "../../src/ui/hitTest";
import type { LayerState, LayerTransform } from "../../src/layers/types";

const BG = { width: 1000, height: 1000 };
const PHOTO = { width: 200, height: 100 };

/** Calque photo minimal — seuls les champs lus par le hit-test comptent, mais
 *  le type reste `LayerState` (le module lit la VRAIE pile, pas une copie
 *  parallèle). */
function photoLayer(id: string, transform: Partial<LayerTransform> = {}, extra: Partial<LayerState> = {}): LayerState {
  return {
    id,
    effectId: "photo",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: { sources: [] } as unknown as LayerState["mask"],
    imageSource: { sourceId: `src-${id}` },
    transform: { x: 500, y: 500, scaleX: 1, scaleY: 1, rotation: 0, ...transform },
    ...extra,
  };
}

/** Calque d'effet : ni `imageSource` ni `transform`. */
function effectLayer(id: string, extra: Partial<LayerState> = {}): LayerState {
  return {
    id,
    effectId: "glow",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: { sources: [] } as unknown as LayerState["mask"],
    ...extra,
  };
}

/** Toutes les photos font PHOTO, sauf indication contraire. */
const sizeOf = () => PHOTO;

describe("hitTestPhotoLayer — géométrie", () => {
  it("rend le calque quand le point tombe DANS la photo", () => {
    const layers = [photoLayer("a")];
    expect(hitTestPhotoLayer(layers, { x: 500, y: 500 }, BG, sizeOf)).toBe("a");
  });

  it("rend null quand le point tombe HORS de la photo", () => {
    const layers = [photoLayer("a")];
    // La photo occupe x 400..600, y 450..550 (200x100 centrée en 500,500).
    expect(hitTestPhotoLayer(layers, { x: 100, y: 100 }, BG, sizeOf)).toBeNull();
  });

  it("respecte la translation : le point suit la photo déplacée", () => {
    const layers = [photoLayer("a", { x: 200, y: 200 })];
    expect(hitTestPhotoLayer(layers, { x: 500, y: 500 }, BG, sizeOf)).toBeNull();
    expect(hitTestPhotoLayer(layers, { x: 200, y: 200 }, BG, sizeOf)).toBe("a");
  });

  it("respecte l'échelle : un point hors de la photo à l'échelle 1 entre dedans à l'échelle 4", () => {
    expect(hitTestPhotoLayer([photoLayer("a")], { x: 850, y: 500 }, BG, sizeOf)).toBeNull();
    expect(hitTestPhotoLayer([photoLayer("a", { scaleX: 4, scaleY: 4 })], { x: 850, y: 500 }, BG, sizeOf)).toBe("a");
  });

  it("respecte la rotation : un coin de la box non tournée sort de la box tournée à 90°", () => {
    // Photo 200x100 centrée : sans rotation le point (590, 500) est dedans
    // (x < 600) ; à 90° la box devient 100x200 (x 450..550) et il en sort.
    expect(hitTestPhotoLayer([photoLayer("a")], { x: 590, y: 500 }, BG, sizeOf)).toBe("a");
    expect(hitTestPhotoLayer([photoLayer("a", { rotation: Math.PI / 2 })], { x: 590, y: 500 }, BG, sizeOf)).toBeNull();
    // ...et le point symétrique, hors box non tournée, entre dans la box tournée.
    expect(hitTestPhotoLayer([photoLayer("a")], { x: 500, y: 590 }, BG, sizeOf)).toBeNull();
    expect(hitTestPhotoLayer([photoLayer("a", { rotation: Math.PI / 2 })], { x: 500, y: 590 }, BG, sizeOf)).toBe("a");
  });

  it("géométrie STRICTE au bord : le dernier pixel dedans touche, le premier dehors non", () => {
    // Arbitrage n°1 : la couverture sub-pixel du rendu (rampe d'un demi-pixel,
    // `render/photoLayerInput.ts`) n'ouvre PAS de zone de tolérance — le hit-test
    // utilise exactement les bornes du prédicat de rendu, pas un seuil.
    const layers = [photoLayer("a")];
    expect(hitTestPhotoLayer(layers, { x: 599.9, y: 500 }, BG, sizeOf)).toBe("a");
    expect(hitTestPhotoLayer(layers, { x: 600, y: 500 }, BG, sizeOf)).toBeNull();
    expect(hitTestPhotoLayer(layers, { x: 400, y: 500 }, BG, sizeOf)).toBe("a");
    expect(hitTestPhotoLayer(layers, { x: 399.9, y: 500 }, BG, sizeOf)).toBeNull();
  });
});

describe("hitTestPhotoLayer — ordre de pile", () => {
  // Convention du modèle : index 0 = BAS de pile (cf. `bottomPhotoSourceId`,
  // src/layers/photoLayer.ts). Le parcours va donc de la FIN vers le début.
  it("rend le calque du HAUT quand deux photos se recouvrent", () => {
    const layers = [photoLayer("dessous"), photoLayer("dessus")];
    expect(hitTestPhotoLayer(layers, { x: 500, y: 500 }, BG, sizeOf)).toBe("dessus");
  });

  it("rend le calque du dessous quand seul lui couvre le point", () => {
    const layers = [photoLayer("dessous"), photoLayer("dessus", { x: 100, y: 100 })];
    expect(hitTestPhotoLayer(layers, { x: 500, y: 500 }, BG, sizeOf)).toBe("dessous");
  });

  it("descend la pile jusqu'au premier calque touché (trois photos)", () => {
    const layers = [photoLayer("bas"), photoLayer("milieu", { x: 100, y: 100 }), photoLayer("haut", { x: 900, y: 900 })];
    expect(hitTestPhotoLayer(layers, { x: 500, y: 500 }, BG, sizeOf)).toBe("bas");
    expect(hitTestPhotoLayer(layers, { x: 100, y: 100 }, BG, sizeOf)).toBe("milieu");
    expect(hitTestPhotoLayer(layers, { x: 900, y: 900 }, BG, sizeOf)).toBe("haut");
  });
});

describe("hitTestPhotoLayer — ce qui n'est pas saisissable", () => {
  it("ignore les calques d'effet (ni imageSource ni transform)", () => {
    const layers = [photoLayer("photo"), effectLayer("glow")];
    expect(hitTestPhotoLayer(layers, { x: 500, y: 500 }, BG, sizeOf)).toBe("photo");
  });

  it("ignore une photo à l'œil ÉTEINT et laisse passer le clic au calque en dessous", () => {
    // Arbitrage n°2 : invisible = non désignable. Sinon un calque qu'on ne voit
    // pas bloquerait la sélection de celui qu'on voit, sans explication.
    const layers = [photoLayer("visible"), photoLayer("eteint", {}, { enabled: false })];
    expect(hitTestPhotoLayer(layers, { x: 500, y: 500 }, BG, sizeOf)).toBe("visible");
  });

  it("rend null quand la seule photo sous le point est éteinte", () => {
    const layers = [photoLayer("eteint", {}, { enabled: false })];
    expect(hitTestPhotoLayer(layers, { x: 500, y: 500 }, BG, sizeOf)).toBeNull();
  });

  it("NE SÉLECTIONNE PAS une photo VERROUILLÉE — c'est ce pour quoi on pose un verrou", () => {
    // ⚠️ CE TEST ASSERTAIT L'INVERSE jusqu'au 2026-08-17, sur une justification
    // fausse : « c'est le seul chemin vers le bouton de déverrouillage ». Le
    // bouton vit dans la LIGNE du panneau de pile, qui est le chemin normal.
    //
    // Le cas d'usage que l'ancienne règle cassait : une photo de fond
    // verrouillée, du travail au-dessus, et chaque clic qui rate son calque
    // tombe sur le fond. Signalé par Antoine — « le lock de calque ne permet pas
    // de lock la sélection d'un calque/d'une photo ».
    const layers = [photoLayer("verrouille", {}, { locks: { all: true } })];
    expect(hitTestPhotoLayer(layers, { x: 500, y: 500 }, BG, sizeOf)).toBeNull();
  });

  it("laisse le clic TRAVERSER un calque verrouillé et atteindre celui du dessous", () => {
    // Le corollaire qui rend la règle utilisable : un verrouillé n'ABSORBE pas
    // le clic, il devient transparent pour lui. Sans ça, verrouiller un fond
    // rendrait inatteignable tout ce qui est dessous — on aurait remplacé une
    // gêne par une autre.
    const layers = [photoLayer("dessous"), photoLayer("verrouille", {}, { locks: { all: true } })];
    expect(hitTestPhotoLayer(layers, { x: 500, y: 500 }, BG, sizeOf)).toBe("dessous");
  });

  it("ignore une photo dont la taille source est inconnue, et continue de descendre", () => {
    const layers = [photoLayer("connue"), photoLayer("inconnue")];
    const sizeOfPartial = (sourceId: string) => (sourceId === "src-inconnue" ? null : PHOTO);
    expect(hitTestPhotoLayer(layers, { x: 500, y: 500 }, BG, sizeOfPartial)).toBe("connue");
  });

  it("ignore une photo de taille dégénérée (0) au lieu de produire un hit NaN", () => {
    const layers = [photoLayer("degeneree")];
    expect(hitTestPhotoLayer(layers, { x: 500, y: 500 }, BG, () => ({ width: 0, height: 100 }))).toBeNull();
  });
});

describe("hitTestPhotoLayer — cas dégénérés", () => {
  it("rend null sur une pile vide", () => {
    expect(hitTestPhotoLayer([], { x: 500, y: 500 }, BG, sizeOf)).toBeNull();
  });

  it("rend null quand la toile est de taille nulle (pas de document chargé)", () => {
    // Sans cette garde, la division par zéro produit un UV NaN, dont AUCUNE
    // comparaison de borne n'est vraie : `compositeUvToPhotoUv` rendrait un
    // point NaN — un faux HIT silencieux sur le premier calque photo.
    const layers = [photoLayer("a")];
    expect(hitTestPhotoLayer(layers, { x: 0, y: 0 }, { width: 0, height: 0 }, sizeOf)).toBeNull();
  });

  it("rend null pour un point non fini", () => {
    const layers = [photoLayer("a")];
    expect(hitTestPhotoLayer(layers, { x: NaN, y: 500 }, BG, sizeOf)).toBeNull();
  });
});
