import { defineConfig, configDefaults } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alias } from './vite.config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite's default `server.fs.allow` is derived from `searchForWorkspaceRoot`,
// which stops climbing at the first ancestor holding a lockfile — here,
// this worktree's own `package-lock.json`, so the allow list is just
// `dirname`. In a git worktree whose `node_modules` is a symlink to the
// main checkout (see `worktree.symlinkDirectories`), Vite resolves that
// symlink to its real path before checking it against the allow list, and
// the real path (the main checkout's `node_modules`) falls outside
// `dirname` — so `@storybook/addon-vitest`'s setup-file import (and any
// other package deep-import) gets rejected with "outside of Vite serving
// allow list" before a single story/play function runs. Resolving the
// symlink ourselves and allow-listing its real parent fixes this for both
// a real (non-symlinked) `node_modules` and a symlinked one.
const nodeModulesRealPath = fs.realpathSync(path.join(dirname, 'node_modules'));

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
