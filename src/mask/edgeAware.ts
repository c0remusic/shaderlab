/**
 * Guided filter (He, Sun, Tang 2010) — étape 2 (design.md §4bis) : calcule
 * les coefficients linéaires locaux `a`/`b` tels que `q ≈ a*I + b` approxime
 * `p` localement, guidé par les statistiques de fenêtre de `I`. `eps` évite
 * la division par zéro quand la fenêtre de guide est plate (var_I = 0) —
 * PAS un paramètre exposé, une constante de stabilité numérique.
 *
 * `a`/`b` ne sont PAS bornés dans [0,1] (peuvent être négatifs ou > 1) — ne
 * jamais les stocker dans un format qui clampe (voir edgeAwareWgsl.ts,
 * format rg16float).
 */
export function computeGuidedAB(
  meanI: number,
  meanP: number,
  corrI: number,
  corrIp: number,
  eps = 1e-4
): { a: number; b: number } {
  // Math.max(..., 0): la variance est mathématiquement >= 0 ; la
  // cancellation corrI - meanI*meanI peut la faire ressortir légèrement
  // négative avec des intermédiaires en précision réduite (r16float côté
  // GPU) — sans ce plancher, varI + eps peut retomber à 0/négatif et
  // produire Infinity/NaN (finding codex-crosscheck HAUTE, commit 87ce5ad,
  // sur le générateur WGSL jumeau edgeAwareWgsl.ts).
  const varI = Math.max(corrI - meanI * meanI, 0);
  const covIp = corrIp - meanI * meanP;
  const a = covIp / (varI + eps);
  const b = meanP - a * meanI;
  return { a, b };
}

/**
 * Composite final (design.md §4bis étape 5) : `lerp(p, q, edgeStrength)`,
 * borné [0,1]. `edgeStrength=0` doit retourner EXACTEMENT `p` (pas une
 * approximation flottante) — test explicite requis par le design (pas de
 * dérive numérique visible quand l'utilisateur désactive l'edge-aware
 * visuellement sans changer `edgeAware`).
 */
export function composeEdgeAware(p: number, q: number, edgeStrength: number): number {
  if (edgeStrength <= 0) return p;
  if (edgeStrength >= 1) return Math.max(0, Math.min(1, q));
  const blended = p + (q - p) * edgeStrength;
  return Math.max(0, Math.min(1, blended));
}
