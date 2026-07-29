# shaderlab — learning-log (leçons projet)

Store instinct-system, portée projet. Écrivain = wrap-up seul. Voir
`~/.claude/CLAUDE.md` § Store instinct-system pour la convention globale.

## 2026-07-24 — le format préféré Windows (bgra*) exige un reswizzle explicite à chaque lecture CPU brute d'une texture couleur

**Découverte (TTL 6 mois)** : `srgbFormat` (toutes les textures couleur,
`gpuContext.ts:69-70`) résout en `bgra8unorm-srgb` sur Windows/D3D12.
`copyTextureToBuffer` copie cet ordre natif (B,G,R,A) tel quel — l'aperçu
écran ne s'en aperçoit jamais (le pipeline de présentation WebGPU connaît
la disposition native), mais **toute lecture CPU manuelle qui suppose
RGBA** (Canvas `ImageData`, encodage JPEG, futur export PNG/TIFF...) doit
reswizzler explicitement, sinon rouge et bleu sont inversés en silence.
Bug réel trouvé au checkpoint visuel document-export-safety (2026-07-24,
commit 85f5293) — chaque export produit depuis le lancement du projet
avait cette inversion sur Windows, jamais détecté (aucun test ne compare
les octets exportés à une image de référence, seul un humain regardant le
fichier final l'a vu). **How to apply** : avant tout nouveau code qui lit
des pixels bruts d'une texture WebGPU côté CPU (export, capture, debug),
vérifier explicitement l'ordre de canaux réel de `srgbFormat`/`canvasFormat`
plutôt que supposer RGBA — voir `FrameReadback.swapRedBlueChannels()` pour
le pattern de fix déjà en place.

## 2026-07-24 — un bouton d'action async sans garde busy peut créer une race de génération (App.tsx `openFile`)

**Découverte (TTL 6 mois)** : "Ouvrir une image" n'est jamais désactivé
pendant qu'un appel `openFile()` précédent est encore en vol — un second
clic rapide (ex. après un fichier corrompu dont `createImageBitmap` met
plusieurs secondes à rejeter) lance un second appel concurrent. Sans garde,
l'appel le plus ANCIEN peut committer son résultat (succès ou erreur)
APRÈS le plus récent, écrasant un état déjà correct — le bandeau d'erreur
réapparaissait seul quelques secondes après une ouverture pourtant réussie
(bug réel, checkpoint ui-runtime-hygiene 2026-07-24, fixé par
`openGenerationRef` commit 9d43f69). **How to apply** : tout futur handler
async déclenchable plusieurs fois sans garde `disabled` (upload, export,
tout ce qui touche `canvasRef`/`rendererRef`) doit soit désactiver son
déclencheur pendant l'opération, soit porter un jeton de génération qui
n'autorise que le dernier appel à committer — ce repo a déjà le pattern
prêt à copier dans `openFile`.

## 2026-07-24 — une image de test sous le plafond de downscale ne prouve jamais le chemin réduit d'un fix Fast Guided Filter

**Découverte (TTL 6 mois)** : l'image synthétique utilisée pour valider le
chantier edge-aware SAT (1600×1200) reste SOUS le plafond de downscale
(~2048px de long côté, `computeSmallDims()`) → `scale=1`, le chemin
"image réduite" du Fast Guided Filter n'a jamais été exercé visuellement
cette session, seul le gain algorithmique (SAT vs boucle O(rayon)) a été
confirmé. **How to apply** : pour valider un fix de perf dont le design
repose sur un downscale conditionnel, toujours inclure au moins une image
de test dont une dimension dépasse le seuil déclencheur — sinon le
checkpoint visuel ne couvre qu'une partie du design approuvé.

## 2026-07-23 — `tsc --noEmit` de ce repo ne couvre JAMAIS `test/` (tsconfig.json `"include": ["src"]`)

**Découverte (TTL 6 mois)** : `tsconfig.json` racine n'inclut que `["src"]` —
tout "`tsc` clean" affirmé pendant une session, aussi souvent répété
soit-il, ne dit RIEN sur la validité de type des fichiers sous `test/`.
Trouvé en ajoutant un 5e paramètre requis (`guideEpoch: number`, sans
défaut) à `MaskTextureResolver.resolve()` : tous les appels dans
`test/render/maskTextureResolver.test.ts` (24 sites) sont restés à 4
arguments pendant plusieurs commits, `tsc --noEmit` répétait "No errors
found" à chaque fois, et Vitest (esbuild, pas tsc) ne signale jamais
l'omission — le paramètre manquant devenait silencieusement `undefined` à
l'exécution, sans lever la moindre erreur. **How to apply** : dans ce
repo, ne jamais lire "tsc clean" comme "les tests sont aussi type-safe" —
si une signature de fonction consommée par des tests change (paramètre
ajouté/retiré/type changé), grep les sites d'appel dans `test/` à la main
plutôt que de compter sur tsc pour les révéler.

## 2026-07-22 — 15 défauts de la tranche design-system unification (efecd5c..HEAD) invisibles à tsc/tests/lint:tokens

**Découverte (TTL 6 mois)** : `/code-review ultra` (local, 4 angles en
parallèle) a trouvé 15 défauts réels dans la migration `src/ui/*` →
`src/components/ui/*` (Base UI) — tous survivaient à `tsc --noEmit`, aux 251
tests, et à `npm run lint:tokens` verts. Cause générique : voir
`[[NG37]]` (`~/.claude/instinct-log.md`) sur le piège Tailwind
`outline-[var(--x)]`/`ring-[var(--x)]` qui compile en propriété couleur, pas
largeur — 4 des 15 défauts (Select/Checkbox/IconButton/Collapsible +
Button/Toggle/Slider) étaient cette même classe d'erreur. Les autres :
chevron de disclosure qui ne tourne pas (`data-panel-open` posé par Base UI
sur le Trigger, pas sur l'icône enfant), `<label htmlFor>` de
`LabeledSlider` pointant sur un `<div>` non labelable (Base UI
`Slider.Root`), `onWheel` posé sur tout le wrapper au lieu de la piste
(volait le scroll du panneau docké), `registerControl` appelé en effet de
bord pendant le render au lieu d'un `useEffect`, 3 valeurs de token qui
avaient dérivé silencieusement sous couvert d'un refactor "littéral →
primitive" (`--primitive-danger`, `--text-tertiary`, `--menu-min-width`),
et du code mort maintenu artificiellement vert par ses propres tests
(`selectPlacement.ts`/`selectNavigation.ts`/`sliderMath.ts`, plus aucun
consommateur de production après la suppression de `src/ui/Select.tsx`/
`Slider.tsx`, mais 3 suites de tests continuaient de les exercer). Fix :
commit `35e2640`. Le nombre de tests visible est passé de 251 à 232 après ce
fix — c'est la fausse couverture du code mort qui disparaît, PAS une
régression de couverture ; ne pas s'alarmer sur ce chiffre seul dans
l'historique git.

**Pattern à surveiller** : `lint:tokens` (`scripts/lint-tokens.mjs`) ne scanne
que le CSS — il ne voit jamais une valeur arbitraire Tailwind mal typée dans
un `.tsx`. Ce garde-fou a un angle mort connu maintenant ; toute revue future
touchant des classes `outline-[var(...)]`/`ring-[var(...)]`/`shadow-[var(...)]`
doit vérifier le CSS RÉELLEMENT émis (`npm run build` + grep `dist/assets/*.css`),
pas seulement lire le nom de la classe.

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

## 2026-07-20 — shadcn/ui migration : stack réelle (base-ui, pas Tailwind pré-existant), bug onSelect/onClick

**Découverte (TTL 6 mois)** : au moment de cadrer la migration vers
`shadcn/ui`, l'hypothèse initiale ("déjà React+Tailwind") était fausse —
aucun Tailwind n'était installé (vérifié sur disque avant d'écrire le PRD,
pas supposé). shadcn a été ajouté avec Tailwind v4 + `@tailwindcss/vite`. Le
style shadcn généré ici est **`base-ui`** (composants `@base-ui/react`), PAS
Radix — malgré le vocabulaire "Radix" utilisé par défaut dans la doc/skills
shadcn courante. Toute migration future de composant doit vérifier l'API
réelle des fichiers déjà générés dans `src/components/ui/` avant de copier un
exemple de code trouvé en ligne (souvent écrit pour Radix).

**Découverte (TTL 6 mois)** : `npx shadcn@latest init` échoue en sandbox
(`EALLOWSCRIPTS`, restriction npm côté environnement Claude Code, pas un bug
du repo) avant de rapporter sa vraie liste de dépendances. Contournement
fiable : laisser la commande écrire ce qu'elle peut (`components.json` est
généré avant l'échec), puis prouver la config via un vrai
`npx shadcn@latest add <composant>` (celui-ci fonctionne) plutôt que deviner
les dépendances de tête.

**Correction (projet)** : "le menu s'ouvre visuellement + la navigation
clavier fonctionne" n'est PAS une preuve que le clic déclenche le bon
callback métier. Bug réel trouvé par `codex-crosscheck` seulement :
`Toolbar.tsx` utilisait `onSelect` (prop HTML générique de sélection de
texte, acceptée par TypeScript sur tout élément DOM, donc invisible au
typecheck) au lieu de `onClick` — base-ui ne lit que `onClick` sur
`MenuItem`. Résultat : cliquer "Ouvrir"/"Exporter" ne faisait rien, malgré 2
reviews de tâche + 1 review de branche entière qui avaient toutes vérifié
l'état visuel du menu sans jamais instrumenter un vrai test du côté effet
(callback réellement appelé). Pour toute future migration d'interaction
(menu/dropdown/bouton d'action) : instrumenter le mock (`window.__xCalled =
true` dans une story, ou équivalent) et cliquer pour de vrai — ne jamais se
contenter de "le menu s'affiche correctement".

**Découverte (TTL 6 mois)** : le DnD HTML5 natif (`draggable`/`onDragStart`/
`onDragOver`/`onDrop`) est structurellement cassé dans ce WebView2 — preuve
obtenue via sonde CDP (`document.addEventListener(..., true)` sur
`dragstart`/`dragover`/`drop`/`dragend`) pendant un geste humain RÉEL (pas
une simulation) : `dragstart` se déclenche correctement, mais `dragover`/
`drop` ne se déclenchent JAMAIS, quelle que soit la distance parcourue par
la souris (observé sur 2,4s/459px). Toute interaction de glisser-déposer
dans cette app doit passer par les pointer events (`pointerdown` +
`setPointerCapture` + `pointermove`/`pointerup` filtrés par `pointerId`),
jamais le DnD HTML5 — voir `LayerPanel.tsx` (réordonnancement de calques)
pour le pattern de référence.

**Découverte (TTL 6 mois)** : un `<input type="range">` stylé déclenche un
`dragstart`/`dragend` HTML5 natif fantôme au click-drag, INDÉPENDAMMENT de
tout ancêtre `draggable` — comportement par défaut du moteur, présent sur
tous les sliders de l'app (confirmé par la même sonde CDP). Fix systématique :
`draggable={false}` sur l'`<input>` dans le composant `Slider.tsx` partagé
(un seul endroit, tous les sliders de l'app en bénéficient).

**Instinct (0.6, NUANCÉ 2026-07-20 — pas de bump de confiance)** : après 3-4
passes de revue adverse `codex-crosscheck` consécutives sur la même feature/
fichier, les findings résiduels deviennent des détails d'implémentation
(précision de calcul, couverture de test marginale) plutôt que des bugs
structurants — s'arrêter et noter le résidu plutôt que boucler indéfiniment.
Confirmé 2 fois le 2026-07-19 (design doc panneaux flottants, réécriture
drag-reorder). **Contre-exemple réel le 2026-07-20** : le portail `Select.tsx`
(listbox déplacée hors overflow:hidden) a enchaîné 5 rounds de crosscheck, et
les rounds 1 à 4 ont TOUS trouvé des bugs réels non-marginaux (focus manqué à
la 1re ouverture, gap CSS écrasé, pas de bornage viewport, tests qui
n'exerçaient pas la branche visée) — seul le 5e round était vraiment un détail
(le calcul lui-même était déjà correct, restait à l'extraire en fonction
testée). Sur `App.tsx` (fit-check panneaux), 3 rounds ont aussi trouvé des
bugs réels d'affilée (source window vs workspace, clamp qui écrase le gap,
verrou consommé avant la vraie mesure). **How to apply, affiné** : le seuil
"3-4 rounds" ne s'applique qu'à du code qui RÉUTILISE un pattern déjà éprouvé
dans le repo (ex. magnétisme = itération sur une fonction pure déjà testée) —
sur du code qui introduit un NOUVEAU mécanisme (portail DOM, effet React à
timing subtil), ne pas présumer la convergence avant d'avoir un round
réellement clean, même après 4-5 rounds.

**Correction (projet)** : un screenshot statique ne contient AUCUNE
information de mouvement/animation — halluciné des caractéristiques
d'interaction (« accrochage sec », « pas de rebond ») à partir d'un
screenshot Photoshop déjà discuté, corrigé par la remarque d'Antoine. Pour
toute question sur le COMPORTEMENT (pas juste l'apparence) d'une référence
externe : soit aller l'observer en direct (navigateur), soit dire
explicitement qu'on ne sait pas plutôt que d'inférer depuis une image fixe.

**Découverte (TTL 6 mois)** : `scripts/dev.ps1` peut se retrouver bloqué
("Set-Content : le processus ne peut pas accéder au fichier
.dev-logs\tauri.stderr.log, en cours d'utilisation") même après avoir tué
`shaderlab.exe` — la cause réelle est le process `powershell.exe` qui A LANCÉ
`dev.ps1` (via `Start-Process -RedirectStandardError`), qui reste vivant même
processus enfant terminé. Fix : `Get-Process -Name powershell | Where
StartTime` pour repérer celui qui correspond au lancement précédent, le tuer
spécifiquement (pas juste `shaderlab`), puis relancer. Vécu 2× cette session.

**Correction (projet)** : `Browser.setWindowBounds` (CDP) sur la fenêtre
Tauri/WebView2 désynchronise la taille de la fenêtre OS et la surface de
rendu WebView2 — le DOM interne (mesuré via `Runtime.evaluate`) reste
correctement positionné mais le RENDU visuel apparaît cassé (contenu
recroquevillé dans un coin, zones blanches/noires). Un `Page.reload` après
resize ne corrige PAS ce désync. Seul un kill+relaunch propre (`dev.ps1`,
sans passer par CDP resize) restaure un état sain. **How to apply** : ne
jamais utiliser `Browser.setWindowBounds` pour tester un comportement
responsive sur cette app — c'est un canvas WebGPU/WebView2, pas un cas
d'usage supporté par ce mécanisme CDP. Redimensionner la vraie fenêtre OS
(ou accepter la taille de lancement) si un test à une autre taille est requis.

**Découverte (TTL 6 mois)** : Photoshop web (`photoshop.adobe.com`) n'a PAS
de système de panneaux flottants/fusionnables en onglets façon VS Code —
c'est un rail d'icônes fixe (Calques/Réglages/Historique/Commentaires) qui
bascule l'affichage de chaque panneau indépendamment, plusieurs peuvent être
visibles empilés en même temps. Vérifié en direct sur le compte réel
d'Antoine (`claude-in-chrome`, pas le navigateur sandboxé) — un premier essai
de drag a accidentellement ajouté 2 calques de réglage au fichier réel,
annulé immédiatement via Historique → état "Ouvert". **How to apply** :
pour toute question future sur le comportement RÉEL d'un outil web tiers,
préférer `claude-in-chrome` (session authentifiée) au navigateur sandboxé
quand une vérification en direct est demandée — mais rester extrêmement
prudent sur les gestes de test (drag/clic) qui peuvent modifier un document
réel de l'utilisateur, toujours vérifier l'historique/annuler après coup.

**Complément (session suivante, même jour)** : détail structurel confirmé
par un zoom plus large (cf. NG23 global — un premier zoom serré avait fait
conclure à tort à un dock fusionné sans séparation) — chaque panneau du
rail (Calques/Propriétés/Historique) est en fait une CARTE INDIVIDUELLE
(fond/radius propres, `box-shadow: none`, ~10px d'écart visible entre
cartes), avec : poignée de drag (petite barre centrée en haut), titre +
bouton fermer `×`, et pour Calques spécifiquement une barre d'icônes
(ajouter/ajustement/cadre/dupliquer/poubelle) + une ligne Fusion/Opacité
au-dessus de la liste. Vignettes de calque ~32-40px avec anneau bleu sur
sélection (pas juste un fond teinté). Valeurs exactes dans
`docs/design-system/photoshop-web-reference-tokens.md`.

**Découverte (TTL 6 mois)** : source canonique des valeurs de tokens Adobe
Spectrum (dark theme) = `github.com/adobe/spectrum-css`
`tokens/dist/json/tokens.json` (JSON avec valeurs `light`/`dark` par token,
format `rgb(r, g, b)`). Utilisé pour re-thémer shaderlab en gris neutre
(remplace l'ancien thème chaud "darkroom-balanced") — cf.
`src/design/primitives.css`/`semantic.css`. Valeurs clés retenues : gray-50
`#1b1b1b`, gray-75 `#222222`, gray-100 `#2c2c2c`, gray-200 `#323232`, gray-800
`#dbdbdb`, gray-900 `#f2f2f2`, blue-800 `#4069fd`. Sélection de ligne "non
emphasized" = 10% opacité du gris texte, pas une couleur bleue (le bleu
Spectrum n'apparaît qu'en état "emphasized"/focus clavier du conteneur).

**Découverte (TTL 6 mois, 2026-07-21)** : re-vérifié via le package npm
`@adobe/spectrum-tokens@14.15.0` (`dist/json/variables.json`, pas
`spectrum-css/tokens/dist/json/tokens.json` cité ci-dessus — les deux
existent, celui-ci est la source "tokens purs" officielle Adobe, licence
Apache-2.0) : les tokens shaderlab actuels (`--primitive-neutral-950/900/200`,
`--primitive-accent-blue`, `--radius-panel`) sont byte-identiques à
`gray-75`/`gray-100`/`gray-800`/`blue-800`/`corner-radius-500` dark de ce
package — confirme que le re-theming du 2026-07-13 (entrée ci-dessus) a bien
pris la bonne source. `--border-subtle`/`--border-default` (technique
différente : overlay blanc en opacité, pas un ton gris plein) rendent
mathématiquement (mélange alpha sur fond) à ~1px près de `gray-300`/`gray-400`
dark — donc déjà alignés eux aussi. **How to apply** : avant tout futur
chantier "rapprocher du thème Photoshop/Spectrum", commencer par ce calcul de
rendu réel plutôt que de supposer qu'il y a un écart — le seul écart trouvé
en 2026-07-21 était l'ABSENCE d'échelle d'ombres nommée (une seule valeur
plate `--shadow-panel-dragging`, aucune ombre sur Tooltip/Select/DropdownMenu)
et le ratio padding horizontal/vertical des boutons (~1.2:1 mesuré, cible
2-3:1 du socle `~/.claude/rules/ui.md` § Élévation/Espacement) — pas les
couleurs/espacements/radius eux-mêmes.

**Découverte (TTL 6 mois, 2026-07-21)** : `react-resizable-panels@4.12.2`
(dernière version au moment de l'installation) a une API RÉELLEMENT
différente de la doc/mémoire habituelle de cette librairie : exports
`Group`/`Panel`/`Separator` (pas `PanelGroup`/`PanelResizeHandle`),
`orientation` (pas `direction`), et une valeur numérique de taille
(`defaultSize={45}`) est interprétée comme des PIXELS, pas un pourcentage —
il faut une STRING (`defaultSize="45"`) pour du pourcentage. Vérifié sur le
`.d.ts` et le bundle `.js` installés dans `node_modules/`, pas deviné depuis
un README qui peut être en retard sur la version réellement publiée. **How
to apply** : pour toute librairie de layout/redimensionnement, revérifier
la forme exacte de l'API sur le `.d.ts` installé avant d'écrire du code qui
suppose une API "connue" — une version majeure peut avoir renommé les
exports sans que la doc publique en ligne suive.

**Instinct (0.6, 2026-07-21)** : Antoine délègue parfois l'exécution d'un
plan écrit par Claude à une session Codex séparée, lancée directement dans
le MÊME worktree (pas de worktree dédié) pendant qu'une session Claude
continue en parallèle (wrap-up, discussion). Preuve : le plan
`2026-07-21-shaderlab-dock-reorder-and-theme-polish.md` a été exécuté par
Codex (commits `e265f08`..`81fccbd`, messages de commit correspondant
exactement aux Steps du plan) pendant que la session Claude qui avait écrit
ce même plan faisait encore le wrap-up dans la même conversation. **How to
apply** : si `git log`/`git status` montre des commits ou des fichiers
modifiés non produits par CETTE conversation sur `feature/design-system`,
ne PAS traiter comme suspect ni comme une erreur — vérifier d'abord si les
messages de commit correspondent à un plan récemment écrit (signature
probable d'une exécution Codex/agent en parallèle) avant de supposer une
autre explication. Un hook post-commit `codex-crosscheck` peut aussi
bloquer un appel `git commit` en apparence (timeout du hook, PAS un échec du
commit lui-même) — vérifier `git log` après un timeout avant de conclure à
un échec.

**Décision d'architecture (2026-07-21)** : le renderer monolithique a été
découpé sans modifier son API publique en six propriétaires cohérents :
`EffectPassRunner` (pipelines couleur/overlay), `MaskTextureResolver`
(résidence, fold et refine edge des masques), `FrameReadback` (buffer MAP_READ
transitoire), `ImageFrameResources` (source/ping-pong/export),
`FramePipelineExecutor` (encodeur, submit et destruction post-submit) et
`FrameDiagnostics` (cadence de log). **How to apply** : ne jamais déplacer le
`queue.submit()` ou la destruction des ressources temporaires dans un runner de
passe; l'exécuteur de frame reste l'unique coordinateur de leur durée de vie.
Le renderer est maintenant une façade de composition, à garder mince.

**Découverte (2026-07-21, TTL 2027-01-21)** : un `git status`/`git ls-files`
sur le seul worktree courant rate systématiquement du travail Codex orphelin
— cette session a trouvé, en creusant `git for-each-ref` + `git ls-files`
par worktree + `.remember/` complet, 5 fichiers doc déjà committés sur
`feature/design-system` elle-même mais jamais indexés dans `docs/INDEX.json`
(le chantier "audit clean-code" complet : design + 3 plans mask-integrity/
document-export-safety/ui-runtime-hygiene, plus un plan dock-width-resize),
ET 2 branches Codex (`codex/ui-audit-remediation` 6 commits review-clean,
`codex/design-system-unification-exec`+`codex/design-system-audit-fixes` 5
commits + 15 fichiers non committés) jamais fusionnées. **How to apply** :
avant de conclure "rien à reprendre" sur ce repo, balayer `git worktree list`
+ `git for-each-ref` + `git ls-files` (pas juste `git status`) sur CHAQUE
worktree, et lire `.remember/remember.md` + le ledger `.superpowers/sdd/
progress.md` de chaque worktree actif — le statut affiché dans
`docs/INDEX.json`/`CLAUDE.md` peut être faux (affirmé sans vérification par
une session précédente) tant que ce balayage n'a pas été fait.

**Découverte (2026-07-21, TTL 2027-01-21)** : le hook post-commit
`codex-crosscheck` lit `.codex-crosscheck` (fichier marqueur opt-in) via
`git rev-parse --show-toplevel`, qui renvoie la racine du WORKTREE courant —
committer dans un worktree scratch/temporaire sans ce marqueur fait sauter
le hook silencieusement (pas d'erreur, juste rien). Un rapatriement ensuite
par fast-forward (`git merge --ff-only`) ne déclenche PAS non plus de
post-commit (aucun nouveau commit créé). **How to apply** : après un merge
fait via un worktree scratch + fast-forward, lancer manuellement
`bash ~/.claude/skills/codex-crosscheck/review.sh <repo> <range>` sur le
commit de fusion — ne pas supposer que le hook a tourné. A trouvé un vrai
bug HAUTE (padding posé sur `<canvas>` au lieu d'un wrapper, cassant
`toImageCoords`) sur le commit de fusion `0f3010d` de cette session.

**Découverte (2026-07-21, TTL 2027-01-21)** : `Emulation.setDeviceMetricsOverride`
(CDP) ne truque que le viewport CSS/layout — utile pour reproduire un bug
CSS dépendant de la forme de fenêtre (ex. stretch flexbox sur fenêtre large/
ultrawide, reproduit ici : ratio réel 3.48 au lieu de 1.5 intrinsèque en
2560×700). Mais il NE redimensionne PAS la vraie fenêtre native, donc le
swapchain WebGPU du `<canvas>` (lié à la fenêtre réelle) part en désync sous
émulation — un screenshot/pixel-sample pris sous `Emulation.*Override` sur
ce canvas est invalide (transparent/noir), alors que `getBoundingClientRect()`
(pur CSS) reste fiable. **How to apply** : pour un bug de géométrie CSS sur
ce canvas WebGPU, utiliser CDP emulation + mesure de rect (fiable) ; pour une
preuve visuelle de RENDU à une taille de fenêtre donnée, redimensionner la
vraie fenêtre native (ou demander à Antoine), jamais l'émulation CDP.

**Découverte (2026-07-21, TTL 2027-01-21)** : `npm run dev:monitor` peut
laisser un process `node` orphelin qui tail `.dev-logs/tauri.std{out,err}.log`
en continu — ce handle bloque tout `scripts/dev.ps1` suivant sur
`Set-Content` ("le processus ne peut pas accéder au fichier") sans qu'aucun
process nommé `shaderlab`/`cargo`/`npm` ne soit visible dans
`Get-Process -Name shaderlab`. **How to apply** : si `dev.ps1` échoue sur un
verrou de fichier `.dev-logs/*.log` sans process `shaderlab` visible,
chercher un `node.exe`/`pwsh.exe` dont la `CommandLine` contient
`dev:monitor`/`monitor.ps1` via `Get-CimInstance Win32_Process` et le tuer —
pas la peine de renommer/déplacer `.dev-logs/`.

## 2026-07-21 (wrap-up session)

### Chantiers exécutés cette session

**mask-integrity** (feature/mask-integrity, 3 commits):
- Task 1-3 complete: MaskSource discriminated union + planFold fix for parametric sources (bug: was filtering on `raster !== null`, excluding ALL gradients/luminosity/colorRange) + checkbox "Actif" per source in UI
- Finding MOYENNE from Codex: cache snapshot never re-updates when fold() re-encodes to same ping-pong texture → GPU refold at full-res every frame indefinitely after first invalidation
- Tests 249/249 green, tsc/build/lint ✅

**design-system-unification-exec** (codex/design-system-unification-exec, 4 commits):
- Tasks 1-5 complete (5 tasks = full unification plan)
- Branch is STALE (diverged after renderer-split commit 3831fd6, needs rebase)
- 2 REAL MOYENNE findings survive rebase: onPointerCancel removed from Canvas → stroke cancellation broken; ParamPanel lost label/units metadata → UI shows bare IDs
- Tests 217/217 green, tsc/build/lint ✅

**dock-width-resize** (feature/dock-width-resize, 1 commit):
- Task 1 complete: clampDockWidth pure function + 5 tests, all pass
- Tasks 2-3-4 pending (Task 4 = human WebView2 visual checkpoint)
- Plan rewritten for multi-column dock-grid API

### Learnings from Codex cross-check (first time used in this repo)

- Cross-check catches real bugs missed by own review (cache snapshot bug, scope-creep regressions)
- Stale branch detection is automatic (HAUTE false-positives from missing upstream commits)
- Valuable for catching logic regressions before merge

## 2026-07-21 (checkpoint Task 8 — dock-reorder-and-theme-polish)

`feature/mask-integrity` mergé (`769ed60`) après nettoyage de 3 worktrees
morts. Le checkpoint visuel Task 8 lui-même a fait remonter 9 bugs/incohérences
réels (pas de simples ajustements cosmétiques), tous corrigés dans `959d9ed` :

**Bug réel — hover cassé par une formule Tailwind invalide** : `button.tsx`
variant `secondary` avait `hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]`
— `--secondary` n'existe nulle part dans ce projet (le vrai token namespacé
Tailwind v4 est `--color-secondary`). Une `custom property` indéfinie dans un
`color-mix()` invalide toute la déclaration → `background-color` retombe sur
`transparent` (valeur initiale). Le bouton "Fichier" devenait invisible au
survol. **Piège générique** : une formule `color-mix()`/arbitrary-value
Tailwind qui référence une variable "à la shadcn" (`--secondary`,
`--foreground`) sans vérifier qu'elle correspond au namespace RÉEL du
`@theme` du projet (`--color-*` en Tailwind v4) échoue silencieusement — pas
d'erreur console, juste `transparent`. Toujours préférer réutiliser un
utilitaire Tailwind existant qui marche déjà ailleurs (`hover:bg-accent`)
plutôt qu'une formule bespoke non testée.

**Bug réel — palette pré-migration orpheline** : `--surface-inset: #141210`
était le SEUL token resté sur l'ancienne échelle "chambre noire chaude",
jamais migré vers Adobe Spectrum le 2026-07-20 (documenté dans le commentaire
de `primitives.css` mais jamais vérifié après coup). Balayage complet
(`grep -rn "#[0-9a-fA-F]\{3,6\}" src --include=*.css`) confirme qu'aucune
autre couleur hex ne traîne hors de `primitives.css` — c'était vraiment le
seul orphelin. Migré vers `var(--primitive-neutral-1000)`.

**2 bugs réels dans `src/ui/Select.tsx`** (listbox custom, pas un `<select>`
natif) :
1. Le listener `window.addEventListener("scroll", closeOnScrollOrResize,
   {capture:true})` (censé fermer la liste si un ANCÊTRE scrolle) attrapait
   AUSSI le scroll interne de la listbox elle-même — un `scroll` event ne
   bubble pas mais un listener en phase CAPTURE d'un ancêtre le voit quand
   même, peu importe la cible. Résultat : impossible de scroller dans une
   liste de +8 options, fermeture dès la première tentative. Fix : ignorer
   l'event si `event.target` est contenu dans `listRef.current`.
2. `scrollIntoView({block:"nearest"})` se déclenchait sur CHAQUE changement
   d'`activeIndex`, y compris ceux causés par `onMouseEnter` (survol souris)
   — bouger la souris dans la liste la faisait scroller toute seule,
   incontrôlable. Fix : un ref `scrollOnNextActiveChangeRef` posé à `true`
   uniquement par les vrais déclencheurs clavier (flèches/Home/End/typeahead/
   ouverture), `false` par le survol — `scrollIntoView` ne s'exécute que si
   `true`. **Pattern générique** : dans un widget custom, ne jamais laisser
   `onMouseEnter` déclencher le MÊME effet de scroll que la navigation
   clavier — le survol est un signal d'affichage, pas d'intention de
   défilement.

**Pattern récurrent — 2 fois dans la session, même bug** : une case fixe
contenant un `IconButton size="compact"` (28px) avec une hauteur de case ne
laissant qu'1px de marge de chaque côté (30px, `--control-height-md`/
`--layer-row-height` avant fix) — le "reliquat de calcul entre deux tokens
sans rapport" plutôt qu'un rang d'espacement délibéré. Trouvé sur
`DockedPanelCard__titlebar` (chevron collapse) ET sur `LayerPanel__row-top`
(eye/trash). **Règle à appliquer PROACTIVEMENT** (pas seulement en review) :
avant de fixer une hauteur de ligne/case contenant un `IconButton`, calculer
explicitement `(hauteur_case - hauteur_bouton) / 2` et vérifier que ça tombe
sur un rang `--space-N` réel (au moins `--space-2`, 4px) — ne jamais
assigner une hauteur "qui a l'air correcte" sans ce calcul.

**Rang de gap incohérent** : `.layer-panel__row-controls` (Opacité → Fusion)
utilisait `--space-2` (rang "interne à un composant", icône-texte) pour une
relation qui est en réalité "contrôles frères dans un groupe" (rang
`--space-5`, même relation que `.param-panel__group`). Les deux zones
affichent le même TYPE de contenu (sliders empilés) mais dans des rangs
different — signal qu'il vaut la peine de comparer les CSS de composants
visuellement similaires plutôt que de juger chaque composant isolément.

Méthode extraite (voir aussi `~/.claude/instinct-log.md` NG29/NG30, portée
globale) : cette session a enchaîné ~9 micro-fixes séquentiels sur des
plaintes UI reformulées 4 fois ("thème pas cohérent" → "et les couleurs ?"
→ "les règles de padding..."). Un audit token/CSS large fait dès la première
plainte systémique aurait capturé plusieurs de ces bugs en une seule passe.

## 2026-07-23 — Cache edge-aware/refine : 4 bugs en cascade, confirme l'instinct "nouveau mécanisme → pas de convergence avant un round clean"

**Contexte** : ajout d'un cache de résultat sur `edge()`/`refine()`
(`maskTextureResolver.ts`) pour corriger un lag global signalé par Antoine.
4 rounds successifs de crosscheck adverse (`verify-gate`) + audit ont
chacun trouvé un VRAI bug de cache non trivial, jusqu'au round 4/5 :
(1) identité de texture au lieu du contenu réel (resident()/parametric()
réutilisent le même objet GPUTexture en le re-rendant), (2) edgeRadius/
edgeStrength non propagés au cache de refine() en aval, (3) bascule ON/OFF
d'edgeAware non trackée, (4) le guide du filtre (composite des calques EN
DESSOUS) jamais suivi — celui-ci a nécessité un changement d'interface à
travers 3 fichiers (`framePipelineExecutor.ts`/`effectPassRunner.ts`/
`maskTextureResolver.ts`), pas détectable par un crosscheck limité au diff.

**Confirme l'instinct déjà noté le 2026-07-20** (même fichier, entrée
"3-4 rounds... nuancé") : le seuil "3-4 rounds puis résidu = détail" ne
s'applique QU'à du code réutilisant un pattern déjà éprouvé — sur un
NOUVEAU mécanisme (ici : cache par révision de contenu, jamais posé
auparavant dans ce resolver), chaque round a trouvé un angle mort réel
jusqu'au bout. Ne jamais présumer la convergence tôt sur un mécanisme neuf,
même après plusieurs rounds consécutifs propres.

**Découverte durable (architecture)** : dans ce renderer, `resident()`/
`parametric()` (masques) réutilisent le MÊME objet `GPUTexture` d'un appel
à l'autre et le RE-RENDENT en place quand le contenu change (cache par
`syncedFrom`) — comparer `texture === lastTexture` ne détecte donc JAMAIS
un changement de contenu réel. Tout futur cache posé sur une ressource GPU
de ce renderer doit invalider sur une valeur de CONTENU (snapshot de
paramètres, ou compteur de révision bumpé au moment du recalcul réel),
jamais sur l'identité d'objet — piège déjà connu de `fold()` (son propre
cache utilise un snapshot), pas généralisé aux nouveaux caches posés sans
relire ce précédent d'abord.

**Découverte durable (architecture)** : `FramePipelineExecutor.run()` n'a
AUCUNE mémoïsation par calque — chaque calque activé recompose son passe
effet/masque à CHAQUE exécution réelle du pipeline, y compris ceux qui
n'ont eux-mêmes pas changé (seul le déclenchement global est coalescé par
`FrameScheduler`, pas le travail par calque). Conséquence directe : un
masque `edge-aware` sur un calque qui n'est PAS le premier de la pile lit
un guide (`colorView` = composite des calques en dessous) qui est
potentiellement neuf à CHAQUE frame — un cache sur ce guide doit soit
suivre un `guideEpoch` fourni par l'appelant (implémenté cette session),
soit accepter de ne jamais mettre en cache au-delà du premier calque.

## 2026-07-23 — 3e occurrence du bug `IconButton` taille par défaut cassant l'alignement `--space-9`

Déjà noté 2 fois le 2026-07-21 (`DockedPanelCard__titlebar`,
`LayerPanel__row-top`) : une case dimensionnée pour un `IconButton
size="compact"` (28px) reçoit un `IconButton` SANS ce prop (défaut 30px,
`--control-height-md`), cassant l'alignement de 2px. 3e occurrence trouvée
cette session sur `MaskPanel.tsx` (icône "Actif" par source) par le même
audit qui a aussi corrigé le point NG48 ci-dessus (`~/.claude/instinct-log.md`).
**Règle à graduer si une 4e occurrence survient** : ce n'est plus un
accident isolé mais un défaut structurel du composant `IconButton`
lui-même (`size="default"` ne devrait peut-être pas exister, ou son usage
dans une liste dense devrait être un lint/convention explicite) — envisager
un audit ciblé de TOUS les usages `IconButton` sans `size` dans des
contextes de liste plutôt qu'un fix au coup par coup à la prochaine
occurrence.

## 2026-07-22 — dogfood-qa (nouveau skill global) : premier passage réel, 1 bug trouvé

Premier test du skill `dogfood-qa` (audit QA exploratoire, ~/.claude/skills/)
sur ce repo. Périmètre réduit à l'écran vide (avant chargement d'image), via
CDP sur la vraie fenêtre WebView2 (confirme en pratique l'exception moyen-de-
preuve déjà déclarée dans CLAUDE.md racine : screenshot CDP non noir, contrairement
à ce qu'aurait donné Playwright headless sur ce canvas WebGPU).

**Bug trouvé et corrigé** (`96dd8d5`) : `LayerPanel` (dropdown "+ Ajouter un
effet") et `Toolbar` (menu Fichier › Exporter) n'étaient gatés par aucune
condition liée à la présence d'un document — un calque complet (avec ses
réglages) pouvait être créé, et Export restait cliquable, alors que le canvas
affichait toujours l'écran vide "Ouvrir une photo". Fix : nouvelle prop
`hasImage` (réutilise `imageSize.width > 0 && imageSize.height > 0`, déjà
calculé pour `Canvas`) passée aux deux composants, `disabled={!hasImage}`.

**Pattern générique à surveiller** : tout nouveau contrôle qui agit sur le
document actif (ajout de calque, export, futurs items menu Fichier) doit
explicitement vérifier `hasImage` — ce n'est pas gardé par défaut par
l'architecture actuelle (chaque composant doit le faire individuellement, pas
de garde centralisée au niveau du routeur/layout).

## 2026-07-23 — un `shaderlab.exe` en cours d'exécution peut appartenir à un AUTRE worktree

**Découverte (TTL 6 mois)** : pendant la vérification visuelle d'une simplification
de `MaskPanel.tsx` (labels mojibake + segmented control combine-mode, `e7dec9f`,
`feature/design-system`), Antoine a montré un screenshot du process `shaderlab.exe`
déjà en cours (CDP actif sur `:9222`) affichant un toggle "Overlay masque"
inexistant dans le fichier édité. `grep -rn "Overlay masque" src` ne trouvait
RIEN dans le worktree courant — signal que la fenêtre visible ne pouvait
structurellement pas montrer le code édité. Confirmé via
`Get-CimInstance Win32_Process -Filter "Name='shaderlab.exe'" | Select ExecutablePath`
: le process tournait depuis `.claude/worktrees/mask-threshold-contour`
(branche `worktree-mask-threshold-contour`), pas depuis `C:\dev\shaderlab`.

**How to apply** : avant de traiter un screenshot/CDP d'une fenêtre `shaderlab.exe`
déjà ouverte comme preuve visuelle d'un changement, vérifier
`ExecutablePath`/`CommandLine` du process (`Get-CimInstance Win32_Process
-Filter "Name='shaderlab.exe'"`) — une fenêtre déjà lancée avant la session
courante peut appartenir à n'importe quel worktree actif (`git worktree list`),
pas forcément à `C:\dev\shaderlab`. Un élément UI visible mais absent du
`grep` sur le fichier source censé le contenir est le signal fiable qu'on
regarde la mauvaise fenêtre plutôt qu'un bug/état non commité.

## 2026-07-23 — 3 sous-agents dispatchés sur des plans frères, 1/3 seulement a mis à jour `docs/INDEX.json`

**Découverte (TTL 6 mois)**, confirme le pattern NG23/NG28 (`~/.claude/instinct-log.md`)
sous un angle nouveau : 3 plans d'audit indépendants (`2026-07-21-audit-
mask-integrity.md`, `-document-export-safety.md`, `-ui-runtime-hygiene.md`)
dispatchés en parallèle, un worktree isolé chacun, prompts quasi-identiques
(même structure : lire CLAUDE.md, exécuter le plan en TDD, committer avec
pathspec). Aucun des 3 prompts ne mentionnait explicitement `docs/INDEX.json`.
Résultat à la fin des 3 exécutions : l'agent mask-integrity a spontanément
trouvé et corrigé un statut périmé (le plan était déjà livré le 2026-07-21,
jamais marqué comme tel) ; l'agent ui-runtime-hygiene a mis à jour l'entrée
correspondante après avoir livré son code ; l'agent document-export-safety,
lui, a livré 3 commits de code irréprochables (tsc/tests/cargo tous verts)
mais n'a jamais touché `docs/INDEX.json` — son entrée est restée à "NON
exécuté" jusqu'à ce que le wrap-up de la session orchestratrice la recroise
avec `git log` et la corrige.

**How to apply** : le fait que le repo documente lui-même sa convention
(`docs/INDEX.json._regle_entretien` : "à chaque ajout/déplacement/archivage,
mettre à jour ce fichier dans le même geste") NE SUFFIT PAS à garantir que
tous les agents dispatchés en parallèle la suivent, même avec des prompts
quasi-identiques — 2 sur 3 l'ont fait, 1 sur 3 non, sans qu'aucun signal ne
distingue à l'avance lequel dérogerait. Dans un prompt de dispatch
`subagent-driven-development`/`dispatching-parallel-agents` sur ce repo,
lister explicitement "mettre à jour l'entrée `docs/INDEX.json` du plan
exécuté (statut + preuve : SHA de commit, résultat tsc/tests) dans le même
commit" comme item de la définition de "terminé" — ne pas compter sur la
convention auto-documentée du repo pour se propager d'elle-même à travers
plusieurs instances de sous-agent.

## 2026-07-24 — `test-storybook` échoue sur 21/21 fichiers ("outside of Vite serving allow list") selon le layout `node_modules` du worktree, pas selon le contenu des stories

**Découverte (TTL 6 mois)** : `npm run test-storybook` échouait avant toute
`play` function (import de `@storybook/addon-vitest/dist/vitest-plugin/
setup-file.js` rejeté par Vite) — cause : `server.fs.allow` par défaut de
Vite s'arrête au premier ancêtre contenant un lockfile
(`searchForWorkspaceRoot`), donc au `package-lock.json` propre à CE worktree,
jamais à `C:\dev\shaderlab`. Deux layouts de worktree différents produisent
le MÊME symptôme par des mécanismes différents : `node_modules` symlinké
vers le checkout principal (Vite résout le symlink en realpath avant de
vérifier l'allow list → hors liste) ; ou `node_modules` réel mais vide/
incomplet (aucun package installé dans le worktree → la résolution Node
remonte vers l'ancêtre `node_modules` qui, lui, est complet → hors liste).
Fix dans `vitest.config.ts` : `require.resolve('@storybook/addon-vitest/
package.json', { paths: [dirname] })` (laisse Node faire sa propre
résolution, qui gère les deux cas) plutôt que `fs.realpathSync` du
`node_modules` local — puis allow-lister le parent du chemin résolu.

**How to apply** : sur ce repo, si `test-storybook` échoue en bloc (tous
fichiers, avant toute `play` function) avec une erreur `"outside of Vite
serving allow list"`, ce n'est jamais un défaut de story individuelle —
vérifier `vitest.config.ts` (`server.fs.allow`) et le layout réel de
`node_modules` du worktree courant (`ls -la node_modules`, symlink ou
dossier peu peuplé) avant de creuser ailleurs.

## 2026-07-24 — Un spike visuel qui ne varie qu'un seul paramètre peut valider un fix incomplet quand le bug dépend d'un DEUXIÈME paramètre implicite

**Correction (skill gap)**, session guide overlay = source
(`docs/adr/0002-overlay-guide-epoch-invariant.md`) : le premier fix (Task 1)
a été validé par un spike CDP live (glow/warp poussés à l'extrême, guide=
source vs guide=composite) qui semblait concluant — mais le spike n'a jamais
ajouté qu'UN SEUL calque à la pile testée, donc ce calque était toujours à
l'index 0. Le bug réel dépendait de la POSITION du calque dans la pile
(index 0 vs index>0), une variable que le spike ne faisait jamais varier. Le
fix a semblé validé alors qu'il ne couvrait qu'une branche du problème — la
revue finale de branche (pas le spike) a trouvé le cas manquant.

**How to apply** : avant de considérer un spike/A-B visuel comme preuve
suffisante d'un fix, lister explicitement les variables dont dépend le bug
(ici : identité du guide ET position du calque dans la pile) et vérifier que
le protocole de spike fait varier CHACUNE, pas seulement celle qu'on a en
tête au moment de le construire. Pour un bug de cache/invalidation
spécifiquement : identifier l'invariant EXACT que le cache compare (ici :
égalité numérique d'epoch, jamais l'identité de texture — voir
`maskTextureResolver.ts:243-247`) avant de juger qu'un fix le respecte, ne
pas se fier à un test visuel qui ne peut de toute façon pas voir une
différence d'epoch.

## 2026-07-24 — reprendre un checkpoint visuel coupé exige de rebaser la branche AVANT de juger

**Découverte (TTL 6 mois)** : le chantier "dossier d'export" avait été
interrompu en pleine Task 7 (checkpoint humain) la nuit du 2026-07-24 — app
lancée puis quittée, aucun résultat consigné. À la reprise, la branche isolée
`claude/sad-almeida-b14d66` était **15 commits en retard** sur
`feature/design-system`, dont `85f5293` (fix de l'inversion rouge/bleu de tout
export JPEG sur Windows). Refaire le checkpoint export SANS rebase aurait fait
juger des fichiers exportés portant un bug déjà corrigé ailleurs — un faux
verdict. **How to apply** : avant de reprendre un checkpoint visuel sur une
branche/worktree isolé laissé en plan, `git rev-list --count <branche>..feature/design-system`
et lire ce qui manque ; rebaser d'abord si des commits touchant le chemin
sous test sont en aval. Le checkpoint ne prouve que ce que la branche contient.

## 2026-07-24 — ne pas demander à Antoine d'agir sur un process lancé tant que son rendu n'est pas VÉRIFIÉ

**Découverte (TTL 6 mois)** : pendant le checkpoint round-trip, une 2e instance
`shaderlab.exe` lancée à la main (Start-Process) a été annoncée comme "lancée,
regarde la fenêtre qui affiche roundtrip-test.JPG" — mais elle n'avait PAS pris
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` (CDP muet), et la fenêtre était en
réalité sur une page `chrome-error://` (`ERR_CONNECTION_REFUSED`, Vite tué entre
temps par la fin du wrapper `dev:debug`). Antoine a dû répondre "la deuxieme
instance n'est pas lancée". Assertion d'état non prouvée avant de solliciter
l'humain (C1). **How to apply** : après tout lancement de fenêtre destiné à un
checkpoint humain, VÉRIFIER d'abord soi-même que l'app rend réellement (CDP
joignable + `location.href` = `http://localhost:1420/` + un marqueur DOM du bon
worktree) AVANT de demander à Antoine de regarder ou de cliquer — ne jamais lui
faire arbitrer sur une fenêtre dont on n'a pas confirmé qu'elle sert l'app.

## 2026-07-24 — pièges d'outillage dev sur ce repo (Tauri/Vite/CDP), reconfirmés

**Découverte (TTL 6 mois)** :
1. **`npm run dev:debug` en tâche de fond, à sa terminaison, tue Vite ET la
   fenêtre qu'il avait lancée.** Une instance `shaderlab.exe` lancée séparément
   se retrouve alors sur `ERR_CONNECTION_REFUSED` (localhost:1420 mort).
   Contournement : relancer `npm run dev` seul (Vite persistant en tâche de
   fond) puis recharger la page via CDP (`location.replace('http://localhost:1420/')`).
2. **Une 2e instance lancée via `Start-Process` sans `-RedirectStandardOutput`/
   `-RedirectStandardError` ne prend pas fiablement `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`
   au 1er essai** (CDP jamais up, `MainWindowTitle` vide) — relancer avec les
   deux redirections capture aussi les erreurs de démarrage.
3. **`git worktree remove --force` échoue en "Permission denied" si un shell
   d'outil persistant a son cwd resté DANS le worktree** (les `cd` de Bash
   persistent entre appels — parent de NG53). L'entrée worktree git et la
   branche se suppriment quand même ; seul le dossier reste verrouillé jusqu'à
   la fin de session. Ne pas s'acharner : `git worktree remove` détache l'admin,
   le dossier vide part au nettoyage suivant.

## 2026-07-24 — grand nettoyage branches/worktrees : master aligné sur feature/design-system

**Découverte (TTL 6 mois)** : repo réduit à 2 branches locales (`master`,
`feature/design-system`), toutes deux synchronisées sur `bbeaf19` — `master`
a été fast-forwardé sur `feature/design-system` (`origin/HEAD` pointait déjà
sur `feature/design-system`, `master` avait juste 416 commits de retard, zéro
commit propre). 15 branches obsolètes + 6 dossiers `.claude/worktrees/*`
supprimés après audit (ancestry-check + diff de contenu par sous-agent
lecture seule). Seul contenu réel récupéré avant suppression : `src/ui/
Dialog.tsx` + `dialog.css` (depuis `feature/design-system-mine`, périmée
depuis 2026-07-13) — seule implémentation de `Dialog` alors que la spec
design-system le référence (`docs/design-system/components.md`,
`tokens.md`). **How to apply** : avant de conclure qu'une vieille branche
est "obsolète" via `git branch --merged`, vérifier que son contenu n'a pas
été **cherry-pické** sous d'autres SHA (`--merged` rate ça — cas réel :
`sat-feather` et `claude/happy-allen-9f4e4e` contenaient le chantier SAT
feather déjà absorbé sous `9741ac0`/`b9e7618`, invisibles en ancestry).

## 2026-07-24 — un fichier extrait d'une branche périmée peut compiler là-bas et casser ici sans avertissement

**Découverte (TTL 6 mois)** : `src/ui/Dialog.tsx` récupéré depuis
`feature/design-system-mine` importait `./IconButton` (chemin valide sur
cette branche, 2026-07-13) — le composant a depuis été renommé en
kebab-case sous `src/components/ui/icon-button.tsx`. Le fichier copié
compilait à l'origine, donc rien dans son propre historique ne signalait le
problème ; seul `tsc --noEmit` sur l'ARBRE COURANT après extraction l'a
révélé (poussé une première fois cassé sur `origin/master` avant d'être
rattrapé par le gate de build du wrap-up). **How to apply** : après tout
`git checkout <branche-périmée> -- <fichier>` (récupération ciblée, pas un
merge), lancer immédiatement `npx tsc --noEmit` avant de committer — ne pas
attendre le gate de fin de session pour un fichier qui "vient d'une branche
qui marchait".

## 2026-07-24 — `scripts/dev.ps1` (Start-Process détaché) ne survit pas de façon fiable à un appel Bash `run_in_background` dans ce sandbox

**Découverte (TTL 6 mois)** : lancer `npm run dev:debug` via le tool Bash
(`run_in_background: true`) retourne "exit 0" quasi instantanément (normal,
`Start-Process -WindowStyle Hidden` détache), mais le process `npm.cmd`/
`cargo`/`shaderlab.exe` détaché n'apparaît PAS de façon fiable dans
`Get-Process` après — sur 3 tentatives successives (Bash puis outil
PowerShell direct), aucune n'a laissé un process nommé `shaderlab`/`cargo`
vivant, et `dev-process.json` n'a jamais été réécrit (la 2e/3e tentative
échouait même à `Set-Content` sur `tauri.stderr.log`, verrouillé par la 1re
tentative pourtant introuvable via `Get-Process`). Contournement qui A
marché : lancer `npm run tauri dev` DIRECTEMENT (pas via `dev.ps1`) en
foreground du tool Bash avec `run_in_background: true` — reste vivant, CDP
(`http://localhost:9222/json`) répond après ~35s de build cargo. **How to
apply** : si `dev.ps1`/`dev:debug` ne produit aucun process visible après
lancement, ne pas s'acharner à diagnostiquer le verrou de fichier — court-
circuiter directement avec `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-
debugging-port=9222 npm run tauri dev` en `run_in_background`, poll
`curl http://localhost:9222/json` (fonctionne malgré un `curl` isolé qui
peut échouer hors contexte de boucle — testé bash direct `curl` en dehors
d'un `until` a échoué une fois sans raison claire, dans un `until` ça a
marché) plutôt que `Invoke-WebRequest` PowerShell (a timeout à tort en
parallèle alors que le port répondait déjà côté bash).

## 2026-07-24 — relever `MAX_EFFECT_PARAMS` casse un test qui codait en dur l'ancienne limite, sans lien visible avec le diff qui l'a cassé

**Découverte (TTL 6 mois)** : `test/render/effects/validate.test.ts`
fixait `effectWithParams(8)`/`effectWithParams(9)` en dur pour tester la
limite — en élargissant `MAX_EFFECT_PARAMS` de 8 à 11 (`shaderCompose.ts`,
pour le duotone tritone à 11 params), ce test a commencé à échouer
("expected to throw") sans qu'aucun diff ne touche directement ce fichier
de test. **How to apply** : après toute modification de
`MAX_EFFECT_PARAMS`, grep `test/` pour des fixtures qui codent en dur
l'ancienne valeur (`effectWithParams(8)`, ou tout littéral numérique proche
de la constante) — `tsc`/lint ne le détectent jamais, seul `npm run test`
le révèle, et le message d'échec ne pointe pas vers `shaderCompose.ts`
comme cause.

## 2026-07-25 — l'automatisation CDP échoue sur les menus Fichier/dialogues natifs de cette app, préférer la main humaine

**Découverte (TTL 6 mois)** : pour le checkpoint Task 8 double exposure,
`.click()`, `dispatchEvent(new PointerEvent(...))` ET `Input.dispatchMouseEvent`
CDP aux coordonnées exactes (`getBoundingClientRect`, DPI confirmé à 1 via
`--device-scale-factor=1` dans la commandline du process renderer) ont TOUS
échoué à déclencher l'item "Ouvrir" du menu Fichier (dropdown Base UI) — zéro
dialogue natif ouvert, zéro changement d'état, après ~10 tentatives sur 3
techniques différentes. Un seul essai précédent (script `cdp-check2.mjs`)
avait réussi à ouvrir un VRAI dialogue natif `rfd` (fenêtre "Ouvrir" bloquante,
confirmée par `Get-Process shaderlab | select MainWindowTitle`) — donc le
mécanisme MARCHE en soi, mais est trop peu fiable pour être automatisé sans
budget de debug disproportionné. **How to apply** : pour toute interaction
nécessitant le menu Fichier natif (Ouvrir/Importer une 2e photo/Exporter sous),
ne pas insister en CDP au-delà de 2-3 tentatives — demander à Antoine de faire
les quelques clics manuellement, puis reprendre le pilotage CDP pour tout ce
qui suit (sélection de calque, lecture d'état, screenshot) qui, lui, fonctionne
bien via `.click()`/CDP.

## 2026-07-25 — tuer le process Vite (port 1420) ne tue pas forcément la fenêtre WebView2 : elle peut rester vivante avec un état périmé

**Découverte (TTL 6 mois)** : après avoir tué le process node tenant le port
1420 (serveur Vite d'une session concurrente), `Get-Process -Name shaderlab`
ne montrait plus rien — mais en se connectant quand même au port CDP 9222
(resté ouvert), la page affichait encore un document chargé (calques
Duotone/Posterize) d'une session antérieure. La fenêtre WebView2 avait donc
survécu à la mort de son serveur Vite, avec state React intact. **How to
apply** : avant tout dev:debug/tauri dev, vérifier `Get-Process shaderlab`
ET l'état réel de la page via CDP (`document.body.innerText`) avant de
supposer une fenêtre "fraîche" — l'absence du process `shaderlab.exe` ne
suffit pas à garantir l'absence d'un état de session antérieur navigable.
Confirmer avec Antoine avant d'écraser un état qu'on n'a pas soi-même produit
(risque de perdre un travail en cours non sauvegardé, cf. collision multi-session
déjà documentée dans CLAUDE.md).

## 2026-07-25 — mesurer la VRAM dédiée réelle d'un process WebView2 (Windows)

**Découverte (TTL 6 mois)** : le compteur perf `\GPU Process Memory(pid_X...)\
Dedicated Usage` n'existe PAS pour le PID de `shaderlab.exe` lui-même — le
rendu WebGPU se fait dans un process ENFANT `msedgewebview2.exe --type=gpu-process`.
Technique : `Get-CimInstance Win32_Process -Filter "ParentProcessId=<shaderlab_pid>"`
→ trouve le process WebView2 principal → `Get-CimInstance Win32_Process -Filter
"ParentProcessId=<webview2_pid>"` → repère la ligne `--type=gpu-process` → son
PID sert de clé pour `Get-Counter '\GPU Process Memory(pid_<gpu_pid>_luid_...)\
Dedicated Usage'` (lister les instances via `(Get-Counter -ListSet "GPU Process
Memory").PathsWithInstances` si le LUID exact est inconnu). Mesuré le 2026-07-25 :
~1280 Mo dédiés avec 2 photos 26MP + 3 calques (dont un calque photo double
exposure) chargés simultanément, aucun `device.lost`.

## 2026-07-25 — fermer un dialogue natif Windows bloquant sans focus (PostMessage WM_CLOSE)

**Découverte (TTL 6 mois)** : `SetForegroundWindow` (P/Invoke) retourne `false`
et `SendKeys::SendWait("{ESC}")` n'a aucun effet sur un dialogue natif ouvert
par un process qui n'a pas le focus (restriction Windows anti-vol-de-focus).
`PostMessage(hWnd, 0x0010 /* WM_CLOSE */, 0, 0)` fonctionne SANS nécessiter le
focus — a fermé un dialogue "Ouvrir" (`rfd`) resté bloquant après une tentative
CDP ratée. **How to apply** : pour débloquer une fenêtre native bloquée depuis
un agent headless, préférer `PostMessage`/`WM_CLOSE` à `SetForegroundWindow`+
`SendKeys`.

## 2026-07-25 — un warning React "setState pendant le render" (App/LayerPanel) trouvé au checkpoint visuel, non corrigé

**Découverte (TTL 6 mois), suivi requis** : pendant le checkpoint Task 8
double exposure, sélectionner le calque Passthrough a émis en console
`"Cannot update a component (App) while rendering a different component
(LayerPanel)"` — pas de crash, pas d'exception, mais un vrai anti-pattern
React (setState en cours de render d'un autre composant) qu'aucune revue de
tâche n'a pu détecter (convention du projet : aucun test ne rend de
composant React). **How to apply** : investiguer l'origine (probablement un
handler de sélection de calque qui déclenche un setState App.tsx pendant
que LayerPanel est en cours de rendu) et corriger — non bloquant pour
Double exposure (aucune régression fonctionnelle observée) mais à traiter
avant d'accumuler d'autres warnings du même type.

## 2026-07-26 — le warning setState-during-render du 2026-07-25 : cause racine trouvée et corrigée

**Correction (clôt la découverte du 2026-07-25 ci-dessus)** : l'hypothèse
inscrite alors ("probablement un handler de sélection de calque") était FAUSSE.
La vraie cause est `src/ui/dragReorder.ts` : `onReorder` était appelé À
L'INTÉRIEUR de l'updater fonctionnel passé à `setDragState`. React peut rejouer
un updater pendant la passe de rendu du composant propriétaire du hook pour
réconcilier sa file — quand ça arrive (rafale de `pointermove` rapprochés, un
vrai glissement physique), `onReorder` remonte alors un `setState` d'`App`
pendant le rendu de `LayerPanel`.
**How to apply** : ne JAMAIS appeler un callback à effet de bord dans un updater
de `setState` — un updater doit être pur. Sortir l'effet dans la pile du
gestionnaire d'événement, en lisant l'état via un miroir en `ref` synchronisé
(motif déjà en place dans `PanelColumn.tsx`). Reproduit puis éteint sous CDP
avec 40 `pointermove` synthétiques : c'est la rafale qui déclenche le rejeu,
un glissement lent ne le montre pas.

## 2026-07-26 — un CSS jamais importé passe tous les contrôles du projet au vert

**Découverte (TTL 6 mois)** : `src/ui/dialog.css` existait depuis le
2026-07-24 sans être importé nulle part — `Dialog.tsx` n'importait que React,
lucide et `IconButton`. Aucun consommateur du composant, donc personne ne
l'avait constaté. `tsc`, `npm run test` et `npm run lint:tokens` passent tous
au vert sur une feuille de style jamais chargée : le seul symptôme aurait été
un `<dialog>` natif brut à l'écran. Trouvé par une revue de PLAN, pas par un
outil.
**How to apply** : quand un composant du projet est mis en service pour la
première fois, vérifier qu'il importe bien sa feuille (`grep -rn "<nom>.css"
src/`) — la convention du projet est que chaque composant importe la sienne
(`ColorPickerPanel.tsx:5`, `PanelRail.tsx:2`, `LayerPanel.tsx:11`). Aucun
contrôle automatisé n'attrape ce cas, ni celui d'un `var(--token-inexistant)`
(`lint:tokens` ne détecte que les valeurs en dur qui doublent un token
existant).

## 2026-07-26 — deux mesures de "largeur du dock" à ne pas confondre

**Découverte (TTL 6 mois)** : `--dock-reserved-width` est la largeur d'UNE
colonne (lue par `PanelColumn.css` pour dimensionner chaque pile, pilotée par
la poignée de redimensionnement). `--dock-total-width` (ajoutée le 2026-07-26)
est la place RÉELLEMENT occupée à l'écran : n colonnes et leurs n-1 gouttières,
0 si le dock est vide. Le canvas et l'ancrage du sélecteur de couleur doivent
lire la SECONDE. Avec la première, masquer tous les panneaux depuis le rail
laissait le canvas décalé de 320px pour un dock invisible, et un dock à 2
colonnes n'était compensé que pour une.
**How to apply** : toute nouvelle surface qui doit "se pousser" pour le dock lit
`--dock-total-width`. Vérifié par CDP : padding du canvas 372px → 52px quand le
dock se vide.

## 2026-07-26 — l'invariant OOM 24MP se re-viole par le chemin le plus banal

**Correction** : deux plans successifs (double exposure puis presets) ont
proposé, pour appliquer une nouvelle pile de calques, de réécrire à la main le
contenu du helper `commit` d'`App.tsx` — donc `sessionRef.current.commit(stack)`
suivi de `setLayers(sessionRef.current.layers())`. Ce `setLayers` pousse les
calques COMPLETS (avec leurs rasters de masque, ~26 Mo à 24MP) dans l'état
React, exactement la cause du crash résolu en `e3c7584`. Le second effet est
qu'oublier `requestRender` rend la fonctionnalité muette : rien ne se redessine.
**How to apply** : toute mutation de pile passe par `commit(stack)`, jamais par
une réécriture de son contenu. C'est le genre d'erreur qu'un plan écrit de
mémoire réintroduit naturellement, parce que la séquence "commit puis setState"
paraît anodine — la relire à chaque plan qui touche aux calques.

## 2026-07-26 — un objet de retour de hook en dépendance casse la mémoïsation d'une liste

**Correction** : `handleRemove` (`App.tsx`) avait reçu l'objet `presets` entier
dans ses dépendances de `useCallback` pour pouvoir appeler `presets.clearActive()`.
`usePresets` rend un littéral objet neuf à chaque render, donc `handleRemove`
changeait d'identité à chaque frame de glissement de curseur (`handleParamChange`
→ `syncSession` → `setLayers` → re-render), ce qui cassait la mémoïsation de
TOUTES les `LayerRow` — la régression de performance à 24MP que ce `memo` existe
précisément pour empêcher.
**How to apply** : dépendre de la FONCTION précise (`presets.clearActive`,
stable car en `useCallback([])`), jamais de l'objet de retour du hook. Envelopper
le retour du hook dans un `useMemo` ne règle rien si ses fonctions changent
elles-mêmes d'identité — ça ne fige que l'enveloppe.

## 2026-07-28 — un compte de tests ne prouve « inchangé » que mesuré deux fois au MÊME HEAD

**Découverte (TTL 6 mois)** : plusieurs sessions mergent des
`worktree-agent-*` dans `master` en continu sur ce repo (4 merges en 30 min
le 2026-07-28 : `bf6810d`, `7821eae`, `24e8cf7`, `8d3b7f0`). Un baseline pris
avant un changement et un run pris après ne portent donc pas sur le même
arbre : 760 tests unitaires sont devenus 788 sans qu'aucune ligne de la
session ne soit en cause. La baseline citée dans une consigne (747/73) était
elle-même déjà périmée à la lecture.
**How to apply** : pour prouver qu'un changement laisse les comptes
inchangés, ne pas comparer avant/après dans le temps — remettre
temporairement l'état d'origine et relancer, en encadrant les deux runs d'un
`git rev-parse --short HEAD` identique. Corollaire : tout compte de tests
écrit quelque part porte sa date ET son SHA, sinon il ment dès le lendemain.

## 2026-07-28 — changer le rôle ou l'aria-label d'un contrôle casse sa story en silence

**Correction** : `c0d18b5` a remplacé la `Checkbox` « Masque actif » par un
`IconButton` `aria-pressed` (`MaskPanel.tsx:146-158`), le libellé devenant un
`<span>` frère hors du bouton (`MaskPanel.tsx:159`) — donc hors du nom
accessible. Le commit n'a pas touché `MaskPanel.stories.tsx`, resté sur
`getByRole("checkbox", { name: "Masque actif" })`. L'échec a voyagé sur
`master` par quatre merges successifs sans que personne ne l'attribue à son
origine, parce qu'un `test-storybook` rouge se lit spontanément comme « cassé
par le dernier merge ».
**How to apply** : un refactor qui change le `role`, l'`aria-label` ou
l'association label↔contrôle d'un élément doit mettre à jour ses stories DANS
LE MÊME COMMIT. Le nom accessible d'un `IconButton` est son `aria-label`, qui
décrit l'ACTION (« Désactiver le masque »), pas l'état — un test qui cherche
le libellé visible ne le trouvera jamais. Pour dater un tel échec :
`git log --oneline -- <composant> <stories>` puis vérifier lequel de ces
commits ne touche QUE le composant.

## 2026-07-28 — `git stash push -- <chemins>` refuse un fichier supprimé en index, mais crée quand même une entrée vide

**Découverte (TTL 6 mois)** : sur un arbre portant une suppression stagée
(`git rm`), `git stash push --include-untracked -m "..." -- <chemins>` sort en
`fatal: pathspec ':(prefix:0)<chemin>' did not match any files` — et laisse
malgré tout une entrée dans `git stash list`, vide (`git stash show` ne rend
rien), pendant que l'arbre de travail reste intact. L'erreur ressemble à un
échec total alors qu'elle a un effet de bord.
**How to apply** : après tout `git stash push` qui échoue, vérifier
`git stash list` avant de conclure. Pour comparer deux états sans git, passer
par une édition de fichier directe (réécrire le fichier, relancer, ré-appliquer)
— c'est plus court et sans effet de bord sur l'index.

## 2026-07-29 — un export sans appelant n'est pas du code mort : ce dépôt a deux familles d'exports volontairement non appelés

**Découverte (TTL 6 mois)** : un balayage des 327 exports de `src/` a rendu 72
symboles sans aucun appelant en production. Après lecture, aucun n'était un
reliquat, et deux familles expliquent presque tout :
1. **Miroirs TS de WGSL** — `srgbToLinear`/`linearToSrgb`
   (`src/render/effects/srgbTransfer.ts`), `mirrorCoord`/`isotropicUvOffset`
   (`uvSpace.ts`), `ditheredQuantize` (`bayer.ts`), `computeGuidedAB`/
   `composeEdgeAware` (`src/mask/edgeAware.ts`). Leur en-tête le dit :
   « `UV_SPACE_WGSL` est la seule définition GPU ; les fonctions TS en-dessous en
   sont la spécification pure, testée en Node » (`uvSpace.ts:23`). Le GPU exécute
   la constante WGSL, le TS n'existe que pour être testé. Non appelé = leur rôle.
2. **`export interface XProps`** consommées uniquement dans leur propre fichier —
   convention React, ~35 des 72.
**How to apply** : avant de retirer un export « sans appelant » ici, lire son
en-tête de module. Le critère utile n'est pas « zéro appelant » mais « zéro
appelant ET aucune intention écrite ». Un balayage automatique ne tranche rien
tout seul dans ce dépôt. Témoin obligatoire pour valider le balayage lui-même :
un symbole connu-vivant (`LayerPanel` → 22 refs hors son fichier) ; une première
version du scan, via `rg` en `execSync` avec un `catch` silencieux, rendait
327/327 « morts » sans lever d'erreur ([[NG81]] en version inverse — un scan qui
trouve TOUT est aussi suspect qu'un scan qui ne trouve rien).

## 2026-07-29 — le mode `crop` du canvas est injoignable en production

**Découverte (TTL 6 mois)** : `CanvasMode` déclare trois variantes
(`src/ui/canvasMode.ts:22-25`) mais `{ kind: "crop" }` n'est construit nulle part
hors de son propre module — `git grep '"crop"' -- src` rend 3 occurrences, toutes
dans `canvasMode.ts` (25, 39, 75). `enterCrop` (`canvasMode.ts:38`) n'a aucun
appelant ; `usePhotoLayer` ne pose jamais que `IDLE_CANVAS_MODE` ou
`toggleMaskPaint` (`src/hooks/usePhotoLayer.ts:205-206`). Le garde
`reconcileCanvasMode` et la moitié de ses tests portent donc sur un état que
l'app ne peut pas atteindre.
**How to apply** : c'est une feature à moitié câblée (parité calque photo T1,
design 2026-07-26 §3.4), pas un reliquat — ne pas la « nettoyer ». Le travail
restant est le point d'entrée : ce qui appelle `enterCrop` depuis l'UI.

## 2026-07-29 — les références de `render-check` sont périmées depuis T1 : `npm run test:render` est rouge sur master, 6/6

**Découverte (TTL 6 mois)** : la tranche T1 (`26ab0ed`, « le fond du document
devient un calque ordinaire ») a été mergée dans master sans régénérer
`test/render-refs/*.png` — `git diff --stat 3e05658..master -- test/render-refs/
scripts/render-check.mjs` rend vide. Mesuré sur master seul
(`9272a7d`, branche jetable `tmp/baseline-master`, aucune modification locale) :

```
FAIL base                   ecart max 255 > 1 LSB  [max 255, moyenne 106.6865]
FAIL effets-glow-posterize  ecart max 255 > 1 LSB  [max 255, moyenne 142.6365]
FAIL grain-graine-fixe      ecart max 255 > 1 LSB  [max 255, moyenne 106.9312]
FAIL photo-double-exposure  ecart max 255 > 1 LSB  [max 255, moyenne 73.7160]
FAIL masque-pinceau-degrade ecart max 255 > 1 LSB  [max 255, moyenne 107.1959]
FAIL masque-edge-aware      ecart max 255 > 1 LSB  [max 255, moyenne 98.7802]
```

Cause probable, non vérifiée en profondeur : les scénarios construisent leur
pile avec `new LayerStack()` nu (`scripts/render-check.mjs:287-353`) et
n'ajoutent jamais de calque photo de fond. Depuis T1, `loadImage` n'uploade plus
la photo dans la toile (`allocateCanvas`, `renderer.ts`) — la toile est vide,
donc les six scénarios rendent sur du noir. Le protocole reste reproductible
(2 passes, 0 canal d'écart) : c'est bien la RÉFÉRENCE qui est périmée, pas le
rendu qui est instable.
**How to apply** : tant que ce n'est pas réglé, `npm run test:render` ne peut
pas servir de preuve de non-régression sur une branche basée après T1 — il est
rouge quoi qu'on fasse. Deux gestes à faire ensemble, et dans cet ordre :
adapter les scénarios pour qu'ils posent le calque photo de fond (sinon on
verrouille une image noire comme référence), PUIS `--update` et relire les six
PNG avant de committer. Le mode `--diagnostic`, lui, reste valable : il ne
compare à aucune référence.

## 2026-07-29 — l'overlay de masque suit la destination, comme le damier

**Correction (projet)** : toute aide de VISÉE (damier de fond, overlay
safelight, isolation de calque) se dérive de `PresentDestination`, jamais lue
directement depuis un champ d'état du `Renderer` au moment d'encoder la frame.
Trois de ces aides existent aujourd'hui, chacune avec son point de dérivation
unique : `presentBackgroundFor` et `maskOverlayFor` (`src/render/presentPass.ts`),
et `projectIsolation` appliqué dans `render()` seulement (`renderer.ts`).
**Why** : `exportFrame` et le rendu d'écran partagent `runPipeline`. Une aide
qui lit son état d'interface directement part donc AUSSI dans le fichier
exporté, en silence. Mesuré le 2026-07-29 (`render-check.mjs --diagnostic`,
avant correctif `87cf44f`) : le voile rouge de l'overlay occupait 51 248 canaux
sur 262 144 du JPEG exporté (19,55 %), et le fichier était en prime
non déterministe (3 799 canaux d'écart entre deux exports du même document,
la passe d'overlay recevant `performance.now()`).
**How to apply** : en ajoutant une quatrième aide de visée, ne pas se contenter
d'une convention d'appel — ajouter la fonction de dérivation à côté de ses deux
sœurs dans `presentPass.ts`, pour que « cette aide, dans le fichier exporté »
reste inexprimable. Et vérifier au passage ce que le résultat de frame alimente
en aval : le correctif a dû garder `lastOverlayFrame` réservé au chemin canvas,
sinon un export figeait l'animation du contour jusqu'au rendu d'écran suivant.
