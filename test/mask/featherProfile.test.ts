import { describe, it, expect } from "vitest";
import { FEATHER_WINDOWS, buildFeatherLookupWgsl } from "../../src/mask/refineEdgeWgsl";

/** Le feather vise depuis le 2026-08-19 un profil en S de type erf, mesuré
 *  chez Affinity au pixel (featherRasterSelection(32) piloté par leur SDK,
 *  alpha relu — audit du même jour, axe outils internes) : transition 10–90 %
 *  d'environ 1,0·rayon, soit σ ≈ 0,4·rayon, ~50 % au bord nominal, pentes
 *  douces aux DEUX extrémités. Le box une passe d'avant rendait une rampe :
 *  50 % au bord aussi, mais deux cassures franches (C0).
 *
 *  Ce test rejoue le lookup GPU en CPU — mêmes fenêtres, mêmes arrondis de
 *  rayon, même normalisation par compte — sur un bord droit idéal, et borne
 *  l'écart L∞ au erf cible. Même patron que la courbure des lames
 *  (test/render/effects/aperture.test.ts) : le modèle est une approximation
 *  DÉCLARÉE, le test dit de combien, en balayant les rayons — une borne posée
 *  sur un seul point s'est déjà révélée dix fois trop serrée. */

/** Moyenne de boîte 1D sur un bord échelon (masque = 1 pour t ≤ -1, 0 pour
 *  t ≥ 0), fenêtre [x-r, x+r] : le nombre de texels pleins dans la fenêtre
 *  vaut clamp(-(x-r), 0, 2r+1). Reproduit boxMean du WGSL, restreint à
 *  l'axe perpendiculaire au bord (les fenêtres sont carrées : sur un bord
 *  droit, l'autre axe moyenne des colonnes identiques et disparaît). */
function boxMeanOnEdge(x: number, r: number): number {
  const pleins = Math.min(Math.max(r - x, 0), 2 * r + 1);
  return pleins / (2 * r + 1);
}

/** Le profil rendu par le lookup : somme pondérée des quatre fenêtres, avec
 *  l'arrondi de rayon du shader (`max(round(radius * scale), 0)`). */
function featherProfile(x: number, radius: number): number {
  let acc = 0;
  for (const w of FEATHER_WINDOWS) {
    const r = Math.max(Math.round(radius * w.scale), 0);
    acc += boxMeanOnEdge(x, r) * w.weight;
  }
  return acc;
}

/** Fonction de répartition normale (cible erf), Abramowitz-Stegun 7.1.26 —
 *  précision 1,5e-7, très au-delà du besoin (les bornes sont en centièmes). */
function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const poly =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erfAbs = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + erfAbs) : 0.5 * (1 - erfAbs);
}

const SIGMA_PER_RADIUS = 0.4;

describe("FEATHER_WINDOWS — les constantes elles-mêmes", () => {
  it("quatre fenêtres, poids normalisés à 1, échelles décroissantes toutes > 0", () => {
    expect(FEATHER_WINDOWS).toHaveLength(4);
    const somme = FEATHER_WINDOWS.reduce((s, w) => s + w.weight, 0);
    expect(Math.abs(somme - 1)).toBeLessThan(1e-9);
    for (let i = 1; i < FEATHER_WINDOWS.length; i++)
      expect(FEATHER_WINDOWS[i].scale).toBeLessThan(FEATHER_WINDOWS[i - 1].scale);
    expect(FEATHER_WINDOWS.at(-1)!.scale).toBeGreaterThan(0);
  });

  it("le WGSL généré porte les quatre fenêtres et son entry point dédié", () => {
    const wgsl = buildFeatherLookupWgsl();
    expect(wgsl).toContain("fs_featherLookup");
    expect(wgsl).toContain("array<vec2<f32>, 4>");
    for (const w of FEATHER_WINDOWS) expect(wgsl).toContain(w.scale.toFixed(6));
  });
});

describe("profil du feather — un S de type erf, pas une rampe", () => {
  it("écart L∞ au erf(σ=0,4r) ≤ 0,045 pour r=8..64", () => {
    for (const r of [8, 12, 16, 24, 32, 48, 64]) {
      const sigma = SIGMA_PER_RADIUS * r;
      let worst = 0;
      for (let x = -Math.ceil(1.2 * r); x <= Math.ceil(1.2 * r); x++) {
        const got = featherProfile(x, r);
        // Le modèle discret place le bord entre les texels -1 et 0 : le erf
        // continu équivalent est centré sur -0,5.
        const want = 1 - phi((x + 0.5) / sigma);
        worst = Math.max(worst, Math.abs(got - want));
      }
      expect(worst, `r=${r} L∞=${worst.toFixed(4)}`).toBeLessThanOrEqual(0.045);
    }
  });

  it("la PENTE décroît vers les extrémités : plus douce à 90 % qu'à 50 % (r=16, 32)", () => {
    // C'est la propriété que la rampe n'a PAS : sa pente est constante puis
    // tombe à zéro d'un coup. Ici la pente au voisinage de 90 % doit valoir
    // moins de 60 % de la pente au centre.
    for (const r of [16, 32]) {
      const penteEn = (niveau: number) => {
        let xAt = 0;
        for (let x = -2 * r; x <= 2 * r; x++)
          if (featherProfile(x, r) >= niveau) xAt = x;
        return featherProfile(xAt, r) - featherProfile(xAt + 1, r);
      };
      const centre = penteEn(0.5);
      const haut = penteEn(0.9);
      expect(haut, `r=${r}`).toBeLessThan(0.6 * centre);
    }
  });

  it("~50 % au bord nominal, monotone décroissant, plein/vide aux extrêmes (r=8..64)", () => {
    for (const r of [8, 16, 32, 64]) {
      const auBord = featherProfile(0, r);
      expect(Math.abs(auBord - 0.5), `r=${r} bord=${auBord.toFixed(3)}`).toBeLessThanOrEqual(0.06);
      let prev = Infinity;
      for (let x = -2 * r; x <= 2 * r; x++) {
        const v = featherProfile(x, r);
        expect(v).toBeLessThanOrEqual(prev + 1e-12);
        prev = v;
      }
      expect(featherProfile(-2 * r, r)).toBeCloseTo(1, 6);
      expect(featherProfile(2 * r, r)).toBeCloseTo(0, 6);
    }
  });

  it("petits rayons : r=1..4 restent monotones et bornés, sans promettre le S", () => {
    // À r=2, deux des quatre fenêtres tombent à rayon 0 (identité) : le
    // profil se rapproche du box — inévitable en discret, et documenté. On
    // verrouille seulement que rien ne déborde ni ne remonte.
    for (const r of [1, 2, 3, 4]) {
      let prev = Infinity;
      for (let x = -3 * r - 2; x <= 3 * r + 2; x++) {
        const v = featherProfile(x, r);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(prev + 1e-12);
        prev = v;
      }
    }
  });
});
