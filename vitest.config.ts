import { defineConfig, configDefaults } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alias } from './vite.config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // The project's `vite.config.ts` default export is an async factory, so
  // `extends: true` does NOT pull its `@`→./src alias into the projects.
  // Declaring it here at the root makes both projects inherit it. The alias
  // object is the single source of truth imported from vite.config.ts.
  resolve: {
    alias,
  },
  test: {
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
