// Machine a etats qui detecte un backtick nu dans un commentaire WGSL.
//
// EXTRAITE du hook `.claude/hooks/wgsl-backtick-guard.mjs` le 2026-09-15, sans
// rien changer a son corps. Pourquoi : le hook ne s'execute qu'en `PostToolUse`
// d'un agent, donc une edition HUMAINE hors Claude Code ne le declenchait pas,
// et il n'etait ni dans `npm run lint` ni dans la CI. La garde etait correcte et
// n'avait qu'un seul appelant.
//
// Le piege qu'elle attrape : a l'interieur d'un corps `wgsl:`, le `//` n'est PAS
// un commentaire JavaScript — c'est du texte WGSL, et JavaScript n'y voit qu'une
// chaine que le premier backtick nu termine. Symptome : `tsc` rend TS1005 sur une
// ligne LOIN de la faute, et le fichier qui ne parse plus fait echouer des tests
// sans rapport. Dix occurrences datees, dont sept en une seule journee.

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

export { scanner as scannerBackticks }
