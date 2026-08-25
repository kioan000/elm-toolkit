import tseslint from 'typescript-eslint'
import stylistic from '@stylistic/eslint-plugin'
import perfectionistPlugin from 'eslint-plugin-perfectionist'
import tsdocPlugin from 'eslint-plugin-tsdoc'
import importPlugin from 'eslint-plugin-import-x'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'eslint.config.mts'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      '@stylistic': stylistic,
      perfectionist: perfectionistPlugin,
      tsdoc: tsdocPlugin,
    },
    extends: [tseslint.configs.recommended, importPlugin.flatConfigs.recommended, importPlugin.flatConfigs.typescript],
    settings: {
      'import-x/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: '/.tsconfig.json',
        },
        node: true,
      },
    },
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2015,
      },

      parser: tseslint.parser,
      ecmaVersion: 2018,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          modules: true,
        },
        projectService: true,
        // @ts-ignore
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'arrow-body-style': [
        'error',
        'as-needed',
        {
          requireReturnForObjectLiteral: true,
        },
      ],

      camelcase: [
        'error',
        {
          ignoreGlobals: true,
        },
      ],

      'class-methods-use-this': 'error',
      'default-case-last': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',

      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        {
          accessibility: 'explicit',
        },
      ],

      'func-style': [
        'error',
        'declaration',
        {
          allowArrowFunctions: true,
          overrides: { namedExports: 'declaration' },
        },
      ],

      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/no-deprecated': 'warn',
      'import-x/no-named-as-default-member': 'off',
      'new-cap': 'error',
      'no-duplicate-imports': 'error',
      'import-x/no-duplicates': 'off',

      '@typescript-eslint/no-explicit-any': [
        'error',
        {
          ignoreRestArgs: true,
        },
      ],

      'no-promise-executor-return': 'error',
      'no-template-curly-in-string': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          // args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      'no-var': 'error',

      '@stylistic/padding-line-between-statements': [
        'error',
        {
          blankLine: 'always',
          prev: '*',
          next: 'return',
        },
        {
          blankLine: 'always',
          prev: '*',
          next: 'switch',
        },
        {
          blankLine: 'always',
          prev: '*',
          next: 'default',
        },
        {
          blankLine: 'always',
          prev: '*',
          next: 'function',
        },
        {
          blankLine: 'always',
          prev: '*',
          next: 'for',
        },
        {
          blankLine: 'always',
          prev: '*',
          next: 'try',
        },
        {
          blankLine: 'always',
          prev: '*',
          next: 'throw',
        },
        {
          blankLine: 'always',
          prev: '*',
          next: 'do',
        },
      ],

      'prefer-const': 'error',
      'require-atomic-updates': 'error',
      'sort-imports': [
        'error',
        {
          ignoreCase: false,
          ignoreDeclarationSort: true,
          ignoreMemberSort: false,
          memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
          allowSeparatedGroups: false,
        },
      ],

      'sort-keys': 'off',
      'perfectionist/sort-objects': 'error',
      'perfectionist/sort-interfaces': 'error',
      'perfectionist/sort-object-types': 'error',
      '@stylistic/spaced-comment': 'error',
      'tsdoc/syntax': 'error',
      // 'jsdoc/check-alignment': 'error',
      // 'jsdoc/check-param-names': 'error',
      // 'jsdoc/check-property-names': 'error',
      // 'jsdoc/check-tag-names': 'error',
      // 'jsdoc/check-types': 'error',
      // 'jsdoc/check-values': 'error',
      // 'jsdoc/empty-tags': 'error',
      // 'jsdoc/implements-on-classes': 'error',
      // 'jsdoc/multiline-blocks': 'error',
      // 'jsdoc/no-multi-asterisks': 'error',
      // 'jsdoc/no-types': 'error',
      // 'jsdoc/no-undefined-types': 'error',
      // 'jsdoc/require-asterisk-prefix': 'error',
      // 'jsdoc/require-description': 'error',
      // 'jsdoc/require-jsdoc': [
      //   'error',
      //   {
      //     require: {
      //       ArrowFunctionExpression: false,
      //       ClassDeclaration: false,
      //       FunctionDeclaration: true,
      //       FunctionExpression: false,
      //       MethodDefinition: true,
      //     },
      //   },
      // ],
      //
      // 'jsdoc/require-hyphen-before-param-description': 'error',
      // 'jsdoc/require-param': 'error',
      // 'jsdoc/require-param-description': 'error',
      // 'jsdoc/require-param-name': 'error',
      // 'jsdoc/require-returns': 'error',
      // 'jsdoc/require-returns-check': 'error',
      // 'jsdoc/require-returns-description': 'error',
      // 'jsdoc/require-throws': 'error',
      // 'jsdoc/require-yields': 'error',
      // 'jsdoc/require-yields-check': 'error',
      //
      // 'jsdoc/tag-lines': [
      //   'error',
      //   'any',
      //   {
      //     startLines: 1,
      //   },
      // ],
      //
      // 'jsdoc/valid-types': 'error',
    },
  },
  {
    // disable type-aware linting on plain JS files
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  }
)
