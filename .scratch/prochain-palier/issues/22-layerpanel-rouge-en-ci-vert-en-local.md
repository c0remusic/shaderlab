# `LayerPanel.stories` est rouge en CI et vert en local

Type: research
Status: resolved
Parent: ../map.md

## ✅ RÉSOLU le 2026-08-16 — et ce n'était ni React, ni ubuntu

**La cause est l'état du CACHE DE PRÉ-BUNDLING de Vite, rien d'autre.**
`react/jsx-dev-runtime` n'était pas déclaré dans `optimizeDeps.include` : Vite le
DÉCOUVRE en cours d'exécution, ré-optimise, et **recharge la page**. L'arbre React
est alors détruit en plein rendu, et le composant qui appelle `useMemo` lit un
dispatcher nul.

Correctif : `optimizeDeps: { include: ['react/jsx-dev-runtime'] }` sur le projet
`storybook` de `vitest.config.ts`. Une ligne.

### Le protocole qui l'a trouvé, et qui vaut plus que le correctif

La CI tourne **toujours à froid** (`npm ci` sur une machine neuve) ; en local, le
cache est chaud dès la deuxième exécution. D'où :

| état du cache | résultat |
| --- | --- |
| froid (cache vidé) | **5 fichiers en échec**, dont `LayerPanel.stories.tsx` |
| chaud (2ᵉ passe, rien changé) | 32 fichiers, 311 tests, vert |
| froid **avec le correctif** | 32 fichiers, 311 tests, **vert** |

```powershell
Remove-Item -Recurse -Force node_modules\.cache\storybook, node_modules\.vite
npm run test-storybook
```

**Vider le cache reproduit la CI en local.** C'est la manipulation qui manquait à
l'énoncé d'origine, lequel proposait de reproduire « ubuntu, chromium, npm ci » —
trois pistes coûteuses et toutes fausses.

### Ce que l'erreur disait, et pourquoi elle a menti deux semaines

```
TypeError: Cannot read properties of null (reading 'useMemo')
  ❯ LayerPanel src/components/LayerPanel.tsx
  ❯ renderWithHooks react-dom-client.development.js
```

`renderWithHooks` DANS la pile avec un dispatcher nul est la signature manuelle
du **double React** — c'est ce que l'énoncé d'origine, et moi, avons lu. La
signature était juste, le diagnostic faux : il n'y a qu'une copie de React
(`npm ls react` : tout dédupliqué en 19.2.7), et le dispatcher est nul parce que
la page a été **rechargée sous le rendu**, pas parce qu'il vient d'une autre
instance.

⚠️ **Vite annonçait la cause en toutes lettres, dans le même flot de sortie** :

```
✨ new dependencies optimized: react/jsx-dev-runtime
[vitest] Vite unexpectedly reloaded a test.
For a stable experience, please add mentioned dependencies to your
config's `optimizeDeps.include` field manually.
✨ optimized dependencies changed. reloading
```

Elle n'apparaît QUE sur un run à froid. Les logs de CI que j'avais lus étaient
filtrés sur `FAIL|Error|TypeError` — le message qui donnait la réponse ne
contenait aucun de ces mots.

### Deux hypothèses écartées, et l'une m'a fait conclure de travers

- **Double React** : réfutée par `npm ls react react-dom`, tout dédupliqué.
- **`resolve.dedupe: ['react','react-dom']`** : essayée, et la suite a cassé en
  local juste après. J'en ai conclu que le correctif était nuisible — **c'était
  faux** : la casse venait du cache que je venais de vider pour l'essai, pas du
  changement. Deux variables bougées en même temps, et j'ai attribué l'effet à la
  mauvaise. C'est ce contretemps qui a mis le cache sur la piste.

### Pourquoi ce fichier-là

Aucune raison tenant à `LayerPanel` : c'est celui que l'ordonnancement place au
moment du rechargement. N'importe quel autre aurait fait l'affaire — et de fait,
à froid, quatre autres tombent avec lui.

## Ce qui rendrait ce ticket raté (énoncé d'origine, conservé)

Marquer le fichier `skip` pour retrouver du vert. `LayerPanel` porte la pile de
calques et ses 30+ stories sont sa seule couverture automatique.
