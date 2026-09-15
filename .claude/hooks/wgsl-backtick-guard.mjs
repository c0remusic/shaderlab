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

// La machine a etats vit dans `scripts/wgslBackticks.mjs`, partagee avec
// `test/scripts/wgslBackticks.test.ts` — qui tourne, lui, dans `npm run test` et
// donc EN CI. Ce hook n'etait appele qu'en `PostToolUse` d'un agent : une edition
// humaine hors Claude Code ne le declenchait pas. Deux appelants, une seule
// ecriture : recopier le scanner ici le ferait diverger, ce qui est exactement le
// defaut de jumeau corrige ailleurs le meme jour.
import { scannerBackticks as scanner } from '../../scripts/wgslBackticks.mjs'

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
