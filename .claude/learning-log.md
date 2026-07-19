# shaderlab — learning-log (leçons projet)

Store instinct-system, portée projet. Écrivain = wrap-up seul. Voir
`~/.claude/CLAUDE.md` § Store instinct-system pour la convention globale.

## 2026-07-18 — pas de composant Menu (actions groupées) avant cette session

**Découverte (TTL 6 mois)** : `src/ui/` n'avait que `Select.tsx` (choix de
VALEUR, `role="listbox"`), aucun composant pour grouper des ACTIONS
(`role="menu"`/`menuitem`). Ajouté `src/ui/Menu.tsx` (bouton déclencheur +
popover, même convention que Select : pas de portail, navigation clavier,
fermeture au clic extérieur) suite au regroupement Ouvrir/Exporter de la
toolbar dans un menu "Fichier" (`src/components/Toolbar.tsx`). Réutiliser ce
composant pour tout futur regroupement d'actions plutôt que d'en récrire un.

## 2026-07-16/17 — le fix `1d5e129` ne résout PAS le crash de peinture au masque à 24MP

**Contexte** : suite au chantier archi-remediation (mergé le 2026-07-16), le
crash/freeze WebGPU pendant la peinture au masque sur une image 24MP
(6240×4160) a été re-signalé comme non résolu malgré le fix dirty-rect de
`src/render/maskUpload.ts`. Investigation approfondie sur le worktree
`feature/archi-remediation` (depuis retiré) via repro CDP réelle (drop
d'image synthétique 6240×4160, dispatch d'événements pointer réels sur le
canvas, lecture de logs de diagnostic ajoutés à chaque étape du pipeline de
rendu).

**Ce qui a été prouvé (pas supposé) :**
1. Le crash ne dépend PAS de la fréquence d'échantillonnage du pinceau — un
   seul `pointerdown`+`pointerup` (zéro `pointermove`) le reproduit de façon
   fiable. Le fix dirty-rect (qui ne cible que les uploads pendant le trait)
   ne pouvait donc structurellement pas le régler.
2. Le point de blocage exact : `handleMaskStrokeEnd` → `commit()` termine
   tout son JS avec succès (logué), planifie un `requestAnimationFrame` —
   et ce rAF ne se déclenche plus JAMAIS. La page devient alors insensible à
   TOUT appel CDP ultérieur (même un `1+1` sans rapport).
3. Reproduit identiquement avec Glow (5 passes) et Chromatic bleed (1
   passe) → pas spécifique à un effet.
4. NE se reproduit PAS sur une image 512×384 avec la même séquence exacte →
   dépend bien de la taille/résolution.
5. NE se reproduit PAS avec `pointerdown` seul (sans `pointerup`) → requiert
   la transition vers le rendu "résident" (`getMaskTexture`, chemin non-live-
   preview), pas juste un upload plein-buffer en soi (un upload plein-buffer
   identique via `getLiveMaskTexture` pendant le trait ne plante jamais).
6. **Fix tenté (commit `1d5e129`)** : éviter le deuxième upload CPU→GPU en
   réutilisant la texture live-preview déjà uploadée via une copie GPU→GPU
   (`encoder.copyTextureToTexture`). Testé avec un timing RÉALISTE (80ms puis
   50ms de délai entre les événements, pas de rafale synthétique à délai
   zéro) — **le crash persiste à l'identique**, même point de blocage exact
   (rAF planifié après le commit, jamais déclenché).

**Conclusion** : ce n'est pas (uniquement) le volume de données CPU→GPU qui
plante — c'est quelque chose de plus profond dans le fait d'entrer dans le
rendu "résident" (post-trait, non-live-preview) à 24MP, indépendamment de la
façon dont la texture de masque est alimentée. Profil d'un bug/limite driver
WebGPU/Dawn/D3D12 spécifique à cette machine sous WebView2, pas d'un bug de
logique applicative identifiable dans notre code. Investigation au niveau
driver (flags Dawn backend-validation, `device.onuncapturederror`) n'a rien
révélé côté navigateur — aucune erreur de validation, aucun `device.lost`,
juste un arrêt silencieux du rAF.

**Pistes non essayées, à tenter avant de re-fermer ce sujet** :
- Ne jamais transitionner vers le chemin résident pour un calque tant qu'un
  autre événement (changement de calque, undo/redo, rechargement) ne le
  force pas — continuer à afficher via la texture live-preview même après la
  fin du trait.
- Réduire la résolution du buffer de masque indépendamment de l'image
  (contourne sans expliquer).
- Reproduire sur une autre machine pour savoir si c'est portable ou propre à
  ce poste (driver GPU local).

**Pourquoi cette note existe** : le commit `1d5e129` (message : "fix: avoid
redundant full mask upload...") reste dans l'historique de
`feature/archi-remediation` sans avoir résolu le problème qu'il prétend
traiter — vérifié APRÈS coup dans la même session. Ne pas assumer que ce
commit règle quoi que ce soit ; ne pas le merger vers `feature/design-system`
sans nouvelle preuve. Voir aussi `[[minidump-forensics-technique]]` (mémoire
auto) pour la technique d'analyse de crash dumps utilisée sur ce même sujet
en 2026-07-15.

## 2026-07-17 — 3e tentative de fix (wait-for-idle) échoue aussi ; seuil systematic-debugging atteint

**Contexte** : troisième tentative indépendante de fix, à travers trois
sessions distinctes (dirty-rect 2026-07-15, GPU-copy `1d5e129` 2026-07-16,
wait-for-idle 2026-07-17) — attendre `device.queue.onSubmittedWorkDone()`
avant `setLayers()` dans `commit()`. Détail complet dans
`docs/superpowers/specs/2026-07-17-native-wgpu-decision.md`.

**Résultat** : échec identique aux deux précédentes tentatives — même point
de blocage (rAF planifié après `commit()`, jamais déclenché). Découverte
additionnelle : une fois le crash déclenché, CDP `Runtime.evaluate` devient
totalement inerte (même une lecture triviale timeout) — le mécanisme exact
(bug JS pur vs stall compositeur WebView2/Dawn/D3D12) reste indéterminé.

**Décision** : seuil de `superpowers:systematic-debugging` atteint (3+
échecs indépendants) — STOP, ne pas tenter un 4e fix à l'aveugle. Sujet à
rouvrir seulement avec Antoine et une nouvelle piste (voir les options
structurelles non testées listées dans le doc de spec : ref au lieu de state
pour `layers` pendant la peinture, `React.memo` des panneaux).

**Mitigation appliquée le même jour (audit pré-release, agent `auditor`)** :
le crash lui-même reste non résolu, mais `device.lost` (toujours fatal) est
maintenant câblé à `setError`/`ErrorBanner` au lieu de rester uniquement dans
le log de diagnostic — un utilisateur qui heurte ce crash voit désormais un
message plutôt qu'un canvas figé sans aucune explication. Voir
`src/render/gpuContext.ts` (`onFatalError`) et `src/App.tsx`. L'instrumentation
debug (`log_diagnostic`) a aussi été gatée derrière `debug_assertions`/
`import.meta.env.DEV` (n'écrivait plus jamais en build release).

## 2026-07-18 — Crash mask-paint 24MP RÉSOLU : c'était le buffer 26 Mo dans le state React, pas le GPU

**Contexte** : reprise du gate crash (3 fix échoués, seuil systematic-debugging)
avec l'accord d'Antoine pour tester LA piste structurelle jamais essayée listée
dans le doc 2026-07-17 : ref-not-state + `React.memo`. Méthode : A/B live sur la
vraie fenêtre WebView2 (CDP, image synthétique 24MP `OffscreenCanvas` droppée,
hook dev `window.__repro` exposant les handlers, sonde de vivacité `Runtime.evaluate`
avec timeout = détecteur de crash).

**Root cause enfin trouvée (sur pièce)** : le crash vient du **buffer `maskData`
r8 pleine résolution (~26 Mo à 24MP) transitant par le state React**, qui fait
hanger WebView2 au re-render déclenché par `setLayers()` en fin de stroke.
Discriminateur PROUVÉ en live : `setLayers()` SANS masque (ajout de calque) à
24MP ne crashe pas ; `setLayers()` AVEC le buffer 26 Mo crashe ; ne pas appeler
`setLayers()` ne crashe pas. Donc **ni le GPU** (`requestRender` avec le masque
complet est OK dans les deux cas) **ni le re-render en soi**, mais le buffer 26 Mo
dans l'état React. Ça explique l'échec des 3 fix précédents (dirty-rect, GPU-copy,
wait-for-idle) : ils ciblaient tous le GPU/timing.

**Fix livré** (`e3c7584`, mergé sur `feature/design-system`) : `layersRef` =
source de vérité COMPLÈTE (avec `maskData`) pour rendu/historique/export ; le
state React `layers` n'est qu'une projection d'affichage SANS `maskData`
(`src/layers/displayProjection.ts`, `toDisplayLayers`). `setLayers()` reste appelé
(UI correcte) mais ne porte plus le buffer. Sites corrigés dans `App.tsx` :
`currentStack`/`handleMaskStroke`(maskData + requestRender base)/export lisent
`layersRef.current` (complet, sinon les masques des autres calques seraient perdus) ;
`syncLayers()` met à jour ref + state projeté. Vérifié en live à 24MP : peinture
au masque sans crash, UI correcte (screenshot CDP). +6 tests `displayProjection`.

**Leçon de méthode** : les 3 fix précédents ont échoué parce qu'ils supposaient
« crash GPU » sans l'avoir prouvé. Le A/B factoriel live (isoler UN facteur —
ici « maskData dans setLayers ou non ») a tranché en une session ce que 3
sessions de fix à l'aveugle n'avaient pas résolu. Le garde-fou systematic-debugging
(STOP à 3 échecs, discuter avec Antoine, tester une hypothèse structurelle plutôt
qu'un 4e fix) a fonctionné.

**Conséquence projet** : le port natif wgpu/Rust est définitivement écarté (cause
= état React, pas rendu). Gate des tranches 2-5 du masquage LEVÉ, sous la règle de
conception héritée : **garder les gros buffers/textures de masque HORS du state
React**. Docs mis à jour : bandeau RÉSOLU sur `2026-07-17-native-wgpu-decision.md`,
gate levé dans le design masquage, INDEX.json.

**Piège environnement rencontré (découverte, TTL 6 mois)** : le repo a été déplacé
de `C:\Users\LEETJ\Desktop\shaderlab` vers `C:\dev\shaderlab`. Le cache cargo
(`src-tauri/target/`, ~6 Go) contenait des chemins absolus périmés vers Desktop →
le build-script Tauri échouait (`failed to read plugin permissions ... Desktop\...`).
Purger seulement `target/debug/build/` en gardant `deps/` laisse le target
INCOHÉRENT (`could not compile potential_utf` sans diagnostic). Fix fiable après
relocalisation d'un repo Tauri : `cargo clean` COMPLET, pas de purge partielle.

## 2026-07-19 — Pinceau : gestes qui s'enchaînent, chacun révèle le suivant

**Contexte** : retours UX live sur le pinceau après le fix du crash 24MP.
Quatre bugs distincts, chacun découvert en corrigeant/vérifiant le précédent.

1. **Trous du trait** : `MaskPainter.paintStroke` ne peint qu'UN tampon par
   appel, sans interpolation ; le coalescing rAF de `Canvas.tsx` ne garde que
   le DERNIER point par frame (les intermédiaires sont perdus, pas groupés).
   Un tracé rapide = tampons isolés dès que l'écart dépasse le diamètre du
   pinceau. Fix : `MaskPainter.paintLine` interpole des tampons espacés à 25%
   du rayon entre le dernier point peint et le point courant (`lastPoint`
   traqué par `MaskPainterEntry`, reset en fin de trait + au re-seed
   undo/redo). Vérifié en live via de VRAIS PointerEvent + coalescing réel
   (pas un raccourci de test), pas juste des appels directs à `handleMaskStroke`.

2. **Peindre hors du canvas** : `setPointerCapture` au `pointerdown` +
   `pointerup` seul termine le trait (retire `endStroke()` de `onPointerLeave`).
   **Piège découvert en le vérifiant** : `setPointerCapture` peut lever
   `NotFoundError` sur des `PointerEvent` synthétiques dispatchés via CDP (le
   moteur ne reconnaît pas toujours le pointeur comme "actif" pour un event
   scripté) — et comme `isPaintingRef.current = true` était fixé AVANT cet
   appel, l'exception non gérée avortait le handler et faisait sauter le
   premier tampon du trait EN SILENCE. Fix : `try/catch` délibéré autour de
   `setPointerCapture` seul — la capture est un confort auxiliaire, son échec
   ne doit jamais bloquer l'action critique (peindre).

3. **Flicker en peignant hors du canvas** : régression du point 2. Un point
   dont le pinceau ne recouvre plus DU TOUT l'image (au-delà du rayon depuis
   un bord) faisait retourner à `paintStroke` un `DirtyRect` à
   largeur/hauteur NÉGATIVE. Ce rect partait tel quel dans
   `computeR8UploadRegion` → `device.queue.writeTexture` comme taille de
   copie GPU — `TypeError: ... Value is outside the unsigned long value
   range`, une erreur de validation à chaque frame concernée = le flicker.
   Fix : clamp `width`/`height` à 0 minimum (un rect vide est un no-op GPU
   valide, jamais une erreur).

4. **Contamination des tests par des worktrees parallèles** : deux chips
   `spawn_task` actifs (worktrees sous `.claude/worktrees/`) faisaient scanner
   leurs propres `test/` par `npm run test` du repo principal (19→57 fichiers,
   122→366 tests). Pas une régression de vitest — confirmé en excluant, le
   compte est revenu à 19/122 immédiatement. Fix : `vitest.config.ts` exclut
   `.claude/worktrees/**`.

**Leçon de méthode** : chaque fix a été vérifié en live (CDP, vraie fenêtre
WebView2) avant d'être considéré résolu — et 2 des 4 bugs (le try/catch qui
sautait le 1er tampon, le DirtyRect négatif) n'ont été trouvés QU'EN
vérifiant honnêtement le fix précédent au lieu de le supposer correct après
la seule revue de code / tsc / tests unitaires.

**Faux positif à ne pas reproduire** : au milieu de cette investigation,
`package.json`/`package-lock.json` ont semblé "driftés" (vitest ^2.0.0
committé vs 4.1.10 réellement installé) puis sont redevenus identiques à HEAD
entre deux vérifications. Ce n'était PAS une anomalie : c'était un commit
légitime d'Antoine (`951f617`, `npm audit fix --force` pour une vraie vuln
critical/high esbuild/vite/vitest) passé PENDANT l'investigation. Un fichier
tracké qui bouge sans que cette conversation l'ait édité = vérifier
`git log` pour un commit concurrent AVANT de traiter ça comme une anomalie à
résoudre (cohérent avec la règle wrap-up sur les fichiers modifiés hors
session — vaut aussi pour un repo de projet avec historique de sessions
concurrentes, pas seulement `~/.claude`).

## 2026-07-19 — Tranche 1 (blend + opacité par calque) livrée

Plan `docs/superpowers/plans/2026-07-18-shaderlab-layers-blend-opacity.md`
exécuté via `subagent-driven-development`, 4 tâches + revue finale, toutes
clean (0 Critical/Important). Commits `4642ffd..421eece` + `631e6bf` (config)
+ `c070cfc` (doc). 2 checkpoints visuels humains confirmés par Antoine (retro-
compat/wiring blend en Task 3, UI réelle slider+select en Task 4). 122/122
tests, tsc clean.

**Résultat** : chaque calque a maintenant `opacity`/`blendMode`, le
compositing est un vrai `mix(input, blend(input,effected,mode), opacity*mask)`
au lieu de l'ancienne "effect chain" qui écrasait tout (le défaut même que
DASCA avait été critiqué pour avoir). Registry de 11 modes de fusion
(`src/render/blend/`), extensible en ajoutant un fichier.

**Reprise pour la suite** : Tranche 2 (masque non-destructif, design déjà
écrit dans `docs/superpowers/specs/2026-07-18-shaderlab-layers-masking-
design.md` §3-5) n'a pas encore son plan d'implémentation — commencer par
`superpowers:writing-plans` dessus avant `subagent-driven-development`.

## 2026-07-19 — Chips fusionnés + bug latent dev.ps1 trouvé et corrigé

Les 2 `spawn_task` (fusion Ouvrir/Exporter en menu Fichier, fusion Terminer/
Arrêter de peindre) ont livré sur des branches séparées (`claude/beautiful-
wing-eca6ea`, `claude/nervous-leakey-2d5e24`) puis leurs sessions ont été
supprimées — cherry-pick propre des 3 commits utiles sur `feature/design-
system` (`9555d3a`, `f05908a`, `62df4be`). `codex-crosscheck` (hook post-
commit) a relevé 3 MOYENNE sur le nouveau `Menu.tsx` : ArrowUp/ArrowDown
ouvrent tous deux sur le premier élément (devrait diverger pour un menu-
bouton standard), pas de gestion de focus ARIA (`aria-activedescendant`
absent), et "Exporter" a disparu de la zone trailing de la toolbar alors
que `docs/design-system/patterns.md` l'exige en action directe en plus du
menu. Non corrigés cette session — à traiter si Antoine confirme le besoin.

**Bug dev tooling trouvé et corrigé** (`8ea3eba`) : `scripts/dev.ps1` tuait
le PID enregistré dans `dev-process.json` sans vérifier que ce PID
appartenait encore à `shaderlab.exe`. Windows recycle les PID — un
lancement précédent tué/crashé laisse un PID que Windows réattribue plus
tard à un process système (`svchost` observé). Au relancement suivant,
`Stop-Process -Force` sur ce PID → Access Denied → avec
`$ErrorActionPreference="Stop"`, tout le script avorte AVANT de lancer
shaderlab.exe, SANS jamais réécrire `dev-process.json` — aucune trace claire
du pourquoi, juste un port CDP qui ne répond jamais après plusieurs tentatives
de lancement apparemment "réussies" (exit code 0 du wrapper npm). Diagnostic :
comparer le timestamp de `dev-process.json` à l'heure réelle du dernier
lancement : périmé + `Get-Process -Id <pid>` renvoie un `ProcessName`
différent de `shaderlab` = ce bug. Fix : vérifier le nom du process avant de
le tuer.
