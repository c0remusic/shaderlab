import { describe, expect, it } from "vitest";
import { guideChainKey, jetonApercuLive, layerContentKey } from "../../src/layers/contentKey";
import { defaultLayerMask } from "../../src/mask/types";
import type { LayerState } from "../../src/layers/types";

function calque(patch: Partial<LayerState> = {}): LayerState {
  return {
    id: "layer-1",
    effectId: "glow",
    params: { intensity: 0.5, radius: 12 },
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
    ...patch,
  };
}

describe("layerContentKey", () => {
  // LE CAS QUI MOTIVE TOUT LE FICHIER. Un appelant en amont recopie le calque
  // du bas a chaque frame ; l'ancienne comparaison par identite d'objet
  // periment alors la chaine de guides et reconstruisait la SAT edge-aware de
  // chaque masque de la pile, ~25 passes, a chaque image.
  it("rend la meme cle pour une COPIE de surface du meme calque", () => {
    const original = calque();
    const copie = { ...original };
    expect(copie).not.toBe(original);
    expect(layerContentKey(copie)).toBe(layerContentKey(original));
  });

  it("rend la meme cle quel que soit l ordre d ecriture des champs", () => {
    const a = calque();
    const b: LayerState = {
      mask: a.mask,
      blendMode: a.blendMode,
      opacity: a.opacity,
      enabled: a.enabled,
      params: { radius: 12, intensity: 0.5 },
      effectId: a.effectId,
      id: a.id,
    };
    expect(layerContentKey(b)).toBe(layerContentKey(a));
  });

  // Le sens de l'erreur : une cle trop sensible coute du travail refait, une
  // cle trop laxiste sert un cache perime — un guide fige sur un ancien
  // composite, sans erreur ni test rouge. Tout ce qui suit verifie le second
  // sens, le seul dangereux.
  it("distingue un parametre modifie", () => {
    expect(layerContentKey(calque({ params: { intensity: 0.6, radius: 12 } }))).not.toBe(
      layerContentKey(calque()),
    );
  });

  it("distingue opacite, fusion, activation et ecretage", () => {
    const reference = layerContentKey(calque());
    expect(layerContentKey(calque({ opacity: 0.9 }))).not.toBe(reference);
    expect(layerContentKey(calque({ blendMode: "screen" }))).not.toBe(reference);
    expect(layerContentKey(calque({ enabled: false }))).not.toBe(reference);
    expect(layerContentKey(calque({ clipToBelow: true }))).not.toBe(reference);
  });

  it("distingue la transformation d un calque photo", () => {
    const base = calque({
      imageSource: { sourceId: "src-1" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    });
    const deplace = calque({
      imageSource: { sourceId: "src-1" },
      transform: { x: 10, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    });
    expect(layerContentKey(deplace)).not.toBe(layerContentKey(base));
  });

  it("distingue deux rasters de masque distincts, meme a contenu egal", () => {
    // Les rasters sont IMMUABLES par convention (toujours remplaces, jamais
    // mutes) : leur identite EST leur contenu, et les serialiser couterait
    // plus cher que le travail qu'on evite. Deux tableaux de meme contenu sont
    // donc deux masques differents — conservateur, dans le sens sur.
    const partage = new Uint8Array([1, 2, 3]);
    const a = calque({ mask: { ...defaultLayerMask(), raster: partage } as LayerState["mask"] });
    const b = calque({
      mask: { ...defaultLayerMask(), raster: new Uint8Array([1, 2, 3]) } as LayerState["mask"],
    });
    const memeRaster = calque({
      mask: { ...defaultLayerMask(), raster: partage } as LayerState["mask"],
    });
    expect(layerContentKey(a)).not.toBe(layerContentKey(b));
    expect(layerContentKey(memeRaster)).toBe(layerContentKey(a));
  });

  // Le point STRUCTUREL : la cle se calcule par parcours, pas par liste de
  // champs. Un champ ajoute a `LayerState` plus tard entre dans la cle tout
  // seul — une liste enumeree, elle, l'aurait oublie en silence.
  it("prend en compte un champ que ce fichier ne connait pas", () => {
    const avec = { ...calque(), champFutur: 42 } as unknown as LayerState;
    expect(layerContentKey(avec)).not.toBe(layerContentKey(calque()));
  });
});

describe("guideChainKey", () => {
  // ⚠️ Un objet d'API navigateur porte ses champs en accesseurs de PROTOTYPE :
  // `Object.entries` y rend `{}`. Sans garde, deux textures de toile
  // differentes rendraient la meme cle, donc un cache perime — la plus
  // silencieuse des deux erreurs.
  it("distingue deux objets opaques dont les champs vivent sur le prototype", () => {
    class TextureFictive {
      get largeur() {
        return 4096;
      }
    }
    const a = new TextureFictive();
    const b = new TextureFictive();
    expect(Object.entries(a)).toHaveLength(0);
    expect(guideChainKey(a)).not.toBe(guideChainKey(b));
    expect(guideChainKey(a)).toBe(guideChainKey(a));
  });

  it("donne une cle distincte a chaque jeton d apercu live", () => {
    // L'apercu live du pinceau change de contenu SANS nouveau `LayerState` :
    // son jeton doit perimer a chaque frame, par construction.
    expect(guideChainKey(jetonApercuLive())).not.toBe(guideChainKey(jetonApercuLive()));
  });

  // Le piege que la ligne ci-dessus evite, rendu explicite : deux objets
  // litteraux vides ont le MEME contenu, donc la meme cle. Un jeton `{}`
  // cesserait de perimer sans que rien ne le signale — d'ou la classe.
  it("rend la meme cle pour deux objets litteraux vides", () => {
    expect(guideChainKey({})).toBe(guideChainKey({}));
  });

  it("ne boucle pas sur une structure cyclique", () => {
    const cyclique: Record<string, unknown> = { a: 1 };
    cyclique.moi = cyclique;
    expect(() => guideChainKey(cyclique)).not.toThrow();
  });
});
