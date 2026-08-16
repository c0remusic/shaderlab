#!/usr/bin/env node
/**
 * GARDE DES BLOCS DE COMMENTAIRE CSS — un piège payé TROIS fois le 2026-08-16,
 * dans le même fichier et dans la même session.
 *
 * LE GESTE FAUTIF. Éditer un bloc de commentaire en insérant de la prose APRÈS
 * son `*​/` de fermeture, puis en refermant avec un second `*​/` :
 *
 *     ... fin du commentaire d'origine. *​/
 *        ⚠️ Mon ajout, qui croit être dans le commentaire.
 *        ... et qui referme. *​/
 *     .ma-regle { ... }
 *
 * POURQUOI RIEN NE L'ATTRAPE AUJOURD'HUI. Le compte de `/​*` et de `*​/` reste
 * ÉQUILIBRÉ — vérifié, 53 contre 53 — donc compter ne dit rien. `npm run
 * lint:tokens` ne parse pas le CSS, `tsc` ne le voit pas, et les stories
 * chargent le CSS par Vite, qui échoue... en servant l'ANCIENNE version.
 *
 * LE SYMPTÔME NE NOMME JAMAIS LA CAUSE. Vite rend :
 *
 *     Pre-transform error: Unterminated string: 'est la variante C'
 *
 * — l'apostrophe de « c'est », des lignes plus bas, et pas un mot sur le
 * commentaire mal fermé. Pire : la page CONTINUE de servir le CSS d'avant, donc
 * une mesure dans l'app rapporte les anciennes valeurs. La deuxième fois, ça m'a
 * fait chercher un problème de spécificité CSS pendant plusieurs minutes sur une
 * règle qui n'avait jamais été chargée.
 *
 * CE QUE CETTE GARDE VÉRIFIE. Un balayage à un seul état : hors commentaire, un
 * `*​/` est forcément orphelin. C'est exactement le défaut ci-dessus, et ça ne
 * peut pas produire de faux positif — `*​/` n'a aucun autre sens en CSS hors
 * chaîne de caractères.
 *
 * Usage : node scripts/css-comment-guard.mjs [fichier.css ...]
 * Sans argument, balaye tous les `.css` de `src/`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function fichiersCss(racine) {
  const sortie = [];
  for (const entree of readdirSync(racine)) {
    const chemin = join(racine, entree);
    if (statSync(chemin).isDirectory()) sortie.push(...fichiersCss(chemin));
    else if (entree.endsWith(".css")) sortie.push(chemin);
  }
  return sortie;
}

/** Position (ligne, colonne) d'un index dans une source. */
function situer(source, index) {
  const avant = source.slice(0, index);
  const ligne = avant.split("\n").length;
  const colonne = index - avant.lastIndexOf("\n");
  return { ligne, colonne };
}

/** Fermetures de commentaire ORPHELINES, c'est-à-dire rencontrées hors
 *  commentaire. Balaye caractère par caractère plutôt qu'en regex : une regex
 *  ne sait pas tenir l'état « suis-je dans un commentaire ». */
function orphelines(source) {
  const trouvees = [];
  let dansCommentaire = false;
  for (let i = 0; i < source.length - 1; i++) {
    const paire = source[i] + source[i + 1];
    if (!dansCommentaire && paire === "/*") {
      dansCommentaire = true;
      i++;
    } else if (dansCommentaire && paire === "*/") {
      dansCommentaire = false;
      i++;
    } else if (!dansCommentaire && paire === "*/") {
      trouvees.push(situer(source, i));
      i++;
    }
  }
  return { trouvees, commentaireNonFerme: dansCommentaire };
}

const cibles = process.argv.slice(2);
const fichiers = cibles.length > 0 ? cibles : fichiersCss("src");
let defauts = 0;

for (const fichier of fichiers) {
  const source = readFileSync(fichier, "utf8");
  const { trouvees, commentaireNonFerme } = orphelines(source);
  for (const { ligne, colonne } of trouvees) {
    console.error(
      `${fichier}:${ligne}:${colonne}  fermeture de commentaire ORPHELINE — ` +
        `la prose au-dessus n'est pas dans un commentaire. ` +
        `Cause habituelle : un bloc rouvert après son propre \`*/\`.`,
    );
    defauts++;
  }
  if (commentaireNonFerme) {
    console.error(`${fichier}  commentaire ouvert et jamais fermé.`);
    defauts++;
  }
}

if (defauts > 0) {
  console.error(`\n${defauts} défaut(s) sur ${fichiers.length} fichier(s).`);
  process.exit(1);
}
console.log(`Commentaires CSS équilibrés — ${fichiers.length} fichier(s).`);
