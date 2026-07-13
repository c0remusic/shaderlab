# Remédiation architecture — design

> Chantier issu de l'audit d'architecture du 2026-07-13 (3 agents lecture
> seule : modularité/testabilité, flux de données/scalabilité, sécurité/infra).
> Objectif : corriger les défauts structurels AVANT le chantier standalone v1,
> pour que les cibles mesurables de la spec
> (`docs/superpowers/specs/2026-07-13-shaderlab-standalone-v1-design.md`)
> soient atteignables.

## Constats retenus (preuve : codebase, audit du 2026-07-13)

1. **Chemin chaud du rendu** : recompilation WGSL + recréation de pipeline à
   chaque passe de chaque frame (`renderer.ts:345,374`) ; texture de masque
   24MP recréée/réuploadée par frame, et 24 Mo CPU alloués par passe quand le
   masque est null (`renderer.ts:466-479`) ; rendu synchrone par pointer-move
   sans coalescing rAF (`App.tsx:141-172`). Cibles spec (slider < 100 ms,
   pinceau < 50 ms) intenables ainsi.
2. **Historique** : snapshots profonds non bornés (`history.ts:12-16`,
   `layerStack.ts:45-52` copie chaque masque) ; une entrée par tick de drag de
   slider au lieu d'une par interaction. Borne spec : 512 Mo, éviction des
   plus anciennes, état courant toujours conservé.
3. **Robustesse fichier** : `fs::write` non atomique sur la cible du
   round-trip Lightroom (`lib.rs:12`) — crash mi-écriture = JPEG source
   détruit ; commandes lecture/écriture disque non bornées ; CSP null ;
   `get_launch_path` paniquable (args non-UTF16) et sans filtre d'extension.
4. **IPC** : images sérialisées en JSON `number[]` (`launch.ts:8,12`),
   ~4-6x d'inflation et copies CPU bloquantes. Tauri v2 supporte les bytes
   bruts (`tauri::ipc::Response` / `InvokeBody::Raw` + headers) — vérifié
   dans la doc officielle v2.tauri.app le 2026-07-13 via Context7.
5. **Garde-fous manquants** : troncature silencieuse à 8 params d'effet
   (`renderer.ts:302-304`) ; buffer de readback export jamais détruit
   (`renderer.ts:427-437`) ; `requestDevice()` sans `requiredLimits` →
   plafond 8192 px silencieux (`gpuContext.ts:25`).

## Décisions

- **Cache de pipelines par code shader** : la composition WGSL devient une
  fonction pure (`composeShader`) dont la sortie sert de clé de cache. Les
  pipelines/bind group layouts sont créés une fois par variante et réutilisés.
- **Masques résidents GPU** : une texture r8unorm par calque, réuploadée
  seulement quand la référence `maskData` change ; masque absent = texture
  blanche 1×1 partagée (le sampler linéaire rend 1.0 partout, comportement
  identique à l'actuel `fill(255)` sans les 24 Mo par passe).
- **Coalescing rAF** : un `FrameScheduler` pur (rAF injectable, testable en
  Node) ; N demandes de rendu par frame → 1 rendu, dernière pile gagnante.
- **Masques immuables partagés** : `updateMask` copie déjà — `clone()` cesse
  de recopier les masques et partage les références. `currentStack()` (appelé
  par sample de pinceau) passe de O(pixels) à O(métadonnées), et l'historique
  peut compter les octets réellement retenus par refcount de buffers.
- **Historique borné** : réécriture de `History` avec budget d'octets
  (512 Mo par défaut, injectable en test), refcount des buffers de masque
  partagés, éviction des entrées les plus anciennes, état courant jamais
  évincé. Une entrée par interaction de slider (commit au pointer-up/keyup,
  mise à jour vivante sans commit pendant le drag).
- **Écriture atomique** : `write .tmp` puis `rename` (même volume →
  atomique ; sous Windows `std::fs::rename` remplace la cible existante).
  Filtre d'extension `.jpg/.jpeg` sur l'écriture. `get_launch_path` passe à
  `args_os()` + `to_string_lossy` (plus de panique possible).
- **CSP minimale** : `default-src 'self'` + directives ipc/img/style
  nécessaires (Tauri injecte ses nonces automatiquement). Identifier
  `com.c0remusic.shaderlab`.
- **IPC binaire** : lecture via `tauri::ipc::Response::new(bytes)` →
  `invoke<ArrayBuffer>` ; écriture via corps brut `Uint8Array` + header
  `x-target-path` percent-encodé (headers ASCII seulement — les chemins
  Windows accentués passent par `encodeURIComponent`/`percent_decode_str`).
- **Fail-fast effets** : validation au chargement du registry — un effet
  déclarant plus de `MAX_EFFECT_PARAMS` (8) paramètres lève une erreur
  explicite au lieu d'être tronqué.

## Différé (pas assez de preuve maintenant — trigger de réouverture nommé)

- **Extraction `EditorDocument`/`WorkspaceSession` hors d'App.tsx** (finding
  majeur de l'audit) — sa forme dépend du design de la pellicule multi-photo.
  L'extraire maintenant serait la designer à l'aveugle et entrerait en
  collision avec le plan design system en cours. Trigger : ouverture du
  chantier workspace multi-photo v1.
- **Peinture de masque GPU** (il reste un memcpy ~24 Mo par sample de pinceau
  dans `updateMask`) — la spec v1 prévoit déjà un chantier « masquage GPU
  persistant ». Trigger : ce chantier.
- **Progression d'export réelle** (readback par tuiles) — trigger : chantier
  « Exporter sous » v1.
- **Cache des paramBuffers** (64 octets créés par passe par frame) — coût
  négligeable a priori. Trigger : profilage montrant un coût mesurable après
  le cache de pipelines.
- **N renderers / éviction VRAM multi-image** — trigger : chantier pellicule.

## Écarté

- Suppression de `readPixels()` : gardé, documenté comme outil de debug d'une
  passe intermédiaire — aucun coût tant qu'il n'est pas appelé.

## Séquencement

- Ce chantier s'exécute **après la fin du plan design system**
  (`docs/superpowers/plans/2026-07-13-shaderlab-design-system.md`, en cours
  sur `feature/design-system`), sur une branche dédiée
  `feature/archi-remediation`. Raison : le design system verrouille App.tsx
  (invariant « ne pas modifier les handlers ») et réécrit ParamPanel ; les
  tâches 3 et 11 de ce plan touchent ces fichiers.
- Les tâches 1-2 et 4-10 ne dépendent d'aucun livrable du design system ;
  seule la tâche 11 devra s'adapter à la primitive Slider si elle a remplacé
  les `<input type="range">`.
