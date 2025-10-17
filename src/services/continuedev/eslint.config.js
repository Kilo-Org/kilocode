const tseslint = require("@typescript-eslint/eslint-plugin");
const tsparser = require("@typescript-eslint/parser");

module.exports = [
  {
    ignores: ["**/testWorkspaceDir/**", "**/__fixtures__/**", "**/node_modules/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
      },
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/naming-convention": "off",
      "@typescript-eslint/semi": "off",
      "quotes": ["off", "double", {}],
      "curly": "off",
      "eqeqeq": "error",
      "complexity": "off",
      "max-lines-per-function": "off",
      "max-statements": "off",
      "max-depth": ["error", { max: 6 }],
      "max-nested-callbacks": ["error", { max: 4 }],
      "max-params": ["error", { max: 8 }],
    },
  },
  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.vitest.ts",
    ],
    rules: {
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
    },
  },
];