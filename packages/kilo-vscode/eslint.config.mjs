import typescriptEslint from "typescript-eslint"
import eslintConfigPrettier from "eslint-config-prettier"

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
  },
  {
    plugins: {
      "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
      parser: typescriptEslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
    },

    rules: {
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],

      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      "max-lines": ["error", 3000],
    },
  },
  {
    files: ["src/KiloProvider.ts"],
    rules: {
      "max-lines": ["error", 3300],
    },
  },
  eslintConfigPrettier,
]
