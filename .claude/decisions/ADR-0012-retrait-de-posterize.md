---
id: ADR-0012
status: active
date: 2026-08-03
---

# ADR-0012 : `posterize` sort du registre, couvert par `dither`

## Contexte

`dither` a été écrit le 2026-08-03 comme **surensemble revendiqué** de
`posterize` : son propre fichier le dit en toutes lettres (« ce n'est pas le
tramage de `posterize` […] ici le motif EST le sujet »), et son commit s'intitule
« surensemble de posterize, et quatre trames de plus ».

Un surensemble revendiqué n'est pas un surensemble prouvé. Tant que les deux
effets coexistaient, la revendication n'était opposable à rien : les deux
scénarios de rendu de `posterize` tournaient sur `posterize`, et rien ne vérifiait
que `dither` savait faire ce qu'il prétendait remplacer.

## Décision

**`posterize` est retiré du registre** (arbitrage d'Antoine, 2026-08-03).

**La couverture a été PROUVÉE avant le retrait, pas affirmée.** Le scénario
`effet-posterize-serigraphie` — le rendu d'aplats, tramage éteint, plage d'entrée
resserrée, axe perceptuel — a été porté mot pour mot sur `dither` sous le nom
`effet-dither-serigraphie`, avec les réglages qui traduisent l'équivalence :

| `posterize`      | `dither`                        |
|------------------|---------------------------------|
| `dither: 0`      | `amount: 0` (trame éteinte)     |
| (par canal)      | `mono: 0`                       |
| `distribution`   | `distribution` (même axe)       |
| `levels`, `blackPoint`, `whitePoint` | identiques  |

Le scénario déclare **32 valeurs distinctes**, et `dither` les rend exactement :
« 32 valeur(s) distincte(s), conforme a sa declaration ». Quatre paliers par canal
ne peuvent produire que 4³ couleurs au plus, et la mire n'en exerce que 32 — un
compte bas EST la propriété. C'est cette égalité de compte, sur la mire qui a
servi à juger l'original, qui autorise le retrait.

Le second scénario, `effets-glow-posterize`, est renommé `effets-glow-dither` :
il verrouille la COMPOSITION (cinq passes internes, deux opacités, deux modes de
fusion) et non la quantification, donc il survit au changement d'effet.

## Conséquences

- **Un preset qui cite `posterize` perd ce calque, il ne casse pas** — même
  mécanisme qu'ADR-0011 (`presetDocument.ts` ignore l'id et pousse un
  avertissement).
- **Les défauts des deux effets DIVERGENT, et c'est délibéré.** `posterize`
  répartissait ses paliers sur l'axe linéaire, `dither` sur l'axe perceptuel. Le
  retrait ne rend donc pas `dither` identique à `posterize` sur ses défauts : il
  le rend *capable* de faire la même chose, en un réglage. La raison est écrite
  dans `dither.ts` — un tramage rend un DÉGRADÉ, donc ses niveaux ont intérêt à
  être également espacés à l'œil ; un posterize fait des APLATS, où le choix est
  une décision de look que le §5 du cahier laissait explicitement ouverte.
- **`bayer.ts` survit** : `dither` s'en sert pour deux de ses six styles (Bayer
  8×8 et Bayer fin 4×4). L'en-tête du fichier disait « utilisée par `posterize` »,
  ce qui n'est plus vrai — le fichier a été corrigé, pas supprimé.
- **La moitié WGSL de `posterizeDither.test.ts` a été REPORTÉE sur `dither`**, pas
  supprimée, et le fichier renommé `bayerDither.test.ts`. Les propriétés qu'elle
  vérifiait — tramer avant de quantifier, en coordonnées pixel, sans source
  temporelle, sans division par zéro — ne tenaient pas à l'effet mais à
  l'opération. Même leçon qu'ADR-0011 : ce qui est rangé dans le fichier d'un
  effet disparaît avec lui, en silence.
- **Le registre passe de vingt-deux à vingt et un effets** (après le retrait de
  `surfaceBlur`, ADR-0011, le même jour).

## Alternatives écartées

- **Garder `posterize` comme raccourci.** Cinq curseurs pour aplatir sont plus
  directs que quatorze, et l'argument est réel. Mais deux entrées pour une
  quantification obligent à choisir entre elles à chaque fois qu'on ajoute un
  calque, alors qu'un seul réglage sépare les deux rendus. Le coût est payé à
  chaque usage, l'économie une seule fois.
- **Retirer `posterize` sans porter ses scénarios.** C'était le geste rapide, et
  il aurait supprimé la seule preuve que le remplacement tient. Le rendu
  sérigraphie EST la propriété qui justifie le retrait : elle devait devenir
  opposable *avant* qu'on l'invoque.
