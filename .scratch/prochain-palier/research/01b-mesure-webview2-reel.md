# Mesure dans le WebView2 réel — le trou déclaré est refermé

Complément de [`01-16-bit-hors-du-depot.md`](01-16-bit-hors-du-depot.md), qui
énonçait franchement son trou : ses mesures avaient été prises dans **Edge
151.0.4129.72**, pas dans le processus WebView2 de shaderlab, faute de binaire
sur disque.

Mesuré le 2026-08-12 dans la **vraie fenêtre**, app lancée avec
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, sonde
évaluée par CDP dans sa page.

## Le verdict : identique

| Vérification | Edge 151.0.4129.72 | **WebView2 151.0.4129.78** |
| --- | --- | --- |
| `rgba16float` en `RENDER_ATTACHMENT` | ✅ | ✅ |
| Filtrage linéaire, device demandé **sans aucune feature** | ✅ | ✅ |
| `copyTextureToBuffer` + `mapAsync` (2048 octets relus) | ✅ | ✅ |
| `getPreferredCanvasFormat()` | — | **`bgra8unorm`** |

Version exacte du runtime, lue sur `/json/version` : **`Edg/151.0.4129.78`** —
c'est bien le `.78` annoncé, un patch après le `.72` d'Edge. L'agent utilisateur
de la page, lui, arrondit à `151.0.0.0` et ne sert à rien pour ça.

## Le témoin de discrimination, qui rend ce vert lisible

Un vert n'est une preuve que si le même instrument sait rendre rouge. Contrôle
négatif exécuté dans la même sonde : `rgba32float` est **refusé** au filtrage.

> `None of the supported sample types (UnfilterableFloat) of [Texture (unlabeled
> 4x1 px, TextureFormat::RGBA32Float)] match`

⚠️ **Et le détail qui compte** : l'adaptateur ANNONCE `float32-filterable` dans
ses features. Le device ayant été demandé **sans aucune feature**, le 32-bit
reste malgré tout non filtrable. La distinction « disponible » contre
« demandé » est donc vérifiée en acte, pas supposée — c'est exactement ce qui
sépare `rgba16float` (filtrable sans rien demander) de `rgba32float`.

## L'adaptateur, et une correction de méthode

```
vendor: "nvidia"   architecture: "turing"   isFallbackAdapter: false
subgroupMinSize: 32   subgroupMaxSize: 32   device: ""   description: ""
```

`isFallbackAdapter: false` : c'est bien le GPU, pas le « Microsoft Basic Render
Driver » (WARP) que la machine expose aussi.

⚠️ **Correction de méthode, à ne pas repayer.** Une première passe a rapporté
`adapter.info` = `{}` et j'ai failli en conclure « le backend n'est pas
observable ». C'était **un défaut de la sonde** : les champs de `GPUAdapterInfo`
sont des **accesseurs de prototype**, donc `{...adapter.info}` et
`Object.keys()` rendent vide alors que les données sont là. Mesuré :
`_clesPropres = 0` mais sept accesseurs sur le prototype. Les lire **par leur
nom**. Le `[non mesuré]` du document parent sur l'info d'adaptateur vient très
probablement du même piège.

Même famille que les défauts de sonde déjà catalogués dans ce dépôt : lire les
pixels par `drawImage` (rend du noir hors frame), patcher
`__TAURI_INTERNALS__.invoke` (n'intercepte rien). **Une sonde se valide avant
de croire son résultat négatif.**

## Ce qui reste ouvert, et ce que ça bloque vraiment

### Le nom du backend Dawn — ouvert, et sans conséquence

`chrome://gpu` est **inaccessible dans WebView2** (ouvert dans une cible
séparée, `innerText` vide). `SystemInfo.getInfo` du protocole donne bien un
rapport GPU, mais son `glRenderer` décrit **ANGLE / Direct3D11**, qui est le
chemin **WebGL** — pas Dawn. Ne pas lire cette ligne comme le backend WebGPU :
ce serait la même erreur de proxy que celle qu'on vient de corriger.

**Mais la question se dissout.** Le backend n'a jamais été intéressant en
lui-même : il était un proxy pour « la mesure prise ailleurs est-elle
représentative de shaderlab ». Mesurer dans shaderlab lui-même rend le proxy
inutile, quel que soit le backend que Dawn a choisi.

### Un seul GPU — ouvert, et NON refermable ici

La machine n'expose que deux devices : **NVIDIA GeForce RTX 2060** (Turing,
driver 32.0.15.9186) et **Microsoft Basic Render Driver** (WARP logiciel).
`optimus: false`, `amdSwitchable: false` — **aucun iGPU, aucun graphisme
hybride**. Les trois `powerPreference` (`défaut`, `high-performance`,
`low-power`) rendent la même liste de features : il n'y a rien d'autre à
interroger.

Rien n'est donc établi pour un Intel ou un AMD, et **ça ne se refermera pas
depuis cette machine** — seulement sur un autre matériel. À garder tel quel
plutôt qu'à laisser croire que le check l'a couvert.

## Reproduire

App lancée avec le port CDP (voir `.claude/skills/run-shaderlab/`), puis la
sonde du document parent § « Pour refermer le trou déclaré », évaluée dans la
page — en lisant `adapter.info` **champ par champ**, jamais par spread.
