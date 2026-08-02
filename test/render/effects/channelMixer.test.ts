import { describe, it, expect } from "vitest";
import { channelMixer, channelMixSpec } from "../../../src/render/effects/channelMixer";
import { hsl2rgb } from "../../../src/render/effects/hsl";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer";
import { TRANSFER_SPACE_LINEAR, TRANSFER_SPACE_SRGB } from "../../../src/render/effects/blendSpace";

/**
 * `channelMixSpec` est le jumeau TS du shader, et il était EXPORTÉ SANS ÊTRE
 * TESTÉ : rien ne vérifiait la formule que son propre commentaire déclare
 * devoir tenir des deux côtés. Ce fichier naît avec les encres par canal
 * (2026-08-02) parce qu'il aurait été absurde d'ajouter un étage à une
 * spécification que personne n'exerce.
 *
 * Ce que ces tests peuvent dire, et pas plus : ils portent sur le jumeau, donc
 * sur l'ALGÈBRE. Que le WGSL calcule bien la même chose est vérifié ailleurs et
 * autrement — par les références de rendu `effet-channel-mixer` (les défauts,
 * posée avant le changement) et `effet-channel-mixer-encres`.
 */

/** Les défauts déclarés, dans l'ordre du uniform — la vraie entrée du shader. */
const defauts = (): number[] => channelMixer.params.map((p) => p.default);

/** Indices, nommés une fois : les lire en dur dans chaque test rendrait un
 *  décalage de paramètre invisible ici alors que c'est exactement ce qu'on
 *  cherche à attraper. */
const idx = (nom: string): number => {
  const i = channelMixer.params.findIndex((p) => p.name === nom);
  if (i < 0) throw new Error(`paramètre "${nom}" absent de channelMixer`);
  return i;
};

const avec = (base: number[], modifs: Record<string, number>): number[] => {
  const p = [...base];
  for (const [nom, v] of Object.entries(modifs)) p[idx(nom)] = v;
  return p;
};

const IDENTITE = {
  redFromRed: 1, redFromGreen: 0, redFromBlue: 0,
  greenFromRed: 0, greenFromGreen: 1, greenFromBlue: 0,
  blueFromRed: 0, blueFromGreen: 0, blueFromBlue: 1,
  monochrome: 0,
};

describe("channelMixer — la matrice", () => {
  it("déclare 22 paramètres, sous le plafond de 24 du uniform", () => {
    // Le plafond n'est pas décoratif : au-delà, `validateEffect` lève, et sans
    // lui l'écriture hors-borne du Float32Array serait un no-op silencieux.
    expect(channelMixer.params).toHaveLength(22);
  });

  it("à l'identité, une couleur ressort inchangée", () => {
    const p = avec(defauts(), { ...IDENTITE, preserveLuma: 1 });
    const out = channelMixSpec([0.2, 0.5, 0.8], p);
    expect(out[0]).toBeCloseTo(0.2, 6);
    expect(out[1]).toBeCloseTo(0.5, 6);
    expect(out[2]).toBeCloseTo(0.8, 6);
  });

  it("préserver la luminosité laisse un gris neutre EXACTEMENT où il est", () => {
    // C'est la promesse écrite du paramètre : la ligne ne fait plus que
    // répartir. Une ligne de somme 2 sans normalisation doublerait le gris.
    const p = avec(defauts(), {
      redFromRed: 1, redFromGreen: 1, redFromBlue: 0,
      greenFromRed: 0, greenFromGreen: 1, greenFromBlue: 1,
      blueFromRed: 1, blueFromGreen: 0, blueFromBlue: 1,
      preserveLuma: 1, monochrome: 0,
    });
    const out = channelMixSpec([0.4, 0.4, 0.4], p);
    for (const c of out) expect(c).toBeCloseTo(0.4, 6);
  });

  it("sans préservation, la même matrice DOUBLE le gris — le contraste du test précédent", () => {
    const p = avec(defauts(), {
      redFromRed: 1, redFromGreen: 1, redFromBlue: 0,
      greenFromRed: 0, greenFromGreen: 1, greenFromBlue: 1,
      blueFromRed: 1, blueFromGreen: 0, blueFromBlue: 1,
      preserveLuma: 0, monochrome: 0,
    });
    const out = channelMixSpec([0.4, 0.4, 0.4], p);
    for (const c of out) expect(c).toBeCloseTo(0.8, 6);
  });

  it("une ligne de somme nulle n'est pas normalisée — elle n'inverserait pas ses signes en silence", () => {
    const p = avec(defauts(), {
      redFromRed: 1, redFromGreen: 0, redFromBlue: -1,
      greenFromRed: 0, greenFromGreen: 1, greenFromBlue: 0,
      blueFromRed: 0, blueFromGreen: 0, blueFromBlue: 1,
      preserveLuma: 1, monochrome: 0,
    });
    // R = 1*0.6 - 1*0.1 = 0.5, et non un quotient par une somme nulle.
    expect(channelMixSpec([0.6, 0.5, 0.1], p)[0]).toBeCloseTo(0.5, 6);
  });

  it("le plancher à 0 tient : aucun canal ne sort négatif", () => {
    const p = avec(defauts(), {
      redFromRed: 0, redFromGreen: 0, redFromBlue: -1,
      greenFromRed: 0, greenFromGreen: 1, greenFromBlue: 0,
      blueFromRed: 0, blueFromGreen: 0, blueFromBlue: 1,
      preserveLuma: 0, monochrome: 0,
    });
    expect(channelMixSpec([0.1, 0.5, 0.9], p)[0]).toBe(0);
  });

  it("monochrome fait sortir les trois canaux de la SEULE ligne rouge", () => {
    const p = avec(defauts(), { ...IDENTITE, preserveLuma: 0, monochrome: 1 });
    const out = channelMixSpec([0.2, 0.5, 0.8], p);
    // Ligne rouge = identité sur R, donc les trois sorties valent R.
    for (const c of out) expect(c).toBeCloseTo(0.2, 6);
  });
});

describe("channelMixer — les encres par canal (cahier §6quinquies)", () => {
  const identiteSansEncre = () => avec(defauts(), { ...IDENTITE, preserveLuma: 1, colorize: 0 });

  it("à Recoloration 0, la sortie est celle d'AVANT les encres — au bit", () => {
    // La garantie que la référence de rendu `effet-channel-mixer` vérifie
    // ensuite sur 65 536 pixels. Ici, la même chose sur l'algèbre : aucune des
    // dix nouvelles valeurs ne doit pouvoir bouger un résultat à 0.
    const sans = channelMixSpec([0.2, 0.5, 0.8], identiteSansEncre());
    const p = avec(identiteSansEncre(), {
      redInkHue: 300, redInkSaturation: 1, redInkLightness: 0.2,
      greenInkHue: 40, greenInkSaturation: 0.1, greenInkLightness: 0.9,
      blueInkHue: 0, blueInkSaturation: 0, blueInkLightness: 0,
    });
    expect(channelMixSpec([0.2, 0.5, 0.8], p)).toEqual(sans);
  });

  it("les encres sont des COLONNES : un canal seul sort à la couleur de SON encre", () => {
    // C'est la définition même de l'outil de la fiche de référence, et le seul
    // test qui distinguerait une transposition (encres posées en LIGNES) — la
    // confusion exacte que l'en-tête de l'effet décrit.
    const p = avec(defauts(), {
      ...IDENTITE, preserveLuma: 0, colorize: 1,
      redInkHue: 25, redInkSaturation: 0.85, redInkLightness: 0.55,
      greenInkHue: 105, greenInkSaturation: 0.55, greenInkLightness: 0.5,
      blueInkHue: 195, blueInkSaturation: 0.85, blueInkLightness: 0.5,
    });
    // Entrée rouge pur : seule la colonne du rouge contribue.
    const encreRouge = hsl2rgb(25 / 360, 0.85, 0.55).map(srgbToLinear);
    const out = channelMixSpec([1, 0, 0], p);
    for (let c = 0; c < 3; c++) expect(out[c]).toBeCloseTo(encreRouge[c], 6);

    // Et l'entrée bleue donne l'encre BLEUE, pas la rouge : sans cette seconde
    // moitié, une implémentation qui appliquerait partout la même encre
    // passerait le test précédent.
    const encreBleue = hsl2rgb(195 / 360, 0.85, 0.5).map(srgbToLinear);
    const outB = channelMixSpec([0, 0, 1], p);
    for (let c = 0; c < 3; c++) expect(outB[c]).toBeCloseTo(encreBleue[c], 6);
    expect(outB[2]).toBeGreaterThan(outB[0]);
  });

  it("préserver la luminosité garde l'exposition d'un blanc, quelles que soient les encres", () => {
    // Trois encres sombres : sans normalisation l'image plongerait, et le
    // curseur d'encre serait un curseur d'exposition déguisé — le défaut que
    // `preserveLuma` existe pour empêcher sur les lignes.
    const p = avec(defauts(), {
      ...IDENTITE, preserveLuma: 1, colorize: 1,
      redInkHue: 0, redInkSaturation: 0.8, redInkLightness: 0.15,
      greenInkHue: 120, greenInkSaturation: 0.8, greenInkLightness: 0.15,
      blueInkHue: 240, blueInkSaturation: 0.8, blueInkLightness: 0.15,
    });
    const out = channelMixSpec([1, 1, 1], p);
    const luma = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
    expect(luma).toBeCloseTo(1, 5);
  });

  it("sans préservation, les mêmes encres sombres FONT plonger l'exposition", () => {
    const p = avec(defauts(), {
      ...IDENTITE, preserveLuma: 0, colorize: 1,
      redInkHue: 0, redInkSaturation: 0.8, redInkLightness: 0.15,
      greenInkHue: 120, greenInkSaturation: 0.8, greenInkLightness: 0.15,
      blueInkHue: 240, blueInkSaturation: 0.8, blueInkLightness: 0.15,
    });
    const out = channelMixSpec([1, 1, 1], p);
    const luma = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
    expect(luma).toBeLessThan(0.2);
  });

  it("trois encres noires ne divisent pas par zéro", () => {
    const p = avec(defauts(), {
      ...IDENTITE, preserveLuma: 1, colorize: 1,
      redInkSaturation: 0, redInkLightness: 0,
      greenInkSaturation: 0, greenInkLightness: 0,
      blueInkSaturation: 0, blueInkLightness: 0,
    });
    for (const c of channelMixSpec([0.5, 0.5, 0.5], p)) expect(Number.isFinite(c)).toBe(true);
  });

  it("l'espace de transfert s'applique AUSSI aux encres — l'aller-retour reste fermé", () => {
    // En sRGB, l'encre doit être ré-encodée pour rejoindre la matrice, puis
    // tout est décodé ensemble. Le témoin : une entrée rouge pur avec une encre
    // rouge pur doit revenir au rouge pur dans les DEUX espaces, sinon un gamma
    // s'est échappé quelque part.
    for (const space of [TRANSFER_SPACE_LINEAR, TRANSFER_SPACE_SRGB]) {
      const p = avec(defauts(), {
        ...IDENTITE, preserveLuma: 0, colorize: 1, transferSpace: space,
        redInkHue: 0, redInkSaturation: 1, redInkLightness: 0.5,
        greenInkHue: 120, greenInkSaturation: 1, greenInkLightness: 0.5,
        blueInkHue: 240, blueInkSaturation: 1, blueInkLightness: 0.5,
      });
      const out = channelMixSpec([1, 0, 0], p);
      expect(out[0]).toBeCloseTo(1, 5);
      expect(out[1]).toBeCloseTo(0, 5);
      expect(out[2]).toBeCloseTo(0, 5);
    }
  });
});
