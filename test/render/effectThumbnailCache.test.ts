import { describe, it, expect, vi } from "vitest";
import {
  EFFECT_THUMBNAIL_BOX,
  EffectThumbnailCache,
  effectThumbnailSignature,
  thumbnailSourceSize,
} from "../../src/render/effectThumbnailCache";
import { LayerStack } from "../../src/layers/layerStack";
import type { LayerState } from "../../src/layers/types";

/** Port PILOTABLE : chaque rendu reste en vol jusqu'à ce que le banc le
 *  termine. C'est la seule façon d'observer l'ordonnancement — un port qui
 *  résout tout de suite ne peut pas montrer deux appels qui se chevauchent, ni
 *  une demande supplantée pendant qu'une autre attend. */
function portPilotable() {
  const appels: string[] = [];
  const enAttente = new Map<string, { resolve: (url: string) => void; reject: (e: unknown) => void }>();
  let enCours = 0;
  let simultanesMax = 0;
  return {
    appels,
    get simultanesMax() {
      return simultanesMax;
    },
    port: {
      render(effectId: string): Promise<string> {
        appels.push(effectId);
        enCours += 1;
        simultanesMax = Math.max(simultanesMax, enCours);
        return new Promise<string>((resolve, reject) => {
          enAttente.set(effectId, { resolve, reject });
        });
      },
    },
    terminer(effectId: string, url = `data:image/png;base64,${effectId}`): void {
      const attente = enAttente.get(effectId);
      if (attente === undefined) throw new Error(`aucun rendu en vol pour ${effectId}`);
      enAttente.delete(effectId);
      enCours -= 1;
      attente.resolve(url);
    },
    echouer(effectId: string, message: string): void {
      const attente = enAttente.get(effectId);
      if (attente === undefined) throw new Error(`aucun rendu en vol pour ${effectId}`);
      enAttente.delete(effectId);
      enCours -= 1;
      attente.reject(new Error(message));
    },
  };
}

/** Vide la file de microtâches. Un `await Promise.resolve()` compté à la main
 *  ne suffit PAS ici : la file du cache est une chaîne de fonctions `async`, et
 *  chaque maillon en coûte plusieurs — un compte fixe rendait le banc vert ou
 *  rouge selon le nombre de demandes du scénario. Une frontière de macrotâche
 *  draine tout ce qui est en attente, quel que soit ce nombre. */
const tourner = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function pile(effectIds: string[]): LayerState[] {
  const stack = new LayerStack();
  for (const id of effectIds) stack.addLayer(id);
  return stack.layers;
}

describe("thumbnailSourceSize", () => {
  it("ramène le document DANS la boîte en gardant son rapport", () => {
    // 3:2 paysage, comme la boîte : il la remplit exactement.
    expect(thumbnailSourceSize({ width: 6240, height: 4160 })).toEqual({ width: 240, height: 160 });
    // Portrait : c'est la HAUTEUR qui borne, la vignette est plus étroite que
    // la boîte — d'où la zone d'aperçu qui centre au lieu de recadrer.
    expect(thumbnailSourceSize({ width: 4160, height: 6240 })).toEqual({ width: 107, height: 160 });
  });

  it("n'AGRANDIT jamais un document plus petit que la boîte", () => {
    // Interpoler des pixels qui existent déjà ne rendrait pas la vignette plus
    // lisible, seulement plus floue.
    expect(thumbnailSourceSize({ width: 120, height: 80 })).toEqual({ width: 120, height: 80 });
  });

  it("rend au moins 1 x 1, y compris sur un document dégénéré", () => {
    // Une texture de côté nul est un refus de `createTexture`, pas une image
    // vide : la vignette d'un document pas encore ouvert ne doit pas y mener.
    expect(thumbnailSourceSize({ width: 0, height: 0 })).toEqual({ width: 1, height: 1 });
    expect(thumbnailSourceSize({ width: 10000, height: 1 })).toEqual({ width: 240, height: 1 });
  });

  it("respecte une boîte donnée par l'appelant", () => {
    expect(thumbnailSourceSize({ width: 1000, height: 1000 }, { width: 64, height: 64 })).toEqual({ width: 64, height: 64 });
    expect(EFFECT_THUMBNAIL_BOX).toEqual({ width: 240, height: 160 });
  });
});

describe("effectThumbnailSignature", () => {
  const toile = { width: 100, height: 100 };

  it("survit à la RECOPIE des calques, qui est le cas réel", () => {
    // Le chemin vivant reconstruit le tableau à la main (`{...layer}`,
    // `replaceLiveLayers`) : comparer par identité d'objet périmerait la source
    // à chaque frame d'un glissement. C'est exactement pourquoi
    // `layerContentKey` existe (voir `contentKey.ts`).
    const p = pile(["glow", "grain"]);
    const recopie = p.map((layer) => ({ ...layer }));
    expect(effectThumbnailSignature(recopie, toile)).toBe(effectThumbnailSignature(p, toile));
  });

  it("change quand un paramètre change", () => {
    const avant = pile(["glow"]);
    const apres = pile(["glow"]);
    apres[0] = { ...apres[0], params: { ...apres[0].params, intensity: 0.5 } };
    expect(effectThumbnailSignature(apres, toile)).not.toBe(effectThumbnailSignature(avant, toile));
  });

  it("change quand la TOILE change à pile égale", () => {
    // La source réduite en dépend directement (`thumbnailSourceSize`) : la
    // laisser hors de la clé ferait servir une vignette au mauvais rapport.
    const p = pile(["glow"]);
    expect(effectThumbnailSignature(p, { width: 100, height: 100 })).not.toBe(
      effectThumbnailSignature(p, { width: 100, height: 200 }),
    );
  });
});

describe("EffectThumbnailCache", () => {
  it("ne fabrique QU'UNE FOIS la vignette d'un effet", async () => {
    const { port, appels, terminer } = portPilotable();
    const cache = new EffectThumbnailCache(port);

    const premier = cache.request("s1", "glow");
    await tourner();
    terminer("glow", "data:png;glow");
    await expect(premier).resolves.toBe("data:png;glow");

    // Deuxième survol du même effet : servi de mémoire, le port n'est pas
    // rappelé — c'est ce que « mémoriser l'aperçu par effet » veut dire.
    await expect(cache.request("s1", "glow")).resolves.toBe("data:png;glow");
    expect(appels).toEqual(["glow"]);
    expect(cache.peek("s1", "glow")).toBe("data:png;glow");
  });

  it("partage la MÊME promesse pour deux survols du même effet en vol", async () => {
    const { port, appels, terminer } = portPilotable();
    const cache = new EffectThumbnailCache(port);

    const a = cache.request("s1", "glow");
    const b = cache.request("s1", "glow");
    await tourner();
    terminer("glow", "data:png;glow");

    await expect(Promise.all([a, b])).resolves.toEqual(["data:png;glow", "data:png;glow"]);
    expect(appels).toEqual(["glow"]);
  });

  it("OUBLIE tout quand la source change de signature", async () => {
    const { port, appels, terminer } = portPilotable();
    const cache = new EffectThumbnailCache(port);

    const avant = cache.request("s1", "glow");
    await tourner();
    terminer("glow", "data:png;avant");
    await avant;

    // La pile a bougé : la vignette mémorisée montre un document qui n'existe
    // plus. `peek` cesse de la servir ET une demande la refabrique.
    expect(cache.peek("s2", "glow")).toBeNull();
    const apres = cache.request("s2", "glow");
    await tourner();
    terminer("glow", "data:png;apres");
    await expect(apres).resolves.toBe("data:png;apres");
    expect(appels).toEqual(["glow", "glow"]);
  });

  it("ABANDONNE une demande supplantée par un survol plus récent", async () => {
    const { port, appels } = portPilotable();
    const cache = new EffectThumbnailCache(port);

    // Balayage de la liste au curseur : trois effets traversés, un seul
    // regardé. Sans le jeton on paierait la compilation des trois shaders.
    const glow = cache.request("s1", "glow");
    const grain = cache.request("s1", "grain");
    const curves = cache.request("s1", "curves");
    await tourner();

    expect(appels).toEqual(["curves"]);
    await expect(glow).resolves.toBeNull();
    await expect(grain).resolves.toBeNull();
    expect(curves).toBeInstanceOf(Promise);
  });

  it("re-fabrique un effet abandonné s'il est survolé à nouveau", async () => {
    const { port, appels, terminer } = portPilotable();
    const cache = new EffectThumbnailCache(port);

    const abandonne = cache.request("s1", "glow");
    cache.request("s1", "grain");
    await tourner();
    await expect(abandonne).resolves.toBeNull();
    terminer("grain");

    // L'abandon ne doit rien laisser derrière : une entrée `pending` orpheline
    // servirait son `null` pour toujours et l'effet ne se fabriquerait plus.
    const seconde = cache.request("s1", "glow");
    await tourner();
    expect(appels).toEqual(["grain", "glow"]);
    terminer("glow", "data:png;glow");
    await expect(seconde).resolves.toBe("data:png;glow");
  });

  it("ne laisse JAMAIS deux fabrications se chevaucher", async () => {
    const { port, terminer } = portPilotable();
    const cache = new EffectThumbnailCache(port);

    // Deux rendus concurrents passeraient par la même texture d'export du
    // renderer d'aperçu et se reliraient l'un l'autre : la sérialisation est
    // une correction, pas un confort.
    const glow = cache.request("s1", "glow");
    await tourner();
    const grain = cache.request("s1", "grain");
    await tourner();

    terminer("glow", "data:png;glow");
    await expect(glow).resolves.toBe("data:png;glow");
    await tourner();
    terminer("grain", "data:png;grain");
    await expect(grain).resolves.toBe("data:png;grain");

    expect(cache.peek("s1", "glow")).toBe("data:png;glow");
  });

  it("est TOTAL : un rendu qui échoue rend null et ne rompt pas la file", async () => {
    const avertissement = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { port, terminer, echouer } = portPilotable();
    const cache = new EffectThumbnailCache(port);

    const casse = cache.request("s1", "glass");
    await tourner();
    echouer("glass", "pipeline refusé");
    await expect(casse).resolves.toBeNull();
    expect(avertissement).toHaveBeenCalled();

    // La file avance : la demande suivante est servie normalement.
    const suivant = cache.request("s1", "grain");
    await tourner();
    terminer("grain", "data:png;grain");
    await expect(suivant).resolves.toBe("data:png;grain");
    avertissement.mockRestore();
  });

  it("ignore un résultat dont la source a changé pendant la fabrication", async () => {
    const { port, terminer } = portPilotable();
    const cache = new EffectThumbnailCache(port);

    const enVol = cache.request("s1", "glow");
    await tourner();
    // La pile bouge pendant le rendu : ce qui va retomber a été composé sur
    // l'ancien document.
    cache.request("s2", "grain");
    await tourner();
    terminer("glow", "data:png;perime");

    await expect(enVol).resolves.toBeNull();
    expect(cache.peek("s2", "glow")).toBeNull();
  });

  it("après dispose, ne fabrique plus rien", async () => {
    const { port, appels } = portPilotable();
    const cache = new EffectThumbnailCache(port);
    cache.dispose();
    await expect(cache.request("s1", "glow")).resolves.toBeNull();
    await tourner();
    expect(appels).toEqual([]);
  });
});
