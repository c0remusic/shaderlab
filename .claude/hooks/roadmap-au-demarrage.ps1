# Injecte docs/ROADMAP.md dans le contexte au démarrage d'une session.
#
# POURQUOI UN HOOK ET PAS UNE PHRASE DANS CLAUDE.md. `CLAUDE.md` demande déjà de
# lire la feuille « au démarrage d'une session de travail, avant de reconstruire
# un backlog de tête ». C'est une consigne en prose : elle dépend de la bonne
# volonté du tour courant, et elle a été suivie certaines sessions et pas
# d'autres. Un hook, c'est le harnais qui l'exécute — la lecture n'est plus une
# décision.
#
# POURQUOI LE FICHIER ENTIER, alors que `CLAUDE.md` refuse d'importer
# `docs/INDEX.json` pour la même raison de coût. Les deux documents n'ont pas la
# même FORME : `INDEX.json` est une table de consultation (on y cherche UNE
# entrée, le reste est du poids mort à chaque tour), la feuille est un document
# qui se LIT d'un bout à l'autre pour décider quoi faire. Un extrait de feuille
# rouvrirait exactement le défaut qu'on ferme — un agent qui croit savoir ce qui
# reste parce qu'il en a vu le début. Coût mesuré le 2026-08-05 : ~3 700 tokens,
# une fois par session.
#
# ⚠️ SILENCIEUX SI LE FICHIER MANQUE. Un hook de démarrage qui échoue bruyamment
# casse toutes les sessions du dépôt, y compris celles qui n'ont rien à voir. On
# n'injecte rien plutôt que de faire du bruit.

$ErrorActionPreference = 'Stop'

try {
    # Racine du dépôt déduite de l'emplacement du script (.claude/hooks/), pas du
    # répertoire courant : un hook peut être lancé depuis n'importe où.
    $racine = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $feuille = Join-Path $racine 'docs/ROADMAP.md'

    if (-not (Test-Path $feuille)) { exit 0 }

    $contenu = Get-Content -Path $feuille -Raw -Encoding utf8

    $entete = @"
Feuille de route du dépôt, lue automatiquement au démarrage (docs/ROADMAP.md).
C'est le SEUL document qui dise ce qui RESTE à faire — les autres disent ce qui
est fait. Ne pas reconstruire un backlog de mémoire ; et si une session ouvre ou
solde quelque chose, ce fichier se réconcilie au wrap-up (skill `wrap-up`,
étape 7).

⚠️ Il peut retarder sur le code : il est écrit par qui l'a écrit, au moment où
il l'a écrit. Mesurer sur disque avant de conclure qu'un item reste ouvert — ça
s'est déjà produit deux fois (le masque par tonalité y était compté à faire
alors qu'il existait et était câblé de bout en bout).

---

$contenu
"@

    $sortie = @{
        hookSpecificOutput = @{
            hookEventName     = 'SessionStart'
            additionalContext = $entete
        }
    }
    $sortie | ConvertTo-Json -Depth 5 -Compress
} catch {
    exit 0
}
