import { describe, it, expect } from "vitest";
import { reglagesDeBase, reglagesDeBaseSpec } from "../../../src/render/effects/reglagesDeBase";
import { srgbToLinear, linearToSrgb } from "../../../src/render/effects/srgbTransfer";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab";

/**
 * `reglagesDeBaseSpec` est le jumeau TS du shader (même patron qu'`etalonnageSpec`
 * / `netteteSpec`) : ces tests portent sur l'ALGÈBRE ponctuelle, pas sur le WGSL,
 * ni sur le flou SPATIAL de Texture/Clarté (verrouillé par les références
 * `developpement-reglages-*`). Le spec reçoit une luminance floutée en paramètre ;
 * sur une rampe elle vaut la luminance du pixel.
 *
 * Le test central est « 132 niveaux, pas 109 » : il PROUVE que le module tient sa
 * raison d'être (le ton d'un bloc, une seule quantification, contre l'empilement
 * de six effets 8 bits — `../research/02-huit-bits-mesure.md`).
 */

type Vec3 = [number, number, number];

/** Défauts déclarés, dans l'ordre du uniform. */
const defauts = (): number[] => reglagesDeBase.params.map((p) => p.default);
const idx = (nom: string): number => {
  const i = reglagesDeBase.params.findIndex((p) => p.name === nom);
  if (i < 0) throw new Error(`paramètre "${nom}" absent de reglagesDeBase`);
  return i;
};
const avec = (modifs: Record<string, number>): number[] => {
  const p = defauts();
  for (const [nom, v] of Object.entries(modifs)) p[idx(nom)] = v;
  return p;
};

/** Écriture 8 bits sRGB + relecture linéaire, sur un gris — la quantification que
 *  le format -srgb applique à chaque écriture de cible. */
const q8 = (lin: number): number => srgbToLinear(Math.round(linearToSrgb(lin) * 255) / 255);
/** Niveau sRGB 0..255 d'une valeur linéaire. */
const niveau = (lin: number): number => Math.round(linearToSrgb(lin) * 255);

describe("reglagesDeBase — jumeau du ton d'un bloc", () => {
  it("réglages au défaut : identité au bit près", () => {
    for (const c of [[0.2, 0.5, 0.8], [0, 0, 0], [1, 1, 1], [0.37, 0.02, 0.91]] as Vec3[]) {
      const l = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
      expect(reglagesDeBaseSpec(c, l, defauts())).toEqual(c);
    }
  });

  it("la balance des blancs teinte un gris ET déplace sa luminance (espace caméra, PAS de renormalisation)", () => {
    // ⚠️ PARITÉ 02b (audit 09) : Lightroom règle la WB en espace CAMÉRA
    // (`ABCtoRGB_local_Temp`) et NE préserve PAS la luminance — les DEUX extrêmes
    // de Température ÉCLAIRCISSENT une rampe grise (mesuré : temperature-p100 Δlum
    // +0,19 ; m100 +0,23). On a donc RETIRÉ la renormalisation au blanc que ce
    // test exigeait auparavant. Il vérifie maintenant les deux faits mesurés :
    // la couleur vire, ET la luminance monte aux deux signes.
    const luma = (c: Vec3) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    for (const g of [0.1, 0.4]) {
      const chaud = reglagesDeBaseSpec([g, g, g], g, avec({ temperature: 60 }));
      const froid = reglagesDeBaseSpec([g, g, g], g, avec({ temperature: -60 }));
      // La couleur A bougé (le virage) : chaud vers le rouge, froid vers le bleu.
      expect(chaud[0] - chaud[2]).toBeGreaterThan(1e-3);
      expect(froid[2] - froid[0]).toBeGreaterThan(1e-3);
      // Et la luminance MONTE aux deux extrêmes (plus de renormalisation).
      expect(luma(chaud)).toBeGreaterThan(g + 1e-3);
      expect(luma(froid)).toBeGreaterThan(g + 1e-3);
    }
  });

  it("le voile en ajout (dehaze < 0) relève et désature ; en retrait (dehaze > 0) creuse le ton", () => {
    // ⚠️ PARITÉ 02b : le voile porte désormais une composante GLOBALE (audit 09 —
    // LR estime un canal sombre, notre voile local était inerte sur un ton plat).
    // Sur un gris moyen, l'AJOUT (dehaze -100) relève fortement vers l'airlight ;
    // le RETRAIT (dehaze +100) creuse. Mesuré sur `voile-m100` (in 128 -> 227) et
    // `voile-p100` (in 128 -> 45).
    const luma = (c: Vec3) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    const g = srgbToLinear(128 / 255);
    const ajout = reglagesDeBaseSpec([g, g, g], g, avec({ dehaze: -100 }));
    const retrait = reglagesDeBaseSpec([g, g, g], g, avec({ dehaze: 100 }));
    expect(luma(ajout)).toBeGreaterThan(g + 0.1);   // relève franchement
    expect(luma(retrait)).toBeLessThan(g - 0.1);     // creuse franchement
    // La désaturation ne mord que sur une couleur, en ajout : un rouge saturé
    // perd de la chroma OKLab sous dehaze -100.
    const rouge: Vec3 = [srgbToLinear(0.9), srgbToLinear(0.1), srgbToLinear(0.1)];
    const chroma = (c: Vec3): number => { const lab = linearSrgbToOklab(c); return Math.hypot(lab[1], lab[2]); };
    const lR = rouge[0] * 0.2126 + rouge[1] * 0.7152 + rouge[2] * 0.0722;
    expect(chroma(reglagesDeBaseSpec(rouge, lR, avec({ dehaze: -100 })))).toBeLessThan(chroma(rouge));
  });

  // ── LE GATE : UNE SEULE QUANTIFICATION ────────────────────────────────────
  //
  // La chaîne de `research/02` (Exposition +1, Ombres +60, Noirs −30, HL −50,
  // Contraste +40, courbe) sur une rampe de gris 8 bits. D'UN BLOC (le module),
  // une seule quantification finale ; EMPILÉE (six effets 8 bits), une
  // quantification entre chacun. ⚠️ Valeurs RE-MESURÉES le 2026-09-12 après la
  // parité 02b (Blancs/Noirs LOCAUX sur `sBlur`) : d'un bloc **174 niveaux, trou
  // max 3** ; empilé **140** (avant 02b : 160 / trou 3 / 140 empilé ; avant
  // calibration du ton : 130 / trou 3 / 104 empilé). Porter les Noirs sur la
  // luminance floutée redistribue leur lift et écarte davantage les niveaux d'un
  // bloc ; l'empilé (chaque étape quantifiée) est inchangé. Le bloc reste très
  // devant : une seule quantification garde plus de niveaux, c'est l'intérêt du
  // module.
  it("« 132 niveaux, pas 109 » : le ton d'un bloc quantifié une fois garde les niveaux", () => {
    const reglage = { exposure: 1, shadows: 60, blacks: -30, highlights: -50, contrast: 40, paramShadows: -40, paramHighlights: 40 };
    const rampe = Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));

    // D'UN BLOC : le spec calcule tout en flottant, on quantifie UNE fois.
    const pAll = avec(reglage);
    const unBloc = rampe.map((l) => niveau(reglagesDeBaseSpec([l, l, l], l, pAll)[0]));

    // EMPILÉ : un opérateur par étape, quantifié 8 bits entre chacun (l'ordre de
    // `research/02`). Chaque étape n'active qu'un curseur ; la luminance floutée
    // suit la valeur courante (rampe lisse).
    const etapes: Record<string, number>[] = [
      { exposure: 1 }, { shadows: 60 }, { blacks: -30 }, { highlights: -50 }, { contrast: 40 },
      { paramShadows: -40, paramHighlights: 40 },
    ];
    const empile = rampe.map((l0) => {
      let l = l0;
      for (const e of etapes) l = q8(reglagesDeBaseSpec([l, l, l], l, avec(e))[0]);
      return niveau(l);
    });

    const distincts = (a: number[]) => new Set(a).size;
    const trouMax = (a: number[]) => {
      const u = [...new Set(a)].sort((x, y) => x - y);
      let g = 0;
      for (let i = 1; i < u.length; i++) g = Math.max(g, u[i] - u[i - 1]);
      return g;
    };

    const nBloc = distincts(unBloc), nEmpile = distincts(empile);
    const gBloc = trouMax(unBloc);
    // Journalisé pour l'inspection (comme les mesures notées d'`etalonnage`).
    console.log(`reglagesDeBase 8 bits — d'un bloc: ${nBloc} niveaux, trou max ${gBloc} ; empilé: ${nEmpile} niveaux`);

    // LE GATE : d'un bloc, au moins 130 niveaux distincts.
    expect(nBloc).toBeGreaterThanOrEqual(130);
    // ⚠️ CE SEUIL ÉTAIT À 3, ET IL PASSAIT POUR UNE MAUVAISE RAISON. Mesuré le
    // 2026-09-16 en portant la courbe paramétrique en CLOCHES : le trou de ce
    // réglage vaut 15 SANS aucune courbe paramétrique, 17 avec la seule paire
    // `exposure +1` / `shadows +60`, et 2 avec la courbe paramétrique seule. Il ne
    // vient donc PAS de la courbe — il vient de deux cloches dont l'exposant bas
    // est inférieur à 1 (`shadowKappa · shadowCenter` = 0,30), ce qui leur donne
    // une pente INFINIE au ras du noir. L'ancienne courbe à plateaux le MASQUAIT
    // en ramenant le bas à zéro ; les cloches ne le masquent plus, elles le
    // RÉDUISENT (15 → 10).
    //
    // Le seuil constate donc une DETTE, ce n'est pas une cible. Et « zéro trou »
    // n'en est pas une non plus : LIGHTROOM POSTE AUSSI — sa propre rampe
    // `ombres-p100` a un trou de 14 et commence par 0 → 11,5 → 24,5. Ce qui est
    // vrai, c'est qu'à réglage égal nous postons DEUX FOIS PLUS (trou 26 contre 14
    // à `shadows +100`, 14 contre 5 à +50).
    //
    // Aucune calibration ne rattrape ça : balayage complet de la famille `bump`
    // (91 × 196 couples centre/κ, amplitudes par signe ajustées à chaque point),
    // le meilleur écart moyen donne un début de rampe à 22,7 quand la mesure dit
    // 11,5, et le meilleur début fidèle coûte le DOUBLE d'écart moyen. C'est la
    // forme de la cloche qui est insuffisante pour l'opérateur d'ombres, pas ses
    // constantes — détail au ticket 02.
    //
    // Le seuil garde sa valeur de garde-fou : au-delà de 10, quelque chose a empiré.
    expect(gBloc).toBeLessThanOrEqual(10);
    // Et l'empilement en perd nettement — la démonstration de la raison d'être.
    expect(nEmpile).toBeLessThan(nBloc - 8);
  });

  // ── VIBRANCE ≠ SATURATION ─────────────────────────────────────────────────
  //
  // La différence DOIT se voir sur la peau : la vibrance protège les carnations,
  // la saturation non. Sur la carnation de `mirePrimaires` (224,160,128), la
  // chroma bouge MOINS en vibrance qu'en saturation, à dose égale.
  it("la vibrance protège la peau là où la saturation ne la protège pas", () => {
    const peau: Vec3 = [srgbToLinear(224 / 255), srgbToLinear(160 / 255), srgbToLinear(128 / 255)];
    const l = peau[0] * 0.2126 + peau[1] * 0.7152 + peau[2] * 0.0722;
    const chroma = (c: Vec3): number => {
      const lab = linearSrgbToOklab(c);
      return Math.hypot(lab[1], lab[2]);
    };
    const c0 = chroma(peau);
    const dVib = chroma(reglagesDeBaseSpec(peau, l, avec({ vibrance: 60 }))) - c0;
    const dSat = chroma(reglagesDeBaseSpec(peau, l, avec({ saturation: 60 }))) - c0;
    console.log(`peau : +chroma vibrance ${dVib.toFixed(4)} vs saturation ${dSat.toFixed(4)}`);
    // La saturation pousse la peau ; la vibrance l'y retient nettement.
    expect(dSat).toBeGreaterThan(0);
    expect(dVib).toBeLessThan(dSat * 0.6);
  });

  it("la vibrance pousse une couleur terne plus qu'une couleur déjà vive", () => {
    // Non-linéarité : à dose égale, un bleu peu saturé gagne plus de chroma qu'un
    // bleu saturé (hors peau).
    const terne: Vec3 = [srgbToLinear(0.45), srgbToLinear(0.5), srgbToLinear(0.62)];
    const vif: Vec3 = [srgbToLinear(0.05), srgbToLinear(0.1), srgbToLinear(0.9)];
    const chroma = (c: Vec3): number => { const lab = linearSrgbToOklab(c); return Math.hypot(lab[1], lab[2]); };
    const lT = terne[0] * 0.2126 + terne[1] * 0.7152 + terne[2] * 0.0722;
    const lV = vif[0] * 0.2126 + vif[1] * 0.7152 + vif[2] * 0.0722;
    const gainTerne = chroma(reglagesDeBaseSpec(terne, lT, avec({ vibrance: 80 }))) / chroma(terne);
    const gainVif = chroma(reglagesDeBaseSpec(vif, lV, avec({ vibrance: 80 }))) / chroma(vif);
    console.log(`vibrance : gain chroma terne ${gainTerne.toFixed(3)} vs vif ${gainVif.toFixed(3)}`);
    expect(gainTerne).toBeGreaterThan(gainVif);
  });
});
