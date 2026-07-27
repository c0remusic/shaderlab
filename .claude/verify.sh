#!/usr/bin/env bash
# Gate de verification deterministe consommee par le hook Stop global
# (~/.claude/stop-verify.sh). Sortie non-zero = le tour est bloque et cette
# sortie est reinjectee. Mise en oeuvre de la regle C1 : « termine = demontrable ».
#
# CONTRAINTE : ce script tourne a CHAQUE fin de tour, budget < 15 s.
# Budget mesure le 2026-07-28 : 7,0 a 8,6 s pour la gate entiere (3 passages),
# soit :
#   npx tsc --noEmit   4,9 s (10,0 s au 1er passage, cache froid)
#   cargo check        1,3 s en incremental (18,5 s a froid, une seule fois)
# C'est la plus lourde des 10 gates ; si elle derive au-dela de 15 s, retirer
# `cargo check` avant `tsc` (il couvre moins de surface editee ici).
# ECARTE : `vitest run` (suite unitaire) et `vitest --project=storybook`
# (navigateur Playwright) — suites de tests, appartiennent au pre-commit
# (verify-gate), pas a la fin de tour. `npm run test:gpu-shaders` ecarte aussi
# (GPU reel). `npm run build` ecarte : produit un artefact, `tsc --noEmit`
# donne la meme erreur de type sans ecrire dans dist/.
set -u

cd "$(dirname "$0")/.." || exit 0
rc=0

run() {
  local nom="$1"; shift
  local out
  if ! out=$("$@" 2>&1); then
    printf '### %s : ECHEC\n%s\n\n' "$nom" "$(printf '%s' "$out" | tail -40)"
    rc=1
  fi
}

run "typecheck (tsc --noEmit)" npx tsc --noEmit

# Rust : `cargo check` et non `cargo build` — on veut l'erreur de type, pas
# l'artefact. Sous-shell pour ne pas deplacer le cwd de la gate.
if [ -f src-tauri/Cargo.toml ]; then
  out=$( ( cd src-tauri && cargo check --quiet ) 2>&1 ) || {
    printf '### rust (cargo check) : ECHEC\n%s\n\n' "$(printf '%s' "$out" | tail -40)"
    rc=1
  }
fi

exit $rc
