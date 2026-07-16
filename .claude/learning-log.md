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
