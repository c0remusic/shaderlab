#!/usr/bin/env node
// PostToolUse guard : un backtick nu dans un commentaire WGSL ferme le template
// literal qui le contient. Erreur commise trois fois (2026-08-03), dont deux dans
// la meme session.
//
// Le point subtil, et c'est tout le piege : a l'interieur d'un corps `wgsl:`, le
// `//` n'est PAS un commentaire JavaScript. C'est du texte WGSL. JavaScript n'y
// voit qu'une chaine, et le premier backtick nu la termine. Hors literal au
// contraire, `//` est un vrai commentaire JS ou les backticks de prose sont
// inoffensifs et idiomatiques ici — les flaguer noierait le signal.
//
// Deux terrains, deux symptomes :
//   - src/render/effects/*.ts -> tsc rend TS1005 sur une ligne LOIN du commentaire
//     fautif, et le fichier qui ne parse pas fait echouer des tests sans rapport.
//   - scripts/render-check.mjs -> tsc ne voit rien ; le script meurt au lancement
//     sur un SyntaxError designant le mot qui SUIT le backtick.
//
// Sortie : JSON {decision:"block"} sur violation, silence sinon.

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const SURVEILLE = [/src[\\/]render[\\/]effects[\\/].*\.tsx?$/, /scripts[\\/]render-check\.mjs$/]
const ACCENTS_INTERDITS = /scripts[\\/]render-check\.mjs$/

let charge = null
try {
  charge = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  process.exit(0)
}

const fichier = charge?.tool_input?.file_path ?? charge?.tool_response?.filePath
if (!fichier || !SURVEILLE.some((r) => r.test(fichier))) process.exit(0)

let source
try {
  source = readFileSync(fichier, 'utf8')
} catch {
  process.exit(0)
}

// Machine a etats au niveau JavaScript. On ne s'interesse qu'a une chose : etre
// dedans ou dehors d'un template literal. Les commentaires JS, les chaines
// simples et doubles sont traverses pour que leurs backticks ne faussent rien.
const NORMAL = 0
const COMMENTAIRE_LIGNE = 1
const COMMENTAIRE_BLOC = 2
const CHAINE_SIMPLE = 3
const CHAINE_DOUBLE = 4
const LITERAL = 5

function scanner(src) {
  const trouves = []
  let etat = NORMAL
  let ligne = 1
  let ouvertureLigne = 0
  // Position du `//` WGSL sur la ligne courante, quand on est dans un literal.
  let commentaireWgslOuvert = false

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const suivant = src[i + 1]

    if (c === '\n') {
      ligne++
      if (etat === COMMENTAIRE_LIGNE) etat = NORMAL
      commentaireWgslOuvert = false
      continue
    }

    // Un caractere echappe ne compte jamais — c'est la forme correcte que la
    // convention exige, elle ne doit pas etre punie.
    if ((etat === LITERAL || etat === CHAINE_SIMPLE || etat === CHAINE_DOUBLE) && c === '\\') {
      i++
      continue
    }

    switch (etat) {
      case NORMAL:
        if (c === '/' && suivant === '/') { etat = COMMENTAIRE_LIGNE; i++ }
        else if (c === '/' && suivant === '*') { etat = COMMENTAIRE_BLOC; i++ }
        else if (c === "'") etat = CHAINE_SIMPLE
        else if (c === '"') etat = CHAINE_DOUBLE
        else if (c === '`') { etat = LITERAL; ouvertureLigne = ligne; commentaireWgslOuvert = false }
        break

      case COMMENTAIRE_LIGNE:
        break // backticks de prose : inoffensifs, on les ignore

      case COMMENTAIRE_BLOC:
        if (c === '*' && suivant === '/') { etat = NORMAL; i++ }
        break

      case CHAINE_SIMPLE:
        if (c === "'") etat = NORMAL
        break

      case CHAINE_DOUBLE:
        if (c === '"') etat = NORMAL
        break

      case LITERAL:
        // Le `//` d'une URL (http://, https://) n'ouvre pas un commentaire. Le
        // caractere qui precede suffit a trancher, et c'est un cas reel : la
        // connexion CDP de render-check.mjs interpole un `http://localhost:${port}`.
        if (c === '/' && suivant === '/' && src[i - 1] !== ':') { commentaireWgslOuvert = true; i++ }
        else if (c === '`') {
          if (commentaireWgslOuvert) {
            trouves.push({
              ligne,
              message: `backtick NON echappe dans un commentaire WGSL — ferme le literal ouvert ligne ${ouvertureLigne}`,
            })
          }
          etat = NORMAL
        } else if (commentaireWgslOuvert && c === '$' && suivant === '{') {
          trouves.push({ ligne, message: '${ NON echappe dans un commentaire WGSL — ouvre une interpolation' })
          i++
        }
        break
    }
  }
  return { trouves, literalNonFerme: etat === LITERAL }
}

const { trouves, literalNonFerme } = scanner(source)
const problemes = trouves.map((t) => `${fichier}:${t.ligne} ${t.message}`)
if (literalNonFerme) problemes.push(`${fichier} — un template literal reste OUVERT en fin de fichier`)

if (ACCENTS_INTERDITS.test(fichier)) {
  source.split('\n').forEach((l, i) => {
    const com = l.match(/\/\/(.*)$/)
    if (com && /[À-ÿ]/.test(com[1])) {
      problemes.push(`${fichier}:${i + 1} accent dans un commentaire de scenario`)
    }
  })
}

// Preuve independante pour les .mjs : node --check attrape ce qu'aucun linter ne voit.
if (/\.mjs$/.test(fichier)) {
  try {
    execFileSync(process.execPath, ['--check', fichier], { stdio: 'pipe' })
  } catch (e) {
    const err = (e.stderr?.toString() ?? '').split('\n').find((l) => /Error/.test(l)) ?? 'parse failed'
    problemes.push(`${fichier} ne parse plus — ${err.trim()}`)
  }
}

if (problemes.length === 0) process.exit(0)

process.stdout.write(
  JSON.stringify({
    decision: 'block',
    reason:
      'Piege backtick/template literal (CLAUDE.md § Stack) :\n' +
      problemes.map((p) => `  - ${p}`).join('\n') +
      '\nEcrire \\` au lieu de ` dans ces commentaires, puis relancer npx tsc --noEmit.',
  }),
)
