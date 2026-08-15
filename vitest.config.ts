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
