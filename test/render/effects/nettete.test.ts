import { describe, expect, it } from "vitest";
import { nettete, netteteSpec } from "../../../src/render/effects/nettete";

/**
 * JUMEAU TS DE L'OPÉRATEUR DE NETTETÉ, et pourquoi il vaut d'exister.
 *
 * `effet-nettete-*` verrouille des PIXELS : il attrape une dérive, jamais une
 * intention. Les trois pièces qui tiennent la barre de qualité de cet effet —
 * le compresseur de halos, le masquage des zones plates, la correction sur la
 * luminance seule — n'ont aujourd'hui aucun test qui dise ce qu'elles DOIVENT
 * faire. Une référence de pixels serait tout aussi verte si le compresseur
 * était un `min` brutal.
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS : que le WGSL et ce jumeau calculent la
 * même chose. Ce sont deux implémentations, et rien ne les relie
 * automatiquement — exactement comme `curvesSpec` et `curve_eval`. Le lien
 * reste `npm run test:render`. Toute modification de la formule se fait des
 * DEUX côtés, comme le dit déjà `inputDriver`.
 */

/** Le flou est ce que la passe précédente rend ; ici on le pose à la main,
 *  c'est tout l'intérêt d'un jumeau pur. */
const defauts = nettete.params.map((p) => p.default);

/** Réglages nommés, pour que les tests lisent comme une spécification. */
const reglages = (o: Partial<Record<string, number>>): number[] => {
  const p = [...defauts];
  for (const [nom, valeur] of Object.entries(o)) {
    const index = nettete.params.findIndex((param) => param.name === nom);
    if (index < 0) throw new Error(`paramètre inconnu : ${nom}`);
    p[index] = valeur as number;
  }
  return p;
};

describe("netteté — l'opérateur", () => {
  it("à force nulle, rend l'entrée au bit près", () => {
    const entree = [0.2, 0.5, 0.8] as const;
    const flou = [0.1, 0.4, 0.9] as const;
    expect(netteteSpec(entree, flou, reglages({ force: 0 }))).toEqual([...entree]);
  });
});

/** Décalage applique par l'opérateur sur un gris, pour un détail donné.
 *  Sur un gris, entrée et flou ont la même chromaticité : le détail vaut donc
 *  exactement l'écart demandé, sans passer par les poids de luminance. */
const decalage = (detail: number, params: readonly number[], gris = 0.5): number => {
  const entree = [gris, gris, gris] as const;
  const f = gris - detail;
  return netteteSpec(entree, [f, f, f], params)[0] - gris;
};

describe("netteté — la maîtrise des halos", () => {
  // CE QU'ELLE EXISTE POUR EMPÊCHER : le liseré clair le long d'un bord franc,
  // signature du « filtre Photoshop 2005 » que le dépôt refuse. Un bord franc
  // est une GRANDE amplitude ; la brider est tout le travail.
  it("un bord franc ne peut pas doubler sa marche quand la maîtrise est fermée", () => {
    const brut = 0.8;
    const applique = decalage(brut, reglages({ force: 1, halos: 0 }));
    expect(applique).toBeGreaterThan(0);
    expect(applique).toBeLessThan(brut * 0.1);
  });

  // CE QUI DISTINGUE UN COMPRESSEUR D'UN `min`, et pourquoi ça compte : un
  // `min` borne aussi, mais il PLAFONNE — passé la limite, deux bords
  // d'amplitudes différentes rendent le même décalage, donc le modelé s'aplatit
  // en un palier visible. La réponse doit rester STRICTEMENT croissante partout.
  it("n'a aucun palier : deux amplitudes différentes ne rendent jamais le même décalage", () => {
    const p = reglages({ force: 1, halos: 0.3 });
    const echantillons = Array.from({ length: 60 }, (_, i) => decalage((i + 1) / 60, p));
    for (let i = 1; i < echantillons.length; i += 1) {
      expect(echantillons[i], `amplitude ${(i + 1) / 60}`).toBeGreaterThan(echantillons[i - 1]);
    }
  });

  // Le curseur doit être VIVANT sur toute sa course : ouvrir la maîtrise laisse
  // passer davantage, à chaque cran. Un mapping dont le haut serait mort ferait
  // exactement l'échec silencieux que ce dépôt proscrit.
  it("ouvrir la maîtrise laisse passer davantage, à chaque cran", () => {
    const crans = [0, 0.25, 0.5, 0.75, 1].map((h) => decalage(0.4, reglages({ force: 1, halos: h })));
    for (let i = 1; i < crans.length; i += 1) {
      expect(crans[i], `cran ${i}`).toBeGreaterThan(crans[i - 1]);
    }
  });
});

describe("netteté — le masquage", () => {
  // CE QU'IL EXISTE POUR ÉPARGNER : les zones plates, où il n'y a que du bruit
  // de capteur à accentuer. C'est le Masking de Lightroom, et sa promesse tient
  // en deux phrases — le grain est épargné, les bords ne le sont pas.
  const GRAIN = 0.005;
  const BORD = 0.4;

  it("au repos, il ne coûte rien : le grain est traité comme le reste", () => {
    const p = reglages({ force: 1, masquage: 0 });
    // Non pas « le décalage est nul » — c'est l'inverse : au repos, un petit
    // détail doit produire un petit décalage NON NUL, proportionnel à lui.
    expect(decalage(GRAIN, p)).toBeGreaterThan(0);
    expect(decalage(GRAIN, p)).toBeCloseTo(decalage(GRAIN, reglages({ force: 1 })), 12);
  });

  it("ouvert, il éteint le grain", () => {
    const repos = decalage(GRAIN, reglages({ force: 1, masquage: 0 }));
    const ouvert = decalage(GRAIN, reglages({ force: 1, masquage: 0.5 }));
    expect(ouvert).toBeLessThan(repos * 0.1);
  });

  it("ouvert, il ne touche PAS aux bords — c'est ce qui le distingue d'une baisse de force", () => {
    const repos = decalage(BORD, reglages({ force: 1, masquage: 0 }));
    const ouvert = decalage(BORD, reglages({ force: 1, masquage: 0.5 }));
    expect(ouvert).toBeGreaterThan(repos * 0.9);
  });

  it("n'a pas de bascule : monter le curseur épargne de plus en plus, sans marche", () => {
    // Une bascule dure laisserait une frontière VISIBLE entre zone accentuée et
    // zone épargnée — exactement le défaut qu'on vient éviter.
    const crans = [0, 0.2, 0.4, 0.6, 0.8, 1].map((m) =>
      decalage(0.02, reglages({ force: 1, masquage: m })));
    for (let i = 1; i < crans.length; i += 1) {
      expect(crans[i], `cran ${i}`).toBeLessThan(crans[i - 1]);
    }
  });
});

describe("netteté — les bornes", () => {
  // UNE FORCE NÉGATIVE EST UN USAGE, pas une symétrie gratuite : c'est le look
  // « diffusion » de la postproduction, le modelé qui s'aplatit. Sur un pixel
  // déjà presque noir, elle pousse vers le bas.
  //
  // Une valeur NÉGATIVE en lumière linéaire n'a pas de sens, et elle ne reste
  // pas sans conséquence : le ré-encodage sRGB évalue `pow(base, 1/2.4)`, donc
  // une base négative rend NaN — un pixel mort, pas un pixel sombre.
  // ⚠️ LE CAS QUI MORD EST PLUS ÉTROIT QU'IL N'EN A L'AIR, et le premier écrit
  // pour ce test ne l'atteignait pas. Le décalage se mesure sur la LUMINANCE et
  // s'applique aux trois canaux : sur un gris, un canal ne peut donc pas
  // descendre plus bas que la luminance du pixel, qui est déjà positive. Il faut
  // un pixel SATURÉ — un canal plus sombre que sa propre luminance — pour que la
  // soustraction le pousse sous zéro. Ici le vert porte tout, le rouge et le
  // bleu sont à zéro et reçoivent quand même le décalage du vert.
  it("une force négative ne fait jamais descendre un canal sous zéro", () => {
    const sortie = netteteSpec([0, 0.05, 0], [0, 0, 0], reglages({ force: -1, halos: 1 }));
    for (const canal of sortie) {
      expect(canal).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(canal)).toBe(true);
    }
  });

  // GARDE, pas une boucle : c'est elle qui porte la promesse « correction sur la
  // LUMINANCE seule ». ⚠️ Elle a REMPLACÉ, le 2026-09-15, une garde qui assertait
  // l'inverse — « décale les trois canaux d'autant ». Un décalage ÉGAL préserve
  // les DIFFÉRENCES entre canaux, donc il désature en éclaircissant et vire la
  // teinte près du noir ; un FACTEUR préserve leurs RAPPORTS. Mesuré sur un bord
  // saturé d'une vraie photo : saturation du crop 0,415 en offset contre 0,453
  // en facteur, et 39,4 % de pixels écrasés au noir contre 39,2 %.
  it("multiplie les trois canaux par le même facteur : teinte et saturation tiennent", () => {
    const entree = [0.30, 0.45, 0.62] as const;
    const sortie = netteteSpec(entree, [0.2, 0.35, 0.5], reglages({ force: 1.5 }));
    const facteurs = sortie.map((v, i) => v / entree[i]);
    expect(facteurs[1]).toBeCloseTo(facteurs[0], 12);
    expect(facteurs[2]).toBeCloseTo(facteurs[0], 12);
    expect(facteurs[0]).not.toBeCloseTo(1, 3);
  });

  // ET LA RÉFÉRENCE DU FACTEUR EST LE CANAL FORT, JAMAIS LA LUMINANCE — c'est ce
  // qui sépare la forme retenue de celle qui a été écartée, et ce test est le cas
  // qui les discrimine. `luma ≤ max(canal)`, et l'écart entre les deux EST la
  // saturation du pixel : référencé sur la luminance, le facteur rendrait du NOIR
  // PUR sur tout pixel saturé dont le gain dépasse sa luminance. Sur ce bleu
  // (luma 0,072 contre canal fort 1,0), la forme écartée rendait 255 → 0.
  it("un pixel saturé ne s'éteint pas sur le côté sombre d'un bord", () => {
    const entree = [0, 0, 1.0] as const;
    const sortie = netteteSpec(entree, [0.5, 0.5, 0.5], reglages({ force: 0.6 }));
    expect(sortie[2]).toBeGreaterThan(0.85);
    expect(sortie[0]).toBe(0);
    expect(sortie[1]).toBe(0);
  });

  // ET SA FRONTIÈRE, dite plutôt que découverte : le plancher est GLOBAL depuis
  // le passage au facteur — quand le gain négatif dépasse le canal fort, le
  // facteur tombe à 0 et les trois canaux s'éteignent ENSEMBLE. Les décalages
  // cessent alors d'être proportionnels (un canal déjà nul ne bouge pas). C'est
  // le comportement voulu — l'alternative serait de laisser passer du négatif,
  // qui ressortirait en NaN au ré-encodage — mais il ne se lit pas comme un défaut.
  it("sauf à l'extinction, où le plancher du facteur l'emporte", () => {
    const entree = [0, 0.05, 0] as const;
    const sortie = netteteSpec(entree, [0, 0, 0], reglages({ force: -1, halos: 1 }));
    const ecarts = sortie.map((v, i) => v - entree[i]);
    expect(ecarts[1]).not.toBeCloseTo(ecarts[0], 6);
  });
});
