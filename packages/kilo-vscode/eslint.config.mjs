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
      complexity: ["error", 20],
    },
  },

  // ── Complexity exceptions ─────────────────────────────────────────
  // Existing violations capped at their current max.
  // New code must stay ≤ 20. Do not raise these caps; refactor instead.
  {
    files: ["src/KiloProvider.ts"],
    rules: { complexity: ["error", 140], "max-lines": ["error", 3350] },
  },
  {
    files: ["webview-ui/agent-manager/AgentManagerApp.tsx"],
    rules: { complexity: ["error", 74], "max-lines": ["error", 3100] },
  },
  {
    files: ["src/agent-manager/AgentManagerProvider.ts"],
    rules: { complexity: ["error", 64] },
  },
  {
    files: ["webview-ui/src/components/chat/PromptInput.tsx"],
    rules: { complexity: ["error", 48] },
  },
  {
    files: ["src/legacy-migration/migration-service.ts"],
    rules: { complexity: ["error", 45] },
  },
  {
    files: ["webview-ui/src/components/migration/MigrationWizard.tsx"],
    rules: { complexity: ["error", 37] },
  },
  {
    files: ["webview-ui/src/context/session.tsx"],
    rules: { complexity: ["error", 31] },
  },
  {
    files: ["src/services/autocomplete/classic-auto-complete/AutocompleteInlineCompletionProvider.ts"],
    rules: { complexity: ["error", 30] },
  },
  {
    files: ["src/agent-manager/WorktreeManager.ts", "webview-ui/src/components/chat/QuestionDock.tsx"],
    rules: { complexity: ["error", 28] },
  },
  {
    files: [
      "src/kilo-provider-utils.ts",
      "src/services/autocomplete/continuedev/core/autocomplete/postprocessing/index.ts",
    ],
    rules: { complexity: ["error", 27] },
  },
  {
    files: ["webview-ui/src/components/settings/CustomProviderDialog.tsx"],
    rules: { complexity: ["error", 26] },
  },
  {
    files: ["src/agent-manager/WorktreeStateManager.ts"],
    rules: { complexity: ["error", 24] },
  },
  {
    files: ["webview-ui/src/utils/errorUtils.ts"],
    rules: { complexity: ["error", 23] },
  },
  {
    files: ["src/services/autocomplete/continuedev/core/autocomplete/filtering/BracketMatchingService.ts"],
    rules: { complexity: ["error", 22] },
  },
  {
    files: ["webview-ui/src/context/server.tsx"],
    rules: { complexity: ["error", 21] },
  },

  eslintConfigPrettier,
]
