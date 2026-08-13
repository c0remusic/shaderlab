#!/usr/bin/env node
// PostToolUse guard : de la prose francaise inseree par SCRIPT ressort corrompue.
// Trois occurrences constatees, dont deux le 2026-08-12 — la derniere quelques
// heures apres qu'une memoire eut ete ecrite sur le sujet. La regle existe dans
// CLAUDE.md (« preferer l'outil Edit a un script pour la prose francaise ») et
// elle ne se declenche pas au moment d'agir : c'est pour ca que ce garde existe.
//
// Meme parti pris que wgsl-backtick-guard.mjs, dont l'en-tete rappelle qu'une
// premiere version trop large flaguait 23 fichiers sur 41 : LA PRECISION DU
// DECLENCHEUR EST LE SUJET. Un garde bruyant se fait ignorer, donc il ne vaut
// rien. Trois restrictions le tiennent :
//
//   1. Un fichier SANS aucun accent n'est jamais analyse pour la 3e famille.
//      Beaucoup de fichiers de ce depot sont deliberement non accentues (les
//      messages de commit, les commentaires de scenario de render-check.mjs) et
//      les punir noierait le signal.
//   2. La liste de mots ne contient QUE des formes qui ne sont pas des mots
//      francais valides. « verrouille » en est absent : c'est un verbe conjugue
//      correct, et il a produit un faux positif reel le 2026-08-12.
//   3. Sur Bash, seuls les fichiers ecrits dans les 15 dernieres secondes sont
//      regardes — sinon le garde signale du mojibake preexistant sans rapport
//      avec la commande qui vient de tourner.
//
// Deux familles BLOQUENT (corruption jamais legitime), une AVERTIT (heuristique).
// Sortie : JSON {decision:"block"} sur corruption, texte simple sur suspicion.

import { readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// Les deux familles de CORRUPTION valent partout : du mojibake dans un .ts est
// un degat comme ailleurs. La famille heuristique, elle, se restreint a EXT_PROSE.
const EXT_TEXTE = /\.(md|txt|json|ts|tsx|js|mjs|css|html|ps1|rs|toml|yml|yaml)$/i
const EXT_PROSE = /\.(md|txt)$/i
const FENETRE_MS = 15_000

// --- Famille 1 : un echappement \uXXXX qui a perdu son antislash. C'est ce qui
// produit « poignu00e9es » au lieu de « poignees ». Jamais legitime dans de la
// prose : en code, la sequence est precedee d'un antislash, pas d'une lettre.
const ECHAPPEMENT_NU = /[A-Za-zÀ-ÿ]u00[0-9a-f]{2}/g

// --- Famille 2 : de l'UTF-8 relu en latin-1. Jamais legitime nulle part.
const MOJIBAKE = /Ã[©¨ª«¢§´¹»]|â€[™œ˜"]|Â[°«»]/g

// --- Famille 3 : desaccentuation. Heuristique, donc elle avertit sans bloquer,
// et uniquement dans un fichier qui porte des accents ailleurs.
// Deux exclusions payees par des faux positifs REELS, mesures le 2026-08-12 :
//   - les formes qui sont du FRANCAIS VALIDE sans accent — « il verrouille »,
//     « corrige les pixels » sont corrects, les flaguer punit du bon texte ;
//   - les mots qui sont de l'ANGLAIS — « for future reference », « general
//     costs » apparaissent dans des fichiers a moitie anglais de ce depot.
// D'ou l'absence de : verrouille, corrige, reference(s), general.
const MOTS_DESACCENTUES = [
  'possibilite', 'coherence', 'mesuree', 'mesurees',
  // « derniers » est absent pour la meme raison que « verrouille » : « les huit
  // derniers » est correct. « derniere » reste, la ou l'accent est requis.
  'deja', 'apres', 'tres', 'derniere', 'premiere',
  'necessaire', 'donnees', 'proprietes', 'parametre', 'parametres', 'requete',
  'verifiee', 'corrigee', 'realite', 'securite',
  'priorite', 'qualite', 'unite', 'entite', 'cles',
]
// ⚠️ PAS de `\b` : en JavaScript il est ASCII, donc le `e` accentue de
// « parametres » y cree une FAUSSE frontiere de mot et `\btres\b` matche a
// l'interieur. Mesure du 2026-08-12 : avec `\b`, 181 fichiers sur 570 se
// declenchaient, dont du code pur — exactement le garde bruyant que l'en-tete
// du garde du backtick donne en contre-exemple. Les lookarounds Unicode avec le
// drapeau `u` sont la forme correcte.
const DESACCENTUES = new RegExp(`(?<!\\p{L})(${MOTS_DESACCENTUES.join('|')})(?!\\p{L})`, 'giu')

// Un fichier peut porter quelques caracteres accentues sans etre de la prose
// francaise : `wgsl-backtick-guard.mjs` porte une plage de lettres accentuees
// dans une REGEX, et serait analyse a tort alors qu'il est ecrit sans accent
// par convention. Un seuil de DENSITE separe la prose du reste.
// Calibre, pas choisi : `wgsl-backtick-guard.mjs` porte 2 accents (une plage
// dans une regex) et doit rester dehors ; un court paragraphe francais en porte
// une dizaine et doit entrer. 6 separe les deux sans serrer ni l'un ni l'autre.
const SEUIL_PROSE = 6

const charge = (() => {
  try { return JSON.parse(readFileSync(0, 'utf8')) } catch { return null }
})()
if (!charge) process.exit(0)

// Ce garde ne s'analyse jamais lui-meme : il CONTIENT les motifs qu'il cherche.
const EXCLUS = /accents-guard\.mjs$/

function fichiersACheck() {
  const direct = charge?.tool_input?.file_path ?? charge?.tool_response?.filePath
  if (direct) return [direct]

  // Chemin Bash : on ne sait pas ce qui a ete ecrit, on demande a git — puis on
  // restreint par date pour ne pas ramasser le travail des tours precedents.
  try {
    const sortie = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    })
    const maintenant = Date.now()
    return sortie.split('\n').filter(Boolean).filter((f) => {
      try { return maintenant - statSync(f).mtimeMs < FENETRE_MS } catch { return false }
    })
  } catch {
    return []
  }
}

// ⚠️ LE faux positif dominant, mesure le 2026-08-12 : les mots de la liste
// vivent surtout dans des CHEMINS et des IDENTIFIANTS, non accentues par
// convention — `2026-08-01-references-effets.md`, `pile-proprietes-masque`,
// `general-purpose`. Avant ce filtre, la TOTALITE des declenchements de
// CLAUDE.md, ROADMAP.md et CONTEXT.md etaient de ce type : zero vrai positif.
// Un voisin `-`, `/`, `.` ou `_` suffit a trancher, et un span entre backticks
// aussi.
function dansUnIdentifiant(ligne, debut, longueur) {
  const avant = ligne[debut - 1] ?? ' '
  const apres = ligne[debut + longueur] ?? ' '
  if (/[-/._]/.test(avant) || /[-/._]/.test(apres)) return true
  // Entre backticks : compter les backticks avant la position. Impair = dedans.
  let n = 0
  for (let k = 0; k < debut; k++) if (ligne[k] === '`') n++
  return n % 2 === 1
}

const bloquants = []
const suspects = []

for (const fichier of fichiersACheck()) {
  if (!EXT_TEXTE.test(fichier) || EXCLUS.test(fichier)) continue

  let source
  try { source = readFileSync(fichier, 'utf8') } catch { continue }

  const lignes = source.split('\n')
  // Un bloc de code cloture (```) contient du code, donc des identifiants non
  // accentues legitimes. Le test de backticks par ligne ne le voit pas — il
  // faut suivre l'etat sur tout le fichier. Faux positif reel : une commande
  // PowerShell citee dans SKILL.md.
  let dansUnBloc = false
  // La 3e famille ne vaut QUE dans de la prose. Dans du code, `cle`, `etat` ou
  // `reference` sont des IDENTIFIANTS — un identifiant ne peut pas porter
  // d'accent, donc y chercher une desaccentuation est structurellement faux.
  // Mesure du 2026-08-12 : sans cette restriction, 73 fichiers se declenchaient,
  // dont `render-check.mjs` a lui seul 165 fois — un fichier que CLAUDE.md
  // documente comme deliberement non accentue.
  const prose = EXT_PROSE.test(fichier) && (source.match(/[À-ÿ]/g) ?? []).length >= SEUIL_PROSE

  lignes.forEach((ligne, i) => {
    for (const m of ligne.matchAll(ECHAPPEMENT_NU)) {
      bloquants.push(`${fichier}:${i + 1} « ${m[0]} » — echappement \\uXXXX ayant perdu son antislash`)
    }
    for (const m of ligne.matchAll(MOJIBAKE)) {
      bloquants.push(`${fichier}:${i + 1} « ${m[0]} » — UTF-8 relu en latin-1`)
    }
    if (/^\s*```/.test(ligne)) { dansUnBloc = !dansUnBloc; return }
    if (!prose || dansUnBloc) return
    for (const m of ligne.matchAll(DESACCENTUES)) {
      if (dansUnIdentifiant(ligne, m.index, m[0].length)) continue
      suspects.push(`${fichier}:${i + 1} « ${m[0]} » dans un fichier par ailleurs accentue`)
    }
  })
}

if (bloquants.length > 0) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason:
      'Prose francaise corrompue (CLAUDE.md : preferer Edit a un script pour la prose francaise) :\n' +
      bloquants.slice(0, 12).map((p) => `  - ${p}`).join('\n') +
      (bloquants.length > 12 ? `\n  … et ${bloquants.length - 12} autres` : '') +
      "\nCorriger avec l'outil Edit, jamais avec un heredoc ou un sed.",
  }))
  process.exit(0)
}

if (suspects.length > 0) {
  const uniq = [...new Set(suspects)].slice(0, 8)
  process.stdout.write(
    'Mots possiblement desaccentues (heuristique, a verifier a l\'oeil) :\n' +
    uniq.map((p) => `  - ${p}`).join('\n') + '\n',
  )
}
