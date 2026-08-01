import { describe, it, expect } from "vitest";
import { grain, GRAIN_REFERENCE_EDGE, GRAIN_VALUE_NOISE_GAIN } from "../../../src/render/effects/grain";
import { linearToSrgb, srgbToLinear } from "../../../src/render/effects/srgbTransfer";

/** Courbe de réponse du shader, transcrite à l'identique : l'entrée est la
 *  luma LINÉAIRE (ce que rend textureSample sur une texture -srgb). */
function response(lumaLinear: number): number {
  const tone = linearToSrgb(lumaLinear);
  return 4 * tone * (1 - tone);
}

/** Ancienne courbe (avant correction), gardée pour prouver le déplacement. */
function responseAvant(lumaLinear: number): number {
  return 4 * lumaLinear * (1 - lumaLinear);
}

function argmaxPerceptuel(f: (luma: number) => number): number {
  let best = 0;
  let bestValue = -Infinity;
  for (let i = 0; i <= 10000; i++) {
    const luma = i / 10000;
    const v = f(luma);
    if (v > bestValue) {
      bestValue = v;
      best = luma;
    }
  }
  return linearToSrgb(best);
}

describe("grain — courbe de réponse posée sur la luminance perceptuelle", () => {
  it("atteint son maximum dans les DEMI-TONS perceptuels (0.5)", () => {
    expect(argmaxPerceptuel(response)).toBeCloseTo(0.5, 3);
  });

  it("prouve le déplacement : l'ancienne courbe culminait à ~0.735 perceptuel", () => {
    // Pic dans les hautes lumières au lieu des demi-tons — le bug corrigé.
    expect(argmaxPerceptuel(responseAvant)).toBeCloseTo(0.7354, 3);
  });

  it("s'annule aux deux extrémités et reste bornée à 1", () => {
    expect(response(0)).toBeCloseTo(0, 12);
    expect(response(1)).toBeCloseTo(0, 12);
    expect(response(srgbToLinear(0.5))).toBeCloseTo(1, 6);
  });

  it("évalue la courbe sur linear_to_srgb(luma) dans le WGSL", () => {
    expect(grain.wgsl).toContain("let tone = linear_to_srgb(luma);");
    expect(grain.wgsl).toContain("let reponseArgentique = 4.0 * tone * (1.0 - tone);");
    expect(grain.wgsl).toMatch(/fn linear_to_srgb\(c: f32\)/);
  });

  it("laisse la couleur de sortie en linéaire (pas de double gamma)", () => {
    // L'invariant tenu ici n'est PAS la forme littérale de la ligne de sortie,
    // c'est que `color.rgb` n'est jamais ré-encodé : on lui ajoute un delta
    // LINÉAIRE, et rien d'autre. Le delta est désormais calculé en repassant
    // par la fonction de transfert partagée — voir le test d'amplitude
    // ci-dessous pour ce que ça change réellement.
    // Mise à jour 2026-08-01 : le delta est devenu un vec3 (un bruit par
    // couche d'émulsion) au lieu d'un scalaire répliqué. Le pivot `base` est
    // sorti en variable parce qu'il est maintenant lu trois fois — il reste le
    // ton de LUMINANCE, commun aux trois canaux, donc c'est bien le bruit qui
    // diffère par canal et non la réponse tonale.
    expect(grain.wgsl).toContain("let base = srgb_to_linear(tone);");
    expect(grain.wgsl).toContain("return vec4<f32>(color.rgb + (perturbe - vec3<f32>(base)), color.a);");
    expect(grain.wgsl).not.toMatch(/linear_to_srgb\(\s*color/);
    expect(grain.wgsl).not.toMatch(/srgb_to_linear\(\s*color/);
  });
});

/** Nombre de cellules de grain traversées le long du GRAND CÔTÉ, transcrit du
 *  shader : `gp = uv * (dims / longEdge) * cells`. Sur le grand côté,
 *  `dims/longEdge` vaut 1 et `uv` va de 0 à 1 — la portée vaut donc `cells`. */
function cellulesSurGrandCote(largeur: number, hauteur: number, size: number): number {
  const longEdge = Math.max(largeur, hauteur);
  const cells = GRAIN_REFERENCE_EDGE / size;
  return (longEdge / longEdge) * cells;
}

/** Ce que donnait la maille d'AVANT : `gp = (uv * dims) / size`, donc une portée
 *  de `longEdge / size` cellules — proportionnelle à la définition de la photo. */
function cellulesSurGrandCoteAvant(largeur: number, hauteur: number, size: number): number {
  return Math.max(largeur, hauteur) / size;
}

describe("grain — maille indépendante de la définition de la photo", () => {
  // Ce bloc existe parce que le curseur « Taille » prétendait décrire une taille
  // de grain physique et décrivait en fait une taille en pixels de SORTIE : le
  // même réglage rendait un grain deux fois plus gros, relativement au cadre,
  // sur une photo deux fois plus définie.
  const SIZE = 2;

  it("compte le même nombre de cellules en 24 MP et en 6 MP", () => {
    const en24MP = cellulesSurGrandCote(6000, 4000, SIZE);
    const en6MP = cellulesSurGrandCote(3000, 2000, SIZE);
    expect(en24MP).toBeCloseTo(en6MP, 9);
    expect(en24MP).toBeCloseTo(GRAIN_REFERENCE_EDGE / SIZE, 9);
  });

  it("prouve le déplacement : l'ancienne maille doublait avec la définition", () => {
    const en24MP = cellulesSurGrandCoteAvant(6000, 4000, SIZE);
    const en6MP = cellulesSurGrandCoteAvant(3000, 2000, SIZE);
    expect(en24MP / en6MP).toBeCloseTo(2, 9);
  });

  it("garde des cellules carrées sur une photo non carrée", () => {
    // Le facteur dims/longEdge conserve l'aspect : sans lui, la maille serait
    // étirée et le grain se lirait peigné sur un ciel.
    expect(grain.wgsl).toContain("uv * (dims / longEdge) * cells");
  });

  it("lie le modèle au WGSL livré : la référence est celle du shader", () => {
    // Même doctrine que le `toContain` du bloc précédent — les fonctions
    // ci-dessus MODÉLISENT la maille, cette ligne prouve que le shader utilise
    // bien la même constante.
    expect(grain.wgsl).toContain(`let cells = ${GRAIN_REFERENCE_EDGE} / size;`);
  });

  it("ne s'applique QU'À l'analogique — le bruit de capteur reste lié au pixel", () => {
    // La maille numérique est délibérément dépendante de la définition : un
    // capteur a une grille physique. Confondre les deux mailles effacerait la
    // différence de nature entre les deux modes.
    expect(grain.wgsl).toContain("let dp = floor(uv * dims / size) + jitter;");
  });
});

describe("grain — deux modes, deux physiques", () => {
  const reponseArgentique = (tone: number) => 4 * tone * (1 - tone);
  const reponseCapteur = (tone: number) => 1 - 0.85 * tone;

  it("l'argentique culmine au demi-ton, le capteur dans les ombres", () => {
    expect(argmaxSurTonePerceptuel(reponseArgentique)).toBeCloseTo(0.5, 3);
    expect(argmaxSurTonePerceptuel(reponseCapteur)).toBeCloseTo(0, 3);
  });

  it("l'argentique s'annule aux deux bouts, le capteur jamais", () => {
    // Un film ne grène ni le noir pur ni le blanc pur (Dehancer) ; un capteur
    // grouille jusque dans le noir absolu, c'est le bruit de lecture.
    expect(reponseArgentique(0)).toBeCloseTo(0, 12);
    expect(reponseArgentique(1)).toBeCloseTo(0, 12);
    expect(reponseCapteur(0)).toBeGreaterThan(0.9);
    expect(reponseCapteur(1)).toBeGreaterThan(0.1);
  });

  it("les deux courbes sont bien OPPOSÉES, ce qui interdit de les interpoler", () => {
    // C'est l'argument qui fait du mode un CHOIX et non un curseur : une moyenne
    // des deux ne modélise ni un film ni un capteur. On le mesure plutôt que de
    // l'affirmer — au quart de ton, le capteur domine ; au demi-ton, le film.
    expect(reponseCapteur(0.05)).toBeGreaterThan(reponseArgentique(0.05));
    expect(reponseArgentique(0.5)).toBeGreaterThan(reponseCapteur(0.5));
  });

  it("le WGSL sélectionne les deux courbes sur le même drapeau que les deux bruits", () => {
    expect(grain.wgsl).toContain("let couches = select(analogique, capteur, numerique);");
    expect(grain.wgsl).toContain("let response = select(reponseArgentique, reponseCapteur, numerique);");
  });
});

/** Écart-type délivré par le mélange luminance/couches, AVANT normalisation.
 *  Pour trois bruits indépendants d'écart-type 1 :
 *    Var = (1-t)^2/3 + t^2 + 2t(1-t)/3 = 1/3 + (2/3)t^2
 *  Le terme croisé n'est pas nul — nLuma CONTIENT le bruit du canal. */
function ecartTypeAvantNormalisation(chroma: number): number {
  return Math.sqrt(1 / 3 + (2 / 3) * chroma * chroma);
}

describe("grain — la chrominance ne change QUE la couleur, jamais la force", () => {
  // Ce bloc existe parce que le correctif évident (un simple `mix`) fait varier
  // la force apparente sur la seule course du curseur de chrominance, ce qui
  // ferait de `chroma` un second réglage d'intensité déguisé.
  it("sans normalisation, passer de 0 à 1 renforcerait le grain de ~73 %", () => {
    const ratio = ecartTypeAvantNormalisation(1) / ecartTypeAvantNormalisation(0);
    expect(ratio).toBeCloseTo(Math.sqrt(3), 6);
    expect(ratio).toBeGreaterThan(1.73);
  });

  it("la forme fermée est bien la variance du mélange (dérivation indépendante)", () => {
    // Dérivation par les COEFFICIENTS, sans réutiliser la forme fermée — sinon
    // le test ne garderait que sa propre copie de l'algèbre.
    //   Y_r = (1-t)(X_r+X_g+X_b)/3 + t·X_r
    //       = X_r·[(1-t)/3 + t] + X_g·(1-t)/3 + X_b·(1-t)/3
    // Les X sont indépendants d'écart-type 1, donc Var(Y) = somme des carrés.
    for (const t of [0, 0.25, 0.3, 0.5, 0.75, 1]) {
      const a = (1 - t) / 3 + t;
      const b = (1 - t) / 3;
      const varianceParCoefficients = a * a + b * b + b * b;
      expect(Math.sqrt(varianceParCoefficients)).toBeCloseTo(ecartTypeAvantNormalisation(t), 12);
    }
  });

  it("après normalisation, l'écart-type délivré vaut 1 partout", () => {
    for (const t of [0, 0.25, 0.3, 0.5, 0.75, 1]) {
      const a = (1 - t) / 3 + t;
      const b = (1 - t) / 3;
      const delivre = Math.sqrt(a * a + 2 * b * b) / ecartTypeAvantNormalisation(t);
      expect(delivre).toBeCloseTo(1, 12);
    }
  });

  it("le WGSL divise bien par cet écart-type", () => {
    expect(grain.wgsl).toContain("sqrt(1.0 / 3.0 + (2.0 / 3.0) * chroma * chroma)");
  });
});

describe("grain — les deux modes délivrent la même force à intensité égale", () => {
  it("compense l'écart-type moindre du bruit de valeur", () => {
    // `hash` est uniforme sur [0,1) ; `valueNoise` interpole quatre tirages par
    // des poids smoothstep, ce qui réduit sa variance. Facteur dérivé dans
    // GRAIN_VALUE_NOISE_GAIN : écart-type relatif 0.743 en 2D.
    expect(GRAIN_VALUE_NOISE_GAIN).toBeCloseTo(1 / 0.743, 9);
    // Sans compensation, basculer de mode renforcerait le grain de ~35 % sans
    // qu'aucun curseur ne bouge.
    expect(GRAIN_VALUE_NOISE_GAIN).toBeGreaterThan(1.3);
    expect(GRAIN_VALUE_NOISE_GAIN).toBeLessThan(1.4);
  });

  it("applique le gain au bruit analogique et à lui seul", () => {
    expect(grain.wgsl).toContain(`) * ${GRAIN_VALUE_NOISE_GAIN};`);
  });
});

/** Amplitude PERCEPTUELLE réellement délivrée pour un bruit à pleine échelle
 *  (±0.5), à l'intensité par défaut du paramètre. C'est ce que l'œil voit —
 *  distinct de `response`, qui n'est que le scalaire de pondération. */
const INTENSITE_DEFAUT = 0.12;
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

function amplitudeDelivree(tonePerceptuel: number): number {
  const luma = srgbToLinear(tonePerceptuel);
  const demiAmplitude = 0.5 * INTENSITE_DEFAUT * response(luma);
  // Décalage posé sur le ton perceptuel, ramené en linéaire : en perceptuel,
  // l'écart délivré vaut exactement le décalage demandé.
  return clamp01(tonePerceptuel + demiAmplitude) - clamp01(tonePerceptuel - demiAmplitude);
}

/** Ce que délivrait l'ADDITION LINÉAIRE d'avant : la même demi-amplitude, mais
 *  ajoutée à la luma linéaire, donc dilatée par la compression sRGB. */
function amplitudeDelivreeAvant(tonePerceptuel: number): number {
  const luma = srgbToLinear(tonePerceptuel);
  const demiAmplitude = 0.5 * INTENSITE_DEFAUT * response(luma);
  return linearToSrgb(clamp01(luma + demiAmplitude)) - linearToSrgb(clamp01(luma - demiAmplitude));
}

function argmaxSurTonePerceptuel(f: (tone: number) => number): number {
  let best = 0;
  let bestValue = -Infinity;
  for (let i = 0; i <= 10000; i++) {
    const tone = i / 10000;
    const v = f(tone);
    if (v > bestValue) {
      bestValue = v;
      best = tone;
    }
  }
  return best;
}

describe("grain — amplitude réellement délivrée, pas seulement la pondération", () => {
  // Ce bloc existe parce que les tests de pondération ci-dessus étaient VERTS
  // pendant que le défaut existait : ils vérifiaient que la COURBE culmine au
  // demi-ton, jamais que le grain délivré le fasse. Une pondération
  // perceptuelle ajoutée linéairement ne produit pas un écart perceptuel
  // constant — la compression sRGB l'amplifie dans les ombres.
  //
  // LIMITE À CONNAÎTRE : ce bloc MODÉLISE le shader, il ne le lit pas. Il
  // verrouille la physique visée, pas le WGSL livré — une réécriture du shader
  // le laisserait vert. Ce qui relie les deux est le `toContain` verbatim du
  // bloc précédent, et c'est bien lui qui a rougi quand la ligne de sortie a
  // changé. Les deux gardes sont nécessaires ; aucune ne remplace l'autre.
  it("culmine au demi-ton perceptuel (0.50)", () => {
    expect(argmaxSurTonePerceptuel(amplitudeDelivree)).toBeCloseTo(0.5, 3);
  });

  it("prouve le déplacement : l'addition linéaire culminait à ~0.2268, dans les ombres", () => {
    expect(argmaxSurTonePerceptuel(amplitudeDelivreeAvant)).toBeCloseTo(0.2268, 3);
  });

  it("n'écrête plus le noir dans les ombres profondes", () => {
    // Au ton 0.10, l'addition linéaire poussait la borne basse sous zéro.
    const luma = srgbToLinear(0.1);
    const demiAmplitude = 0.5 * INTENSITE_DEFAUT * response(luma);
    expect(luma - demiAmplitude).toBeLessThan(0);
    expect(0.1 - demiAmplitude).toBeGreaterThan(0);
  });
});
