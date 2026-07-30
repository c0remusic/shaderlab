import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'src-tauri/**',
      'node_modules/**',
      'storybook-static/**',
      '.claude/**',
      'scripts/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      // Version NON type-checked : pas de programme TS chargé, lint rapide.
      ...tseslint.configs.recommended,
      // v7 : la forme flat config vit sous `configs.flat`,
      // `configs.recommended` est encore la forme eslintrc (plugins: []).
      reactHooks.configs.flat.recommended,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  {
    // Stories Storybook : une story déclare son composant dans une propriété
    // `render:`, dont le nom est en minuscule. La règle y voit une fonction
    // ordinaire appelant un hook et lève `rules-of-hooks` — c'est un FAUX
    // POSITIF de nommage, pas un problème d'ordre d'appel : Storybook monte
    // `render` comme un composant à part entière. Vérifié sur les trois seules
    // occurrences du repo (`slider.stories.tsx:10,60`,
    // `labeled-slider.stories.tsx:60`), toutes des `useState` en tête de
    // `render`. Laisser la règle active ici ferait démarrer le linter avec
    // trois erreurs fausses, ce qui apprend à l'ignorer.
    files: ['src/**/*.stories.tsx'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
);
