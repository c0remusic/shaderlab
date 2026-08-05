/**
 * STRUCTURE SPATIALE d'un delta entre deux frames — l'instrument qui distingue
 * « du hasard par pixel » de « des grappes ».
 *
 * D'OÙ ÇA VIENT. Le 2026-08-05, `grain` a été accusé de tirer un nombre au
 * hasard par pixel, sur la foi d'une mesure faite… sur `Math.random()`. Le
 * shader, lui, utilise `valueNoise` — corrélé spatialement par construction.
 * Mesuré ensuite pour de vrai : **survie 0,81**, contre 0,50 pour un bruit
 * blanc et 0,78 à 0,94 pour de vraies pellicules scannées. L'accusation était
 * fausse, et seule cette mesure pouvait le dire.
 *
 * LE PRINCIPE. Moyenner des blocs de 4×4 fait chuter l'écart-type d'un bruit
 * BLANC (16 échantillons indépendants s'annulent), et beaucoup moins celui d'un
 * bruit CORRÉLÉ, dont les motifs débordent du bloc. Le RAPPORT des deux
 * écarts-types est donc sans dimension et indépendant de l'amplitude : il ne
 * décrit que la structure.
 *
 * POURQUOI ICI ET PAS DANS `App.tsx`. Ce code y a d'abord été écrit, et ses
 * deux cents lignes ont fait ABANDONNER le compilateur React sur toute la
 * racine de composition : les huit `eslint-disable react-hooks/refs` du fichier
 * sont devenus « inutiles » d'un coup, c'est-à-dire que la règle avait cessé de
 * s'appliquer partout. Un outil de diagnostic qui éteint un contrôle réel n'est
 * pas un bon échange. `App.tsx` ne garde que le câblage.
 *
 * PUR : ni DOM, ni GPU, ni React. Testable en Node.
 */

export interface FrameLike {
  pixels: Uint8Array;
  width: number;
  height: number;
}

export interface StructureMesuree {
  /** Écart-type du delta à pleine résolution. */
  plein: number;
  /** Écart-type après moyennage par blocs de `BLOC`×`BLOC`. */
  reduit: number;
  /** `reduit / plein`. **C'est le seul chiffre qui porte l'information** :
   *  les deux autres varient avec l'intensité réglée, celui-ci non. */
  survie: number;
}

/** Côté du bloc de moyennage. Quatre : assez pour que seize échantillons
 *  indépendants s'annulent visiblement (facteur 4 attendu sur du bruit blanc),
 *  assez peu pour qu'un grain de deux ou trois pixels survive s'il existe. */
export const BLOC = 4;

function ecartType(valeurs: Float32Array): number {
  if (valeurs.length === 0) return 0;
  let somme = 0;
  for (const v of valeurs) somme += v;
  const moyenne = somme / valeurs.length;
  let carres = 0;
  for (const v of valeurs) {
    const d = v - moyenne;
    carres += d * d;
  }
  return Math.sqrt(carres / valeurs.length);
}

/** Luminance perceptuelle, même pondération que partout ailleurs dans le dépôt. */
function luminance(pixels: Uint8Array, offset: number): number {
  return 0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2];
}

/**
 * Compare deux frames de MÊMES dimensions et mesure la structure de leur
 * différence. Rend `null` si les dimensions diffèrent — comparer des frames de
 * tailles différentes n'a pas de sens, et un repli silencieux rendrait un
 * chiffre qui a l'air d'une mesure.
 *
 * Le DELTA et pas la frame : sans lui on mesurerait le détail de la photo, qui
 * écrase de plusieurs ordres de grandeur ce qu'un calque ajoute.
 */
export function mesurerStructureAjoutee(reference: FrameLike, apres: FrameLike): StructureMesuree | null {
  if (reference.width !== apres.width || reference.height !== apres.height) return null;
  const { width, height } = apres;
  const delta = new Float32Array(width * height);
  for (let i = 0, p = 0; i < delta.length; i += 1, p += 4) {
    delta[i] = luminance(apres.pixels, p) - luminance(reference.pixels, p);
  }

  const bw = Math.floor(width / BLOC);
  const bh = Math.floor(height / BLOC);
  const bloque = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by += 1) {
    for (let bx = 0; bx < bw; bx += 1) {
      let somme = 0;
      for (let y = 0; y < BLOC; y += 1) {
        for (let x = 0; x < BLOC; x += 1) {
          somme += delta[(by * BLOC + y) * width + (bx * BLOC + x)];
        }
      }
      bloque[by * bw + bx] = somme / (BLOC * BLOC);
    }
  }

  const plein = ecartType(delta);
  const reduit = ecartType(bloque);
  return { plein, reduit, survie: plein > 0 ? reduit / plein : 0 };
}
