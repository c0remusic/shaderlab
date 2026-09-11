# Profils HSL de Lightroom 14.5, mesures différentielles (contre temoin2 — série contaminée par un virage constant, annulé par différence)

Par bande : Δteinte de sortie (°) en fonction de la teinte d'entrée (balayage sat 100 % L 50 %, pas 15°),
pour Teinte +100 (série 1, contre temoin) et −100 (série 2, contre temoin2). Puis pic, centre, largeur.

## rouge · +100 : pic +50.1° à 343°, actif 65° · −100 : pic -36.4° à 13°, actif 65° · sat −100 : min Δsat -0.79 à 4°, largeur 65° · sat +100 : max Δsat +0.12 (balayage déjà saturé) · lum +100 : max ΔL +0.249 à 336° ; lum −100 : min -0.445 · mélange N&B +100 : max ΔL +0.404 à 339° (≈, séries croisées)

## orange · +100 : pic +22.5° à 352°, actif 66° · −100 : pic -54.2° à 32°, actif 65° · sat −100 : min Δsat -0.91 à 39°, largeur 60° · sat +100 : max Δsat +0.09 (balayage déjà saturé) · lum +100 : max ΔL +0.246 à 32° ; lum −100 : min -0.516 · mélange N&B +100 : max ΔL +0.425 à 359° (≈, séries croisées)

## jaune · +100 : pic +38.6° à 55°, actif 46° · −100 : pic -22.1° à 49°, actif 48° · sat −100 : min Δsat -0.89 à 45°, largeur 39° · sat +100 : max Δsat +0.07 (balayage déjà saturé) · lum +100 : max ΔL +0.213 à 51° ; lum −100 : min -0.526 · mélange N&B +100 : max ΔL +0.425 à 359° (≈, séries croisées)

## vert · +100 : pic +77.2° à 82°, actif 112° · −100 : pic -87.6° à 97°, actif 107° · sat −100 : min Δsat -0.85 à 80°, largeur 107° · sat +100 : max Δsat +0.01 (balayage déjà saturé) · lum +100 : max ΔL +0.388 à 97° ; lum −100 : min -0.390 · mélange N&B +100 : max ΔL +0.425 à 359° (≈, séries croisées)

## aqua · +100 : pic +34.4° à 174°, actif 84° · −100 : pic -37.1° à 166°, actif 49° · sat −100 : min Δsat -0.90 à 172°, largeur 35° · sat +100 : max Δsat +0.00 (balayage déjà saturé) · lum +100 : max ΔL +0.441 à 172° ; lum −100 : min -0.181 · mélange N&B +100 : max ΔL +0.425 à 359° (≈, séries croisées)

## bleu · +100 : pic +88.4° à 202°, actif 111° · −100 : pic -50.3° à 278°, actif 114° · sat −100 : min Δsat -0.91 à 198°, largeur 103° · sat +100 : max Δsat +0.03 (balayage déjà saturé) · lum +100 : max ΔL +0.432 à 194° ; lum −100 : min -0.113 · mélange N&B +100 : max ΔL +0.542 à 239° (≈, séries croisées)

## violet · +100 : pic +55.5° à 222°, actif 114° · −100 : pic -84.4° à 298°, actif 107° · sat −100 : min Δsat -0.77 à 298°, largeur 100° · sat +100 : max Δsat +0.09 (balayage déjà saturé) · lum +100 : max ΔL +0.296 à 295° ; lum −100 : min -0.279 · mélange N&B +100 : max ΔL +0.578 à 239° (≈, séries croisées)

## magenta · +100 : pic +26.9° à 322°, actif 28° · −100 : pic -32.5° à 316°, actif 37° · sat −100 : min Δsat -0.67 à 325°, largeur 32° · sat +100 : max Δsat +0.11 (balayage déjà saturé) · lum +100 : max ΔL +0.270 à 321° ; lum −100 : min -0.435 · mélange N&B +100 : max ΔL +0.578 à 239° (≈, séries croisées)

## ⚠️ Contamination de la série 2 (hsl2/etal2/grading2/temoin2)

`ZERO` du plugin ne remettait pas les clés `SplitToning*` : le virage posé par
les deux premières mesures grading2 est resté collé sur TOUTE la série
(`temoin2` : gris −50/+11 · −92/+20 · −3/−0). Les profils ci-dessus sont donc
mesurés PAR DIFFÉRENCE à `temoin2`, ce qui annule la contamination au premier
ordre — valable pour les bandes HSL et l'étalonnage (structures locales),
INVALIDE pour le grading lui-même (la contamination EST du grading).
`mesures.lua` corrigé (ZERO += SplitToning*), liste `grading3` de 13 mesures
propres posée dans `Documents/shaderlab-mesures-extra.txt` — un clic
« mesurer les courbes » la consommera.
