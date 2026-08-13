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

const EXT_TEXTE = /\.(md|txt|json|ts|tsx|js|mjs|css|html|ps1|rs|toml|yml|yaml)$/i
const FENETRE_MS = 15_000

// --- Famille 1 : un echappement \uXXXX qui a perdu son antislash. C'est ce qui
// produit « poignu00e9es » au lieu de « poignees ». Jamais legitime dans de la
// prose : en code, la sequence est precedee d'un antislash, pas d'une lettre.
const ECHAPPEMENT_NU = /[A-Za-zÀ-ÿ]u00[0-9a-f]{2}/g

// --- Famille 2 : de l'UTF-8 relu en latin-1. Jamais legitime nulle part.
const MOJIBAKE = /Ã[©¨ª«¢§´¹»]|â€[™œ˜"]|Â[°«»]/g

// --- Famille 3 : desaccentuation. Heuristique, donc elle avertit sans bloquer,
// et uniquement dans un fichier qui porte des accents ailleurs.
const MOTS_DESACCENTUES = [
  'possibilite', 'coherence', 'mesuree', 'mesurees', 'reference', 'references',
  'deja', 'apres', 'tres', 'etat', 'etats', 'derniere', 'derniers', 'premiere',
  'necessaire', 'donnees', 'proprietes', 'parametre', 'parametres', 'requete',
  'verifie', 'verifiee', 'corrige', 'corrigee', 'realite', 'securite',
  'priorite', 'qualite', 'unite', 'entite', 'cle', 'cles', 'general',
]
const DESACCENTUES = new RegExp(`\\b(${MOTS_DESACCENTUES.join('|')})\\b`, 'gi')

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

const bloquants = []
const suspects = []

for (const fichier of fichiersACheck()) {
  if (!EXT_TEXTE.test(fichier) || EXCLUS.test(fichier)) continue

  let source
  try { source = readFileSync(fichier, 'utf8') } catch { continue }

  const lignes = source.split('\n')
  const porteDesAccents = /[À-ÿ]/.test(source)

  lignes.forEach((ligne, i) => {
    for (const m of ligne.matchAll(ECHAPPEMENT_NU)) {
      bloquants.push(`${fichier}:${i + 1} « ${m[0]} » — echappement \\uXXXX ayant perdu son antislash`)
    }
    for (const m of ligne.matchAll(MOJIBAKE)) {
      bloquants.push(`${fichier}:${i + 1} « ${m[0]} » — UTF-8 relu en latin-1`)
    }
    if (!porteDesAccents) return
    for (const m of ligne.matchAll(DESACCENTUES)) {
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
