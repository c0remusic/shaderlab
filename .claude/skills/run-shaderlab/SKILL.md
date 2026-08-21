---
name: run-shaderlab
description: Build, launch, drive, screenshot and verify shaderlab — the Tauri v2 + React + WebGPU desktop photo-effects app. Use when asked to run, start, launch, open, screenshot, debug or visually check shaderlab, add an effect in the real window, or run its gates (tests, lint, GPU shader compile, pixel-lock render check).
---

# Piloter shaderlab

App **desktop Windows** : Tauri v2 (coquille Rust) + React + WebGPU/WGSL brut,
dans une fenêtre **WebView2 native**. Il n'y a pas de « page à ouvrir » : aucun
`npm start` ne rend la main, Playwright ne peut pas l'attacher, et `computer-use`
ne sait pas la cibler (ce n'est pas une app enregistrée au menu Démarrer).

**Le seul handle programmatique est le DevTools Protocol de la WebView2**, activé
par une variable d'environnement au lancement. Le pilote
[`driver.mjs`](driver.mjs) est ce handle.

Chemins relatifs à la racine du dépôt (`C:\dev\shaderlab`).

## Prérequis

Rien à installer si le dépôt a déjà tourné : Node (Vite, Vitest), Rust/cargo
(`src-tauri`), et le runtime **WebView2**, présent d'origine sur Windows 10/11.

⚠️ **`src-tauri/Cargo.toml` porte `[profile.dev.package."*"] opt-level = 3`, et
ce n'est pas décoratif.** Sans ce bloc, le décodeur JPEG du crate `image` non
optimisé met **49,6 s** pour une vignette de texture 8K, contre 2,0 s avec.
Mesuré le 2026-08-05. Ne pas le retirer « pour accélérer la compilation ».

## Lancer (chemin agent) — À FAIRE EN PREMIER

Un seul lancement, avec le port CDP. **Ne pas utiliser `npm run tauri dev` nu :**
sans la variable d'environnement, aucun pilotage n'est possible.

```powershell
Get-Process -Name shaderlab -ErrorAction SilentlyContinue | Stop-Process -Force
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
Start-Process -FilePath "npm.cmd" -ArgumentList @("run","tauri","dev") -WorkingDirectory "C:\dev\shaderlab" -RedirectStandardOutput ".dev-logs\relance-out.log" -RedirectStandardError ".dev-logs\relance-err.log" -WindowStyle Hidden
for ($i=0; $i -lt 90; $i++) { Start-Sleep -Seconds 4; if (Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue) { Write-Output "CDP up apres $($i*4+4)s"; break } }
```

Premier build Rust : ~4 min. Ensuite ~5 s. Si rien n'écoute sur 9222 au bout de
6 min, lire `.dev-logs\relance-err.log`.

⚠️ **« Ouvre shaderlab » veut dire « montre-la-moi », pas « démarre le process ».
Le port CDP présent et une capture `Page.captureScreenshot` réussie NE prouvent
PAS que la fenêtre est visible à l'écran** — la WebView2 rend et se capture même
en arrière-plan, et même une fenêtre qui va se fermer. Vécu le 2026-08-21 :
annoncé « ouvert » sur la foi d'une capture, la fenêtre n'était pas devant
Antoine (« ?? c'est pas ouvert »), et le premier process s'était refermé seul
sans erreur au log. Après lancement, vérifier `Get-Process -Name shaderlab`
(PID + `MainWindowHandle` non nul), attendre ~10 s qu'il tienne, puis le forcer
au premier plan avant de dire « ouvert » :

```powershell
$p = Get-Process -Name shaderlab -ErrorAction SilentlyContinue
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class W{[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);}'
[W]::ShowWindow($p.MainWindowHandle, 9) | Out-Null   # 9 = SW_RESTORE
[W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
```

Le `-WindowStyle Hidden` du `Start-Process` cache la console npm, pas la fenêtre
Tauri — mais rien ne garantit qu'elle passe au premier plan seule.

Il existe aussi `npm run dev:debug` (script maison, même effet) — ⚠️ **il tue
TOUT process nommé `shaderlab` sur la machine**, y compris celui d'une autre
session ou d'un autre worktree.

## Piloter

```bash
node .claude/skills/run-shaderlab/driver.mjs status
```

```
url        : http://localhost:1420/
pont debug : présent
document   : AUCUN — ouvrir une photo avant d'ajouter un effet
cartes     : ["Presets","Pile","Textures"]
```

Commandes (toutes rendent un code de sortie non nul en cas d'échec) :

| Commande | Effet |
| --- | --- |
| `status` | app / pont de debug / document / cartes du dock |
| `open <chemin.jpg>` | ouvre une photo — **chemin ABSOLU** |
| `shot <sortie.png>` | capture la fenêtre **et mesure son contenu** |
| `signature` | statistiques des pixels RÉELLEMENT composés |
| `layers` | pile de calques |
| `add-effect <Nom>` | ajoute un calque d'effet par son nom affiché |
| `param <index> <valeur>` | pose la valeur du n-ième curseur du panneau |
| `textures` | dossier + état du store de textures |
| `eval <expression>` | JS arbitraire dans la page |
| `reload` | recharge et attend le pont de debug |

Un parcours complet, vérifié :

```bash
S=".claude/skills/run-shaderlab/driver.mjs"
node $S open "C:\\Users\\LEETJ\\Pictures\\vram-test\\photo-1.jpg"
node $S add-effect Texture
node $S signature
node $S param 6 14
node $S signature
node $S shot /tmp/shaderlab.png
```

`signature` passe de `{"moyenne":46.04,"ecart":63.10}` à
`{"moyenne":54.25,"ecart":73.15}` quand le curseur 6 (Contraste) monte à 14 —
c'est comme ça qu'on prouve qu'un réglage AGIT.

### ⚠️ Le screenshot MARCHE, contrairement à ce que dit CLAUDE.md

`CLAUDE.md` § *Moyen de preuve (UI)* affirme que la vérification visuelle exige
un checkpoint humain, parce que « le canvas WebGPU en WebView2 rend noir en
headless ». **C'est vrai pour Playwright headless et faux pour CDP sur la vraie
fenêtre** : `Page.captureScreenshot` rend une PNG 3440×1377 où la photo, les
effets et le dock sont tous visibles. Vérifié le 2026-08-05.

`shot` **mesure** ce qu'il écrit et le dit. Un écart-type sous 1 signifie un
aplat — fenêtre minimisée, ou rien de rendu. Une capture noire de 300 Ko a
l'air d'une réussite jusqu'à ce qu'on l'ouvre.

## Lancer (chemin humain)

`npm run tauri dev` ouvre la fenêtre et ne rend jamais la main. Aucun pilotage
possible : pas de port CDP. Utile seulement pour regarder.

## Portes de vérification

Toutes lancées et vertes le 2026-08-05.

```bash
npx tsc --noEmit
npm run test
npm run lint
npm run lint:tokens
cd src-tauri && cargo check
```

Deux portes **GPU**, locales seulement (la CI n'a pas de carte). Les deux exigent
l'app lancée ci-dessus **plus** un Vite du worktree courant sur 1421 :

```powershell
Start-Process -FilePath "npx.cmd" -ArgumentList @("vite","--port","1421") -WorkingDirectory "C:\dev\shaderlab" -RedirectStandardOutput ".dev-logs\vite1421.out.log" -RedirectStandardError ".dev-logs\vite1421.err.log" -WindowStyle Hidden
```

```bash
node scripts/gpu-shader-check.mjs --origin http://localhost:1421
npm run test:render
```

La première compile les 157 shaders composés. La seconde compare les pixels aux
références versionnées ; `npm run test:render -- --update` les réécrit — **les
relire à l'œil avant de committer**.

## Gotchas

Chacun a coûté du temps réel.

- **`npm run test:gpu-shaders` SANS `--origin` est un faux témoin, dans les deux
  sens.** Il compile les modules FIGÉS en cache de la fenêtre, pas ton édition :
  un `import()` d'une URL déjà évaluée rend l'instance en cache. Toujours passer
  `--origin http://localhost:1421` avec un Vite frais.

- **Le harnais de rendu n'a AUCUN accès IPC.** Ses modules viennent du Vite 1421,
  et Tauri v2 restreint ses commandes à l'origine de l'app : tout `invoke` y
  répond `read_image_file not allowed. Plugin not found`. Un scénario ne doit
  donc jamais dépendre d'un fichier — il génère ses images dans la page, et
  `Renderer` accepte un troisième argument (port de décodage de texture) que le
  harnais remplit avec sa mire générée.

- **Ne JAMAIS lire les pixels par `drawImage` du canvas.** La surface de
  présentation WebGPU rend du **noir** hors de sa frame. Une sonde qui la lit
  rapporte « aucun changement » aussi bien quand l'effet est mort que quand il
  marche — vécu, deux fois. Passer par `signature` (qui lit
  `Renderer.exportFrame()`).

- **Patcher `window.__TAURI_INTERNALS__.invoke` n'intercepte rien.** Les modules
  importent `invoke` depuis `@tauri-apps/api/core` — une autre référence. Un
  espion posé là rapporte zéro appel alors que l'IPC travaille.

- **Un objet WebGPU lu par spread rend `{}`, et ce vide n'est PAS une absence de
  donnée.** `{...adapter.info}` et `Object.keys(adapter.info)` rendent vide
  parce que les champs de `GPUAdapterInfo` sont des **accesseurs de prototype**.
  Lus par leur nom, ils sont tous là (`vendor`, `architecture`, `device`,
  `description`, `subgroupMinSize`, `subgroupMaxSize`, `isFallbackAdapter`).
  Vérifié le 2026-08-12 : `Object.keys(info).length === 0` et sept accesseurs
  sur `Object.getPrototypeOf(info)`. **Un résultat VIDE se raconte tout seul une
  histoire crédible** (« la plateforme ne l'expose pas ») — imprimer
  `getOwnPropertyNames(getPrototypeOf(x))` avant d'y croire. Vaut pour tout objet
  d'API navigateur, pas seulement WebGPU.

- **Une sonde sans témoin de discrimination ne prouve rien, même en vert.** Dans
  la même passe, `rgba16float` passait le filtrage ET `rgba32float` était refusé
  (`None of the supported sample types (UnfilterableFloat)`) : c'est le second
  qui rend le premier lisible. Faire porter à toute sonde un cas dont on SAIT
  qu'il doit échouer, sinon un vert d'instrument mort et un vert de vraie
  réussite ont exactement la même tête.

- **`SystemInfo.getInfo` (CDP, endpoint NAVIGATEUR et non page) donne le rapport
  GPU** — devices, driver, `optimus`/`amdSwitchable`. ⚠️ Son `glRenderer` décrit
  **ANGLE / Direct3D11**, qui est le chemin **WebGL** : ne jamais le lire comme
  le backend **WebGPU**, que Dawn choisit séparément. `chrome://gpu` est
  inaccessible dans WebView2 (page vide, même ouverte dans une cible séparée).

- **Le dock existe SANS document ouvert.** Les cartes Presets / Pile / Textures
  s'affichent sur l'écran d'accueil. Le seul témoin fiable d'un document est
  `state().layers.length`, pas la présence du dock.

- **Les titres de carte sont des `<span>`, la bascule est un bouton SANS texte.**
  Chercher un bouton nommé « Textures » ne trouve rien et se lit comme « la carte
  n'existe pas ». Passer par `.docked-panel-card__title` puis
  `.closest('.docked-panel-card__titlebar')`.

- **Les curseurs n'ont ni `aria-label` ni texte adjacent.** Les désigner par leur
  rang (`param <index>`) ou par leurs bornes
  (`node $S eval "..."` sur `.min`/`.max`), jamais par un libellé.

- **`window.__shaderlabDebug` est `import.meta.env.DEV` seulement.** Absent d'un
  build de production — normal, pas une panne.

- **Backticks.** Un backtick dans un commentaire ferme le template literal qui le
  porte. Deux endroits : tout corps `wgsl:` (⇒ `npx tsc --noEmit` après TOUTE
  édition de shader, l'erreur `TS1005` désigne une ligne LOIN de la faute), et le
  bloc de scénarios de `scripts/render-check.mjs` (⇒ `tsc` ne voit rien, le
  script meurt sur `SyntaxError: Unexpected identifier` nommant le mot QUI SUIT).
  Convention du fichier de scénarios : ni backtick ni accent dans les
  commentaires.

- **`App.tsx` peut faire abandonner le compilateur React.** Y ajouter ~200 lignes
  a éteint `react-hooks/refs` sur TOUT le fichier. Le seul signal : `npm run
  lint` passe de 0 problème à des `Unused eslint-disable directive` en rafale.
  Lire le COMPTE de warnings, pas seulement « 0 error ».

## Troubleshooting

| Symptôme | Cause et remède |
| --- | --- |
| `Port 1420 is already in use` | Vite orphelin d'une session morte. `Get-NetTCPConnection -LocalPort 1420` puis tuer le PID propriétaire. |
| `ECHEC : CDP injoignable sur http://localhost:9222` | App lancée sans `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`. Relancer avec le bloc ci-dessus. |
| `window.__shaderlabDebug absent` | Build de production, ou React pas encore monté. Attendre, ou vérifier qu'on est en `tauri dev`. |
| `Bouton « Ajouter un effet » introuvable` | Aucun document ouvert. `node $S open <photo.jpg>` d'abord. |
| `exit code: 0xcfffffff` dans les logs | Un second lancement a tué le premier (`dev:debug` tue tout `shaderlab`). Ne lancer qu'une fois. |
| `read_image_file not allowed. Plugin not found` | Un module servi par 1421 tente un `invoke`. Voir le gotcha « harnais sans IPC ». |
| `test:render` : `un scenario au moins ne porte plus de signal` | **Garde volontaire, pas un bug du harnais.** Le scénario rend la même image que son témoin. Aucune référence n'est écrite — figer une image morte rendrait le verrou vert et aveugle. |
