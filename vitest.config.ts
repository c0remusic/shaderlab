import { defineConfig, configDefaults } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { alias } from './vite.config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite's default `server.fs.allow` is derived from `searchForWorkspaceRoot`,
// which stops climbing at the first ancestor holding a lockfile — here,
// this worktree's own `package-lock.json`, so the allow list is just
// `dirname`. Two distinct worktree layouts break this:
// - `node_modules` is a symlink to the main checkout (`worktree.
//   symlinkDirectories`): Vite resolves it to its real path before checking
//   the allow list, which falls outside `dirname`.
// - `node_modules` is a real but incomplete/empty directory (no packages
//   installed in the worktree): Node's resolution algorithm climbs to the
//   nearest ancestor `node_modules` that actually has the package — also
//   outside `dirname`.
// Either way `@storybook/addon-vitest`'s setup-file import gets rejected
// with "outside of Vite serving allow list" before a single story/play
// function runs. Resolving where the package *actually* lives via Node's
// own resolver (which already climbs the tree and follows symlinks) and
// allow-listing its real parent fixes both cases, plus the normal
// single-checkout case.
const require = createRequire(import.meta.url);
const addonVitestPkgPath = require.resolve('@storybook/addon-vitest/package.json', {
  paths: [dirname],
});
// .../node_modules/@storybook/addon-vitest/package.json -> .../node_modules
const nodeModulesRealPath = path.dirname(path.dirname(path.dirname(addonVitestPkgPath)));

export default defineConfig({
  // The project's `vite.config.ts` default export is an async factory, so
  // `extends: true` does NOT pull its `@`→./src alias into the projects.
  // Declaring it here at the root makes both projects inherit it. The alias
  // object is the single source of truth imported from vite.config.ts.
  resolve: {
    alias,
  },
  server: {
    fs: {
      allow: [dirname, path.dirname(nodeModulesRealPath)],
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        ...configDefaults.coverage.exclude ?? [],
        '**/*.stories.*',
        '**/*.test.*',
        '**/*.config.*',
        'node_modules/**',
        '.claude/worktrees/**',
      ],
      reporter: ['text', 'html'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          // ⚠️ `tools/**` porte des clones TIERS (shadplay et son vendoring de
          // Bevy, 8000 fichiers), et Vitest ne lit pas `.gitignore` : sans cette
          // exclusion il ramasse leurs specs — vécu à la minute où le clone est
          // entré dans l'arbre (`tools/shadplay/bevy/.github/.../wasm_example.spec.ts`,
          // suite en échec sur 129 fichiers). Un outil posé dans le dépôt entre
          // dans le périmètre de TOUS les scanners de fichiers, pas seulement de
          // git.
          exclude: [...configDefaults.exclude, '.claude/worktrees/**', 'tools/**'],
        },
      },
      {
        extends: true,
        plugins: [
          storybookTest({ configDir: path.join(dirname, '.storybook') }),
          // Sans ce plugin, les stories rendent SANS Tailwind : `flex`,
          // `sr-only` et les hauteurs arbitraires fondées sur les tokens CSS
          // n'existent pas pendant
          // les tests, alors qu'elles existent sous `storybook dev` (dont la
          // config vient de vite.config.ts, qui le charge). Toute assertion de
          // style y etait donc aveugle — decouvert le 2026-07-28 en mesurant un
          // en-tete a 132px sous vitest contre 92px en rendu reel.
          tailwindcss(),
        ],
        // PRÉ-BUNDLER `react/jsx-dev-runtime` PLUTÔT QUE LE LAISSER DÉCOUVRIR
        // (2026-08-16) — c'est le correctif du ticket 22.
        //
        // LE DÉFAUT. `LayerPanel.stories.tsx` échouait en CI ubuntu depuis le
        // 2026-08-01 et passait en local, sur `TypeError: Cannot read properties
        // of null (reading 'useMemo')` avec `renderWithHooks` DANS la pile. La
        // lecture naturelle est « deux copies de React » — elle est fausse.
        //
        // CE QUE LA MESURE DIT. Le défaut ne dépend ni de l'OS ni de React, mais
        // de l'état du CACHE DE PRÉ-BUNDLING. Vidé `node_modules/.cache/storybook`
        // et `node_modules/.vite`, la suite échoue en LOCAL exactement pareil :
        // 5 fichiers, dont `LayerPanel.stories.tsx`. Relancée sans rien changer,
        // cache désormais chaud : 32 fichiers, 311 tests, vert. La CI, elle,
        // tourne TOUJOURS à froid — `npm ci` sur une machine neuve.
        //
        // LE MÉCANISME, que Vite annonce lui-même :
        //   ✨ new dependencies optimized: react/jsx-dev-runtime
        //   [vitest] Vite unexpectedly reloaded a test.
        //   ✨ optimized dependencies changed. reloading
        // La dépendance est découverte EN COURS d'exécution, Vite ré-optimise et
        // RECHARGE la page ; l'arbre React est détruit en plein rendu, et un
        // composant qui appelle `useMemo` lit alors un dispatcher nul. L'erreur
        // décrit la conséquence, jamais la cause — d'où deux semaines à chercher
        // un double React qui n'existait pas.
        //
        // Pourquoi `LayerPanel.stories.tsx` et pas un autre : c'est celui que le
        // hasard d'ordonnancement place au moment du rechargement. Rien de
        // particulier à ce composant.
        //
        // ⚠️ LE JEU EST COMPLET À DESSEIN, et ce n'est pas de la précaution.
        // La première version de ce correctif ne listait que
        // `react/jsx-dev-runtime` — la seule que Vite ait découverte CE
        // jour-là. Or ce qui déclenche le rechargement n'est pas cette entrée en
        // particulier, c'est qu'une entrée QUELCONQUE de React soit découverte
        // en cours de route ; le jeu qui sera découvert dépend de l'ordre des
        // fichiers et du hasard d'ordonnancement. Corriger sur l'entrée observée
        // corrige l'instance, pas la classe.
        // Ce jeu-ci vient de `claude/mattpocock-skills-wayfinder-6lxjiz`
        // (`0f6feba`), branche jamais fusionnée où quelqu'un avait déjà attaqué
        // le même défaut — trouvée en mesurant les branches avant de les
        // supprimer.
        // Second garde, repris de la meme branche : il vise l'AUTRE mecanisme
        // par lequel un dispatcher React peut etre nul — deux copies du paquet
        // dans le graphe, l'une servant le rendu et l'autre le composant. Ce
        // n'est PAS le defaut mesure ici (npm ls rend tout deduplique), mais les
        // deux echouent de la meme facon et le cout est nul.
        resolve: { dedupe: ['react', 'react-dom'] },
        optimizeDeps: {
          include: [
            'react',
            'react-dom',
            'react-dom/client',
            'react/jsx-runtime',
            'react/jsx-dev-runtime',
          ],
        },
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            provider: playwright({}),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
