module.exports = {
  // Environment setup - defines global variables for different environments
  env: {
    node: true,
    es2022: true,
    jest: false, // Using tap testing framework instead
  },

  // Extend from recommended configurations
  extends: [
    'eslint:recommended',
    '@typescript-eslint/recommended',
    '@typescript-eslint/recommended-requiring-type-checking',
    'prettier', // Must be last to override other formatting rules
  ],

  // Parser configuration for TypeScript
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json', // Required for type-aware rules
    tsconfigRootDir: __dirname,
  },

  // Plugins for additional linting capabilities
  plugins: ['@typescript-eslint', 'prettier'],

  // Root configuration - prevents ESLint from looking in parent directories
  root: true,

  // Custom rule configurations
  rules: {
    // Prettier integration
    'prettier/prettier': 'error',

    // TypeScript specific rules
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_', // Allow unused parameters starting with _
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/prefer-const': 'error',
    '@typescript-eslint/no-var-requires': 'error',

    // Fastify specific best practices
    'no-console': 'warn', // Prefer using Fastify's logging
    'prefer-const': 'error',
    'no-var': 'error',

    // General code quality rules
    'eqeqeq': ['error', 'always'], // Require strict equality
    'curly': ['error', 'all'], // Require braces for all control statements
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',

    // Error handling
    'no-throw-literal': 'error',
    'prefer-promise-reject-errors': 'error',

    // Performance
    'no-loop-func': 'error',
    'no-extend-native': 'error',

    // Security
    'no-new-require': 'error',
    'no-path-concat': 'error',

    // Async/Promise best practices
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    'require-await': 'off', // Disabled in favor of TypeScript version
    '@typescript-eslint/require-await': 'error',

    // Disable rules that conflict with Prettier
    'max-len': 'off',
    'indent': 'off',
    '@typescript-eslint/indent': 'off',
  },

  // Override rules for specific file patterns
  overrides: [
    {
      // Test files - more relaxed rules
      files: ['test/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        'no-console': 'off',
      },
    },
    {
      // Configuration files
      files: ['*.config.js', '*.config.ts', '.eslintrc.js'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
        'no-console': 'off',
      },
    },
    {
      // Migration files - database specific relaxed rules
      files: ['migrations/**/*.js', 'migrations/**/*.ts'],
      rules: {
        '@typescript-eslint/explicit-function-return-type': 'off',
        'no-console': 'off',
      },
    },
  ],

  // Files to ignore (in addition to .eslintignore)
  ignorePatterns: [
    'dist/',
    'node_modules/',
    'coverage/',
    '*.js.map',
    '.tap/',
    'data/',
    'backups/',
  ],
};