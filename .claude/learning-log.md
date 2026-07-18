# shaderlab — learning-log (leçons projet)

Store instinct-system, portée projet. Écrivain = wrap-up seul. Voir
`~/.claude/CLAUDE.md` § Store instinct-system pour la convention globale.

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
