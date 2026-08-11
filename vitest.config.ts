import { defineConfig, configDefaults } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
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
    // Browser-mode stories render through react-dom while components import
    // `react` through Vite's own resolution. Without dedupe those two can
    // land on separate copies of the package, leaving React 19's hook
    // dispatcher (`ReactSharedInternals.H`) null on the copy the component
    // sees — surfacing as "Cannot read properties of null (reading 'useState')"
    // at the first hook call, before any assertion runs.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // Pre-bundle the whole React entry set together so the optimizer cannot
    // mix a pre-bundled copy with a raw CJS one (the two-copies case above).
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
    ],
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
          exclude: [...configDefaults.exclude, '.claude/worktrees/**'],
        },
      },
      {
        extends: true,
        plugins: [
          storybookTest({ configDir: path.join(dirname, '.storybook') }),
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            provider: playwright({}),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
          setupFiles: ['./.storybook/vitest.setup.ts'],
        },
      },
    ],
  },
});
